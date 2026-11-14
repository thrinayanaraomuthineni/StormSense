import React from 'react';
import type { RiskCategory } from '../../lib/types';
import { AnimatedNumber } from './AnimatedNumber';

const CATEGORY_STROKE: Record<RiskCategory, string> = {
  LOW: '#5AC49E',
  MODERATE: '#E5A94C',
  HIGH: '#E58854',
  CRITICAL: '#E36D6D',
};

const CATEGORY_TEXT: Record<RiskCategory, string> = {
  LOW: 'text-[#8BE0C4]',
  MODERATE: 'text-[#F2C16E]',
  HIGH: 'text-[#F0A478]',
  CRITICAL: 'text-[#F29B9B]',
};

export function RiskGaugeArc({
  score,
  category,
  label = 'Outage Risk Index',
  size = 132,
}: {
  score: number;
  category: RiskCategory;
  label?: string;
  size?: number;
}) {
  const clamped = Math.max(0, Math.min(100, score));
  const strokeWidth = 10;
  const radius = (size - strokeWidth) / 2 - 4;
  const center = size / 2;
  const arcFraction = 240 / 360;
  const circumference = 2 * Math.PI * radius;
  const totalArcLength = circumference * arcFraction;
  const filledLength = (clamped / 100) * totalArcLength;

  return (
    <div className="inline-flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size * 0.85 }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label={`${label}: ${clamped} out of 100 (${category})`}
          className="overflow-visible"
        >
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="#344655"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={`${totalArcLength} ${circumference}`}
            transform={`rotate(150 ${center} ${center})`}
          />
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={CATEGORY_STROKE[category]}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={`${filledLength} ${circumference}`}
            transform={`rotate(150 ${center} ${center})`}
            style={{
              transition:
                'stroke-dasharray 380ms cubic-bezier(0.16, 1, 0.3, 1), stroke 240ms ease',
            }}
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center pt-1">
          <AnimatedNumber value={clamped} className="text-2xl font-bold text-[#E5EDF3] leading-none" />
          <span className={`text-[11px] font-semibold tracking-wide mt-1 ${CATEGORY_TEXT[category]}`}>
            {category}
          </span>
        </div>
      </div>
      <span className="text-[11px] text-[#8FA3B3] mt-0.5">{label}</span>
    </div>
  );
}
