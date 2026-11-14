"""Spatial intelligence for the 3D Water Explorer: evidence-based regional analysis built only from stored data.

Every statement ("finding") carries the values it rests on (Measures with source, data kind, spatial level and date),
so it can be traced. Nothing is invented to complete an analysis: a missing input makes the finding say "unavailable".

Scope rules (unchanged platform decisions):
* weather values come from one representative Open-Meteo point per division (ERA5 reanalysis for history); the
  national value is the area-weighted mean of the eight points (catalog.NATIONAL_WEATHER_NOTE);
* GRACE TWS is regional (~300 km): only the national series is used, never a division score;
* JRC surface water is a map layer only (no statistic is stored), so no number is given for it;
* AQUASTAT / SDG 6.4.2 stay national (decision 1);
* the scarcity risk is the existing division-level estimate (engine stress class + ML dryness class, max rule);
* districts are reference boundaries: geography only, never water values.
Trends are linear (OLS) with a 95 % interval that ignores autocorrelation; they describe change, not its cause.
"""
from __future__ import annotations

import calendar
import sqlite3
from dataclasses import dataclass

import numpy as np
from scipy import stats

from ..config.params import pentry
from ..schemas.common import Measure
from . import catalog, indicators, ml_artifacts as mla, regional, store
from .catalog import mv

NORMAL = "1991–2020"
WEATHER_SRC = "openmeteo_archive"
DRY_SEASON_NOTE = "dry season = the engine's dry-season months"
LIMITS_COMMON = [
    "Weather values come from one representative Open-Meteo point per division (ERA5 reanalysis), not from "
    "weather stations or division averages.",
    "GRACE resolves about 300 km: AquaGuard uses only the national series; it is total water storage, not a "
    "groundwater level.",
    "JRC surface-water occurrence (1984–2021) is a historical map layer; AquaGuard stores no per-division "
    "statistic, so no surface-water number is given.",
    "The scarcity risk is an estimate (engine stress ratio with area-based splits of national data, combined with "
    "an ML dryness class); it is not a measured quantity.",
    "Trends describe change over time; they do not establish a cause.",
]


@dataclass
class Scope:
    region: dict
    divisions: list[str]
    weights: dict[str, float]
    level: str  # "national" or "division"


def scope(conn: sqlite3.Connection, region_id: str) -> Scope:
    reg = dict(store.region(conn, region_id))  # raises store.RegionError for unknown ids and districts
    row = conn.execute("SELECT area_km2, population FROM regions WHERE id = ?", (reg["id"],)).fetchone()
    reg["area_km2"], reg["population"] = (row[0], row[1]) if row else (None, None)  # geoBoundaries / HDX COD-PS
    pts = store.weather_points(conn)
    if reg["level"] == "country":
        return Scope(reg, sorted(pts), pts, "national")
    return Scope(reg, [reg["id"]], {reg["id"]: pts.get(reg["id"], 1.0)}, "division")


# ---------------------------------------------------------------- monthly weather (complete months only)

def _monthly(conn: sqlite3.Connection, divisions: list[str]) -> dict[str, dict[tuple[int, int], dict]]:
    out: dict[str, dict[tuple[int, int], dict]] = {d: {} for d in divisions}
    q = ("SELECT division, year, month, precip_mm, tmean_c, d_mm, n_days FROM weather_monthly WHERE division IN (%s)"
         % ",".join("?" * len(divisions)))
    for d, y, m, p, t, dm, n in conn.execute(q, divisions):
        complete = n is not None and int(n) == calendar.monthrange(int(y), int(m))[1]
        out[d][(int(y), int(m))] = {"p": p, "t": t, "d": dm, "complete": complete}
    return out


def _climatology(conn: sqlite3.Connection, divisions: list[str]) -> dict[str, dict[int, dict]]:
    out: dict[str, dict[int, dict]] = {d: {} for d in divisions}
    q = ("SELECT division, month, precip_mm, tmean_c, d_mm FROM climatology WHERE division IN (%s)"
         % ",".join("?" * len(divisions)))
    for d, m, p, t, dm in conn.execute(q, divisions):
        out[d][int(m)] = {"p": p, "t": t, "d": dm}
    return out


def _wavg(vals: dict[str, float | None], w: dict[str, float]) -> float | None:
    if any(v is None for v in vals.values()):
        return None
    return store.weighted(vals, w)


def monthly_series(conn: sqlite3.Connection, sc: Scope) -> list[dict]:
    """Area-weighted monthly values over the scope; a month counts only when every division has it complete."""
    data = _monthly(conn, sc.divisions)
    clim = _climatology(conn, sc.divisions)
    keys = sorted(set().union(*[set(v) for v in data.values()])) if data else []
    rows = []
    for key in keys:
        recs = {d: data[d].get(key) for d in sc.divisions}
        complete = all(r is not None and r["complete"] for r in recs.values())
        def agg(field: str, source: dict) -> float | None:  # noqa: E306
            return _wavg({d: (source[d] or {}).get(field) for d in sc.divisions}, sc.weights)
        row = {"year": key[0], "month": key[1], "complete": complete,
               "p": agg("p", recs) if complete else None, "t": agg("t", recs) if complete else None,
               "d": agg("d", recs) if complete else None,
               "pNormal": agg("p", {d: clim[d].get(key[1]) for d in sc.divisions}),
               "tNormal": agg("t", {d: clim[d].get(key[1]) for d in sc.divisions})}
        rows.append(row)
    return rows


def last_12_months(rows: list[dict]) -> dict | None:
    """The latest 12 consecutive complete months with their totals and the 1991–2020 normal of the same months."""
    complete = [r for r in rows if r["complete"]]
    if len(complete) < 12:
        return None
    end = complete[-1]
    idx = {(r["year"], r["month"]): r for r in complete}
    y, m = end["year"], end["month"]
    window = []
    for _ in range(12):
        r = idx.get((y, m))
        if r is None or r["pNormal"] is None or r["tNormal"] is None:
            return None
        window.append(r)
        y, m = (y, m - 1) if m > 1 else (y - 1, 12)
    window.reverse()
    total = sum(r["p"] for r in window)
    normal = sum(r["pNormal"] for r in window)
    t = sum(r["t"] for r in window) / 12
    tn = sum(r["tNormal"] for r in window) / 12
    return {"start": f"{window[0]['year']}-{window[0]['month']:02d}", "end": f"{end['year']}-{end['month']:02d}",
            "rain": total, "rainNormal": normal, "rainDeparturePct": (total - normal) / normal * 100 if normal else None,
            "tmean": t, "tmeanNormal": tn, "tmeanAnomaly": t - tn}


def annual_series(rows: list[dict]) -> list[dict]:
    """Calendar years with 12 complete months (incomplete years are left out, never filled)."""
    by_year: dict[int, list[dict]] = {}
    for r in rows:
        by_year.setdefault(r["year"], []).append(r)
    out = []
    for y in sorted(by_year):
        months = by_year[y]
        ok = len(months) == 12 and all(m["complete"] for m in months)
        out.append({"year": y, "complete": ok,
                    "rain": sum(m["p"] for m in months) if ok else None,
                    "tmean": sum(m["t"] for m in months) / 12 if ok else None,
                    "pet": sum(m["d"] for m in months) if ok and all(m["d"] is not None for m in months) else None})
    return out


def trend(years: list[int], values: list[float], per: int = 10) -> dict | None:
    """OLS slope per `per` years with a 95 % interval (t distribution; autocorrelation ignored)."""
    if len(years) < 10:
        return None
    x = np.asarray(years, dtype=float)
    y = np.asarray(values, dtype=float)
    res = stats.linregress(x, y)
    tcrit = float(stats.t.ppf(0.975, len(x) - 2))
    slope, half = res.slope * per, tcrit * res.stderr * per
    return {"slope": float(slope), "low": float(slope - half), "high": float(slope + half), "n": len(x),
            "start": int(x.min()), "end": int(x.max()), "clear": bool((slope - half) > 0 or (slope + half) < 0)}


# ---------------------------------------------------------------- GRACE (national only)

def _month_index(t: str) -> int:
    return int(t[:4]) * 12 + int(t[5:7]) - 1


def grace_context(conn: sqlite3.Connection) -> dict:
    series = store.grace_series(conn)
    if not series:
        return {"available": False}
    months = [t[:7] for t, _ in series]
    first, last = _month_index(months[0]), _month_index(months[-1])
    present = {_month_index(m) for m in months}
    missing = [i for i in range(first, last + 1) if i not in present]
    gaps, run = [], []
    for i in missing:
        if run and i != run[-1] + 1:
            gaps.append(run)
            run = []
        run.append(i)
    if run:
        gaps.append(run)
    longest = max(gaps, key=len) if gaps else None
    fmt = lambda i: f"{i // 12}-{i % 12 + 1:02d}"  # noqa: E731
    t, v = series[-1]
    prev = next((x for x in series if x[0][:7] == f"{int(t[:4]) - 1}{t[4:7]}"), None)
    row = conn.execute("SELECT baseline, release_version, uncertainty_cm FROM water_storage WHERE source_id = "
                       "'grace_csr' AND scope = 'national' ORDER BY period_start DESC LIMIT 1").fetchone()
    g = mla.grace_trend()
    return {"available": True, "latest": (t[:7], v), "sameMonthLastYear": (prev[0][:7], prev[1]) if prev else None,
            "first": months[0], "last": months[-1], "months": len(months), "missingMonths": len(missing),
            "longestGap": (fmt(longest[0]), fmt(longest[-1]), len(longest)) if longest else None,
            "baseline": row[0] if row else None, "release": row[1] if row else None,
            "uncertaintyStored": bool(row and row[2] is not None),
            "trend": g}


# ---------------------------------------------------------------- risk (existing division-level estimate)

def risk_context(region_id: str) -> dict:
    run = regional.run(region_id)
    rk = regional.region_risk(run, 1)
    r = pentry("risk")
    s_level = r["stress_level"][rk["stressClass"]]
    d_level = r["dryness_level"][rk["drynessClass"]] if rk.get("drynessClass") else 0
    driver = "both" if s_level == d_level and s_level > 0 else "stress" if s_level >= d_level else "dryness"
    if rk["level"] == 0:
        driver = "none"
    f = rk.get("forecast")
    return {"label": rk["label"], "level": rk["level"], "stressClass": rk["stressClass"], "stressLevel": s_level,
            "drynessClass": rk.get("drynessClass"), "drynessLevel": d_level, "driver": driver,
            "dryStressRatio": rk["stressRatio"], "z": rk.get("z"), "targetMonth": f["targetMonth"] if f else None,
            "rule": rk["rule"], "isSample": run.is_sample}


# ---------------------------------------------------------------- findings

def _ev(label: str, m: Measure) -> dict:
    return {"label": label, "measure": m}


def _finding(fid: str, topic: str, text: str, kind: str, evidence: list[dict], tone: str = "neutral") -> dict:
    return {"id": fid, "topic": topic, "text": text, "kind": kind, "tone": tone, "evidence": evidence}


def _pct(v: float) -> str:
    return f"{abs(v):.0f}%"


def build(conn: sqlite3.Connection, region_id: str, db_key: str = "main") -> dict:
    """Regional intelligence for Bangladesh ('bd') or one division."""
    sc = scope(conn, region_id)
    reg = sc.region
    level = sc.level
    spatial = "national" if level == "national" else "point"
    name = reg["name"] + ("" if level == "national" else " Division")
    rows = monthly_series(conn, sc)
    l12 = last_12_months(rows)
    ann = annual_series(rows)
    full = [a for a in ann if a["complete"]]
    rain_tr = trend([a["year"] for a in full], [a["rain"] for a in full]) if full else None
    temp_tr = trend([a["year"] for a in full], [a["tmean"] for a in full]) if full else None
    grace = grace_context(conn)
    rk = risk_context(region_id)
    ind = indicators.all_divisions(conn, db_key).get(region_id if level == "division" else "bd", {})
    cur = store.current(conn, reg)
    n_districts = conn.execute("SELECT COUNT(*) FROM regions WHERE level = 'district' AND "
                               + ("parent_id = ?" if level == "division" else "? IS NOT NULL"), (reg["id"],)).fetchone()[0]
    note_w = catalog.NATIONAL_WEATHER_NOTE if level == "national" else "Representative Open-Meteo point for the division."

    findings: list[dict] = []
    # rainfall, last 12 complete months
    if l12:
        dep = l12["rainDeparturePct"]
        ev = [_ev("Rainfall, last 12 complete months", mv(l12["rain"], "mm", "reanalysis", WEATHER_SRC, spatial,
                   observed_at=l12["end"], digits=0, note=f"{l12['start']} to {l12['end']}; {note_w}")),
              _ev(f"Normal for the same months ({NORMAL})", mv(l12["rainNormal"], "mm", "derived", WEATHER_SRC, spatial,
                   digits=0, note="Mean of the same calendar months 1991–2020"))]
        if dep is None:
            text, tone = "The rainfall normal for this period is unavailable.", "neutral"
        elif dep <= -10:
            text, tone = (f"Rainfall over the last 12 complete months ({l12['start']} to {l12['end']}) was "
                          f"{_pct(dep)} below the {NORMAL} normal for the same months."), "warn"
        elif dep >= 10:
            text, tone = (f"Rainfall over the last 12 complete months ({l12['start']} to {l12['end']}) was "
                          f"{_pct(dep)} above the {NORMAL} normal for the same months."), "good"
        else:
            text, tone = (f"Rainfall over the last 12 complete months ({l12['start']} to {l12['end']}) was within "
                          f"10% of the {NORMAL} normal ({dep:+.0f}%)."), "neutral"
        ev.append(_ev("Departure from normal", mv(dep, "%", "derived", WEATHER_SRC, spatial, observed_at=l12["end"],
                                                  digits=1)))
        findings.append(_finding("rain12", "Rainfall", text, "reanalysis", ev, tone))
        ta = l12["tmeanAnomaly"]
        word = "warmer than" if ta >= 0.5 else "cooler than" if ta <= -0.5 else "close to"
        findings.append(_finding(
            "temp12", "Temperature",
            f"Mean temperature over the same 12 months was {l12['tmean']:.1f} °C, {word} the {NORMAL} normal "
            f"({ta:+.1f} °C).", "reanalysis",
            [_ev("Mean temperature, last 12 complete months", mv(l12["tmean"], "°C", "reanalysis", WEATHER_SRC, spatial,
                                                                  observed_at=l12["end"], digits=1)),
             _ev(f"Normal ({NORMAL})", mv(l12["tmeanNormal"], "°C", "derived", WEATHER_SRC, spatial, digits=1)),
             _ev("Anomaly", mv(ta, "°C", "derived", WEATHER_SRC, spatial, observed_at=l12["end"], digits=2))],
            "warn" if ta >= 0.5 else "neutral"))
    else:
        findings.append(_finding("rain12", "Rainfall", "Twelve consecutive complete months of rainfall are not "
                                 "available, so no 12-month comparison is made.", "reanalysis", []))

    # seasonal dryness indicator (M1 definition)
    dz = ind.get("dryness_3m")
    if dz and dz[0] is not None:
        cls = indicators.classify("dryness_3m", dz[0])
        findings.append(_finding(
            "dryness", "Seasonal dryness",
            f"Seasonal dryness (3-month P − ET0 z-score) is {dz[0]:+.2f}: {cls['label'] if cls else 'not classified'} "
            f"(SPI classes).", "derived",
            [_ev("3-month P − ET0 z-score", mv(dz[0], "z-score", "derived", WEATHER_SRC, spatial, observed_at=dz[1],
                                               digits=2))],
            "warn" if cls and cls["tone"] <= -1 else "neutral"))

    # long-term trends
    for key, tr, unit, label in (("rainTrend", rain_tr, "mm per decade", "Annual rainfall"),
                                 ("tempTrend", temp_tr, "°C per decade", "Annual mean temperature")):
        if not tr:
            continue
        digits = 0 if unit.startswith("mm") else 2
        if tr["clear"]:
            direction = "increased" if tr["slope"] > 0 else "decreased"
            text = (f"{label} {direction} by about {abs(tr['slope']):.{digits}f} {unit} over {tr['start']}–{tr['end']} "
                    f"(95% interval {tr['low']:.{digits}f} to {tr['high']:.{digits}f}).")
        else:
            text = (f"{label} shows no clear linear trend over {tr['start']}–{tr['end']} "
                    f"({tr['slope']:+.{digits}f} {unit}; the 95% interval includes zero).")
        findings.append(_finding(key, "Historical trend", text, "derived",
                                 [_ev(f"{label} trend", mv(tr["slope"], unit, "derived", WEATHER_SRC, spatial,
                                                           observed_at=str(tr["end"]), low=tr["low"], high=tr["high"],
                                                           digits=3,
                                                           note=f"OLS over {tr['n']} complete years; autocorrelation "
                                                                "ignored; describes change, not its cause"))]))

    # scarcity risk (estimated)
    driver_txt = {"stress": f"set by the dry-season stress class ({rk['stressClass']})",
                  "dryness": f"set by the predicted dryness class ({rk['drynessClass']})",
                  "both": f"set equally by stress ({rk['stressClass']}) and dryness ({rk['drynessClass']})",
                  "none": "no component is above its lowest class"}[rk["driver"]]
    findings.append(_finding(
        "risk", "Estimated scarcity risk",
        f"Estimated scarcity risk is {rk['label']}, {driver_txt}. Rule: the higher of the two levels.", "derived",
        [_ev("Dry-season stress ratio (engine estimate)", mv(rk["dryStressRatio"], "ratio", "derived",
                                                             "aquaguard_engine", "division" if level == "division" else "national",
                                                             digits=3, note=DRY_SEASON_NOTE)),
         _ev("Predicted dryness z (next month)", mv(rk["z"], "z-score", "prediction", "aquaguard_ml",
                                                    "division" if level == "division" else "national",
                                                    observed_at=rk["targetMonth"], digits=2))],
        "bad" if rk["level"] >= 3 else "warn" if rk["level"] == 2 else "neutral"))

    # GRACE (national)
    if grace["available"]:
        t, v = grace["latest"]
        tr = grace["trend"]
        text = (f"Bangladesh-wide terrestrial water storage was {v:+.1f} cm in {t} relative to the 2004–2009 mean"
                + (f"; the long-term trend is {tr['trendCmPerYr']:+.2f} cm/yr" if tr else "")
                + ". GRACE cannot resolve a single division (about 300 km), so this is national context only.")
        ev = [_ev("TWS anomaly, latest month (national)", mv(v, "cm", "satellite_monthly", "grace_csr", "regional",
                                                              observed_at=t, digits=1, note="Not a groundwater level"))]
        if tr:
            ev.append(_ev("TWS trend (national)", mv(tr["trendCmPerYr"], "cm/yr", "derived", "grace_csr", "regional",
                                                     observed_at=tr["period"]["to"][:7], low=tr["trendCi95"][0],
                                                     high=tr["trendCi95"][1], digits=2)))
        findings.append(_finding("grace", "Water storage (GRACE)", text, "satellite_monthly", ev))

    findings.append(_finding(
        "surface", "Surface water (JRC)",
        "Historical surface-water occurrence (1984–2021, JRC Global Surface Water) is shown on the map. AquaGuard "
        "stores no per-region statistic for it, so no surface-water percentage is reported.", "satellite_historical", []))

    # monitoring suggestions (rule-based, stated as suggestions)
    suggestions = []
    if l12 and l12["rainDeparturePct"] is not None and l12["rainDeparturePct"] <= -15:
        suggestions.append("Rainfall has been well below normal: compare with river gauge and groundwater well "
                           "records (not available in AquaGuard) before drawing conclusions.")
    if dz and dz[0] is not None and dz[0] <= -1:
        suggestions.append("Seasonal dryness is at least moderately dry: watch the next months' rainfall and the "
                           "predicted dryness class.")
    if rk["level"] >= 2:
        suggestions.append(f"The estimated risk is {rk['label']}: check the engine's dry-season demand and supply "
                           "assumptions in Water Budget and What-if, since the estimate depends on them.")
    suggestions.append("No measured groundwater levels are available; well observations (e.g. BWDB) would be needed "
                       "to assess groundwater locally.")

    # data quality
    months_total = len(rows)
    incomplete = sum(1 for r in rows if not r["complete"])
    statuses = {s: catalog.status_of(s) for s in ("openmeteo_archive", "openmeteo_forecast", "grace_csr",
                                                  "fao_aquastat", "jrc_gsw", "aquaguard_engine", "aquaguard_ml")}
    quality = {
        "weatherMonths": months_total, "weatherIncompleteMonths": incomplete,
        "weatherFirst": f"{rows[0]['year']}-{rows[0]['month']:02d}" if rows else None,
        "weatherLast": f"{rows[-1]['year']}-{rows[-1]['month']:02d}" if rows else None,
        "completeYears": len(full), "grace": {k: grace.get(k) for k in ("first", "last", "months", "missingMonths",
                                                                          "longestGap", "baseline", "release",
                                                                          "uncertaintyStored")},
        "sources": statuses,
        "resolution": [
            {"layer": "Weather (Open-Meteo / ERA5)", "spatial": "one point per division" + (
                "; national = area-weighted mean of 8 points" if level == "national" else ""),
             "temporal": "daily, aggregated to months", "status": statuses["openmeteo_archive"]},
            {"layer": "GRACE CSR RL06.3", "spatial": "~300 km effective (0.25° display grid)", "temporal": "monthly",
             "status": statuses["grace_csr"]},
            {"layer": "JRC Global Surface Water", "spatial": "30 m raster (map only)",
             "temporal": "1984–2021 aggregate", "status": statuses["jrc_gsw"]},
            {"layer": "Scarcity risk (engine + ML)", "spatial": "division", "temporal": "monthly climatology / "
             "next-month prediction", "status": catalog.worst([statuses["aquaguard_engine"], statuses["aquaguard_ml"]])},
        ],
    }

    current = {}
    for var, label in (("temperature_2m", "Temperature now"), ("precipitation", "Precipitation now")):
        c = cur["values"].get(var)
        if c:
            current[var] = mv(c["value"], c["unit"], "model_current", "openmeteo_forecast", spatial,
                              observed_at=c["observed"], digits=1, note=note_w)

    summary = _summary(name, findings, rk)
    return {
        "region": {"id": reg["id"], "name": reg["name"], "level": level},
        "profile": {
            "area": mv(reg.get("area_km2"), "km²", "reference", "geoboundaries", spatial if level == "national" else "division",
                       digits=0),
            "population": mv(reg.get("population"), "persons", "statistic", "hdx_cod_ps",
                             "national" if level == "national" else "division", observed_at="2022", digits=0),
            "districts": n_districts,
        },
        "current": current,
        "last12": l12,
        "risk": rk,
        "findings": findings,
        "summary": summary,
        "suggestions": suggestions,
        "quality": quality,
        "limitations": LIMITS_COMMON,
        "graceAvailable": grace["available"],
    }


def _summary(name: str, findings: list[dict], rk: dict) -> str:
    by = {f["id"]: f for f in findings}
    parts = [f"{name}: estimated scarcity risk {rk['label']}."]
    for fid in ("rain12", "temp12", "dryness", "rainTrend"):
        if fid in by:
            parts.append(by[fid]["text"])
    return " ".join(parts)


# ---------------------------------------------------------------- overview of all divisions (+ national)

def overview(conn: sqlite3.Connection, db_key: str = "main") -> list[dict]:
    out = []
    ind = indicators.all_divisions(conn, db_key)
    for rid in ["bd", *sorted(store.weather_points(conn))]:
        sc = scope(conn, rid)
        rows = monthly_series(conn, sc)
        l12 = last_12_months(rows)
        rk = risk_context(rid)
        dz = (ind.get(rid) or {}).get("dryness_3m")
        cur = store.current(conn, sc.region)["values"].get("temperature_2m") or {}
        out.append({"id": rid, "name": sc.region["name"], "level": sc.level, "area": sc.region.get("area_km2"),
                    "population": sc.region.get("population"),
                    "districts": conn.execute("SELECT COUNT(*) FROM regions WHERE level = 'district'"
                                              + (" AND parent_id = ?" if sc.level == "division" else ""),
                                              ((rid,) if sc.level == "division" else ())).fetchone()[0],
                    "last12": l12, "risk": rk, "drynessZ": dz[0] if dz else None, "drynessAt": dz[1] if dz else None,
                    "drynessClass": (indicators.classify("dryness_3m", dz[0]) or {}).get("label") if dz and dz[0] is not None else None,
                    "tempNow": cur.get("value"), "tempNowAt": cur.get("observed")})
    return out


# ---------------------------------------------------------------- period comparison

def _mean(xs: list[float]) -> float | None:
    return sum(xs) / len(xs) if xs else None


def compare(conn: sqlite3.Connection, region_id: str, a: tuple[int, int], b: tuple[int, int]) -> dict:
    """Mean annual values in two year ranges (complete years only) and national GRACE means (months present)."""
    sc = scope(conn, region_id)
    ann = {r["year"]: r for r in annual_series(monthly_series(conn, sc))}
    grace = store.grace_series(conn)

    def period(p: tuple[int, int]) -> dict:
        years = list(range(p[0], p[1] + 1))
        got = [ann[y] for y in years if y in ann and ann[y]["complete"]]
        g = [v for t, v in grace if p[0] <= int(t[:4]) <= p[1]]
        return {"start": p[0], "end": p[1], "yearsExpected": len(years), "yearsComplete": len(got),
                "missingYears": [y for y in years if y not in ann or not ann[y]["complete"]],
                "rain": _mean([r["rain"] for r in got]), "tmean": _mean([r["tmean"] for r in got]),
                "pet": _mean([r["pet"] for r in got if r["pet"] is not None]),
                "graceMonths": len(g), "graceMonthsExpected": len(years) * 12, "grace": _mean(g)}

    pa, pb = period(a), period(b)
    def diff(k: str) -> float | None:  # noqa: E306
        return None if pa[k] is None or pb[k] is None else pb[k] - pa[k]
    rain_pct = (diff("rain") / pa["rain"] * 100) if pa["rain"] and diff("rain") is not None else None
    return {"region": {"id": sc.region["id"], "name": sc.region["name"], "level": sc.level}, "a": pa, "b": pb,
            "change": {"rain": diff("rain"), "rainPct": rain_pct, "tmean": diff("tmean"), "pet": diff("pet"),
                       "grace": diff("grace")},
            "notes": ["Means use complete calendar years only; missing years are listed, never filled.",
                      "GRACE is the national series (regional, ~300 km) and starts in 2002-04; its means use the "
                      "months present (the 2017-07 to 2018-05 mission gap is not filled).",
                      "A percentage change is given for rainfall only; for temperature and the GRACE anomaly the "
                      "absolute change is the meaningful quantity.",
                      "A difference between periods is not evidence of its cause."]}


# ---------------------------------------------------------------- time series

def timeseries(conn: sqlite3.Connection, region_id: str) -> dict:
    """Monthly and annual weather for the scope (complete months only carry values) and the national GRACE series
    with an explicit null for every missing month (gaps are shown, never interpolated)."""
    sc = scope(conn, region_id)
    rows = monthly_series(conn, sc)
    ann = annual_series(rows)
    full = [a for a in ann if a["complete"]]
    g = store.grace_series(conn)
    grace = []
    if g:
        have = {_month_index(t[:7]): v for t, v in g}
        lo, hi = min(have), max(have)
        grace = [{"t": f"{i // 12}-{i % 12 + 1:02d}", "v": have.get(i)} for i in range(lo, hi + 1)]
    return {
        "region": {"id": sc.region["id"], "name": sc.region["name"], "level": sc.level},
        "monthly": [{"t": f"{r['year']}-{r['month']:02d}", "rain": r["p"], "rainNormal": r["pNormal"], "tmean": r["t"],
                     "tmeanNormal": r["tNormal"], "pet": r["d"], "complete": r["complete"]} for r in rows],
        "annual": ann,
        "rainTrend": trend([a["year"] for a in full], [a["rain"] for a in full]) if full else None,
        "tempTrend": trend([a["year"] for a in full], [a["tmean"] for a in full]) if full else None,
        "grace": grace,
        "graceTrend": mla.grace_trend(),
    }
