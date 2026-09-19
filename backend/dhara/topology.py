"""Deterministic topology validation + safe auto-fix (pipeline step 8).

Every rule is an explicit geometric test - no learning involved. Issues carry a geometry,
severity, a plain-language message and a suggested fix so the reviewer knows what to do.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import geopandas as gpd
import numpy as np
import shapely
from shapely.geometry import Polygon
from shapely.ops import unary_union
from shapely.validation import explain_validity

from .config import Params


@dataclass
class Issue:
    type: str
    severity: str                     # error | warning | info
    message: str
    fix: str
    geometry: object
    parcel_ids: list = field(default_factory=list)
    area_m2: float = 0.0


def _sliver_width(g: Polygon) -> float:
    """Effective width = 2*area/perimeter (equals the true width for long thin strips)."""
    return 2.0 * g.area / max(g.length, 1e-9)


def _real(inter, p: Params, min_area: float | None = None) -> bool:
    """An intersection counts only if it is polygonal, big enough AND thicker than the positional
    tolerance - a 10 cm ribbon along a shared wall is digitising noise, not an error."""
    if inter.is_empty or inter.geom_type not in ("Polygon", "MultiPolygon"):
        return False
    return inter.area > (min_area or p.overlap_tol_m2) and _sliver_width(inter) >= p.sliver_thickness_m


def validate(parcels: gpd.GeoDataFrame, buildings: gpd.GeoDataFrame, roads, p: Params) -> list[Issue]:
    issues: list[Issue] = []
    pg = parcels.geometry.values
    pid = parcels["parcel_id"].values
    road_geom = roads if roads is not None and not roads.is_empty else None

    # 1. invalid geometry
    for g, i in zip(pg, pid):
        if not g.is_valid:
            issues.append(Issue("invalid_geometry", "error", f"{i}: {explain_validity(g)}",
                                "Repair with make_valid or redraw the ring", g.representative_point(), [i]))

    # 2. parcel overlaps (STRtree)
    tree = shapely.STRtree(pg)
    left, right = tree.query(pg, predicate="intersects")
    for a, b in zip(left, right):
        if a >= b:
            continue
        inter = pg[a].intersection(pg[b])
        area = inter.area
        if _real(inter, p):
            issues.append(Issue("parcel_overlap", "error",
                                f"{pid[a]} and {pid[b]} overlap by {area:.1f} m2",
                                "Assign the overlap to the parcel that contains the building",
                                inter, [pid[a], pid[b]], area))

    # 3. gaps between parcels (closing-minus-original), excluding road corridors
    union = unary_union(pg)
    closed = union.buffer(0.6).buffer(-0.6)
    gaps = closed.difference(union)
    if road_geom is not None:
        gaps = gaps.difference(road_geom.buffer(0.3))
    for g in getattr(gaps, "geoms", [gaps]):
        if g.geom_type == "Polygon" and g.area > 0.6 and _sliver_width(g) > 0.05:
            issues.append(Issue("parcel_gap", "warning", f"Unassigned gap of {g.area:.1f} m2 between parcels",
                                "Merge into the neighbouring parcel with the longest shared edge or mark as common land",
                                g, [], g.area))

    # 4. slivers / tiny parcels
    for g, i in zip(pg, pid):
        if g.is_valid and _sliver_width(g) < p.sliver_thickness_m * 4 and g.area < 25:
            issues.append(Issue("sliver_parcel", "warning", f"{i} is a thin sliver ({_sliver_width(g):.2f} m wide)",
                                "Merge into an adjacent parcel", g.representative_point(), [i], g.area))
        elif g.area < p.min_parcel_area_m2 * 1.5:
            issues.append(Issue("tiny_parcel", "info", f"{i} is only {g.area:.1f} m2",
                                "Verify on the ground - possible fragment", g.representative_point(), [i], g.area))

    # 5. building overlaps
    bg = buildings.geometry.values
    bid = buildings["building_id"].values
    btree = shapely.STRtree(bg)
    l2, r2 = btree.query(bg, predicate="intersects")
    for a, b in zip(l2, r2):
        if a >= b:
            continue
        inter = bg[a].intersection(bg[b])
        if _real(inter, p, 0.5):
            issues.append(Issue("building_overlap", "warning",
                                f"Buildings {bid[a]} and {bid[b]} overlap by {inter.area:.1f} m2",
                                "Check for shared wall vs digitising error; snap edges", inter, [], inter.area))

    # 6. buildings on roads
    if road_geom is not None:
        for g, i in zip(bg, bid):
            inter = g.intersection(road_geom)
            if _real(inter, p, 2.0) and inter.area > 0.08 * g.area:
                issues.append(Issue("building_on_road", "warning",
                                    f"{i} intrudes {inter.area:.1f} m2 into the road corridor - possible encroachment",
                                    "Flag for field verification", inter, [], inter.area))

    # 7. building not contained in its parcel
    ptree = shapely.STRtree(pg)
    for g, i, par in zip(bg, bid, buildings["parcel_id"].values):
        cand = ptree.query(g, predicate="intersects")
        if len(cand) == 0:
            continue
        areas = []
        for c in cand:
            it = pg[c].intersection(g)
            areas.append((it.area if _real(it, p, 2.0) else 0.0, pid[c]))
        areas.sort(reverse=True)
        main, others = areas[0], [a for a in areas[1:] if a[0] > 0]
        if others:
            issues.append(Issue("building_straddles", "error",
                                f"{i} straddles {len(others) + 1} parcels ({', '.join(str(a[1]) for a in [main] + others)})",
                                "Move the shared boundary or split the building", g.representative_point(),
                                [a[1] for a in [main] + others], sum(a[0] for a in others)))

    # 8. no road access
    if road_geom is not None:
        acc = road_geom.buffer(1.0)
        for g, i in zip(pg, pid):
            if not g.intersects(acc):
                issues.append(Issue("no_road_access", "info", f"{i} has no direct road access",
                                    "Verify access easement on the ground", g.representative_point(), [i], g.area))
    return issues


def autofix_overlaps(parcels: gpd.GeoDataFrame, buildings: gpd.GeoDataFrame, p: Params) -> gpd.GeoDataFrame:
    """Resolve parcel overlaps deterministically: the overlap goes to the parcel that holds the
    larger share of any building inside the overlap; ties go to the smaller parcel id."""
    parcels = parcels.copy()
    geoms = list(parcels.geometry.values)
    ids = list(parcels["parcel_id"].values)
    bg = buildings.geometry.values
    tree = shapely.STRtree(geoms)
    for a in range(len(geoms)):
        for b in tree.query(geoms[a], predicate="intersects"):
            if a >= b:
                continue
            inter = geoms[a].intersection(geoms[b])
            if inter.area <= p.overlap_tol_m2 or inter.geom_type not in ("Polygon", "MultiPolygon"):
                continue
            wa = sum(inter.intersection(x).area for x in bg if x.intersects(geoms[a]) and x.intersects(inter))
            wb = sum(inter.intersection(x).area for x in bg if x.intersects(geoms[b]) and x.intersects(inter))
            loser = b if wa >= wb else a
            geoms[loser] = geoms[loser].difference(inter)
    parcels["geometry"] = [g if g.geom_type in ("Polygon", "MultiPolygon") else Polygon() for g in geoms]
    return parcels[~parcels.geometry.is_empty]
