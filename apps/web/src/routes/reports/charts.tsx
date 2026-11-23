/**
 * Small hand-drawn SVG charts for Reports (reports dashboard design 2026-11-23). Colours come from tokens through
 * app.css; shapes are physical (time runs left to right in every language), labels are passed in already localized.
 */
import { useId } from "react";
import type { AdherenceWeek } from "../../api/queries.ts";

/** Recent scores against the child's own baseline (100, the dashed line). The last point is emphasised. */
export function Sparkline({ scores, label }: { scores: Array<number | null>; label: string }) {
  const id = useId();
  const pts = scores.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
  if (pts.length === 0) return null;
  const W = 124;
  const H = 34;
  const pad = 4;
  const lo = Math.min(100, ...pts.map((p) => p.v)) - 6;
  const hi = Math.max(100, ...pts.map((p) => p.v)) + 6;
  const slots = Math.max(scores.length - 1, 1);
  const x = (i: number) => pad + (i * (W - 2 * pad)) / slots;
  const y = (v: number) => H - pad - ((v - lo) / (hi - lo)) * (H - 2 * pad);
  const line = pts.map((p) => `${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const end = pts.at(-1)!;
  return (
    <svg className="rchart rchart--spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="rchart__fade-a" />
          <stop offset="1" className="rchart__fade-b" />
        </linearGradient>
      </defs>
      {pts.length > 1 && <polygon points={`${x(pts[0]!.i)},${H} ${line} ${x(end.i)},${H}`} fill={`url(#${id})`} />}
      <line className="rchart__baseline" x1={pad} x2={W - pad} y1={y(100)} y2={y(100)} />
      {pts.length > 1 && <polyline className="rchart__line" points={line} />}
      <circle className="rchart__dot" cx={x(end.i)} cy={y(end.v)} r={3.5} />
    </svg>
  );
}

/** A 270° gauge for a share between 0 and 1. */
export function ArcGauge({ value, label }: { value: number; label: string }) {
  const id = useId();
  const r = 32;
  const c = 2 * Math.PI * r;
  const arc = c * 0.75;
  const v = Math.min(1, Math.max(0, value));
  const a = ((135 + v * 270) * Math.PI) / 180;
  return (
    <svg className="rchart" width={84} height={78} viewBox="0 0 84 78" role="img" aria-label={label}>
      <defs>
        <linearGradient id={id} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" className="rchart__grad-a" />
          <stop offset="1" className="rchart__grad-b" />
        </linearGradient>
      </defs>
      <circle className="rchart__track" cx={42} cy={42} r={r} strokeDasharray={`${arc} ${c}`} transform="rotate(135 42 42)" />
      {v > 0 && <circle className="rchart__arc" cx={42} cy={42} r={r} stroke={`url(#${id})`} strokeDasharray={`${arc * v} ${c}`} transform="rotate(135 42 42)" />}
      <circle className="rchart__knob" cx={42 + r * Math.cos(a)} cy={42 + r * Math.sin(a)} r={7} />
    </svg>
  );
}

/** Weekly counts as small pill bars; the latest week is highlighted and labelled. */
export function WeekBars({ values, label, format }: { values: number[]; label: string; format: (n: number) => string }) {
  const bw = 10;
  const gap = 7;
  const H = 70;
  const max = Math.max(1, ...values);
  const last = values.length - 1;
  const W = Math.max(values.length * (bw + gap) - gap + 16, 40);
  const cx = 8 + last * (bw + gap) + bw / 2;
  return (
    <svg className="rchart" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      {values.map((v, i) => {
        const h = Math.max((v / max) * 44, v > 0 ? 4 : 2);
        return <rect key={i} className={i === last ? "rchart__bar rchart__bar--now" : "rchart__bar"} x={8 + i * (bw + gap)} y={H - h} width={bw} height={h} rx={bw / 2} />;
      })}
      {last >= 0 && (
        <>
          <rect className="rchart__bubble" x={cx - 15} y={2} width={30} height={18} rx={9} />
          <text className="rchart__bubbletext" x={cx} y={15} textAnchor="middle">
            {format(values[last]!)}
          </text>
        </>
      )}
    </svg>
  );
}

/** A small area line; gaps (weeks with no sessions) are skipped. */
export function MiniArea({ values, label }: { values: Array<number | null>; label: string }) {
  const id = useId();
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
  if (pts.length === 0) return null;
  const W = 108;
  const H = 60;
  const lo = Math.min(...pts.map((p) => p.v));
  const hi = Math.max(...pts.map((p) => p.v));
  const span = hi - lo || 1;
  const slots = Math.max(values.length - 1, 1);
  const x = (i: number) => 6 + (i * (W - 12)) / slots;
  const y = (v: number) => H - 12 - ((v - lo) / span) * (H - 26);
  const line = pts.map((p) => `${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const end = pts.at(-1)!;
  return (
    <svg className="rchart rchart--alt" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="rchart__fade-a" />
          <stop offset="1" className="rchart__fade-b" />
        </linearGradient>
      </defs>
      {pts.length > 1 && <polygon points={`${x(pts[0]!.i)},${H} ${line} ${x(end.i)},${H}`} fill={`url(#${id})`} />}
      {pts.length > 1 && <polyline className="rchart__line" points={line} />}
      <circle className="rchart__knob" cx={x(end.i)} cy={y(end.v)} r={4.5} />
    </svg>
  );
}

/** Planned against done per week: stacked bars (clinic, then home) with a dashed marker for what was planned. */
export function PlanChart({ weeks, label, weekLabel, describe }: { weeks: AdherenceWeek[]; label: string; weekLabel: (weekStart: string) => string; describe: (w: AdherenceWeek) => string }) {
  const W = 480;
  const H = 268;
  const L = 30;
  const B = 24;
  const T = 12;
  const bw = 30;
  const top = Math.max(4, ...weeks.map((w) => Math.max(w.planned, w.done_clinic + w.done_home)));
  const step = top <= 8 ? 2 : top <= 20 ? 5 : top <= 50 ? 10 : Math.ceil(top / 5 / 10) * 10;
  const max = Math.ceil(top / step) * step;
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const slot = (W - L - 8) / Math.max(weeks.length, 1);
  const ticks: number[] = [];
  for (let v = 0; v <= max; v += step) ticks.push(v);
  return (
    <svg className="rchart rchart--plan" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      {ticks.map((v) => (
        <g key={v}>
          <line className="rchart__grid" x1={L} x2={W} y1={y(v)} y2={y(v)} />
          <text className="rchart__tick" x={L - 6} y={y(v) + 4} textAnchor="end">
            {v}
          </text>
        </g>
      ))}
      {weeks.map((w, i) => {
        const x = L + i * slot + (slot - bw) / 2;
        const clinicH = y(0) - y(w.done_clinic);
        const homeH = y(w.done_clinic) - y(w.done_clinic + w.done_home);
        return (
          <g key={w.week_start}>
            <title>{describe(w)}</title>
            {w.done_clinic > 0 && <rect className="rchart__clinic" x={x} y={y(w.done_clinic)} width={bw} height={clinicH} rx={8} />}
            {w.done_home > 0 && <rect className="rchart__home" x={x} y={y(w.done_clinic + w.done_home)} width={bw} height={Math.max(homeH - (w.done_clinic > 0 ? 3 : 0), 2)} rx={8} />}
            {w.planned > 0 && <line className="rchart__planned" x1={x - 7} x2={x + bw + 7} y1={y(w.planned)} y2={y(w.planned)} />}
            <text className="rchart__tick" x={x + bw / 2} y={H - 6} textAnchor="middle">
              {weekLabel(w.week_start)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
