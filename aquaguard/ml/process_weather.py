"""Clean Open-Meteo archive + GloFAS raw responses into processed tables.

Outputs (data/processed/):
  weather_daily.csv      division, date, precip_mm, tmax_c, tmin_c, tmean_c, et0_mm, soil_moisture_m3m3
  weather_monthly.csv    division, year, month, precip_mm, et0_mm, d_mm (= P - ET0), tmean_c, tmax_c,
                         tmin_c, soil_moisture_m3m3, n_days  (complete months only)
  climatology.csv        division, month, normals over CLIM_START..CLIM_END (WMO 1991-2020 normal)
  inflow_shape.json      monthly share of combined GloFAS discharge at three river cells (sums to 1)
"""
from __future__ import annotations

import calendar
import json

import pandas as pd

from common import PROCESSED, RAW, load_divisions, write_json

CLIM_START, CLIM_END = 1991, 2020

COLS = {
    "precipitation_sum": "precip_mm",
    "temperature_2m_max": "tmax_c",
    "temperature_2m_min": "tmin_c",
    "temperature_2m_mean": "tmean_c",
    "et0_fao_evapotranspiration": "et0_mm",
    "soil_moisture_0_to_7cm_mean": "soil_moisture_m3m3",
}


def load_daily() -> pd.DataFrame:
    frames = []
    for d in load_divisions():
        path = RAW / "openmeteo" / f"archive_{d['id']}.json"
        if not path.exists():
            raise FileNotFoundError(f"missing {path}; run ml/fetch_openmeteo.py archive")
        js = json.loads(path.read_text(encoding="utf-8"))
        df = pd.DataFrame(js["daily"]).rename(columns={"time": "date", **COLS})
        df["division"] = d["id"]
        frames.append(df)
    daily = pd.concat(frames, ignore_index=True)
    daily["date"] = pd.to_datetime(daily["date"])
    return daily[["division", "date", *COLS.values()]]


def monthly_from_daily(daily: pd.DataFrame) -> pd.DataFrame:
    df = daily.copy()
    df["year"] = df["date"].dt.year
    df["month"] = df["date"].dt.month
    g = df.groupby(["division", "year", "month"])
    m = g.agg(
        precip_mm=("precip_mm", "sum"), et0_mm=("et0_mm", "sum"), tmean_c=("tmean_c", "mean"),
        tmax_c=("tmax_c", "mean"), tmin_c=("tmin_c", "mean"),
        soil_moisture_m3m3=("soil_moisture_m3m3", "mean"),
        n_days=("precip_mm", "count"),
    ).reset_index()
    m["days_in_month"] = [calendar.monthrange(y, mo)[1] for y, mo in zip(m["year"], m["month"])]
    m = m[m["n_days"] == m["days_in_month"]].drop(columns="days_in_month")  # complete months only
    m["d_mm"] = m["precip_mm"] - m["et0_mm"]
    return m.round(3)


def climatology(monthly: pd.DataFrame) -> pd.DataFrame:
    base = monthly[(monthly["year"] >= CLIM_START) & (monthly["year"] <= CLIM_END)]
    c = base.groupby(["division", "month"]).agg(
        precip_mm=("precip_mm", "mean"), precip_sd=("precip_mm", "std"),
        et0_mm=("et0_mm", "mean"), tmean_c=("tmean_c", "mean"),
        tmax_c=("tmax_c", "mean"), tmin_c=("tmin_c", "mean"),
        soil_moisture_m3m3=("soil_moisture_m3m3", "mean"),
        d_mm=("d_mm", "mean"), d_sd=("d_mm", "std"), n_years=("year", "nunique"),
    ).reset_index()
    return c.round(3)


def inflow_shape() -> dict:
    series = []
    for path in sorted((RAW / "glofas").glob("discharge_*.json")):
        js = json.loads(path.read_text(encoding="utf-8"))
        s = pd.Series(js["daily"]["river_discharge"], index=pd.to_datetime(js["daily"]["time"]), dtype=float)
        series.append(s)
    if not series:
        raise FileNotFoundError("no GloFAS files; run ml/fetch_openmeteo.py glofas")
    total = pd.concat(series, axis=1).sum(axis=1, min_count=len(series)).dropna()
    total = total[(total.index.year >= CLIM_START) & (total.index.year <= CLIM_END)]
    # mean flow (m3/s) per calendar month x days -> volume share per month
    by_month = total.groupby(total.index.month).mean()
    vol = {m: by_month[m] * 86400 * calendar.monthrange(2001, m)[1] for m in range(1, 13)}
    s = sum(vol.values())
    return {
        "source_id": "openmeteo_glofas",
        "period": f"{CLIM_START}-{CLIM_END}",
        "method": "Monthly share of the summed mean daily discharge at three GloFAS river cells "
                  "(Ganges, Brahmaputra-Jamuna, Upper Meghna).",
        "shares": {str(m): round(vol[m] / s, 6) for m in range(1, 13)},
        "meanFlowM3s": {str(m): round(float(by_month[m]), 1) for m in range(1, 13)},
    }


def main() -> None:
    daily = load_daily()
    monthly = monthly_from_daily(daily)
    clim = climatology(monthly)
    PROCESSED.mkdir(parents=True, exist_ok=True)
    daily.to_csv(PROCESSED / "weather_daily.csv", index=False, date_format="%Y-%m-%d")
    monthly.to_csv(PROCESSED / "weather_monthly.csv", index=False)
    clim.to_csv(PROCESSED / "climatology.csv", index=False)
    write_json(PROCESSED / "inflow_shape.json", inflow_shape())
    print(f"daily={len(daily)} monthly={len(monthly)} last={monthly['year'].max()}-"
          f"{monthly[monthly['year'] == monthly['year'].max()]['month'].max()}")


if __name__ == "__main__":
    main()
