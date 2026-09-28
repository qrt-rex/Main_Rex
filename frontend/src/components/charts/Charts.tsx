import { useId, useMemo, useRef, useState } from 'react';

export interface Datum {
  label: string;
  value: number;
}

type Slot = 1 | 2 | 3;
const color = (slot: Slot) => `var(--color-chart-${slot})`;

/** Collapsible table of the plotted values, so no number is reachable only by hovering. */
function DataTable({ data, valueLabel, format }: { data: Datum[]; valueLabel: string; format: (v: number) => string }) {
  return (
    <details className="mt-3 text-xs text-text-muted">
      <summary className="cursor-pointer select-none hover:text-text">View as table</summary>
      <table className="mt-2 w-full text-left">
        <thead>
          <tr className="border-b border-border">
            <th className="py-1.5 font-medium">Category</th>
            <th className="py-1.5 text-right font-medium">{valueLabel}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.label} className="border-b border-border last:border-0">
              <td className="py-1.5 text-text-secondary">{d.label}</td>
              <td className="py-1.5 text-right tabular-nums text-text">{format(d.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

interface HBarProps {
  data: Datum[];
  valueLabel: string;
  format?: (v: number) => string;
  slot?: Slot;
  emptyText?: string;
}

/** Categorical magnitude with long labels: horizontal bars, value at the tip, one series color. */
export function HBarChart({ data, valueLabel, format = (v) => v.toLocaleString('en-IN'), slot = 1, emptyText = 'No data yet' }: HBarProps) {
  const max = Math.max(...data.map((d) => d.value), 0);
  if (data.length === 0 || max === 0) return <p className="py-8 text-center text-sm text-text-muted">{emptyText}</p>;

  return (
    <div>
      <ul className="space-y-2.5" aria-label={`${valueLabel} by category`}>
        {data.map((d) => {
          const pct = (d.value / max) * 100;
          return (
            <li key={d.label} className="group grid grid-cols-[minmax(0,9rem)_1fr] items-center gap-3 sm:grid-cols-[minmax(0,11rem)_1fr]" title={`${d.label}: ${format(d.value)}`}>
              <span className="truncate text-xs text-text-secondary">{d.label}</span>
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className="h-3.5 rounded-r-[4px] transition-opacity group-hover:opacity-80"
                  style={{ width: `max(${pct}%, ${d.value > 0 ? '4px' : '0px'})`, background: color(slot) }}
                  aria-hidden="true"
                />
                <span className="shrink-0 text-xs font-medium tabular-nums text-text">{format(d.value)}</span>
              </span>
            </li>
          );
        })}
      </ul>
      <DataTable data={data} valueLabel={valueLabel} format={format} />
    </div>
  );
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

interface LineProps {
  data: Datum[];
  valueLabel: string;
  format?: (v: number) => string;
  slot?: Slot;
  height?: number;
}

/** Change over time: 2px line, 10% area wash, crosshair + tooltip snapping to the nearest point. */
export function LineChart({ data, valueLabel, format = (v) => v.toLocaleString('en-IN'), slot = 1, height = 180 }: LineProps) {
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const gradientId = useId();
  const W = 600;
  const H = height;
  const pad = { l: 36, r: 12, t: 12, b: 24 };
  const top = niceMax(Math.max(...data.map((d) => d.value), 0));

  const points = useMemo(() => data.map((d, i) => ({
    x: pad.l + (data.length === 1 ? (W - pad.l - pad.r) / 2 : (i / (data.length - 1)) * (W - pad.l - pad.r)),
    y: pad.t + (1 - d.value / top) * (H - pad.t - pad.b),
    d,
  })), [data, top, H, pad.l, pad.r, pad.t, pad.b]);

  if (data.length === 0) return <p className="py-8 text-center text-sm text-text-muted">No data yet</p>;

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ');
  const area = `${line} L${points[points.length - 1].x},${H - pad.b} L${points[0].x},${H - pad.b} Z`;
  const ticks = [0, top / 2, top];
  const labelEvery = Math.max(1, Math.ceil(data.length / 7));
  const last = points[points.length - 1];

  const onMove = (e: React.PointerEvent) => {
    const rect = box.current!.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(p.x - x) < Math.abs(points[best].x - x)) best = i;
    });
    setHover(best);
  };
  const h = hover !== null ? points[hover] : null;

  return (
    <div>
      <div ref={box} className="relative" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={`${valueLabel} over time`}>
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={color(slot)} stopOpacity="0.12" />
              <stop offset="1" stopColor={color(slot)} stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {ticks.map((t) => {
            const y = pad.t + (1 - t / top) * (H - pad.t - pad.b);
            return (
              <g key={t}>
                <line x1={pad.l} x2={W - pad.r} y1={y} y2={y} stroke="var(--color-chart-grid)" strokeWidth="1" />
                <text x={pad.l - 6} y={y} dy="0.32em" textAnchor="end" fontSize="10" fill="var(--color-text-muted)" className="tabular-nums">{format(t)}</text>
              </g>
            );
          })}
          <path d={area} fill={`url(#${gradientId})`} />
          <path d={line} fill="none" stroke={color(slot)} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {points.map((p, i) => i % labelEvery === 0 || i === points.length - 1 ? (
            <text key={p.d.label} x={p.x} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--color-text-muted)">{p.d.label}</text>
          ) : null)}
          <circle cx={last.x} cy={last.y} r="4" fill={color(slot)} stroke="var(--color-surface)" strokeWidth="2" />
          {h && (
            <>
              <line x1={h.x} x2={h.x} y1={pad.t} y2={H - pad.b} stroke="var(--color-border-strong)" strokeWidth="1" />
              <circle cx={h.x} cy={h.y} r="4.5" fill={color(slot)} stroke="var(--color-surface)" strokeWidth="2" />
            </>
          )}
        </svg>
        {h && (
          <div
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md border border-border bg-elevated px-2.5 py-1.5 text-xs shadow-[var(--shadow-pop)]"
            style={{ left: `${(h.x / W) * 100}%` }}
          >
            <p className="font-semibold tabular-nums text-text">{format(h.d.value)}</p>
            <p className="text-text-muted">{h.d.label}</p>
          </div>
        )}
      </div>
      <DataTable data={data} valueLabel={valueLabel} format={format} />
    </div>
  );
}
