"""BWDB station-data importer (documented schema; no BWDB data is bundled).

Drop one or more CSV files into data/raw/bwdb/ with this header (see docs/DATA_SOURCES.md#bwdb):

    station_id,station_name,division,lon,lat,variable,date,value,unit

    variable ∈ {water_level_m, discharge_m3s, groundwater_depth_m, rainfall_mm}
    date     = YYYY-MM-DD
    division = one of the 8 AquaGuard division ids (dhaka, chattogram, ...)

Then run:  python ml/import_bwdb.py
Rows are validated and appended to the station_observations table with provenance = "observed".
This is the path by which measured groundwater levels may enter the platform — AquaGuard never
displays a groundwater depth that did not come through here.
"""
from __future__ import annotations

import sqlite3
import sys

import pandas as pd

from common import DATA, RAW, load_divisions, now_iso, record_retrieval

REQUIRED = ["station_id", "station_name", "division", "lon", "lat", "variable", "date", "value", "unit"]
VARIABLES = {"water_level_m": "m", "discharge_m3s": "m3/s", "groundwater_depth_m": "m", "rainfall_mm": "mm"}


def validate(df: pd.DataFrame, name: str) -> pd.DataFrame:
    missing = [c for c in REQUIRED if c not in df.columns]
    if missing:
        raise ValueError(f"{name}: missing columns {missing}")
    divisions = {d["id"] for d in load_divisions()}
    bad_div = set(df["division"]) - divisions
    if bad_div:
        raise ValueError(f"{name}: unknown division ids {sorted(bad_div)}")
    bad_var = set(df["variable"]) - set(VARIABLES)
    if bad_var:
        raise ValueError(f"{name}: unknown variables {sorted(bad_var)}")
    wrong_unit = df[df.apply(lambda r: VARIABLES[r["variable"]] != r["unit"], axis=1)]
    if len(wrong_unit):
        raise ValueError(f"{name}: unit mismatch on {len(wrong_unit)} rows (expected {VARIABLES})")
    df["date"] = pd.to_datetime(df["date"], format="%Y-%m-%d").dt.strftime("%Y-%m-%d")
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    return df.dropna(subset=["value"])


def main() -> int:
    files = sorted((RAW / "bwdb").glob("*.csv"))
    if not files:
        print("No BWDB CSV files in data/raw/bwdb/ — nothing to import (this is expected until data is obtained).")
        return 0
    frames = [validate(pd.read_csv(f), f.name) for f in files]
    df = pd.concat(frames, ignore_index=True)[REQUIRED]
    df["source_id"] = "bwdb_import"
    df["retrieved_at"] = now_iso()
    df["provenance"] = "observed"
    df["is_sample"] = 0
    con = sqlite3.connect(DATA / "aquaguard.db")
    con.execute("DELETE FROM station_observations WHERE source_id = 'bwdb_import'")
    df.to_sql("station_observations", con, if_exists="append", index=False)
    con.commit()
    con.close()
    record_retrieval("bwdb_import", {"files": [f.name for f in files], "rows": len(df)})
    print(f"imported {len(df)} BWDB rows from {len(files)} files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
