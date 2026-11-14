"""FAO-56 crop water requirement engine (Allen et al. 1998).

    ETc = Kc x ET0
    Kc  : stage values (ini, mid, end); linear through development and late stages (FAO-56 Fig. 25)
    Pe  : USDA-SCS monthly method   P <= 250: Pe = P(125 - 0.2P)/125 ;  P > 250: Pe = 125 + 0.1P
    NIR = max(0, ETc - Pe)  (+ rice: land preparation + percolation/seepage)
    GIR = NIR / efficiency
    Volume (m3) = GIR (mm) x area (ha) x 10
    TAW = 1000 (theta_FC - theta_WP) Zr ;  RAW = p TAW ; interval ~ RAW / ETc

The monthly functions drive agricultural demand in the water balance; the daily functions drive
the Smart Irrigation Advisor. Both use the same Kc curve and effective-rainfall rule.
"""
from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date

from ..config.params import pentry, pval

DAYS_IN_MONTH = [calendar.monthrange(2001, m)[1] for m in range(1, 13)]  # climatological (non-leap) year
MONTH_START_DOY = [sum(DAYS_IN_MONTH[:i]) for i in range(12)]           # 0-based day-of-year at month start


@dataclass(frozen=True)
class Crop:
    key: str
    label: str
    kc_ini: float
    kc_mid: float
    kc_end: float
    l_ini: int
    l_dev: int
    l_mid: int
    l_late: int
    plant_month: int
    plant_day: int
    zr_m: float
    p: float
    ponded: bool
    irrigated_area_kha: float

    @property
    def season_days(self) -> int:
        return self.l_ini + self.l_dev + self.l_mid + self.l_late


def crops() -> dict[str, Crop]:
    out = {}
    for key, c in pentry("fao56", "crops").items():
        out[key] = Crop(
            key=key, label=c["label"], kc_ini=c["kc"]["ini"], kc_mid=c["kc"]["mid"], kc_end=c["kc"]["end"],
            l_ini=c["stages_days"]["ini"], l_dev=c["stages_days"]["dev"], l_mid=c["stages_days"]["mid"],
            l_late=c["stages_days"]["late"], plant_month=c["planting"]["month"], plant_day=c["planting"]["day"],
            zr_m=c["zr_m"], p=c["p"], ponded=bool(c["ponded"]), irrigated_area_kha=float(c["irrigated_area_kha"]),
        )
    return out


def kc_on_day(crop: Crop, day: int) -> float:
    """Kc on day `day` since planting (0-based). Outside the season returns 0."""
    if day < 0 or day >= crop.season_days:
        return 0.0
    if day < crop.l_ini:
        return crop.kc_ini
    d = day - crop.l_ini
    if d < crop.l_dev:
        return crop.kc_ini + (crop.kc_mid - crop.kc_ini) * (d / crop.l_dev)
    d -= crop.l_dev
    if d < crop.l_mid:
        return crop.kc_mid
    d -= crop.l_mid
    return crop.kc_mid + (crop.kc_end - crop.kc_mid) * (d / crop.l_late)


def stage_on_day(crop: Crop, day: int) -> str:
    if day < 0:
        return "not planted"
    if day < crop.l_ini:
        return "initial"
    if day < crop.l_ini + crop.l_dev:
        return "development"
    if day < crop.l_ini + crop.l_dev + crop.l_mid:
        return "mid-season"
    if day < crop.season_days:
        return "late season"
    return "harvested"


def effective_rainfall_monthly(p_mm: float) -> float:
    """USDA-SCS monthly effective rainfall (P in mm/month)."""
    p = max(0.0, p_mm)
    if p <= 250.0:
        return p * (125.0 - 0.2 * p) / 125.0
    return 125.0 + 0.1 * p


def effective_rainfall_period(p_mm: float, days: int) -> float:
    """Apply the monthly USDA-SCS rule to a period of `days` by scaling to a 30.4-day month."""
    if days <= 0:
        return 0.0
    scale = 30.4 / days
    return effective_rainfall_monthly(p_mm * scale) / scale


def plant_doy(crop: Crop) -> int:
    return MONTH_START_DOY[crop.plant_month - 1] + crop.plant_day - 1


def monthly_requirement(crop: Crop, precip_mm: list[float], et0_mm: list[float], efficiency: float,
                        rice: dict | None = None) -> list[dict]:
    """Climatological-year monthly requirement for one crop (mm over the cropped area).

    precip_mm / et0_mm: 12 monthly totals. Seasons may cross the year boundary (wrapped on 365 days).
    Returns per month: days_in_season, kc_mean, etc_mm, pe_mm, extra_mm (rice), nir_mm, gir_mm.
    """
    if not (0 < efficiency <= 1):
        raise ValueError("efficiency must be in (0, 1]")
    rice = rice or rice_params()
    start = plant_doy(crop)
    days_in = [0] * 12
    kc_sum = [0.0] * 12
    first_month = None
    for d in range(crop.season_days):
        doy = (start + d) % 365
        m = next(i for i in range(11, -1, -1) if doy >= MONTH_START_DOY[i])
        if first_month is None:
            first_month = m
        days_in[m] += 1
        kc_sum[m] += kc_on_day(crop, d)
    out = []
    for m in range(12):
        n = days_in[m]
        if n == 0:
            out.append({"month": m + 1, "days": 0, "kc": 0.0, "etc_mm": 0.0, "pe_mm": 0.0,
                        "extra_mm": 0.0, "nir_mm": 0.0, "gir_mm": 0.0})
            continue
        et0_day = et0_mm[m] / DAYS_IN_MONTH[m]
        etc = kc_sum[m] * et0_day
        pe = effective_rainfall_monthly(precip_mm[m]) * n / DAYS_IN_MONTH[m]
        extra = 0.0
        if crop.ponded:
            extra += rice["percolation_mm_day"] * n
            if m == first_month:
                extra += rice["land_preparation_mm"]
        nir = max(0.0, etc + extra - pe)
        out.append({"month": m + 1, "days": n, "kc": kc_sum[m] / n, "etc_mm": etc, "pe_mm": pe,
                    "extra_mm": extra, "nir_mm": nir, "gir_mm": nir / efficiency})
    return out


def rice_params() -> dict:
    return {k: pval("fao56", "rice", k) for k in
            ("land_preparation_mm", "percolation_mm_day", "ponding_depth_mm", "awd_saving_fraction")}


def mm_ha_to_m3(mm: float, area_ha: float) -> float:
    """Volume (m3) = depth (mm) x area (ha) x 10."""
    return mm * area_ha * 10.0


def mm_kha_to_mcm(mm: float, area_kha: float) -> float:
    """depth (mm) over area (1000 ha) -> MCM:  mm x 1000 ha x 10 m3 / 1e6 = mm x kha x 0.01."""
    return mm * area_kha * 0.01


def agricultural_demand_monthly(precip_mm: list[float], et0_mm: list[float], efficiency: float,
                                area_share: float) -> dict:
    """Gross agricultural demand (MCM per month) for a division holding `area_share` of the national
    AQUASTAT irrigated crop area. Returns totals and per-crop detail."""
    per_crop = {}
    totals = [0.0] * 12
    net = [0.0] * 12
    for key, crop in crops().items():
        if crop.irrigated_area_kha <= 0:
            continue
        area = crop.irrigated_area_kha * area_share
        rows = monthly_requirement(crop, precip_mm, et0_mm, efficiency)
        vols = [mm_kha_to_mcm(r["gir_mm"], area) for r in rows]
        nets = [mm_kha_to_mcm(r["nir_mm"], area) for r in rows]
        per_crop[key] = {"label": crop.label, "area_kha": area, "gross_mcm": vols, "net_mcm": nets,
                         "gir_mm": [r["gir_mm"] for r in rows]}
        totals = [a + b for a, b in zip(totals, vols)]
        net = [a + b for a, b in zip(net, nets)]
    return {"gross_mcm": totals, "net_mcm": net, "crops": per_crop}


# ---------------------------------------------------------------- daily advisor

@dataclass
class SoilWater:
    taw_mm: float
    raw_mm: float
    theta_fc: float
    theta_wp: float


def soil_water(soil_key: str, crop: Crop) -> SoilWater:
    soils = pentry("fao56", "soils")
    if soil_key not in soils or soil_key == "source":
        raise KeyError(soil_key)
    s = soils[soil_key]
    taw = 1000.0 * (s["theta_fc"] - s["theta_wp"]) * crop.zr_m
    return SoilWater(taw_mm=taw, raw_mm=crop.p * taw, theta_fc=s["theta_fc"], theta_wp=s["theta_wp"])


def advise(crop: Crop, soil_key: str, planting: date, today: date, days: list[dict], area_ha: float,
           efficiency: float, soil_moisture: float | None) -> dict:
    """Daily soil-water balance over the supplied days (recent + forecast).

    days: [{date, et0_mm, precip_mm}] covering `today` onward (past days are used for context only).
    Starting depletion: from model soil moisture when present, Dr0 = (theta_FC - theta) x 1000 x Zr,
    clipped to [0, TAW]; otherwise assumed half of RAW (documented assumption).
    """
    sw = soil_water(soil_key, crop)
    rice = rice_params()
    future = [d for d in days if d["date"] >= today.isoformat()]
    if not future:
        raise ValueError("no weather days from today onward")
    missing = [d["date"] for d in future if d.get("et0_mm") is None or d.get("precip_mm") is None]
    if missing:  # never assume 0 mm for a missing day (callers trim the window and report the dates)
        raise ValueError(f"missing ET0 or rainfall for {', '.join(missing)}")
    n = len(future)
    day0 = (today - planting).days
    kcs = [kc_on_day(crop, day0 + i) for i in range(n)]
    etcs = [k * d["et0_mm"] for k, d in zip(kcs, future)]
    p_total = sum(d["precip_mm"] for d in future)
    pe_total = effective_rainfall_period(p_total, n)
    pe_ratio = (pe_total / p_total) if p_total > 0 else 0.0
    etc_total = sum(etcs)
    extra = 0.0
    if crop.ponded:
        extra = rice["percolation_mm_day"] * sum(1 for k in kcs if k > 0)
        if 0 <= day0 < 1:
            extra += rice["land_preparation_mm"]
    nir = max(0.0, etc_total + extra - pe_total)
    gir = nir / efficiency

    if soil_moisture is not None:
        dr0 = min(max((sw.theta_fc - soil_moisture) * 1000.0 * crop.zr_m, 0.0), sw.taw_mm)
        start_basis = "model soil moisture (Open-Meteo, 3-9 cm; model data, not a field measurement)"
    else:
        dr0 = sw.raw_mm / 2.0
        start_basis = "assumed half of RAW (soil moisture unavailable)"

    # Trigger depletion: RAW for upland crops; for ponded rice (AWD) the ponding depth.
    trigger = rice["ponding_depth_mm"] if crop.ponded else sw.raw_mm
    if crop.ponded:
        dr0 = 0.0
        start_basis = "assumed field flooded to the AWD ponding depth"
    loss_per_day = [e + (rice["percolation_mm_day"] if crop.ponded and k > 0 else 0.0) for e, k in zip(etcs, kcs)]
    dr = dr0
    next_date = None
    trace = []
    for d, loss, k in zip(future, loss_per_day, kcs):
        dr = max(0.0, dr + loss - d["precip_mm"] * pe_ratio)
        trace.append({"date": d["date"], "depletion_mm": round(dr, 2), "kc": round(k, 3)})
        if next_date is None and k > 0 and dr >= trigger:
            next_date = d["date"]
    in_season = [e for e, k in zip(etcs, kcs) if k > 0]
    mean_etc = sum(in_season) / len(in_season) if in_season else 0.0
    mean_loss = sum(loss_per_day) / n
    interval = (trigger / mean_loss) if mean_loss > 0 else None
    per_irrigation_net = trigger
    per_irrigation_gross = per_irrigation_net / efficiency
    return {
        "kcToday": kcs[0], "stage": stage_on_day(crop, day0), "daysSincePlanting": day0,
        "etcMeanMmDay": mean_etc, "et0MeanMmDay": sum(d["et0_mm"] for d in future) / n,
        "periodDays": n, "periodFrom": future[0]["date"], "periodTo": future[-1]["date"],
        "precipMm": p_total, "effectiveRainMm": pe_total, "etcTotalMm": etc_total, "riceExtraMm": extra,
        "nirMm": nir, "girMm": gir, "nirM3": mm_ha_to_m3(nir, area_ha), "girM3": mm_ha_to_m3(gir, area_ha),
        "tawMm": sw.taw_mm, "rawMm": sw.raw_mm, "triggerMm": trigger, "startDepletionMm": dr0,
        "startBasis": start_basis, "nextIrrigationDate": next_date, "intervalDays": interval,
        "perIrrigationNetMm": per_irrigation_net, "perIrrigationGrossMm": per_irrigation_gross,
        "perIrrigationGrossM3": mm_ha_to_m3(per_irrigation_gross, area_ha), "trace": trace,
        "inSeason": any(k > 0 for k in kcs),
    }


def planting_date_for(crop: Crop, today: date) -> date:
    """Default planting date: the configured planting day in the most recent season that is not in the future."""
    d = date(today.year, crop.plant_month, crop.plant_day)
    return d if d <= today else date(today.year - 1, crop.plant_month, crop.plant_day)
