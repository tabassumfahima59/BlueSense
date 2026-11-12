"""Adapters for static reference datasets.

    python ml/fetch_static.py aquastat     # FAO AQUASTAT dissemination API, Bangladesh, 1990..2025
    python ml/fetch_static.py geo          # geoBoundaries ADM0/ADM1/ADM2 simplified GeoJSON
    python ml/fetch_static.py population   # HDX COD-PS 2022 (adm1, adm2) + World Bank projection
    python ml/fetch_static.py all

Raw files land in data/raw/<source>/ and cleaned outputs in data/processed/.
"""
from __future__ import annotations

import csv
import io
import json
import sys
from urllib.parse import quote

from common import PROCESSED, RAW, http_get, record_retrieval, write_json

AQUASTAT_SQL = (
    "https://data.apps.fao.org/catalog/dataset/945666e6-7803-4621-b8ef-cfd885a84596/resource/"
    "4a000a1b-24f0-4328-aab6-b9b525892090/download/query_en.sql"
)
AQUASTAT_API = "https://api.data.apps.fao.org/api/v2/bigquery"

# AQUASTAT variable codes used by the water-balance engine (code -> our key).
AQUASTAT_VARS = {
    4150: "precip_volume_km3",            # Long-term average annual precipitation in volume
    4151: "precip_depth_mm",              # Long-term average annual precipitation in depth
    4155: "surface_internal_km3",         # Surface water produced internally
    4154: "groundwater_internal_km3",     # Groundwater produced internally
    4187: "groundwater_renewable_km3",    # Total renewable groundwater
    4176: "surface_external_km3",         # Surface water: total external renewable
    4185: "surface_renewable_km3",        # Total renewable surface water
    4188: "trwr_km3",                     # Total renewable water resources
    4549: "efr_km3",                      # Environmental Flow Requirements
    4253: "withdrawal_total_km3",         # Total water withdrawal
    4250: "withdrawal_agri_km3",          # Agricultural water withdrawal
    4251: "withdrawal_municipal_km3",     # Municipal water withdrawal
    4252: "withdrawal_industrial_km3",    # Industrial water withdrawal
    4262: "withdrawal_groundwater_km3",   # Fresh groundwater withdrawal
    4261: "withdrawal_surface_km3",       # Fresh surface water withdrawal
    4260: "irrigation_requirement_km3",   # Irrigation water requirement
    4457: "municipal_per_capita_m3",      # Municipal water withdrawal per capita (total population)
    4346: "irrigated_harvested_rice_kha", # Harvested irrigated temporary crop area: Rice
    4345: "irrigated_harvested_wheat_kha",
    4348: "irrigated_harvested_maize_kha",
    4352: "irrigated_harvested_potato_kha",
    4313: "area_equipped_irrigation_kha", # Area equipped for irrigation: total
    4100: "country_area_kha",             # Total area of the country (excl. coastal water)
    4104: "population_kinhab",            # Total population
    4550: "sdg642_water_stress_pct",      # SDG 6.4.2 Water Stress
}

GEOB_API = "https://www.geoboundaries.org/api/current/gbOpen/BGD/{level}/"
HDX_PACKAGE = "https://data.humdata.org/api/3/action/package_show?id=cod-ps-bgd"


def fetch_aquastat() -> None:
    years = ",".join(str(y) for y in range(1990, 2026))
    variables = ",".join(str(v) for v in AQUASTAT_VARS)
    url = (
        f"{AQUASTAT_API}?sql_url={AQUASTAT_SQL}&variable={variables}&area=Bangladesh"
        f"&type=all&year={quote(years)}&download=true"
    )
    body = http_get(url, timeout=180)
    (RAW / "aquastat").mkdir(parents=True, exist_ok=True)
    (RAW / "aquastat" / "aquastat_bgd.csv").write_bytes(body)
    rows = list(csv.DictReader(io.StringIO(body.decode("utf-8-sig"))))
    if not rows:
        raise RuntimeError("AQUASTAT returned no rows")
    latest: dict[str, dict] = {}
    for r in rows:
        key = AQUASTAT_VARS.get(int(r["VariableCode"]))
        if key is None or r["Value"] in ("", None):
            continue
        year = int(r["Year"])
        if key not in latest or year > latest[key]["year"]:
            latest[key] = {
                "value": float(r["Value"]), "unit": r["Unit"], "year": year,
                "symbol": r["Symbol"], "symbolDescription": r["SymbolDescription"],
                "variable": r["Variable"], "variableCode": int(r["VariableCode"]),
            }
    # Record the most recent year whose value was NOT imputed (symbol "I" = carried forward /
    # interpolated), so the UI can say e.g. "2008 value, carried forward by AQUASTAT to 2023".
    for r in rows:
        key = AQUASTAT_VARS.get(int(r["VariableCode"]))
        if key is None or key not in latest or r["Value"] in ("", None) or r["Symbol"] == "I":
            continue
        year = int(r["Year"])
        if year > latest[key].get("lastNonImputedYear", 0):
            latest[key]["lastNonImputedYear"] = year
    for key, item in latest.items():
        if "lastNonImputedYear" not in item:
            # Every row imputed: the earliest year with the current value is the best reference.
            same = [int(r["Year"]) for r in rows if AQUASTAT_VARS.get(int(r["VariableCode"])) == key
                    and r["Value"] not in ("", None) and abs(float(r["Value"]) - item["value"]) < 1e-9]
            item["referenceYear"] = min(same) if same else item["year"]
        else:
            item["referenceYear"] = item["lastNonImputedYear"]
    missing = sorted(set(AQUASTAT_VARS.values()) - set(latest))
    write_json(PROCESSED / "aquastat_bgd.json", {"source_id": "fao_aquastat", "values": latest, "missing": missing})
    record_retrieval("fao_aquastat", {"rows": len(rows), "missing": missing})
    print(f"AQUASTAT: {len(latest)} variables, missing={missing}")


WB_PROJ = ("https://api.worldbank.org/v2/country/BGD/indicator/SP.POP.TOTL"
           "?source=40&date=2000:2050&format=json&per_page=200")


def fetch_population_projection() -> None:
    """World Bank Population Estimates and Projections (source 40), national total 2000-2050."""
    js = json.loads(http_get(WB_PROJ, timeout=120))
    rows = sorted(
        ({"year": int(r["date"]), "population": r["value"]} for r in js[1] if r["value"] is not None),
        key=lambda r: r["year"])
    if not rows:
        raise RuntimeError("World Bank projection returned no rows")
    (RAW / "worldbank").mkdir(parents=True, exist_ok=True)
    write_json(RAW / "worldbank" / "pop_projection_bgd.json", js)
    write_json(PROCESSED / "population_projection.json", {
        "source_id": "worldbank_pep", "lastUpdated": js[0].get("lastupdated"), "series": rows})
    record_retrieval("worldbank_pep", {"years": f"{rows[0]['year']}-{rows[-1]['year']}"})
    print(f"WB population projection: {rows[0]['year']}..{rows[-1]['year']}")


def fetch_geo() -> None:
    meta_out = {}
    for level in ("ADM0", "ADM1", "ADM2"):
        meta = json.loads(http_get(GEOB_API.format(level=level), timeout=60))
        gj = json.loads(http_get(meta["simplifiedGeometryGeoJSON"], timeout=180))
        write_json(RAW / "geo" / f"geoBoundaries-BGD-{level}_simplified.geojson", gj)
        meta_out[level] = {k: meta.get(k) for k in (
            "boundaryLicense", "boundarySource", "boundaryYearRepresented", "admUnitCount",
            "simplifiedGeometryGeoJSON", "sourceDataUpdateDate")}
        print(f"geoBoundaries {level}: {len(gj['features'])} features")
    write_json(RAW / "geo" / "geoboundaries_meta.json", meta_out)
    record_retrieval("geoboundaries", meta_out)


def fetch_population() -> None:
    pkg = json.loads(http_get(HDX_PACKAGE, timeout=60))["result"]
    wanted = {"bgd_admpop_adm1_2022.csv", "bgd_admpop_adm2_2022.csv"}
    got = []
    for res in pkg["resources"]:
        if res["name"] in wanted:
            body = http_get(res["url"], timeout=120)
            (RAW / "population").mkdir(parents=True, exist_ok=True)
            (RAW / "population" / res["name"]).write_bytes(body)
            got.append(res["name"])
    write_json(RAW / "population" / "hdx_meta.json", {
        "license": pkg.get("license_title"), "source": pkg.get("dataset_source"), "files": got})
    record_retrieval("hdx_cod_ps", {"license": pkg.get("license_title"), "files": got})
    print(f"HDX population: {got}")


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    if what in ("aquastat", "all"):
        fetch_aquastat()
    if what in ("geo", "all"):
        fetch_geo()
    if what in ("population", "all"):
        fetch_population()
        fetch_population_projection()
