"""Risk classification.

Stress class   : WRI Aqueduct baseline water stress categories applied to the engine's stress ratio.
Dryness class  : SPI/SPEI-style classes applied to the standardised predicted climatic water balance
                 z = (D_pred - mean_D(month)) / sd_D(month), climatology 1991-2020.
Combined risk  : level = max(stress level, dryness level)  — rule shown on every page that uses it.
"""
from __future__ import annotations

import math

from ..config.params import pentry


def stress_label(ratio: float) -> str:
    for c in pentry("stress_classes")["classes"]:
        if c["max"] is None or ratio < c["max"]:
            return c["name"]
    raise AssertionError("unreachable")


def dryness_label(z: float | None) -> str | None:
    if z is None or math.isnan(z):
        return None
    for c in pentry("dryness_classes")["classes"]:
        if c["max"] is None or z <= c["max"]:
            return c["name"]
    raise AssertionError("unreachable")


def zscore(value: float, mean: float, sd: float) -> float | None:
    if sd is None or sd <= 0 or math.isnan(sd):
        return None
    return (value - mean) / sd


def combined(stress_ratio: float, z: float | None) -> dict:
    r = pentry("risk")
    s_label = stress_label(stress_ratio)
    s_level = r["stress_level"][s_label]
    d_label = dryness_label(z)
    d_level = r["dryness_level"][d_label] if d_label else 0
    level = max(s_level, d_level)
    return {
        "label": r["labels"][level], "level": level, "stressClass": s_label, "drynessClass": d_label,
        "rule": "risk level = max(stress level, dryness level); stress: WRI Aqueduct classes "
                "(<10% Low, 10-20% Low-medium, 20-40% Medium-high, 40-80% High, >80% Extremely high); "
                "dryness: z of predicted D (<=-1 moderately dry -> 2, <=-1.5 severely -> 3, <=-2 extremely -> 4)",
    }
