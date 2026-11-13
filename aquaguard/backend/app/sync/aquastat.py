"""FAO AQUASTAT adapter (national statistics for Bangladesh).

* Queries the AQUASTAT dissemination API (same query as ``ml/fetch_static.py``) for the indicators AquaGuard uses.
* Stores only genuine reference-year records (AQUASTAT symbol other than ``I`` = imputed) in ``water_statistics``,
  with original symbols, units and indicator names. Nothing is carried forward.
* Revisions: when AQUASTAT changes a value for an existing indicator and year, the previous row gets
  ``superseded_at`` and the new value is inserted; identical rows are skipped.
* The legacy ``water_resources`` table (read by the current API) is refreshed with the latest published row per
  indicator and its last non-imputed year, exactly as ``ml/fetch_static.py`` computes it.
"""
from __future__ import annotations

import csv
import io
import math
import sqlite3
from datetime import datetime

from .http import HttpClient, HttpError
from .runs import RunStats, iso, utcnow

SOURCE = "fao_aquastat"
SQL_URL = ("https://data.apps.fao.org/catalog/dataset/945666e6-7803-4621-b8ef-cfd885a84596/resource/"
           "4a000a1b-24f0-4328-aab6-b9b525892090/download/query_en.sql")
FIRST_YEAR = 1990
REQUIRED_COLUMNS = {"VariableCode", "Variable", "Year", "Value", "Unit", "Symbol"}

# AQUASTAT variable code -> AquaGuard key (must match ml/fetch_static.AQUASTAT_VARS; checked by tests)
VARIABLES = {
    4150: "precip_volume_km3", 4151: "precip_depth_mm", 4155: "surface_internal_km3",
    4154: "groundwater_internal_km3", 4187: "groundwater_renewable_km3", 4176: "surface_external_km3",
    4185: "surface_renewable_km3", 4188: "trwr_km3", 4549: "efr_km3", 4253: "withdrawal_total_km3",
    4250: "withdrawal_agri_km3", 4251: "withdrawal_municipal_km3", 4252: "withdrawal_industrial_km3",
    4262: "withdrawal_groundwater_km3", 4261: "withdrawal_surface_km3", 4260: "irrigation_requirement_km3",
    4457: "municipal_per_capita_m3", 4346: "irrigated_harvested_rice_kha", 4345: "irrigated_harvested_wheat_kha",
    4348: "irrigated_harvested_maize_kha", 4352: "irrigated_harvested_potato_kha",
    4313: "area_equipped_irrigation_kha", 4100: "country_area_kha", 4104: "population_kinhab",
    4550: "sdg642_water_stress_pct",
}


def query_params(last_year: int) -> dict[str, str]:
    return {
        "sql_url": SQL_URL, "variable": ",".join(str(v) for v in VARIABLES), "area": "Bangladesh", "type": "all",
        "year": ",".join(str(y) for y in range(FIRST_YEAR, last_year + 1)), "download": "true",
    }


def parse_csv(text: str, stats: RunStats) -> list[dict]:
    reader = csv.DictReader(io.StringIO(text.lstrip("﻿")))
    missing = REQUIRED_COLUMNS - set(reader.fieldnames or [])
    if missing:
        raise ValueError(f"AQUASTAT CSV is missing columns {sorted(missing)}")
    rows = []
    for r in reader:
        try:
            code = int(r["VariableCode"])
            year = int(r["Year"])
            raw = (r.get("Value") or "").strip()
            value = float(raw) if raw else None
        except (TypeError, ValueError):
            stats.skipped += 1
            continue
        if code not in VARIABLES or value is None or not math.isfinite(value) or not (1900 <= year <= 2100):
            stats.skipped += 1
            continue
        rows.append({
            "code": code, "key": VARIABLES[code], "name": (r.get("Variable") or "").strip(), "year": year,
            "value": value, "unit": (r.get("Unit") or "").strip(), "symbol": (r.get("Symbol") or "").strip() or None,
            "symbol_description": (r.get("SymbolDescription") or "").strip() or None,
        })
    return rows


def store(conn: sqlite3.Connection, rows: list[dict], retrieved: str, stats: RunStats) -> None:
    for r in rows:
        if r["symbol"] == "I":
            stats.skipped += 1  # imputed by AQUASTAT: never stored as a genuine record
            continue
        current = conn.execute(
            "SELECT id, value, unit, symbol FROM water_statistics WHERE source_id = ? AND iso3 = 'BGD' "
            "AND indicator_code = ? AND reference_year = ? AND superseded_at IS NULL",
            (SOURCE, str(r["code"]), r["year"])).fetchone()
        if current is not None:
            same = abs(current[1] - r["value"]) <= 1e-9 and current[2] == r["unit"] and current[3] == r["symbol"]
            if same:
                stats.skipped += 1
                continue
            conn.execute("UPDATE water_statistics SET superseded_at = ? WHERE id = ?", (retrieved, current[0]))
            stats.updated += 1
        else:
            stats.inserted += 1
        conn.execute(
            "INSERT INTO water_statistics (iso3, source_id, indicator_code, indicator_key, indicator_name, "
            "reference_year, value, unit, symbol, symbol_description, imputed, last_non_imputed_year, retrieved_at) "
            "VALUES ('BGD', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?)",
            (SOURCE, str(r["code"]), r["key"], r["name"] or r["key"], r["year"], r["value"], r["unit"], r["symbol"],
             r["symbol_description"], retrieved))


def refresh_legacy(conn: sqlite3.Connection, rows: list[dict], retrieved: str) -> int:
    """Latest published row per indicator (+ last non-imputed year) into legacy water_resources."""
    changed = 0
    for code, key in VARIABLES.items():
        mine = [r for r in rows if r["code"] == code]
        if not mine:
            continue
        latest = max(mine, key=lambda r: r["year"])
        genuine = [r["year"] for r in mine if r["symbol"] != "I"]
        if genuine:
            reference_year = max(genuine)
        else:
            same = [r["year"] for r in mine if abs(r["value"] - latest["value"]) < 1e-9]
            reference_year = min(same)
        before = conn.total_changes
        conn.execute(
            "INSERT INTO water_resources (key, value, unit, year, reference_year, symbol, variable, variable_code, "
            "source_id, retrieved_at, provenance, is_sample) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'historical', 0) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value, unit = excluded.unit, year = excluded.year, "
            "reference_year = excluded.reference_year, symbol = excluded.symbol, variable = excluded.variable, "
            "retrieved_at = excluded.retrieved_at "
            "WHERE water_resources.value IS NOT excluded.value OR water_resources.year IS NOT excluded.year "
            "OR water_resources.reference_year IS NOT excluded.reference_year "
            "OR water_resources.symbol IS NOT excluded.symbol",
            (key, latest["value"], latest["unit"], latest["year"], reference_year, latest["symbol"], latest["name"],
             code, SOURCE, retrieved))
        changed += conn.total_changes - before
    return changed


def sync_aquastat(conn: sqlite3.Connection, client: HttpClient, settings, now: datetime | None = None) -> RunStats:
    stats = RunStats()
    now = now or utcnow()
    retrieved = iso(now)
    try:
        response = client.get(settings.aquastat_api_url, params=query_params(now.year))
        rows = parse_csv(response.text, stats)
    except (HttpError, ValueError) as exc:
        stats.errors.append(f"{type(exc).__name__}: {str(exc)[:180]}")
        return stats
    if not rows:
        stats.errors.append("AQUASTAT returned no usable rows")
        return stats
    stats.retrieved += 1
    conn.execute("BEGIN IMMEDIATE")
    try:
        store(conn, rows, retrieved, stats)
        refresh_legacy(conn, rows, retrieved)
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    stats.ok += 1
    return stats
