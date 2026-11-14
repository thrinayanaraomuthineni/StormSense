import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeAlertSeverity,
  normalizeAlertStatus,
  sortAlertsByPriority,
} from '../src/lib/alertSummary';
import { DEFAULT_RISK_WEIGHTS } from '../src/lib/riskEngine';
import { DISTRICT_MAP } from '../src/lib/telanganaDistricts';
import type {
  AlertConfig,
  AlertItem,
  Crew,
  DispatchHistoryEntry,
  Incident,
  RiskScoringWeights,
  RiskSnapshotRecord,
  SavedSimulationScenario,
  UserAccount,
  WeatherObservation,
} from '../src/lib/types';

const DB_PATH = process.env.STORMSENSE_DB_PATH || path.join(process.cwd(), 'data', 'stormsense.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL,
    department TEXT NOT NULL,
    discom TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS incidents (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    districtId TEXT NOT NULL,
    districtName TEXT NOT NULL,
    locationName TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    severity TEXT NOT NULL,
    faultType TEXT NOT NULL,
    description TEXT NOT NULL,
    source TEXT NOT NULL,
    status TEXT NOT NULL,
    assignedCrewId TEXT,
    affectedConsumers INTEGER NOT NULL DEFAULT 0,
    restorationNotes TEXT NOT NULL DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    resolvedAt TEXT
  );

  CREATE TABLE IF NOT EXISTS crews (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    districtId TEXT NOT NULL,
    districtName TEXT NOT NULL,
    baseLocation TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    members INTEGER NOT NULL,
    skills TEXT NOT NULL,
    availability TEXT NOT NULL,
    status TEXT NOT NULL,
    activeIncidentId TEXT,
    completedJobs INTEGER NOT NULL DEFAULT 0,
    locationSource TEXT NOT NULL DEFAULT 'Simulated Demonstration Data',
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    dedupeKey TEXT,
    type TEXT NOT NULL,
    severity TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'New',
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    explanation TEXT NOT NULL DEFAULT '',
    districtId TEXT,
    districtName TEXT,
    incidentId TEXT,
    incidentTitle TEXT,
    assignedCrewId TEXT,
    assignedCrewName TEXT,
    provenance TEXT NOT NULL,
    isRead INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL,
    updatedAt TEXT,
    acknowledgedAt TEXT,
    resolvedAt TEXT
  );

  CREATE TABLE IF NOT EXISTS alert_config (
    id TEXT PRIMARY KEY,
    moderateRiskThreshold INTEGER NOT NULL DEFAULT 31,
    highRiskThreshold INTEGER NOT NULL,
    criticalRiskThreshold INTEGER NOT NULL,
    highWindThresholdKmh INTEGER NOT NULL,
    heavyRainThresholdMm INTEGER NOT NULL,
    unassignedAlertMinutes INTEGER NOT NULL,
    restorationDelayMinutes INTEGER NOT NULL,
    smsEnabled INTEGER NOT NULL DEFAULT 0,
    whatsappEnabled INTEGER NOT NULL DEFAULT 0,
    emailEnabled INTEGER NOT NULL DEFAULT 0,
    smsWebhookStatus TEXT NOT NULL,
    whatsappWebhookStatus TEXT NOT NULL,
    emailSmtpStatus TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS weather_cache (
    districtId TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    fetchedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS risk_snapshots (
    id TEXT PRIMARY KEY,
    districtId TEXT NOT NULL,
    districtName TEXT NOT NULL,
    riskScore INTEGER NOT NULL,
    riskCategory TEXT NOT NULL,
    rainMm REAL NOT NULL,
    windSpeedKmh REAL NOT NULL,
    windGustsKmh REAL NOT NULL,
    past24hRainMm REAL NOT NULL DEFAULT 0,
    activeIncidents INTEGER NOT NULL DEFAULT 0,
    confidence TEXT NOT NULL DEFAULT 'HIGH',
    recordedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS risk_weights (
    id TEXT PRIMARY KEY,
    rainfall REAL NOT NULL,
    wind REAL NOT NULL,
    gusts REAL NOT NULL,
    thunderstorm REAL NOT NULL,
    precipitationProb REAL NOT NULL,
    historicalWeather REAL NOT NULL,
    recordedIncidents REAL NOT NULL,
    gridVulnerability REAL NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS dispatch_history (
    id TEXT PRIMARY KEY,
    incidentId TEXT NOT NULL,
    incidentTitle TEXT NOT NULL,
    crewId TEXT NOT NULL,
    crewName TEXT NOT NULL,
    action TEXT NOT NULL,
    previousCrewId TEXT,
    previousCrewName TEXT,
    crewStatus TEXT NOT NULL,
    incidentStatus TEXT NOT NULL,
    distanceKm REAL,
    etaMinutes INTEGER,
    routingMode TEXT,
    notes TEXT NOT NULL DEFAULT '',
    performedBy TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS simulation_scenarios (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    createdBy TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    paramsJson TEXT NOT NULL,
    targetDistrictName TEXT NOT NULL,
    baselineScore INTEGER NOT NULL,
    simulatedScore INTEGER NOT NULL,
    deltaScore INTEGER NOT NULL,
    elevatedDistrictCount INTEGER NOT NULL,
    peakCategory TEXT NOT NULL,
    summaryNote TEXT NOT NULL
  );
`);

function ensureColumn(table: string, column: string, definition: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function migrateAlertSchemaAndData() {
  ensureColumn('alerts', 'dedupeKey', 'TEXT');
  ensureColumn('alerts', 'status', "TEXT NOT NULL DEFAULT 'New'");
  ensureColumn('alerts', 'explanation', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('alerts', 'districtName', 'TEXT');
  ensureColumn('alerts', 'incidentTitle', 'TEXT');
  ensureColumn('alerts', 'assignedCrewId', 'TEXT');
  ensureColumn('alerts', 'assignedCrewName', 'TEXT');
  ensureColumn('alerts', 'updatedAt', 'TEXT');
  ensureColumn('alerts', 'acknowledgedAt', 'TEXT');
  ensureColumn('alerts', 'resolvedAt', 'TEXT');

  ensureColumn('alert_config', 'moderateRiskThreshold', 'INTEGER NOT NULL DEFAULT 31');
  ensureColumn('risk_snapshots', 'past24hRainMm', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('risk_snapshots', 'activeIncidents', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('risk_snapshots', 'confidence', "TEXT NOT NULL DEFAULT 'HIGH'");

  // Normalize legacy alert rows cleanly
  const rows = db.prepare('SELECT * FROM alerts ORDER BY createdAt DESC').all() as Array<{
    id: string;
    dedupeKey: string | null;
    type: string;
    severity: string;
    status: string | null;
    title: string;
    message: string;
    explanation: string | null;
    districtId: string | null;
    districtName: string | null;
    incidentId: string | null;
    isRead: number;
    createdAt: string;
    updatedAt: string | null;
    acknowledgedAt: string | null;
  }>;

  const updateStmt = db.prepare(
    `UPDATE alerts
     SET dedupeKey = ?, severity = ?, status = ?, explanation = ?, districtName = ?, updatedAt = ?, acknowledgedAt = ?
     WHERE id = ?`
  );
  const seenOpenKeys = new Set<string>();
  const deleteStmt = db.prepare('DELETE FROM alerts WHERE id = ?');

  const tx = db.transaction(() => {
    for (const r of rows) {
      const normalizedSev = normalizeAlertSeverity(r.severity);
      const normalizedStatus = normalizeAlertStatus(r.status, Boolean(r.isRead));
      let key = r.dedupeKey;
      if (!key) {
        if (r.type === 'critical_vulnerability' || r.type === 'risk_threshold') {
          key = r.districtId ? `risk:${r.districtId}` : `legacy:${r.id}`;
        } else if (r.type === 'weather_deterioration') {
          key = r.districtId ? `weather:${r.districtId}` : `legacy:${r.id}`;
        } else if (r.type === 'unassigned_incident') {
          key = r.incidentId ? `incident:unassigned:${r.incidentId}` : `legacy:${r.id}`;
        } else if (r.type === 'restoration_delay') {
          key = r.incidentId ? `incident:delay:${r.incidentId}` : `legacy:${r.id}`;
        } else if (r.type === 'crew_assignment') {
          key = r.incidentId ? `incident:active:${r.incidentId}` : `legacy:${r.id}`;
        } else {
          key = `legacy:${r.id}`;
        }
      }

      if (normalizedStatus !== 'Resolved') {
        if (seenOpenKeys.has(key)) {
          deleteStmt.run(r.id);
          continue;
        }
        seenOpenKeys.add(key);
      }

      const dName = r.districtName || (r.districtId ? DISTRICT_MAP.get(r.districtId)?.name ?? null : null);
      const explanation = r.explanation && r.explanation.trim().length > 0 ? r.explanation : r.message;
      const updatedAt = r.updatedAt || r.createdAt;
      const acknowledgedAt =
        r.acknowledgedAt || (normalizedStatus === 'Acknowledged' ? updatedAt : null);

      updateStmt.run(
        key,
        normalizedSev,
        normalizedStatus,
        explanation,
        dName,
        updatedAt,
        acknowledgedAt,
        r.id
      );
    }
  });
  tx();

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_alerts_active_dedupe
    ON alerts(dedupeKey)
    WHERE dedupeKey IS NOT NULL AND status != 'Resolved';
  `);
}

migrateAlertSchemaAndData();

function seedInitialData() {
  const userCount = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
  if (userCount === 0) {
    const insertUser = db.prepare(
      'INSERT INTO users (id, name, email, role, department, discom) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const seedUsers: UserAccount[] = [
      {
        id: 'USR-ADMIN',
        name: 'Srikanth Rao, IAS',
        email: 'admin@energy.telangana.gov.in',
        role: 'Administrator',
        department: 'State Grid Control Center',
        discom: 'TGTRANSCO',
      },
      {
        id: 'USR-MGR',
        name: 'Padmavathi Reddy',
        email: 'ops.manager@tgspdcl.in',
        role: 'Operations Manager',
        department: 'Southern Distribution Operations',
        discom: 'TGSPDCL',
      },
      {
        id: 'USR-FIELD',
        name: 'Ramesh Goud',
        email: 'field.dispatch@tgnpdcl.in',
        role: 'Field Operator',
        department: 'Northern Line Maintenance',
        discom: 'TGNPDCL',
      },
      {
        id: 'USR-EVAL',
        name: 'Dr. Ananya Sharma',
        email: 'evaluator@telangana.gov.in',
        role: 'Read-only Evaluator',
        department: 'Energy Audit & Oversight',
        discom: 'TGTRANSCO',
      },
    ];
    for (const u of seedUsers) {
      insertUser.run(u.id, u.name, u.email, u.role, u.department, u.discom);
    }
  }

  const configCount = (db.prepare('SELECT COUNT(*) as c FROM alert_config').get() as { c: number }).c;
  if (configCount === 0) {
    db.prepare(
      `INSERT INTO alert_config (
        id, moderateRiskThreshold, highRiskThreshold, criticalRiskThreshold, highWindThresholdKmh,
        heavyRainThresholdMm, unassignedAlertMinutes, restorationDelayMinutes,
        smsEnabled, whatsappEnabled, emailEnabled,
        smsWebhookStatus, whatsappWebhookStatus, emailSmtpStatus, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'default',
      31,
      61,
      81,
      40,
      10,
      30,
      120,
      0,
      0,
      0,
      'Not configured (requires TG-SMS Gateway credentials)',
      'Not configured (requires WhatsApp Business API token)',
      'Not configured (requires Department SMTP credentials)',
      new Date().toISOString()
    );
  }

  const weightsCount = (db.prepare('SELECT COUNT(*) as c FROM risk_weights').get() as { c: number }).c;
  if (weightsCount === 0) {
    db.prepare(
      `INSERT INTO risk_weights (
        id, rainfall, wind, gusts, thunderstorm, precipitationProb,
        historicalWeather, recordedIncidents, gridVulnerability, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'default',
      DEFAULT_RISK_WEIGHTS.rainfall,
      DEFAULT_RISK_WEIGHTS.wind,
      DEFAULT_RISK_WEIGHTS.gusts,
      DEFAULT_RISK_WEIGHTS.thunderstorm,
      DEFAULT_RISK_WEIGHTS.precipitationProb,
      DEFAULT_RISK_WEIGHTS.historicalWeather,
      DEFAULT_RISK_WEIGHTS.recordedIncidents,
      DEFAULT_RISK_WEIGHTS.gridVulnerability,
      new Date().toISOString()
    );
  }

  const crewCount = (db.prepare('SELECT COUNT(*) as c FROM crews').get() as { c: number }).c;
  if (crewCount === 0) {
    const now = new Date().toISOString();
    const insertCrew = db.prepare(
      `INSERT INTO crews (
        id, name, districtId, districtName, baseLocation, lat, lng, members, skills,
        availability, status, activeIncidentId, completedJobs, locationSource, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const seedCrews: Array<Omit<Crew, 'skills'> & { skills: string[] }> = [
      {
        id: 'CRW-HYD-01',
        name: 'Hyderabad Metro HT Alpha',
        districtId: 'hyderabad',
        districtName: 'Hyderabad',
        baseLocation: 'Mint Compound Grid Yard',
        lat: 17.4062,
        lng: 78.4691,
        members: 5,
        skills: ['HT Restoration', '33kV Feeder', 'Substation', 'Protection Relay'],
        availability: 'Available',
        status: 'Ready at Depot',
        activeIncidentId: null,
        completedJobs: 28,
        locationSource: 'Simulated Demonstration Data',
        updatedAt: now,
      },
      {
        id: 'CRW-HYD-02',
        name: 'Secunderabad Rapid Line Unit',
        districtId: 'hyderabad',
        districtName: 'Hyderabad',
        baseLocation: 'Habsiguda 132kV Yard',
        lat: 17.4184,
        lng: 78.5412,
        members: 4,
        skills: ['Distribution Transformer', '11kV Line', 'Tree Clearing'],
        availability: 'Deployed',
        status: 'On Site - Restoring',
        activeIncidentId: 'INC-2026-101',
        completedJobs: 19,
        locationSource: 'Simulated Demonstration Data',
        updatedAt: now,
      },
      {
        id: 'CRW-WGL-01',
        name: 'Warangal Circle HT Response',
        districtId: 'warangal',
        districtName: 'Warangal',
        baseLocation: 'Kazipet Substation Depot',
        lat: 17.9784,
        lng: 79.5065,
        members: 5,
        skills: ['132kV/33kV Line', 'HT Restoration', 'Fault Isolation'],
        availability: 'Available',
        status: 'Ready at Depot',
        activeIncidentId: null,
        completedJobs: 22,
        locationSource: 'Simulated Demonstration Data',
        updatedAt: now,
      },
      {
        id: 'CRW-KHM-01',
        name: 'Khammam Storm & Tree Unit',
        districtId: 'khammam',
        districtName: 'Khammam',
        baseLocation: 'Wyra Road Division Office',
        lat: 17.2412,
        lng: 80.1632,
        members: 6,
        skills: ['Tree Clearing', 'HT Restoration', '11kV Line', '33kV Feeder'],
        availability: 'Standby',
        status: 'Standby Reserve',
        activeIncidentId: null,
        completedJobs: 31,
        locationSource: 'Simulated Demonstration Data',
        updatedAt: now,
      },
      {
        id: 'CRW-KRM-01',
        name: 'Karimnagar Substation Team',
        districtId: 'karimnagar',
        districtName: 'Karimnagar',
        baseLocation: 'Manair 132kV Yard',
        lat: 18.4215,
        lng: 79.1389,
        members: 4,
        skills: ['Substation', 'Protection Relay', 'Distribution Transformer'],
        availability: 'Available',
        status: 'Ready at Depot',
        activeIncidentId: null,
        completedJobs: 17,
        locationSource: 'Simulated Demonstration Data',
        updatedAt: now,
      },
      {
        id: 'CRW-NZB-01',
        name: 'Nizamabad Feeder Patrol',
        districtId: 'nizamabad',
        districtName: 'Nizamabad',
        baseLocation: 'Dichpally Grid Center',
        lat: 18.618,
        lng: 78.146,
        members: 4,
        skills: ['33kV Feeder', 'Fault Isolation', 'HT Restoration'],
        availability: 'Available',
        status: 'Ready at Depot',
        activeIncidentId: null,
        completedJobs: 15,
        locationSource: 'Simulated Demonstration Data',
        updatedAt: now,
      },
      {
        id: 'CRW-NLG-01',
        name: 'Nalgonda Corridor Unit',
        districtId: 'nalgonda',
        districtName: 'Nalgonda',
        baseLocation: 'Narketpally Depot',
        lat: 17.1945,
        lng: 79.205,
        members: 4,
        skills: ['33kV Feeder', 'Distribution Transformer', 'HT Restoration'],
        availability: 'Available',
        status: 'Ready at Depot',
        activeIncidentId: null,
        completedJobs: 14,
        locationSource: 'Simulated Demonstration Data',
        updatedAt: now,
      },
      {
        id: 'CRW-KTG-01',
        name: 'Kothagudem Forest Line Crew',
        districtId: 'kothagudem',
        districtName: 'Bhadradri Kothagudem',
        baseLocation: 'Palvoncha Grid Station',
        lat: 17.595,
        lng: 80.706,
        members: 5,
        skills: ['Tree Clearing', '132kV/33kV Line', 'HT Restoration'],
        availability: 'Available',
        status: 'Ready at Depot',
        activeIncidentId: null,
        completedJobs: 26,
        locationSource: 'Simulated Demonstration Data',
        updatedAt: now,
      },
    ];
    for (const c of seedCrews) {
      insertCrew.run(
        c.id,
        c.name,
        c.districtId,
        c.districtName,
        c.baseLocation,
        c.lat,
        c.lng,
        c.members,
        JSON.stringify(c.skills),
        c.availability,
        c.status,
        c.activeIncidentId,
        c.completedJobs,
        c.locationSource,
        c.updatedAt
      );
    }
  }

  const incidentCount = (db.prepare('SELECT COUNT(*) as c FROM incidents').get() as { c: number }).c;
  if (incidentCount === 0) {
    const now = Date.now();
    const iso = (minsAgo: number) => new Date(now - minsAgo * 60_000).toISOString();
    const insertIncident = db.prepare(
      `INSERT INTO incidents (
        id, title, districtId, districtName, locationName, lat, lng, severity, faultType,
        description, source, status, assignedCrewId, affectedConsumers, restorationNotes,
        createdAt, updatedAt, resolvedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const seedIncidents: Incident[] = [
      {
        id: 'INC-2026-101',
        title: '11kV Uppal Industrial Feeder Breaker Trip',
        districtId: 'hyderabad',
        districtName: 'Hyderabad',
        locationName: 'Uppal IDA Substation Bay 4',
        lat: 17.4018,
        lng: 78.5602,
        severity: 'High',
        faultType: 'Feeder Trip',
        description:
          'Simulated demonstration incident: Overcurrent relay lockout triggered on 11kV industrial spur; crew isolating faulty cable section.',
        source: 'Simulated Demonstration Data',
        status: 'Under Maintenance',
        assignedCrewId: 'CRW-HYD-02',
        affectedConsumers: 3450,
        restorationNotes: 'Crew inspecting cable termination box at Peerzadiguda cross.',
        createdAt: iso(95),
        updatedAt: iso(18),
        resolvedAt: null,
      },
      {
        id: 'INC-2026-102',
        title: '33kV Tallada Rural Spur Tree Contact',
        districtId: 'khammam',
        districtName: 'Khammam',
        locationName: 'Tallada-Wyra 33kV Line Span 19',
        lat: 17.2194,
        lng: 80.3411,
        severity: 'Critical',
        faultType: 'Vegetation Contact',
        description:
          'Simulated demonstration incident: Wind-blown bamboo cluster leaning across phase-B conductor causing intermittent earth fault.',
        source: 'Simulated Demonstration Data',
        status: 'Reported',
        assignedCrewId: null,
        affectedConsumers: 5820,
        restorationNotes: 'Awaiting crew dispatch authorization from circle control.',
        createdAt: iso(42),
        updatedAt: iso(42),
        resolvedAt: null,
      },
      {
        id: 'INC-2026-103',
        title: '250 kVA Distribution Transformer Bush Failure',
        districtId: 'warangal',
        districtName: 'Warangal',
        locationName: 'Hanamkonda Chowrastha DTR-14',
        lat: 18.004,
        lng: 79.5582,
        severity: 'Medium',
        faultType: 'Transformer Fault',
        description:
          'Simulated demonstration incident: HT bushing flashover observed during high humidity evening peak load.',
        source: 'Simulated Demonstration Data',
        status: 'Detected',
        assignedCrewId: null,
        affectedConsumers: 680,
        restorationNotes: 'Feeder sectionalizer isolated; replacement bushing kit staged.',
        createdAt: iso(25),
        updatedAt: iso(25),
        resolvedAt: null,
      },
      {
        id: 'INC-2026-104',
        title: '33kV Palvoncha Line Insulator Replacement',
        districtId: 'kothagudem',
        districtName: 'Bhadradri Kothagudem',
        locationName: 'Palvoncha East Feeder',
        lat: 17.592,
        lng: 80.692,
        severity: 'Low',
        faultType: 'Substation Breaker',
        description:
          'Simulated demonstration incident: Scheduled post-fault insulator string replacement completed and line re-energized.',
        source: 'Simulated Demonstration Data',
        status: 'Restored',
        assignedCrewId: null,
        affectedConsumers: 1210,
        restorationNotes: 'Supply restored across all 4 downstream 11kV feeders.',
        createdAt: iso(340),
        updatedAt: iso(110),
        resolvedAt: iso(110),
      },
    ];
    for (const inc of seedIncidents) {
      insertIncident.run(
        inc.id,
        inc.title,
        inc.districtId,
        inc.districtName,
        inc.locationName,
        inc.lat,
        inc.lng,
        inc.severity,
        inc.faultType,
        inc.description,
        inc.source,
        inc.status,
        inc.assignedCrewId,
        inc.affectedConsumers,
        inc.restorationNotes,
        inc.createdAt,
        inc.updatedAt,
        inc.resolvedAt
      );
    }
  }
  const historyCount = (db.prepare('SELECT COUNT(*) as c FROM dispatch_history').get() as { c: number }).c;
  if (historyCount === 0) {
    const activeSeedInc = db
      .prepare('SELECT id, title, status, updatedAt FROM incidents WHERE id = ?')
      .get('INC-2026-101') as { id: string; title: string; status: string; updatedAt: string } | undefined;
    const activeSeedCrew = db
      .prepare('SELECT id, name, status FROM crews WHERE id = ?')
      .get('CRW-HYD-02') as { id: string; name: string; status: string } | undefined;
    if (activeSeedInc && activeSeedCrew) {
      db.prepare(
        `INSERT INTO dispatch_history (
          id, incidentId, incidentTitle, crewId, crewName, action, previousCrewId, previousCrewName,
          crewStatus, incidentStatus, distanceKm, etaMinutes, routingMode, notes, performedBy, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        'DSP-SEED-101',
        activeSeedInc.id,
        activeSeedInc.title,
        activeSeedCrew.id,
        activeSeedCrew.name,
        'assigned',
        null,
        null,
        activeSeedCrew.status,
        activeSeedInc.status,
        null,
        null,
        null,
        'Initial seeded demonstration dispatch for active Uppal feeder isolation.',
        'System Seed',
        activeSeedInc.updatedAt
      );
    }
  }
}

seedInitialData();

export function getUsers(): UserAccount[] {
  return db.prepare('SELECT * FROM users').all() as UserAccount[];
}

export function getCrews(): Crew[] {
  const rows = db.prepare('SELECT * FROM crews ORDER BY id ASC').all() as Array<
    Omit<Crew, 'skills'> & { skills: string }
  >;
  return rows.map((r) => ({
    ...r,
    skills: JSON.parse(r.skills || '[]') as string[],
  }));
}

export function getIncidents(): Incident[] {
  const crews = getCrews();
  const crewNameMap = new Map(crews.map((c) => [c.id, c.name]));
  const rows = db.prepare('SELECT * FROM incidents ORDER BY createdAt DESC').all() as Incident[];
  return rows.map((r) => ({
    ...r,
    assignedCrewName: r.assignedCrewId ? crewNameMap.get(r.assignedCrewId) ?? r.assignedCrewId : null,
  }));
}

export function getAlerts(): AlertItem[] {
  const rows = db.prepare('SELECT * FROM alerts ORDER BY COALESCE(updatedAt, createdAt) DESC LIMIT 200').all() as Array<{
    id: string;
    dedupeKey: string | null;
    type: AlertItem['type'];
    severity: string;
    status: string | null;
    title: string;
    message: string;
    explanation: string | null;
    districtId: string | null;
    districtName: string | null;
    incidentId: string | null;
    incidentTitle: string | null;
    assignedCrewId: string | null;
    assignedCrewName: string | null;
    provenance: AlertItem['provenance'];
    isRead: number;
    createdAt: string;
    updatedAt: string | null;
    acknowledgedAt: string | null;
    resolvedAt: string | null;
  }>;

  const normalized: AlertItem[] = rows.map((r) => ({
    id: r.id,
    dedupeKey: r.dedupeKey || `legacy:${r.id}`,
    type: r.type,
    severity: normalizeAlertSeverity(r.severity),
    status: normalizeAlertStatus(r.status, Boolean(r.isRead)),
    title: r.title,
    message: r.message,
    explanation: r.explanation || r.message,
    districtId: r.districtId,
    districtName:
      r.districtName || (r.districtId ? DISTRICT_MAP.get(r.districtId)?.name ?? null : null),
    incidentId: r.incidentId,
    incidentTitle: r.incidentTitle ?? null,
    assignedCrewId: r.assignedCrewId ?? null,
    assignedCrewName: r.assignedCrewName ?? null,
    provenance: r.provenance,
    isOfficialWarning: false,
    isRead: Boolean(r.isRead),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt || r.createdAt,
    acknowledgedAt: r.acknowledgedAt ?? null,
    resolvedAt: r.resolvedAt ?? null,
  }));

  return sortAlertsByPriority(normalized);
}

export function getAlertConfig(): AlertConfig {
  const row = db.prepare('SELECT * FROM alert_config WHERE id = ?').get('default') as Omit<
    AlertConfig,
    'smsEnabled' | 'whatsappEnabled' | 'emailEnabled'
  > & { smsEnabled: number; whatsappEnabled: number; emailEnabled: number };
  return {
    ...row,
    moderateRiskThreshold: Number(row.moderateRiskThreshold ?? 31),
    smsEnabled: Boolean(row.smsEnabled),
    whatsappEnabled: Boolean(row.whatsappEnabled),
    emailEnabled: Boolean(row.emailEnabled),
  };
}

export function saveWeatherCache(observations: WeatherObservation[]) {
  const stmt = db.prepare(
    'INSERT OR REPLACE INTO weather_cache (districtId, payload, fetchedAt) VALUES (?, ?, ?)'
  );
  const tx = db.transaction((items: WeatherObservation[]) => {
    for (const obs of items) {
      stmt.run(obs.districtId, JSON.stringify(obs), obs.fetchedAt);
    }
  });
  tx(observations);
}

export function loadWeatherCache(): WeatherObservation[] {
  const rows = db.prepare('SELECT payload FROM weather_cache').all() as Array<{ payload: string }>;
  return rows.map((r) => JSON.parse(r.payload) as WeatherObservation);
}

export function getRiskWeights(): RiskScoringWeights {
  const row = db.prepare('SELECT * FROM risk_weights WHERE id = ?').get('default') as
    | (RiskScoringWeights & { id?: string })
    | undefined;
  if (!row) {
    return { ...DEFAULT_RISK_WEIGHTS, updatedAt: new Date().toISOString() };
  }
  return {
    rainfall: Number(row.rainfall),
    wind: Number(row.wind),
    gusts: Number(row.gusts),
    thunderstorm: Number(row.thunderstorm),
    precipitationProb: Number(row.precipitationProb),
    historicalWeather: Number(row.historicalWeather),
    recordedIncidents: Number(row.recordedIncidents),
    gridVulnerability: Number(row.gridVulnerability),
    updatedAt: row.updatedAt,
  };
}

export function saveRiskWeights(weights: Omit<RiskScoringWeights, 'updatedAt'>): RiskScoringWeights {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE risk_weights
     SET rainfall = ?, wind = ?, gusts = ?, thunderstorm = ?, precipitationProb = ?,
         historicalWeather = ?, recordedIncidents = ?, gridVulnerability = ?, updatedAt = ?
     WHERE id = 'default'`
  ).run(
    weights.rainfall,
    weights.wind,
    weights.gusts,
    weights.thunderstorm,
    weights.precipitationProb,
    weights.historicalWeather,
    weights.recordedIncidents,
    weights.gridVulnerability,
    now
  );
  return getRiskWeights();
}

export function saveRiskSnapshots(snapshots: RiskSnapshotRecord[]) {
  const stmt = db.prepare(
    `INSERT INTO risk_snapshots (
      id, districtId, districtName, riskScore, riskCategory, rainMm, windSpeedKmh, windGustsKmh,
      past24hRainMm, activeIncidents, confidence, recordedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const tx = db.transaction((items: RiskSnapshotRecord[]) => {
    for (const s of items) {
      stmt.run(
        s.id,
        s.districtId,
        s.districtName,
        s.riskScore,
        s.riskCategory,
        s.rainMm,
        s.windSpeedKmh,
        s.windGustsKmh,
        s.past24hRainMm ?? 0,
        s.activeIncidents ?? 0,
        s.confidence ?? 'HIGH',
        s.recordedAt
      );
    }
  });
  tx(snapshots);
}

export function getRiskSnapshots(limit = 320): RiskSnapshotRecord[] {
  return db
    .prepare('SELECT * FROM risk_snapshots ORDER BY recordedAt DESC LIMIT ?')
    .all(limit) as RiskSnapshotRecord[];
}

export function recordDispatchHistory(
  entry: Omit<
    DispatchHistoryEntry,
    'id' | 'createdAt' | 'previousCrewId' | 'previousCrewName' | 'distanceKm' | 'etaMinutes' | 'routingMode'
  > & {
    id?: string;
    createdAt?: string;
    previousCrewId?: string | null;
    previousCrewName?: string | null;
    distanceKm?: number | null;
    etaMinutes?: number | null;
    routingMode?: DispatchHistoryEntry['routingMode'];
  }
): DispatchHistoryEntry {
  const id = entry.id || `DSP-${Date.now()}-${Math.floor(100 + Math.random() * 899)}`;
  const createdAt = entry.createdAt || new Date().toISOString();
  db.prepare(
    `INSERT INTO dispatch_history (
      id, incidentId, incidentTitle, crewId, crewName, action, previousCrewId, previousCrewName,
      crewStatus, incidentStatus, distanceKm, etaMinutes, routingMode, notes, performedBy, createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    entry.incidentId,
    entry.incidentTitle,
    entry.crewId,
    entry.crewName,
    entry.action,
    entry.previousCrewId ?? null,
    entry.previousCrewName ?? null,
    entry.crewStatus,
    entry.incidentStatus,
    entry.distanceKm ?? null,
    entry.etaMinutes ?? null,
    entry.routingMode ?? null,
    entry.notes,
    entry.performedBy,
    createdAt
  );
  return db.prepare('SELECT * FROM dispatch_history WHERE id = ?').get(id) as DispatchHistoryEntry;
}

export function getDispatchHistory(limit = 100): DispatchHistoryEntry[] {
  return db
    .prepare('SELECT * FROM dispatch_history ORDER BY createdAt DESC LIMIT ?')
    .all(limit) as DispatchHistoryEntry[];
}

export function getSavedSimulations(limit = 30): SavedSimulationScenario[] {
  const rows = db
    .prepare('SELECT * FROM simulation_scenarios ORDER BY createdAt DESC LIMIT ?')
    .all(limit) as Array<{
    id: string;
    name: string;
    createdBy: string;
    createdAt: string;
    paramsJson: string;
    targetDistrictName: string;
    baselineScore: number;
    simulatedScore: number;
    deltaScore: number;
    elevatedDistrictCount: number;
    peakCategory: SavedSimulationScenario['peakCategory'];
    summaryNote: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    params: JSON.parse(r.paramsJson) as SavedSimulationScenario['params'],
    targetDistrictName: r.targetDistrictName,
    baselineScore: r.baselineScore,
    simulatedScore: r.simulatedScore,
    deltaScore: r.deltaScore,
    elevatedDistrictCount: r.elevatedDistrictCount,
    peakCategory: r.peakCategory,
    summaryNote: r.summaryNote,
  }));
}

export function saveSimulationScenario(
  scenario: Omit<SavedSimulationScenario, 'id' | 'createdAt'> & {
    id?: string;
    createdAt?: string;
  }
): SavedSimulationScenario {
  const id = scenario.id || `SIM-${Date.now()}-${Math.floor(100 + Math.random() * 899)}`;
  const createdAt = scenario.createdAt || new Date().toISOString();
  db.prepare(
    `INSERT INTO simulation_scenarios (
      id, name, createdBy, createdAt, paramsJson, targetDistrictName,
      baselineScore, simulatedScore, deltaScore, elevatedDistrictCount, peakCategory, summaryNote
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    scenario.name,
    scenario.createdBy,
    createdAt,
    JSON.stringify(scenario.params),
    scenario.targetDistrictName,
    scenario.baselineScore,
    scenario.simulatedScore,
    scenario.deltaScore,
    scenario.elevatedDistrictCount,
    scenario.peakCategory,
    scenario.summaryNote
  );
  return {
    id,
    name: scenario.name,
    createdBy: scenario.createdBy,
    createdAt,
    params: scenario.params,
    targetDistrictName: scenario.targetDistrictName,
    baselineScore: scenario.baselineScore,
    simulatedScore: scenario.simulatedScore,
    deltaScore: scenario.deltaScore,
    elevatedDistrictCount: scenario.elevatedDistrictCount,
    peakCategory: scenario.peakCategory,
    summaryNote: scenario.summaryNote,
  };
}

export function deleteSimulationScenario(id: string): boolean {
  const result = db.prepare('DELETE FROM simulation_scenarios WHERE id = ?').run(id);
  return result.changes > 0;
}

