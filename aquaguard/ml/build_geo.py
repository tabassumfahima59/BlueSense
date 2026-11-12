"""Build cleaned region geometry + attributes from geoBoundaries and HDX COD-PS.

Outputs
  data/geo/divisions.geojson   8 divisions  (id, name, nameBn, areaKm2, population2022)
  data/geo/districts.geojson   64 districts (id, name, divisionId, areaKm2, population2022)
  data/processed/regions.json  country + divisions + districts with centroids, areas, populations

Areas are computed on a sphere (R = 6371.0088 km) from the simplified polygons, so they are
Estimated values. Geometry is simplified (Douglas-Peucker, ~0.003 deg) to keep the web map light.
"""
from __future__ import annotations

import csv
import json
import math
import re

from common import GEO, PROCESSED, RAW, load_geo_registry, write_json

R_KM = 6371.0088
SIMPLIFY_TOL = 0.003


def ring_area_km2(ring: list[list[float]]) -> float:
    """Spherical polygon area (Chamberlain & Duquette 2007 approximation)."""
    total = 0.0
    n = len(ring)
    for i in range(n - 1):
        lon1, lat1 = map(math.radians, ring[i])
        lon2, lat2 = map(math.radians, ring[i + 1])
        total += (lon2 - lon1) * (2 + math.sin(lat1) + math.sin(lat2))
    return abs(total * R_KM * R_KM / 2.0)


def polygons(geom: dict) -> list[list[list[list[float]]]]:
    return [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]


def geom_area_km2(geom: dict) -> float:
    area = 0.0
    for poly in polygons(geom):
        area += ring_area_km2(poly[0]) - sum(ring_area_km2(h) for h in poly[1:])
    return area


def geom_centroid(geom: dict) -> tuple[float, float]:
    """Area-weighted planar centroid of outer rings (adequate at Bangladesh scale)."""
    ax = ay = at = 0.0
    for poly in polygons(geom):
        ring = poly[0]
        a = cx = cy = 0.0
        for i in range(len(ring) - 1):
            x0, y0 = ring[i]
            x1, y1 = ring[i + 1]
            cross = x0 * y1 - x1 * y0
            a += cross
            cx += (x0 + x1) * cross
            cy += (y0 + y1) * cross
        if a == 0:
            continue
        a *= 0.5
        ax += cx / 6.0
        ay += cy / 6.0
        at += a
    return (round(ax / at, 4), round(ay / at, 4))


def point_in_ring(x: float, y: float, ring: list[list[float]]) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-15) + xi:
            inside = not inside
        j = i
    return inside


def point_in_geom(x: float, y: float, geom: dict) -> bool:
    for poly in polygons(geom):
        if point_in_ring(x, y, poly[0]) and not any(point_in_ring(x, y, h) for h in poly[1:]):
            return True
    return False


def _dp(points: list[list[float]], tol: float) -> list[list[float]]:
    if len(points) < 3:
        return points
    (x1, y1), (x2, y2) = points[0], points[-1]
    dx, dy = x2 - x1, y2 - y1
    norm = math.hypot(dx, dy) or 1e-12
    idx, dmax = 0, 0.0
    for i in range(1, len(points) - 1):
        x0, y0 = points[i]
        d = abs(dy * x0 - dx * y0 + x2 * y1 - y2 * x1) / norm
        if d > dmax:
            idx, dmax = i, d
    if dmax > tol:
        return _dp(points[: idx + 1], tol)[:-1] + _dp(points[idx:], tol)
    return [points[0], points[-1]]


def simplify_geom(geom: dict) -> dict:
    out = []
    for poly in polygons(geom):
        rings = []
        for ring in poly:
            # A closed ring starts and ends on the same point, which degenerates Douglas-Peucker;
            # split it at the vertex farthest from the start and simplify both halves.
            far = max(range(len(ring)), key=lambda i: math.dist(ring[0], ring[i]))
            simplified = _dp(ring[: far + 1], SIMPLIFY_TOL)[:-1] + _dp(ring[far:], SIMPLIFY_TOL)
            s = [[round(x, 4), round(y, 4)] for x, y in simplified]
            if len(s) >= 4:
                rings.append(s)
        if rings:
            out.append(rings)
    return {"type": "MultiPolygon", "coordinates": out}


def norm(s: str) -> str:
    return re.sub(r"[^a-z]", "", s.lower())


# geoBoundaries ADM1 shapeName -> our division id (geoBoundaries spells Rajshahi "Rajshani").
ADM1_TO_ID = {
    "chittagong": "chattogram", "dhaka": "dhaka", "mymensingh": "mymensingh", "rajshani": "rajshahi",
    "rajshahi": "rajshahi", "rangpur": "rangpur", "sylhet": "sylhet", "khulna": "khulna", "barisal": "barishal",
}
# HDX ADM1_NAME -> our division id
HDX1_TO_ID = {
    "barisal": "barishal", "chittagong": "chattogram", "dhaka": "dhaka", "khulna": "khulna",
    "mymensingh": "mymensingh", "rajshahi": "rajshahi", "rangpur": "rangpur", "sylhet": "sylhet",
}
# District spellings that differ between geoBoundaries ADM2 and HDX COD-PS ADM2.
DISTRICT_ALIASES = {
    "brahamanbaria": "brahmanbaria", "nawabganj": "chapainababganj", "chapainawabganj": "chapainababganj",
    "jessore": "jashore", "bogra": "bogura", "comilla": "cumilla", "barisal": "barishal",
    "chittagong": "chattogram", "maulvibazar": "moulvibazar", "jhalokati": "jhalokathi",
}


def build() -> None:
    reg = load_geo_registry()
    adm1 = json.loads((RAW / "geo" / "geoBoundaries-BGD-ADM1_simplified.geojson").read_text(encoding="utf-8"))
    adm2 = json.loads((RAW / "geo" / "geoBoundaries-BGD-ADM2_simplified.geojson").read_text(encoding="utf-8"))
    meta = {d["id"]: d for d in reg["divisions"]}

    pop1: dict[str, int] = {}
    with open(RAW / "population" / "bgd_admpop_adm1_2022.csv", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            pop1[HDX1_TO_ID[norm(r["ADM1_NAME"])]] = int(r["T_TL"])
    pop2: dict[str, int] = {}
    with open(RAW / "population" / "bgd_admpop_adm2_2022.csv", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            k = norm(r["ADM2_NAME"])
            pop2[DISTRICT_ALIASES.get(k, k)] = int(r["T_TL"])

    div_features, divisions = [], []
    for feat in adm1["features"]:
        did = ADM1_TO_ID[norm(feat["properties"]["shapeName"])]
        geom = feat["geometry"]
        area = geom_area_km2(geom)
        m = meta[did]
        props = {"id": did, "name": m["name"], "nameBn": m["nameBn"], "level": "division",
                 "areaKm2": round(area, 1), "population2022": pop1.get(did)}
        div_features.append({"type": "Feature", "properties": props, "geometry": simplify_geom(geom)})
        divisions.append({**props, "centroid": [m["lon"], m["lat"]], "geomCentroid": list(geom_centroid(geom)),
                          "parentId": "bd"})

    districts, dist_features, unmatched_pop = [], [], []
    for feat in adm2["features"]:
        name = feat["properties"]["shapeName"]
        geom = feat["geometry"]
        cx, cy = geom_centroid(geom)
        parent = next((f for f in adm1["features"] if point_in_geom(cx, cy, f["geometry"])), None)
        if parent is None:  # centroid outside every division (coastal multipolygon): nearest division
            parent = min(adm1["features"], key=lambda f: math.dist(geom_centroid(f["geometry"]), (cx, cy)))
        div_id = ADM1_TO_ID[norm(parent["properties"]["shapeName"])]
        k = norm(name)
        key = DISTRICT_ALIASES.get(k, k)
        pop = pop2.get(key)
        if pop is None:
            unmatched_pop.append(name)
        did = f"{div_id}-{key}"
        props = {"id": did, "name": name, "level": "district", "divisionId": div_id,
                 "areaKm2": round(geom_area_km2(geom), 1), "population2022": pop}
        dist_features.append({"type": "Feature", "properties": props, "geometry": simplify_geom(geom)})
        districts.append({**props, "centroid": [cx, cy], "parentId": div_id})

    write_json(GEO / "divisions.geojson", {"type": "FeatureCollection", "features": div_features})
    write_json(GEO / "districts.geojson", {"type": "FeatureCollection", "features": dist_features})
    country_area = sum(d["areaKm2"] for d in divisions)
    write_json(PROCESSED / "regions.json", {
        "country": {**reg["country"], "level": "country", "areaKm2": round(country_area, 1),
                    "population2022": sum(v for v in pop1.values())},
        "divisions": sorted(divisions, key=lambda d: d["name"]),
        "districts": sorted(districts, key=lambda d: (d["divisionId"], d["name"])),
        "unmatchedDistrictPopulation": unmatched_pop,
    })
    print(f"divisions={len(divisions)} districts={len(districts)} area={country_area:.0f} km2 "
          f"unmatched population names={unmatched_pop}")


if __name__ == "__main__":
    build()
