"""GRACE/GRACE-FO CSR RL06.3 mascon adapter (Deviation D1: CSR instead of JPL).

* Daily check: HEAD on the CSR all-corrections NetCDF; download (≈110 MB, streamed) only when ``Last-Modified`` /
  ``ETag`` differ from the last processed file, then delete the download.
* Extraction (same method as ``ml/grace_trend.py``): 0.25° cells whose centres fall inside the geoBoundaries
  Bangladesh outline, cos(latitude) weights; solutions in the same calendar month are averaged.
* Stored in ``water_storage``: one national series and one series per grid cell. The quantity is the total water
  storage (TWS) anomaly in cm equivalent water height relative to the file's ``time_mean_removed`` baseline — it
  integrates groundwater, soil moisture, surface water and snow and is NOT a groundwater level. The 0.25° grid
  oversamples 1° mascons; the native resolution is ~300 km. The file has no uncertainty variable (left NULL).
* The legacy ``storage_anomaly`` table (read by the current API) is updated with the national series.
* Gaps (e.g. 2017–2018 between missions) stay gaps.
"""
from __future__ import annotations

import json
import math
import sqlite3
import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np

from .http import HttpClient, HttpError
from .runs import RunStats, get_state, iso, set_state, utcnow

SOURCE = "grace_csr"
PRODUCT = "CSR_GRACE_GRACE-FO_RL0603_Mascons_all-corrections"
CELL_SIZE_DEG = 0.25
MAX_BYTES = 600 * 1024 * 1024
BBOX = {"lat": (20.0, 27.0), "lon": (87.5, 93.0)}


def _decode(v):
    return v.decode() if isinstance(v, bytes) else v


def _in_ring(x: float, y: float, ring) -> bool:
    inside, j = False, len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-15) + xi:
            inside = not inside
        j = i
    return inside


def load_outline(path: Path) -> list:
    gj = json.loads(Path(path).read_text(encoding="utf-8"))
    geom = gj["features"][0]["geometry"]
    return [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]


def _inside(x: float, y: float, polys) -> bool:
    return any(_in_ring(x, y, p[0]) and not any(_in_ring(x, y, h) for h in p[1:]) for p in polys)


def extract(nc_path: Path, outline_path: Path) -> dict:
    """Read the CSR file and return national + per-cell monthly series and verified metadata."""
    import h5py

    polys = load_outline(outline_path)
    with h5py.File(nc_path, "r") as f:
        lwe = f["lwe_thickness"]
        units = _decode(lwe.attrs.get("Units") or lwe.attrs.get("units") or "")
        if units != "cm":
            raise ValueError(f"unexpected lwe_thickness units {units!r}")
        version = _decode(f.attrs.get("product_version") or "")
        baseline = _decode(f.attrs.get("time_mean_removed") or "")
        if not version or not baseline:
            raise ValueError("file is missing product_version or time_mean_removed attributes")
        time_units = _decode(f["time"].attrs.get("Units") or f["time"].attrs.get("units") or "")
        if not time_units.startswith("days since "):
            raise ValueError(f"unexpected time units {time_units!r}")
        epoch = datetime.fromisoformat(time_units[len("days since "):].strip().replace("Z", "+00:00"))
        if epoch.tzinfo is None:
            epoch = epoch.replace(tzinfo=timezone.utc)
        lats, lons, times = f["lat"][:], f["lon"][:], f["time"][:]
        li = np.where((lats > BBOX["lat"][0]) & (lats < BBOX["lat"][1]))[0]
        lo = np.where((lons > BBOX["lon"][0]) & (lons < BBOX["lon"][1]))[0]
        cells = [(i, j) for i in li for j in lo if _inside(float(lons[j]), float(lats[i]), polys)]
        if not cells:
            raise ValueError("no grid cells inside the Bangladesh outline")
        ci = np.array(cells)
        i0, i1, j0, j1 = ci[:, 0].min(), ci[:, 0].max() + 1, ci[:, 1].min(), ci[:, 1].max() + 1
        block = lwe[:, i0:i1, j0:j1]
    values = block[:, ci[:, 0] - i0, ci[:, 1] - j0].astype(float)  # (time, cell)
    weights = np.cos(np.radians(lats[ci[:, 0]].astype(float)))
    national_t = (values * weights).sum(axis=1) / weights.sum()
    months: dict[tuple[int, int], list[int]] = defaultdict(list)
    for k, t in enumerate(times):
        d = (epoch + timedelta(days=float(t))).date()
        months[(d.year, d.month)].append(k)
    national, per_cell = [], []
    cell_meta = [(f"{float(lats[i]):.3f}_{float(lons[j]):.3f}", float(lats[i]), float(lons[j])) for i, j in cells]
    for (y, m), idx in sorted(months.items()):
        nv = float(np.mean(national_t[idx]))
        if math.isfinite(nv):
            national.append((y, m, round(nv, 4), len(idx)))
        cell_means = values[idx, :].mean(axis=0)
        for (cid, clat, clon), v in zip(cell_meta, cell_means):
            if math.isfinite(float(v)):
                per_cell.append((cid, clat, clon, y, m, round(float(v), 4)))
    # same labels as the rows already stored by the bootstrap importer (e.g. "2004.000-2009.999 time mean removed")
    return {"national": national, "cells": per_cell, "release": f"CSR {version}",
            "baseline": f"{baseline.replace(' to ', '-')} time mean removed", "n_cells": len(cells)}


def _period(y: int, m: int) -> tuple[str, str]:
    start = date(y, m, 1)
    end = (date(y + (m == 12), m % 12 + 1, 1) - timedelta(days=1))
    return start.isoformat(), end.isoformat()


UPSERT = """
INSERT INTO water_storage (scope, location_id, cell_id, cell_lat, cell_lon, cell_size_deg, aggregation, period_start,
                           period_end, period_basis, tws_anomaly_cm, uncertainty_cm, baseline, release_version, product,
                           source_id, retrieved_at)
VALUES (?, 'bd', ?, ?, ?, ?, ?, ?, ?, 'calendar_month', ?, NULL, ?, ?, ?, 'grace_csr', ?)
ON CONFLICT(source_id, release_version, scope, location_id, cell_id, period_start) DO UPDATE SET
  tws_anomaly_cm = excluded.tws_anomaly_cm, retrieved_at = excluded.retrieved_at
WHERE abs(water_storage.tws_anomaly_cm - excluded.tws_anomaly_cm) > 1e-9
"""


def store(conn: sqlite3.Connection, data: dict, retrieved: str, stats: RunStats) -> None:
    def put(scope, cid, clat, clon, size, aggregation, y, m, v):
        start, end = _period(y, m)
        exists = conn.execute(
            "SELECT 1 FROM water_storage WHERE source_id='grace_csr' AND release_version=? AND scope=? "
            "AND location_id='bd' AND cell_id=? AND period_start=?", (data["release"], scope, cid, start)).fetchone()
        before = conn.total_changes
        conn.execute(UPSERT, (scope, cid, clat, clon, size, aggregation, start, end, v, data["baseline"],
                              data["release"], PRODUCT, retrieved))
        if conn.total_changes > before:
            if exists:
                stats.updated += 1
            else:
                stats.inserted += 1

    national_agg = "cos(lat)-weighted mean of CSR 0.25 deg grid cells inside the geoBoundaries ADM0 outline"
    for y, m, v, _n in data["national"]:
        put("national", "", None, None, None, national_agg, y, m, v)
    cell_agg = "monthly mean of CSR solutions (0.25 deg grid value; native resolution ~300 km)"
    for cid, clat, clon, y, m, v in data["cells"]:
        put("grid_cell", cid, clat, clon, CELL_SIZE_DEG, cell_agg, y, m, v)
    for y, m, v, _n in data["national"]:  # legacy table read by the current API
        conn.execute(
            "INSERT INTO storage_anomaly (date, year, month, tws_cm, source_id, retrieved_at, provenance, is_sample) "
            "VALUES (?, ?, ?, ?, 'grace_csr', ?, 'historical', 0) ON CONFLICT(date) DO UPDATE SET "
            "tws_cm = excluded.tws_cm, retrieved_at = excluded.retrieved_at "
            "WHERE abs(storage_anomaly.tws_cm - excluded.tws_cm) > 1e-9",
            (f"{y:04d}-{m:02d}-15", y, m, v, retrieved))


def sync_grace(conn: sqlite3.Connection, client: HttpClient, settings, now: datetime | None = None) -> RunStats:
    stats = RunStats()
    retrieved = iso(now or utcnow())
    url = settings.grace_csr_url
    try:
        head = client.head(url)
    except HttpError as exc:
        stats.errors.append(f"HEAD failed: {str(exc)[:180]}")
        return stats
    marker = {"last_modified": head.headers.get("Last-Modified", ""), "etag": head.headers.get("ETag", "")}
    has_data = conn.execute("SELECT 1 FROM water_storage WHERE source_id = ? LIMIT 1", (SOURCE,)).fetchone()
    unchanged = all(marker[k] and marker[k] == (get_state(conn, SOURCE, k) or "") for k in marker)
    if has_data and unchanged:
        stats.ok += 1
        return stats  # provider file unchanged since the last processed version: nothing downloaded
    tmp = Path(settings.data_dir) / "raw" / "grace" / f"_download_{uuid.uuid4().hex}.nc"
    try:
        client.download(url, tmp, max_bytes=getattr(settings, "grace_max_download_bytes", MAX_BYTES))
        data = extract(tmp, Path(settings.data_dir) / "geo" / "bgd_adm0.geojson")
        stats.retrieved += 1
    except (HttpError, ValueError, OSError) as exc:
        stats.errors.append(f"{type(exc).__name__}: {str(exc)[:180]}")
        return stats
    finally:
        tmp.unlink(missing_ok=True)
    conn.execute("BEGIN IMMEDIATE")
    try:
        store(conn, data, retrieved, stats)
        for k, v in marker.items():
            if v:
                set_state(conn, SOURCE, k, v)
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    stats.ok += 1
    return stats
