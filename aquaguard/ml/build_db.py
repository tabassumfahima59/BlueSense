"""Idempotent bootstrap importer: load cleaned files from data/processed (and ML artifacts) into SQLite.

    python ml/build_db.py                 # import into data/aquaguard.db (created if missing)
    python ml/build_db.py --db PATH       # another database file
    python ml/build_db.py --no-backup     # skip the pre-import backup (tests only)
    python ml/build_db.py --sample        # also refresh data/sample/*.csv (legacy snapshot; see decision 5)

Guarantees (P1)
* Never replaces or recreates the database file; schema changes come only from versioned migrations, which run
  first (``backend/app/db/migrate.py``).
* A verified backup is written before importing into a database that already holds data.
* Every table is upserted on its primary key inside one transaction: new rows are inserted, existing rows change
  only when an incoming value differs, and a NULL never overwrites an existing value. Nothing is deleted.
* Row counts are compared before and after; any decrease aborts with an error.
* AQUASTAT history: when the raw source CSV is present, only genuine (non-imputed) reference-year rows are imported
  with their original symbols; otherwise only the latest published values (with imputation flags) are kept.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import pandas as pd

from common import ARTIFACTS, DATA, PROCESSED, RAW, RETRIEVED_FILE, ROOT, SAMPLE, write_json

sys.path.insert(0, str(ROOT / "backend"))
from app.db import backfill, connection, migrate  # noqa: E402

DB_PATH = DATA / "aquaguard.db"
BACKUP_DIR = DATA / "backups"
AQUASTAT_CSV = RAW / "aquastat" / "aquastat_bgd.csv"

PROVENANCE = {
    "openmeteo_archive": "historical", "openmeteo_glofas": "historical", "fao_aquastat": "historical",
    "geoboundaries": "historical", "hdx_cod_ps": "historical", "worldbank_pep": "historical",
    "grace_csr": "historical", "aquaguard_ml": "predicted",
}


def retrieved() -> dict:
    return json.loads(RETRIEVED_FILE.read_text(encoding="utf-8")) if RETRIEVED_FILE.exists() else {}


def meta(df: pd.DataFrame, source_id: str, provenance: str | None = None) -> pd.DataFrame:
    df = df.copy()
    df["source_id"] = source_id
    df["retrieved_at"] = retrieved().get(source_id, {}).get("retrievedAt")
    df["provenance"] = provenance or PROVENANCE[source_id]
    df["is_sample"] = 0
    return df


def tables() -> dict[str, pd.DataFrame]:
    out: dict[str, pd.DataFrame] = {}
    reg = json.loads((PROCESSED / "regions.json").read_text(encoding="utf-8"))
    rows = [{"id": "bd", "name": reg["country"]["name"], "name_bn": reg["country"]["nameBn"], "level": "country",
             "lon": reg["country"]["centroid"][0], "lat": reg["country"]["centroid"][1], "parent_id": None,
             "area_km2": reg["country"]["areaKm2"], "population": reg["country"]["population2022"]}]
    for d in reg["divisions"]:
        rows.append({"id": d["id"], "name": d["name"], "name_bn": d["nameBn"], "level": "division",
                     "lon": d["centroid"][0], "lat": d["centroid"][1], "parent_id": "bd",
                     "area_km2": d["areaKm2"], "population": d["population2022"]})
    for d in reg["districts"]:
        rows.append({"id": d["id"], "name": d["name"], "name_bn": None, "level": "district",
                     "lon": d["centroid"][0], "lat": d["centroid"][1], "parent_id": d["divisionId"],
                     "area_km2": d["areaKm2"], "population": d["population2022"]})
    out["regions"] = meta(pd.DataFrame(rows), "geoboundaries")

    out["sources"] = pd.DataFrame([
        {"id": k, "retrieved_at": v.get("retrievedAt"), "details_json": json.dumps(v)} for k, v in retrieved().items()
    ])
    out["weather_daily"] = meta(pd.read_csv(PROCESSED / "weather_daily.csv"), "openmeteo_archive")
    out["weather_monthly"] = meta(pd.read_csv(PROCESSED / "weather_monthly.csv"), "openmeteo_archive")
    out["climatology"] = meta(pd.read_csv(PROCESSED / "climatology.csv"), "openmeteo_archive")

    aq = json.loads((PROCESSED / "aquastat_bgd.json").read_text(encoding="utf-8"))["values"]
    out["water_resources"] = meta(pd.DataFrame([
        {"key": k, "value": v["value"], "unit": v["unit"], "year": v["year"], "reference_year": v["referenceYear"],
         "symbol": v["symbol"], "variable": v["variable"], "variable_code": v["variableCode"]} for k, v in aq.items()
    ]), "fao_aquastat")

    shape = json.loads((PROCESSED / "inflow_shape.json").read_text(encoding="utf-8"))
    out["inflow_shape"] = meta(pd.DataFrame([
        {"month": int(m), "share": s, "mean_flow_m3s": shape["meanFlowM3s"][m]} for m, s in shape["shares"].items()
    ]), "openmeteo_glofas")

    proj = json.loads((PROCESSED / "population_projection.json").read_text(encoding="utf-8"))
    out["population_projection"] = meta(pd.DataFrame(proj["series"]), "worldbank_pep")

    grace_file = PROCESSED / "storage_anomaly.csv"
    if grace_file.exists():
        out["storage_anomaly"] = meta(pd.read_csv(grace_file), "grace_csr")

    pred_file = ARTIFACTS / "predictions.json"
    if pred_file.exists():
        pj = json.loads(pred_file.read_text(encoding="utf-8"))
        prow = []
        for div, by_h in pj["forecasts"].items():
            for h, f in by_h.items():
                prow.append({"division": div, "horizon": int(h), "issued_month": f["issuedMonth"],
                             "target_month": f["targetMonth"], "value_mm": f["value"], "low_mm": f["low"],
                             "high_mm": f["high"], "model": f["model"]})
        out["predictions"] = meta(pd.DataFrame(prow), "aquaguard_ml")
    return out


def aquastat_history_rows(csv_path: Path = AQUASTAT_CSV) -> list[dict]:
    """Genuine AQUASTAT records from the raw source CSV: symbol other than 'I' (imputed), value present."""
    if not csv_path.exists():
        return []
    from fetch_static import AQUASTAT_VARS

    retrieved_at = retrieved().get("fao_aquastat", {}).get("retrievedAt")
    if not retrieved_at:
        return []
    df = pd.read_csv(csv_path)
    rows = []
    for r in df.itertuples(index=False):
        if pd.isna(r.Value) or str(r.Symbol) == "I":
            continue
        code = int(r.VariableCode)
        rows.append({
            "iso3": "BGD", "source_id": "fao_aquastat", "indicator_code": str(code),
            "indicator_key": AQUASTAT_VARS.get(code), "indicator_name": str(r.Variable),
            "reference_year": int(r.Year), "value": float(r.Value), "unit": str(r.Unit),
            "symbol": None if pd.isna(r.Symbol) else str(r.Symbol),
            "symbol_description": None if pd.isna(r.SymbolDescription) else str(r.SymbolDescription),
            "imputed": 0, "last_non_imputed_year": None, "retrieved_at": retrieved_at,
        })
    return rows


def _clean(value):
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    if hasattr(value, "item"):  # numpy scalar
        value = value.item()
        if isinstance(value, float) and math.isnan(value):
            return None
    return value


def upsert_legacy(conn, table: str, df: pd.DataFrame) -> tuple[int, int]:
    """Upsert on the table's primary key; returns (inserted, updated). NULL never overwrites a value."""
    info = conn.execute(f'PRAGMA table_info("{table}")').fetchall()
    existing = {r[1] for r in info}
    pk = [r[1] for r in sorted((r for r in info if r[5]), key=lambda r: r[5])]
    cols = [c for c in df.columns if c in existing]
    unknown = [c for c in df.columns if c not in existing]
    if unknown:
        raise RuntimeError(f"{table}: columns not in schema: {unknown}")
    if not pk or any(k not in cols for k in pk):
        raise RuntimeError(f"{table}: primary key {pk} missing from import columns")
    non_pk = [c for c in cols if c not in pk]
    col_sql = ", ".join(f'"{c}"' for c in cols)
    placeholders = ", ".join("?" for _ in cols)
    if non_pk:
        sets = ", ".join(f'"{c}" = COALESCE(excluded."{c}", "{table}"."{c}")' for c in non_pk)
        changed = " OR ".join(f'"{table}"."{c}" IS NOT COALESCE(excluded."{c}", "{table}"."{c}")' for c in non_pk)
        conflict = f"DO UPDATE SET {sets} WHERE {changed}"
    else:
        conflict = "DO NOTHING"
    pk_sql = ", ".join(f'"{k}"' for k in pk)
    sql = f'INSERT INTO "{table}" ({col_sql}) VALUES ({placeholders}) ON CONFLICT({pk_sql}) {conflict}'
    rows = [tuple(_clean(v) for v in row) for row in df[cols].itertuples(index=False, name=None)]
    count_before = conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
    changes_before = conn.total_changes
    conn.executemany(sql, rows)
    changes = conn.total_changes - changes_before
    inserted = conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0] - count_before
    return inserted, changes - inserted


def build(db_path: Path = DB_PATH, *, backup: bool = True, backup_dir: Path = BACKUP_DIR) -> dict:
    data = tables()                 # read every input before touching the database
    history = aquastat_history_rows()
    report = migrate.migrate(db_path, backup=backup, backup_dir=backup_dir)
    conn = connection.connect(db_path)
    result: dict = {"migrations_applied": report.applied, "backup": report.backup_path}
    try:
        before = migrate.table_counts(conn)
        if backup and report.backup_path is None and any(before.get(t, 0) for t in data):
            result["backup"] = str(migrate.backup_database(Path(db_path), backup_dir, label="pre-import"))
        stats: dict[str, object] = {}
        conn.execute("BEGIN IMMEDIATE")
        try:
            for name, df in data.items():
                stats[name] = upsert_legacy(conn, name, df)
            for name, changed in backfill.all_from_legacy(conn).items():
                stats[f"{name} (from legacy)"] = changed
            if history:
                stats["water_statistics (AQUASTAT history)"] = backfill.insert_water_statistics(conn, history)
            violations = conn.execute("PRAGMA foreign_key_check").fetchall()
            if violations:
                raise RuntimeError(f"foreign key violations: {violations[:5]}")
            conn.execute("COMMIT")
        except Exception:
            if conn.in_transaction:
                conn.execute("ROLLBACK")
            raise
        after = migrate.table_counts(conn)
    finally:
        conn.close()
    shrunk = {t: (n, after.get(t, 0)) for t, n in before.items() if after.get(t, 0) < n}
    if shrunk:
        raise RuntimeError(f"row counts decreased (must never happen): {shrunk}")
    result.update({"stats": stats, "before": before, "after": after})
    return result


def export_sample() -> None:
    """Frozen snapshot of the real processed data, flagged is_sample = 1 (legacy; becomes a bootstrap seed in P2)."""
    SAMPLE.mkdir(parents=True, exist_ok=True)
    for name, df in tables().items():
        if name == "sources":
            continue
        df = df.copy()
        if name == "weather_daily":  # keep the snapshot small: last 400 days
            df["date"] = pd.to_datetime(df["date"])
            df = df[df["date"] >= df["date"].max() - pd.Timedelta(days=400)]
            df["date"] = df["date"].dt.strftime("%Y-%m-%d")
        df["is_sample"] = 1
        df.to_csv(SAMPLE / f"{name}.csv", index=False)
    write_json(SAMPLE / "README.json", {
        "what": "Frozen snapshot of AquaGuard's processed real datasets, used only when the database and "
                "live APIs are unavailable. Every record is flagged is_sample = 1 and shown with a 'Sample' tag.",
        "sources_retrieved": retrieved(),
    })
    print(f"sample snapshot written: {SAMPLE}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Idempotent AquaGuard bootstrap importer")
    parser.add_argument("--db", type=Path, default=DB_PATH)
    parser.add_argument("--no-backup", action="store_true")
    parser.add_argument("--sample", action="store_true", help="also refresh data/sample snapshot")
    args = parser.parse_args(argv)
    res = build(args.db, backup=not args.no_backup)
    print(f"database: {args.db}")
    print(f"migrations applied: {res['migrations_applied'] or 'none'}; backup: {res['backup'] or 'not needed'}")
    for name, value in res["stats"].items():
        if isinstance(value, tuple):
            print(f"  {name}: inserted {value[0]}, updated {value[1]}")
        else:
            print(f"  {name}: changed {value}")
    if args.sample:
        export_sample()
    return 0


if __name__ == "__main__":
    sys.exit(main())
