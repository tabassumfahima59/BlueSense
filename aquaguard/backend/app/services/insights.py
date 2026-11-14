"""Rule-based key insights for the Command Center (M1): short sentences built only from stored values, each with
its source, data kind, observation date and status. An insight whose data is unavailable is left out (never filled).
"""
from __future__ import annotations

import sqlite3

from . import catalog, indicators, store
from . import ml_artifacts as mla

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _month(ym: str) -> str:
    return f"{MONTHS[int(ym[5:7]) - 1]} {ym[:4]}"


def _item(key: str, text: str, kind: str, sources: list[str], observed: str | None) -> dict:
    return {"key": key, "text": text, "dataKind": kind, "sources": sources, "observedAt": observed,
            "status": catalog.worst(catalog.status_of(s) for s in sources)}


def build(conn: sqlite3.Connection, reg: dict, divisions: dict[str, dict], names: dict[str, str]) -> list[dict]:
    out: list[dict] = []
    national = reg["level"] == "country"

    s = store.stat(conn, 4550)
    if s:
        label, _ = store.sdg_class(s["value"])
        out.append(_item("water_stress",
                         f"Water stress (SDG 6.4.2) is {s['value']:.1f}% — '{label}' in the FAO classes — reference "
                         f"year {s['year']} (AQUASTAT symbol {s['symbol'] or '—'}). This is a national statistic.",
                         "statistic", ["fao_aquastat"], str(s["year"])))

    series = store.grace_series(conn)
    if series:
        t, v = series[-1]
        prev = next((x for x in series if x[0] == f"{int(t[:4]) - 1}{t[4:]}"), None)
        g = mla.grace_trend()
        text = f"Total water storage anomaly was {v:+.1f} cm in {_month(t)}"
        if prev:
            diff = v - prev[1]
            text += f", {abs(diff):.1f} cm {'higher' if diff >= 0 else 'lower'} than {_month(prev[0])}"
        if g:
            text += f"; long-term trend {g['trendCmPerYr']:+.2f} cm/yr"
        out.append(_item("storage", text + " (regional ~300 km signal, not a groundwater level).",
                         "satellite_monthly", ["grace_csr"], t[:7]))

    key = "bd" if national else reg["id"]
    mine = divisions.get(key, {})
    rain, rain_end = mine.get("rain_30d_anomaly", (None, None))
    if rain is not None and rain_end:
        cls = indicators.classify("rain_30d_anomaly", rain)
        where = "nationally (area-weighted mean of the eight points)" if national else f"in {reg['name']}"
        text = (f"Rainfall in the 30 days to {rain_end} was {abs(rain):.0f}% {'below' if rain < 0 else 'above'} the "
                f"1991–2020 mean {where}" + (f" — '{cls['label']}' (IMD categories)" if cls else "") + ".")
        if national:
            per = {d: divisions[d]["rain_30d_anomaly"][0] for d in divisions if d != "bd"
                   and divisions[d]["rain_30d_anomaly"][0] is not None}
            if per:
                wet = max(per, key=per.get)
                dry = min(per, key=per.get)
                text += (f" Range across divisions: {names.get(dry, dry)} {per[dry]:+.0f}% to "
                         f"{names.get(wet, wet)} {per[wet]:+.0f}%.")
        out.append(_item("rain_30d", text, "derived", ["openmeteo_archive"], rain_end))

    if national:
        z = {d: divisions[d]["dryness_3m"][0] for d in divisions if d != "bd" and divisions[d]["dryness_3m"][0] is not None}
        end = next((divisions[d]["dryness_3m"][1] for d in z), None)
        if z and end:
            dry = [d for d, v in z.items() if v <= -1.0]
            driest = min(z, key=z.get)
            text = (f"Over the three months to {_month(end)}, {len(dry)} of {len(z)} divisions were moderately dry or "
                    f"drier (P − ET0 against 1991–2020, SPI classes); driest: {names.get(driest, driest)} "
                    f"(z = {z[driest]:.2f}).")
            out.append(_item("dryness", text, "derived", ["openmeteo_archive"], end))
    else:
        z, end = mine.get("dryness_3m", (None, None))
        if z is not None and end:
            cls = indicators.classify("dryness_3m", z)
            out.append(_item("dryness", f"Over the three months to {_month(end)}, P − ET0 in {reg['name']} was "
                                        f"z = {z:.2f} against 1991–2020 — '{cls['label']}' (SPI classes).",
                             "derived", ["openmeteo_archive"], end))

    bal, bal_end = mine.get("water_balance_next_7d", (None, None))
    if bal is not None and bal_end:
        where = "nationally" if national else f"in {reg['name']}"
        out.append(_item("forecast_7d", f"Forecast for the next 7 days (to {bal_end}): P − ET0 of {bal:+.0f} mm {where} "
                                        "(weather-model forecast).", "forecast", ["openmeteo_forecast"], bal_end))

    params: list = []
    sql = "SELECT severity, COUNT(*) FROM alerts WHERE resolved_at IS NULL"
    if not national:
        sql += " AND location_id IN (?, 'bd')"
        params.append(reg["id"])
    counts = dict(conn.execute(sql + " GROUP BY severity", params).fetchall())
    total = sum(counts.values())
    if total:
        parts = [f"{counts[k]} {k}" for k in ("critical", "high", "medium", "low", "info") if counts.get(k)]
        out.append(_item("alerts", f"{total} open alert{'s' if total != 1 else ''}: {', '.join(parts)} "
                                   "(rule engine; see Recent alerts).", "derived", ["aquaguard_engine"], None))
    return out
