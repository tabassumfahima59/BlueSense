"""Helpers to build Measure objects consistently."""
from __future__ import annotations

import math

from ..schemas.common import Interval, Measure, Provenance

CLIMATE_NORMAL_AS_OF = "2020-12-31"  # end of the 1991-2020 normal used by the engines


def m(value: float | None, unit: str, provenance: Provenance, source: str | None, *, sample: bool = False,
      as_of: str | None = None, low: float | None = None, high: float | None = None, digits: int = 3) -> Measure:
    if value is not None and (math.isnan(value) or math.isinf(value)):
        value = None
    unc = None
    if low is not None and high is not None and not (math.isnan(low) or math.isnan(high)):
        unc = Interval(low=round(low, digits), high=round(high, digits))
    return Measure(value=None if value is None else round(float(value), digits), unit=unit, provenance=provenance,
                   isSample=sample, sourceId=source, asOf=as_of, uncertainty=unc)


def engine(value: float | None, unit: str, scenario: bool, sample: bool, digits: int = 3,
           source: str = "aquaguard_engine") -> Measure:
    """Engine outputs: Estimated in baseline, Simulated under a scenario."""
    return m(value, unit, "simulated" if scenario else "estimated", source, sample=sample,
             as_of=CLIMATE_NORMAL_AS_OF, digits=digits)
