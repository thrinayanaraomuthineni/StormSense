import React from 'react';
import { AlertTriangle, CheckCircle2, Info, ShieldAlert } from 'lucide-react';
import type { DataProvenance, IncidentSeverity, RiskCategory } from '../../lib/types';

export function ProvenanceText({
  source,
  timestamp,
}: {
  source: DataProvenance | string;
  timestamp?: string | null;
}) {
  const formatted = timestamp
    ? new Date(timestamp).toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Kolkata',
      }) + ' IST'
    : null;

  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-[#8FA3B3] font-normal">
      <span className="text-[#55B7B0] font-medium">{source}</span>
      {formatted && (
        <>
          <span aria-hidden="true" className="text-[#60788A]">
            ·
          </span>
          <span className="font-mono tabular-nums text-[#8FA3B3]">{formatted}</span>
        </>
      )}
    </span>
  );
}

export function RiskIndicator({
  category,
  score,
}: {
  category: RiskCategory;
  score?: number;
}) {
  const styles: Record<RiskCategory, string> = {
    LOW: 'text-[#8BE0C4] bg-[#55B7B0]/18 border-[#55B7B0]/45',
    MODERATE: 'text-[#F2C16E] bg-[#E5A94C]/18 border-[#E5A94C]/45',
    HIGH: 'text-[#F0A478] bg-[#E58854]/18 border-[#E58854]/45',
    CRITICAL: 'text-[#F29B9B] bg-[#E36D6D]/20 border-[#E36D6D]/50',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded border font-mono tabular-nums whitespace-nowrap shrink-0 ${styles[category]}`}
    >
      {score !== undefined && <span>{score}</span>}
      <span>{category}</span>
    </span>
  );
}

export function SeverityIndicator({ severity }: { severity: IncidentSeverity }) {
  const styles: Record<IncidentSeverity, string> = {
    Low: 'text-[#8BE0C4] bg-[#55B7B0]/18 border-[#55B7B0]/45',
    Medium: 'text-[#F2C16E] bg-[#E5A94C]/18 border-[#E5A94C]/45',
    High: 'text-[#F0A478] bg-[#E58854]/18 border-[#E58854]/45',
    Critical: 'text-[#F29B9B] bg-[#E36D6D]/20 border-[#E36D6D]/50',
  };

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded border whitespace-nowrap shrink-0 ${styles[severity]}`}
    >
      {severity === 'Critical' && <ShieldAlert className="w-3 h-3" aria-hidden="true" />}
      {severity === 'High' && <AlertTriangle className="w-3 h-3" aria-hidden="true" />}
      {severity === 'Medium' && <Info className="w-3 h-3" aria-hidden="true" />}
      {severity === 'Low' && <CheckCircle2 className="w-3 h-3" aria-hidden="true" />}
      <span>{severity}</span>
    </span>
  );
}

export function formatIstDateTime(iso: string | null | undefined): string {
  if (!iso) return 'Unavailable';
  try {
    return (
      new Date(iso).toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Kolkata',
      }) + ' IST'
    );
  } catch {
    return iso;
  }
}

export function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-lg bg-[#E36D6D]/16 border border-[#E36D6D]/45 text-[#F6C5C5] text-sm"
    >
      <div className="flex items-center gap-2.5">
        <AlertTriangle className="w-4 h-4 text-[#E36D6D] shrink-0" aria-hidden="true" />
        <span>{message}</span>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="px-3 py-1.5 text-xs font-medium rounded bg-[#3B5061] hover:bg-[#43596A] text-[#E5EDF3] border border-[#E36D6D]/50 transition-colors whitespace-nowrap shrink-0"
        >
          Retry Fetch
        </button>
      )}
    </div>
  );
}

export function LoadingGridSkeleton() {
  return (
    <div className="space-y-4" aria-label="Loading operational data">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((n) => (
          <div key={n} className="h-28 rounded-lg ss-skeleton border border-[#60788A]" />
        ))}
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <div className="xl:col-span-7 h-80 rounded-lg ss-skeleton border border-[#60788A]" />
        <div className="xl:col-span-5 h-80 rounded-lg ss-skeleton border border-[#60788A]" />
      </div>
    </div>
  );
}
