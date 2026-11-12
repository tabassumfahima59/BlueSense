"""Load cleaned files from data/processed (and ML artifacts) into SQLite, and export the
offline sample snapshot.

    python ml/build_db.py            # build data/aquaguard.db
    python ml/build_db.py --sample   # also refresh data/sample/*.csv (frozen snapshot, is_sample = 1)
"""
from __future__ import annotations

import json
import sqlite3
import sys

import pandas as pd

from common import ARTIFACTS, DATA, PROCESSED, RETRIEVED_FILE, ROOT, SAMPLE, write_json

DB_PATH = DATA / "aquaguard.db"
SCHEMA = ROOT / "backend" / "app" / "db" / "schema.sql"

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


def build() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = DB_PATH.with_suffix(".tmp.db")
    if tmp.exists():
        tmp.unlink()
    con = sqlite3.connect(tmp)
    con.executescript(SCHEMA.read_text(encoding="utf-8"))
    for name, df in tables().items():
        con.execute(f"DELETE FROM {name}")
        df.to_sql(name, con, if_exists="append", index=False)
        print(f"  {name}: {len(df)} rows")
    con.commit()
    con.close()
    tmp.replace(DB_PATH)
    print(f"database written: {DB_PATH}")


def export_sample() -> None:
    """Frozen snapshot of the real processed data, flagged is_sample = 1, for offline fallback."""
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


if __name__ == "__main__":
    build()
    if "--sample" in sys.argv:
        export_sample()
