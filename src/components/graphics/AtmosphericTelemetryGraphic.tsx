import React, { useEffect, useRef } from 'react';
import { CloudRain, Wind } from 'lucide-react';

export function WindFlowCanvas({
  windSpeedKmh,
  windGustsKmh,
  height = 96,
}: {
  windSpeedKmh: number;
  windGustsKmh: number;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const dpr = 1;
    const width = canvas.clientWidth || 320;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const speedFactor = Math.max(0.4, Math.min(3.4, windSpeedKmh / 14));
    const count = Math.min(30, Math.max(12, Math.round(12 + windSpeedKmh * 0.4)));
    const particles = Array.from({ length: count }, (_, idx) => ({
      x: (idx / count) * width + Math.random() * 24,
      y: 24 + Math.random() * Math.max(20, height - 30),
      len: 18 + (windGustsKmh / 80) * 26 + Math.random() * 12,
      phase: Math.random() * Math.PI * 2,
      alpha: 0.34 + Math.random() * 0.36,
      useTeal: idx % 2 === 0,
    }));

    let t = 0;
    const drawFrame = () => {
      ctx.clearRect(0, 0, width, height);

      ctx.strokeStyle = 'rgba(112, 169, 207, 0.16)';
      ctx.lineWidth = 1;
      for (const frac of [0.38, 0.7]) {
        const gy = Math.round(height * frac) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(width, gy);
        ctx.stroke();
      }

      for (const p of particles) {
        const y0 = p.y + Math.sin(p.x * 0.02 + p.phase + t) * 2.2;
        const ym = p.y + Math.sin((p.x - p.len * 0.45) * 0.02 + p.phase + t) * 2.2;
        const y1 = p.y + Math.sin((p.x + p.len) * 0.02 + p.phase + t) * 2.2;
        const rgb = p.useTeal ? '85, 183, 176' : '112, 169, 207';

        ctx.strokeStyle = `rgba(${rgb}, ${(p.alpha * 0.35).toFixed(2)})`;
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        ctx.moveTo(p.x - p.len, y0);
        ctx.lineTo(p.x - p.len * 0.45, ym);
        ctx.stroke();

        ctx.strokeStyle = `rgba(${rgb}, ${p.alpha.toFixed(2)})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(p.x - p.len * 0.45, ym);
        ctx.lineTo(p.x, y1);
        ctx.stroke();

        if (!prefersReduced) {
          p.x += speedFactor * 2.1;
          if (p.x - p.len > width) {
            p.x = -10;
            p.y = 24 + Math.random() * Math.max(20, height - 30);
          }
        }
      }
      if (!prefersReduced) t += 0.045;
    };

    drawFrame();
    if (prefersReduced) return;

    const timerId = window.setInterval(() => {
      if (!document.hidden) drawFrame();
    }, 45);
    return () => window.clearInterval(timerId);
  }, [windSpeedKmh, windGustsKmh, height]);

  return (
    <div className="relative rounded-md bg-[#344655] border border-[#60788A] overflow-hidden">
      <canvas
        ref={canvasRef}
        aria-label={`Wind flow streamline graphic for ${windSpeedKmh.toFixed(1)} km/h sustained and ${windGustsKmh.toFixed(1)} km/h gusts`}
        className="w-full block"
        style={{ height }}
      />
      <div className="absolute inset-x-3 top-2 flex items-center justify-between gap-2 text-[11px]">
        <span className="text-[#AABBC9] flex items-center gap-1.5 font-medium whitespace-nowrap">
          <Wind className="w-3.5 h-3.5 text-[#55B7B0] shrink-0" aria-hidden="true" />
          <span>Wind Vector Stream</span>
        </span>
        <span className="font-mono tabular-nums text-[#E5EDF3] font-semibold whitespace-nowrap">
          {windSpeedKmh.toFixed(1)} km/h · Gust {windGustsKmh.toFixed(1)}
        </span>
      </div>
    </div>
  );
}

export function RainfallVisualizer({
  rainMm,
  precipProb,
}: {
  rainMm: number;
  precipProb: number;
}) {
  const dropCount = rainMm <= 0 ? 0 : Math.min(20, Math.max(4, Math.round(rainMm * 1.4 + 3)));
  const drops = Array.from({ length: dropCount }, (_, i) => ({
    x: 12 + ((i * 23) % 276),
    delay: ((i * 0.19) % 1.2).toFixed(2),
    duration: Math.max(0.65, 1.35 - Math.min(0.65, rainMm * 0.03)).toFixed(2),
  }));

  return (
    <div className="relative rounded-md bg-[#344655] border border-[#60788A] h-24 overflow-hidden px-3 py-2 flex flex-col justify-between">
      <svg
        viewBox="0 0 300 64"
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full pointer-events-none"
        aria-hidden="true"
      >
        <line x1="0" y1="62" x2="300" y2="62" stroke="#52697A" strokeWidth="2.5" />
        <line
          x1="0"
          y1="62"
          x2={Math.max(4, (Math.min(100, precipProb) / 100) * 300)}
          y2="62"
          stroke="#70A9CF"
          strokeWidth="3"
        />
        {drops.map((d, idx) => (
          <line
            key={idx}
            x1={d.x}
            y1="10"
            x2={d.x - 3}
            y2="24"
            stroke={idx % 2 === 0 ? '#70A9CF' : '#55B7B0'}
            strokeWidth="1.5"
            strokeLinecap="round"
            className="ss-rain-drop"
            style={{
              animationDelay: `${d.delay}s`,
              animationDuration: `${d.duration}s`,
            }}
          />
        ))}
      </svg>

      <div className="relative z-10 flex items-center justify-between gap-2 text-[11px]">
        <span className="text-[#AABBC9] flex items-center gap-1.5 font-medium whitespace-nowrap">
          <CloudRain className="w-3.5 h-3.5 text-[#70A9CF] shrink-0" aria-hidden="true" />
          <span>Precipitation Intensity</span>
        </span>
        <span className="font-mono tabular-nums text-[#E5EDF3] font-semibold whitespace-nowrap">
          {rainMm.toFixed(1)} mm · {Math.round(precipProb)}% prob
        </span>
      </div>

      <div className="relative z-10 text-[11px] text-[#8FA3B3]">
        {rainMm <= 0
          ? 'Dry surface telemetry · 0.0 mm/h precipitation rate'
          : rainMm < 5
            ? 'Light precipitation · Monitoring 11kV insulator surface moisture'
            : 'Active rainfall · Elevated feeder flashover vigilance'}
      </div>
    </div>
  );
}
