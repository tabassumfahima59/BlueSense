"use client";
import { ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, Pause, Play, Waves } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { DataStatusBadge, fromMeta } from "@/components/ui/DataStatus";
import { ErrorCard, Skeleton } from "@/components/ui/States";
import { fmtNumber } from "@/lib/format";
import { monthLabel } from "@/lib/format/time";
import { useAppStore } from "@/lib/store";
import type { Envelope, WeatherSeries } from "@/lib/types/contract";
import { availableIndices, drynessInterpretation, RHYTHM_MODES, rhythmPoints, rhythmValue, shiftMonth,
  type RhythmMode, type RhythmPoint } from "@/lib/weather/rhythm";
import { RhythmWaveform } from "./water-rhythm-waveform";
import { useCommandWeatherState } from "./weather-history";
import styles from "./water-rhythm.module.css";

export function WaterRhythm() {
  const { weather: { data, error, loading, retry, scope }, onMonth } = useCommandWeatherState();
  return (
    <section id="water-rhythm" aria-label="Water Rhythm" className={styles.panel}>
      {data && !loading && !error ? <RhythmPlayer key={scope} env={data} onMonth={onMonth} /> : (
        <>
          <h2 className={styles.title}><Waves size={25} aria-hidden /> Water Rhythm</h2>
          <p className={styles.subtitle}>Explore how key water indicators change over time.</p>
          {error ? <ErrorCard title="Water Rhythm could not load" error={error} onRetry={retry} /> : (
            <div role="status" aria-label="Loading Water Rhythm observations" className={styles.loading}>
              <Skeleton className="h-36 w-full" /><p>Loading stored monthly weather observations…</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function RhythmPlayer({ env, onMonth }: { env: Envelope<WeatherSeries>; onMonth: (month: string | null) => void }) {
  const points = useMemo(() => rhythmPoints(env.data), [env.data]);
  const [mode, setMode] = useState<RhythmMode>("rainfall");
  const [index, setIndex] = useState(() => availableIndices(points, "rainfall").at(-1) ?? 0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [inView, setInView] = useState(false);
  const [visible, setVisible] = useState(true);
  const [systemReduced, setSystemReduced] = useState(false);
  const motion = useAppStore((s) => s.prefs.motion);
  const root = useRef<HTMLDivElement>(null);
  const valid = useMemo(() => availableIndices(points, mode), [points, mode]);
  const selected = points[index];
  const reduced = motion === "reduce" || (motion === "system" && systemReduced);
  const active = inView && visible;
  const meta = RHYTHM_MODES.find((m) => m.id === mode)!;

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => { setSystemReduced(mq.matches); setVisible(!document.hidden); };
    update();
    mq.addEventListener("change", update);
    document.addEventListener("visibilitychange", update);
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.05 });
    if (root.current) observer.observe(root.current);
    return () => { observer.disconnect(); mq.removeEventListener("change", update); document.removeEventListener("visibilitychange", update); };
  }, []);
  useEffect(() => { onMonth(selected && rhythmValue(selected, mode) !== null ? selected.month : null); }, [selected, mode, onMonth]);
  useEffect(() => {
    if (!playing || !active) return;
    const timer = window.setInterval(() => {
      const next = valid.find((v) => v > index);
      if (next === undefined) setPlaying(false);
      else { setIndex(next); if (next === valid.at(-1)) setPlaying(false); }
    }, 1200 / speed);
    return () => window.clearInterval(timer);
  }, [playing, active, valid, index, speed]);

  const select = (i: number) => { setPlaying(false); setIndex(i); };
  const step = (direction: -1 | 1) => {
    const next = direction === 1 ? valid.find((v) => v > index) : valid.findLast((v) => v < index);
    if (next !== undefined) select(next); else setPlaying(false);
  };
  const changeMode = (next: RhythmMode) => {
    const available = availableIndices(points, next);
    setMode(next); setPlaying(false);
    if (!available.includes(index)) setIndex(available.at(-1) ?? 0);
  };
  const toggle = () => {
    if (!playing && index >= (valid.at(-1) ?? 0)) setIndex(valid[0] ?? 0);
    setPlaying(!playing);
  };
  return (
    <div ref={root} data-active={active && !reduced} className={styles.player}>
      <div className={styles.particles} aria-hidden><i /><i /><i /><i /></div>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}><Waves size={25} aria-hidden className={styles.waveIcon} /> Water Rhythm</h2>
          <p className={styles.subtitle}>Explore how key water indicators change over time.</p>
        </div>
        <div className={styles.tabs} role="group" aria-label="Water Rhythm indicator">
          {RHYTHM_MODES.map((m) => <button key={m.id} type="button" aria-pressed={mode === m.id}
            onClick={() => changeMode(m.id)}>{m.label}</button>)}
        </div>
      </div>
      <div className={styles.context}>
        <span>{env.data.region.name} · {env.data.region.level === "country" ? "Area-weighted national estimate" : "Representative divisional weather point"}</span>
        <DataStatusBadge info={fromMeta(env.meta)} compact />
      </div>
      {valid.length ? (
        <div className={styles.content}>
          <div className={styles.chartColumn}>
            <div className={styles.chartHeading}><h3>{meta.title}</h3><span>{meta.unit}</span></div>
            <RhythmWaveform points={points} mode={mode} index={index} unit={meta.unit} title={meta.title}
              onSelect={select} onStep={step} />
            <div className={styles.legend}>
              <span><ArrowUpRight size={13} aria-hidden /> {mode === "balance" ? "P > ET0" : "Above normal"}</span>
              <span><ArrowDownRight size={13} aria-hidden /> {mode === "balance" ? "P < ET0" : "Below normal"}</span>
              <span>× Missing / unsupported</span>
            </div>
            <p className={styles.caption}>{meta.baseline}. Color shows direction, not a safety rating.</p>
          </div>
          <RhythmDetails point={selected} mode={mode} />
        </div>
      ) : (
        <div className={styles.empty} role="status">
          <Waves size={32} aria-hidden /><h3>No observations are available for the selected indicator, region and date range.</h3>
          <p>{mode === "dryness" ? "Dryness needs three consecutive stored months and at least 25 complete reference windows with non-zero variability." : "This indicator needs stored monthly values and, for rainfall anomalies, the corresponding normal."}</p>
          <p>Choose another indicator above, or adjust the region and date range in the top bar.</p>
        </div>
      )}
      <div className={styles.controls}>
        <div className={styles.transport}>
          <button type="button" onClick={() => step(-1)} disabled={!valid.length || index <= valid[0]}
            aria-label="Previous Water Rhythm observation"><ChevronLeft size={18} aria-hidden /></button>
          <button type="button" className={styles.play} onClick={toggle} disabled={valid.length < 2}
            aria-label={playing ? "Pause Water Rhythm" : "Play Water Rhythm"} aria-pressed={playing}>
            {playing ? <Pause size={17} aria-hidden /> : <Play size={17} aria-hidden />} {playing ? "Pause" : "Play"}
          </button>
          <button type="button" onClick={() => step(1)} disabled={!valid.length || index >= (valid.at(-1) ?? 0)}
            aria-label="Next Water Rhythm observation"><ChevronRight size={18} aria-hidden /></button>
        </div>
        <label className={styles.timeline}>
          <span>Selected month <output aria-live={playing ? "off" : "polite"}>{monthLabel(selected?.month)}</output></span>
          <input type="range" min={0} max={Math.max(0, points.length - 1)} step={1} value={index} disabled={!valid.length}
            aria-label="Water Rhythm month" aria-valuetext={`${monthLabel(selected?.month)}${selected && rhythmValue(selected, mode) === null ? ": no supported observation" : ""}`}
            onPointerDown={() => setPlaying(false)} onKeyDown={() => setPlaying(false)}
            onChange={(e) => select(Number(e.target.value))} />
        </label>
        <label className={styles.speed}>Speed
          <select aria-label="Water Rhythm playback speed" value={speed} onChange={(e) => { setPlaying(false); setSpeed(Number(e.target.value)); }}>
            <option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option>
          </select>
        </label>
      </div>
      <div className={styles.footer}>
        <span>{valid.length} supported / {points.length} calendar months · Playback skips gaps and stops at the end.</span>
        <a href="#weather-analysis">View full analysis ↓</a>
      </div>
      <p className={styles.limitation}>Timeline selection highlights monthly weather charts only. The scarcity map, current risk indicators,
        next-seven-day forecasts and annual statistics keep their own observation periods.</p>
      <details className={styles.method}>
        <summary>Source, method and observation scope</summary>
        <p>Source: {env.meta.source.join(", ")} · {env.meta.attribution.join(" · ")}. Monthly ERA5/ERA5-Land reanalysis via Open-Meteo;
          these are historical model estimates, not station measurements.</p>
        <p>Rainfall = monthly total minus the 1991–2020 monthly normal (mm). Water Balance = raw monthly P − ET0 (mm), with zero as its baseline.</p>
        <p>Dryness = existing three-month P − ET0 normal z-score, using sample standard deviation and at least 25 complete reference windows
          whose starting years are 1991–2020 (cross-year windows can end in 2021).
          It is not gamma-fitted SPI. National dryness is the area-weighted mean of all eight point z-scores.</p>
        <p>Lines connect consecutive supported months only; no curve smoothing or missing-value interpolation is applied. Decorative glow never changes the values.</p>
        {env.meta.note && <p>{env.meta.note}</p>}
      </details>
    </div>
  );
}

function RhythmDetails({ point, mode }: { point?: RhythmPoint; mode: RhythmMode }) {
  const value = point ? rhythmValue(point, mode) : null;
  const display = (v: number | null | undefined, unit = "mm") => v === null || v === undefined ? "Unavailable" : `${fmtNumber(v, 2)} ${unit}`;
  const meta = RHYTHM_MODES.find((m) => m.id === mode)!;
  const rows: [string, string][] = point ? mode === "rainfall" ? [
    ["Rainfall (reanalysis)", display(point.rainfall)], ["1991–2020 normal", display(point.rainfallNormal)],
    ["Anomaly", display(value)],
  ] : mode === "balance" ? [
    ["Rainfall · P", display(point.rainfall)], ["Reference ET0", display(point.et0)],
    ["P − ET0 (raw)", display(point.balance)], ["1991–2020 normal", display(point.balanceNormal)],
  ] : [
    ["Window", `${monthLabel(shiftMonth(point.month, -2))} – ${monthLabel(point.month)}`],
    ["Interpretation", value === null ? "Insufficient inputs or baseline" : drynessInterpretation(value)],
    ["Reference", "Same 3 months · 1991–2020"],
  ] : [];
  return (
    <aside className={styles.details} aria-label="Water Rhythm selected observation">
      <span className={styles.eyebrow}>Selected observation</span>
      <h3>{monthLabel(point?.month)}</h3>
      <p className={styles.value} data-testid="rhythm-value" data-value={value ?? "unavailable"}>
        {value === null ? "Unavailable" : fmtNumber(value, 2)} {value !== null && <small>{meta.unit}</small>}
      </p>
      <p className={styles.detailLabel}>{meta.title}</p>
      <dl>{rows.map(([label, text]) => <div key={label}><dt>{label}</dt><dd>{text}</dd></div>)}</dl>
    </aside>
  );
}
