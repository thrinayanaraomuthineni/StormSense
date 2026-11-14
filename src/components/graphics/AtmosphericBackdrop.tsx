import React, { useEffect, useRef } from 'react';

interface WindStreamParticle {
  x: number;
  y: number;
  speed: number;
  length: number;
  phase: number;
  amp: number;
  alpha: number;
  teal: boolean;
}

interface RainSpeck {
  x: number;
  y: number;
  vx: number;
  vy: number;
  len: number;
  alpha: number;
}

export function AtmosphericBackdrop({
  showPrecipitation = false,
  intensity = 'normal',
}: {
  showPrecipitation?: boolean;
  intensity?: 'subtle' | 'normal';
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

    let width = window.innerWidth;
    let height = window.innerHeight;

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width;
      canvas.height = height;
    };
    resize();
    window.addEventListener('resize', resize);

    const streamCount = intensity === 'normal' ? 28 : 18;
    const streams: WindStreamParticle[] = Array.from({ length: streamCount }, (_, i) => ({
      x: Math.random() * width,
      y: (i / streamCount) * height + Math.random() * 24,
      speed: 0.7 + Math.random() * 0.9,
      length: 52 + Math.random() * 70,
      phase: Math.random() * Math.PI * 2,
      amp: 8 + Math.random() * 14,
      alpha: intensity === 'normal' ? 0.16 + Math.random() * 0.14 : 0.1 + Math.random() * 0.1,
      teal: i % 3 === 0,
    }));

    const rainCount = showPrecipitation ? (intensity === 'normal' ? 32 : 18) : 0;
    const drops: RainSpeck[] = Array.from({ length: rainCount }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: -0.8 - Math.random() * 0.6,
      vy: 3.4 + Math.random() * 2.2,
      len: 10 + Math.random() * 10,
      alpha: 0.12 + Math.random() * 0.14,
    }));

    let t = 0;
    const drawFrame = () => {
      ctx.clearRect(0, 0, width, height);

      ctx.lineCap = 'round';
      for (const s of streams) {
        const y0 = s.y + Math.sin(s.x * 0.004 + s.phase + t * 0.35) * s.amp;
        const xm = s.x + s.length * 0.5;
        const ym = s.y + Math.sin(xm * 0.004 + s.phase + t * 0.35) * s.amp;
        const x1 = s.x + s.length;
        const y1 = s.y + Math.sin(x1 * 0.004 + s.phase + t * 0.35) * s.amp;

        const rgb = s.teal ? '85, 183, 176' : '112, 169, 207';
        ctx.strokeStyle = `rgba(${rgb}, ${s.alpha.toFixed(3)})`;
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        ctx.moveTo(s.x, y0);
        ctx.quadraticCurveTo(xm, ym, x1, y1);
        ctx.stroke();

        if (!prefersReduced) {
          s.x += s.speed;
          if (s.x > width + 30) {
            s.x = -s.length - 20;
            s.y = Math.random() * height;
          }
        }
      }

      if (rainCount > 0) {
        ctx.lineWidth = 1;
        for (const d of drops) {
          ctx.strokeStyle = `rgba(170, 187, 201, ${d.alpha.toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(d.x, d.y);
          ctx.lineTo(d.x + d.vx * 2.5, d.y + d.len);
          ctx.stroke();

          if (!prefersReduced) {
            d.x += d.vx;
            d.y += d.vy;
            if (d.y > height + 20 || d.x < -20) {
              d.x = Math.random() * (width + 60);
              d.y = -20;
            }
          }
        }
      }

      if (!prefersReduced) {
        t += 0.032;
      }
    };

    drawFrame();
    if (prefersReduced) {
      return () => window.removeEventListener('resize', resize);
    }

    let timerId: number | null = null;
    const startLoop = () => {
      if (timerId !== null || document.hidden) return;
      timerId = window.setInterval(drawFrame, 45);
    };
    const stopLoop = () => {
      if (timerId !== null) {
        window.clearInterval(timerId);
        timerId = null;
      }
    };
    const handleVisibility = () => {
      if (document.hidden) stopLoop();
      else startLoop();
    };

    startLoop();
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      stopLoop();
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('resize', resize);
    };
  }, [showPrecipitation, intensity]);

  return (
    <div
      className="pointer-events-none fixed inset-0 overflow-hidden z-0"
      aria-hidden="true"
    >
      {/* Slowly shifting ambient atmospheric cloud & mist layers */}
      <div
        className="absolute -top-32 -left-24 w-[62vw] h-[54vh] rounded-full ss-cloud-drift"
        style={{
          background:
            'radial-gradient(circle at 42% 45%, rgba(112, 169, 207, 0.16), rgba(85, 183, 176, 0.06) 55%, transparent 75%)',
        }}
      />
      <div
        className="absolute top-[18%] -right-28 w-[58vw] h-[58vh] rounded-full ss-cloud-drift-alt"
        style={{
          background:
            'radial-gradient(circle at 55% 50%, rgba(85, 183, 176, 0.13), rgba(59, 80, 97, 0.22) 52%, transparent 76%)',
        }}
      />
      <div
        className="absolute -bottom-36 left-[22%] w-[64vw] h-[44vh] rounded-full ss-cloud-drift"
        style={{
          background:
            'radial-gradient(circle at 50% 50%, rgba(67, 89, 106, 0.4), rgba(40, 55, 68, 0.1) 65%, transparent 80%)',
        }}
      />

      {/* Animated synoptic isobar & barometric pressure contour lines */}
      <svg
        className="absolute inset-0 w-full h-full opacity-55"
        preserveAspectRatio="none"
        viewBox="0 0 1440 900"
      >
        <path
          d="M-80 160 C 220 95, 500 245, 840 175 C 1140 112, 1310 198, 1520 135"
          fill="none"
          stroke="#70A9CF"
          strokeWidth="1.15"
          strokeOpacity="0.2"
          className="ss-isobar-flow"
        />
        <path
          d="M-80 315 C 260 250, 560 395, 900 310 C 1180 245, 1340 340, 1520 270"
          fill="none"
          stroke="#55B7B0"
          strokeWidth="1.15"
          strokeOpacity="0.16"
          className="ss-isobar-flow"
          style={{ animationDuration: '24s' }}
        />
        <path
          d="M-80 510 C 280 445, 610 585, 960 495 C 1230 425, 1380 515, 1520 460"
          fill="none"
          stroke="#70A9CF"
          strokeWidth="1"
          strokeOpacity="0.15"
        />
        <path
          d="M-80 710 C 320 645, 640 770, 990 685 C 1250 620, 1390 700, 1520 650"
          fill="none"
          stroke="#55B7B0"
          strokeWidth="1"
          strokeOpacity="0.13"
          className="ss-isobar-flow"
          style={{ animationDuration: '28s' }}
        />
        <ellipse
          cx="1140"
          cy="240"
          rx="230"
          ry="135"
          fill="none"
          stroke="#70A9CF"
          strokeWidth="0.9"
          strokeOpacity="0.12"
          strokeDasharray="6 10"
        />
        <ellipse
          cx="1140"
          cy="240"
          rx="145"
          ry="84"
          fill="none"
          stroke="#55B7B0"
          strokeWidth="0.9"
          strokeOpacity="0.14"
        />
      </svg>

      {/* Curved-path wind-flow particles & optional precipitation */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
    </div>
  );
}
