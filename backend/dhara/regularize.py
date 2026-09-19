"""Polygon regularisation (Layer 3).

Two explicit stages, both real and testable:

1. Douglas-Peucker simplification (Shapely) with a tolerance given in *metres*.
2. Orthogonalisation by edge fitting: edges are classified as parallel to the polygon's dominant
   direction (H), perpendicular to it (V) or other (O). Consecutive edges of the same class are
   merged into one fitted line (length-weighted), and new vertices are the intersections of
   consecutive fitted lines. This yields true right-angle corners where the structure supports
   them, while genuinely oblique walls are preserved. Any result that becomes invalid or drifts
   too far from the input silently falls back to the simplified polygon.
"""
from __future__ import annotations

import math

import numpy as np
from shapely.geometry import Polygon
from shapely.validation import make_valid


def _largest_polygon(geom) -> Polygon | None:
    if geom is None or geom.is_empty:
        return None
    if geom.geom_type == "Polygon":
        return geom
    polys = [g for g in getattr(geom, "geoms", []) if g.geom_type == "Polygon"]
    return max(polys, key=lambda p: p.area) if polys else None


def clean(geom) -> Polygon | None:
    """Repair an invalid geometry and keep its largest polygon part."""
    if geom is None or geom.is_empty:
        return None
    if not geom.is_valid:
        geom = make_valid(geom)
    return _largest_polygon(geom)


def simplify(poly: Polygon, tol_m: float) -> Polygon | None:
    return clean(poly.simplify(tol_m, preserve_topology=True))


def dominant_angle(poly: Polygon) -> float:
    """Length-weighted dominant edge direction, folded to [0, 90) degrees."""
    xy = np.asarray(poly.exterior.coords)
    d = np.diff(xy, axis=0)
    length = np.hypot(d[:, 0], d[:, 1])
    ang = np.degrees(np.arctan2(d[:, 1], d[:, 0])) % 90.0
    # circular weighted mean on a 90-degree period
    rad = np.radians(ang * 4.0)
    mean = math.atan2((length * np.sin(rad)).sum(), (length * np.cos(rad)).sum())
    return (math.degrees(mean) / 4.0) % 90.0


def _line_intersection(l1, l2):
    """Lines given as (point, unit direction). Returns None when (nearly) parallel."""
    (p, d), (q, e) = l1, l2
    denom = d[0] * e[1] - d[1] * e[0]
    if abs(denom) < 1e-6:
        return None
    t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / denom
    return (p[0] + t * d[0], p[1] + t * d[1])


def orthogonalize(poly: Polygon, angle_tol_deg: float = 22.0, max_area_drift: float = 0.25,
                  min_edge_m: float = 0.5, min_edge_frac: float = 0.05) -> Polygon:
    """Snap near-axis-aligned edges to a shared orientation and recompute corners.

    Edges shorter than max(min_edge_m, min_edge_frac * perimeter) are treated as vertex noise
    (mask-boundary spikes) and dropped: the neighbouring long edges decide the corner.
    """
    poly = clean(poly)
    if poly is None or len(poly.exterior.coords) < 5:
        return poly
    theta = math.radians(dominant_angle(poly))
    ux, uy = math.cos(theta), math.sin(theta)          # dominant axis
    vx, vy = -uy, ux                                    # perpendicular axis
    pts = np.asarray(poly.exterior.coords)[:-1]
    n = len(pts)

    edges = []  # (start, end, label, length)
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        d = b - a
        L = float(np.hypot(*d))
        if L < 1e-9:
            continue
        ang = math.degrees(math.atan2(d[1], d[0]) - theta) % 180.0
        if ang < angle_tol_deg or ang > 180.0 - angle_tol_deg:
            lab = "H"
        elif abs(ang - 90.0) < angle_tol_deg:
            lab = "V"
        else:
            lab = "O"
        edges.append([a, b, lab, L])
    perim = sum(e[3] for e in edges)
    min_len = max(min_edge_m, min_edge_frac * perim)
    edges = [e for e in edges if e[3] >= min_len]
    if len(edges) < 3:
        return poly

    # merge consecutive same-class H/V edges into runs (cyclically)
    runs = []
    for e in edges:
        if runs and runs[-1]["lab"] == e[2] and e[2] in ("H", "V"):
            runs[-1]["edges"].append(e)
        else:
            runs.append({"lab": e[2], "edges": [e]})
    if len(runs) > 1 and runs[0]["lab"] == runs[-1]["lab"] and runs[0]["lab"] in ("H", "V"):
        runs[0]["edges"] = runs[-1]["edges"] + runs[0]["edges"]
        runs.pop()
    if len(runs) < 3:
        return poly

    lines = []
    for r in runs:
        es = r["edges"]
        w = np.array([e[3] for e in es])
        mids = np.array([(e[0] + e[1]) / 2 for e in es])
        if r["lab"] == "H":
            # offset along the perpendicular axis, length-weighted
            off = float(((mids[:, 0] * vx + mids[:, 1] * vy) * w).sum() / w.sum())
            lines.append((np.array([off * vx, off * vy]), np.array([ux, uy])))
        elif r["lab"] == "V":
            off = float(((mids[:, 0] * ux + mids[:, 1] * uy) * w).sum() / w.sum())
            lines.append((np.array([off * ux, off * uy]), np.array([vx, vy])))
        else:
            a, b = es[0][0], es[-1][1]
            d = b - a
            d = d / (np.hypot(*d) + 1e-12)
            lines.append((np.array(a), d))

    new_pts = []
    for i in range(len(lines)):
        p = _line_intersection(lines[i - 1], lines[i])
        if p is None:
            return poly
        new_pts.append(p)
    try:
        cand = clean(Polygon(new_pts))
    except Exception:
        return poly
    if cand is None or cand.is_empty:
        return poly
    drift = abs(cand.area - poly.area) / max(poly.area, 1e-9)
    # corners may move by centimetres to a metre or two, never more
    if drift > max_area_drift or cand.hausdorff_distance(poly) > min(0.35 * math.sqrt(poly.area), 2.0):
        return poly
    return cand


def regularize(poly: Polygon, tol_m: float, angle_tol_deg: float, ortho: bool = True) -> Polygon | None:
    p = simplify(poly, tol_m)
    if p is None:
        return None
    if ortho:
        p = orthogonalize(p, angle_tol_deg)
    return clean(p)


def right_angle_ratio(poly: Polygon, tol_deg: float = 5.0) -> float:
    """Share of corners within tol of 90 degrees - used as an honest before/after metric."""
    xy = np.asarray(poly.exterior.coords)[:-1]
    n = len(xy)
    if n < 3:
        return 0.0
    ok = 0
    for i in range(n):
        a, b, c = xy[i - 1], xy[i], xy[(i + 1) % n]
        v1, v2 = a - b, c - b
        cosang = np.dot(v1, v2) / (np.hypot(*v1) * np.hypot(*v2) + 1e-12)
        ang = math.degrees(math.acos(max(-1, min(1, cosang))))
        ok += abs(ang - 90.0) <= tol_deg
    return ok / n
