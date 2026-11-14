/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { StormSenseProvider, useStormSense } from './context/StormSenseContext';
import { AppShell } from './components/layout/AppShell';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { LoginPage } from './pages/LoginPage';
import { CommandCenterPage } from './pages/CommandCenterPage';
import { WeatherIntelligencePage } from './pages/WeatherIntelligencePage';
import { RiskPredictionPage } from './pages/RiskPredictionPage';
import { StormSimulationLabPage } from './pages/StormSimulationLabPage';
import { TelanganaMapPage } from './pages/TelanganaMapPage';
import { IncidentsPage } from './pages/IncidentsPage';
import { CrewDispatchPage } from './pages/CrewDispatchPage';
import { AiIntelligencePage } from './pages/AiIntelligencePage';
import { AlertsPage } from './pages/AlertsPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { SettingsPage } from './pages/SettingsPage';

function StormSenseRouter() {
  const { currentUser, activePage } = useStormSense();

  if (!currentUser) {
    return <LoginPage />;
  }

  return (
    <AppShell>
      {activePage === 'command' && <CommandCenterPage />}
      {activePage === 'weather' && <WeatherIntelligencePage />}
      {activePage === 'risk' && <RiskPredictionPage />}
      {activePage === 'simulation' && <StormSimulationLabPage />}
      {activePage === 'map' && <TelanganaMapPage />}
      {activePage === 'incidents' && <IncidentsPage />}
      {activePage === 'dispatch' && <CrewDispatchPage />}
      {activePage === 'ai' && <AiIntelligencePage />}
      {activePage === 'alerts' && <AlertsPage />}
      {activePage === 'analytics' && <AnalyticsPage />}
      {activePage === 'settings' && <SettingsPage />}
    </AppShell>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <StormSenseProvider>
        <StormSenseRouter />
      </StormSenseProvider>
    </ErrorBoundary>
  );
}
