"""Evaluation against ground truth (pipeline step 9). No numbers are ever hard-coded: everything
is computed from the GT layer the user supplies, on the same scene."""
from __future__ import annotations

import geopandas as gpd
import numpy as np
import shapely
from shapely.ops import unary_union


def polygon_scores(pred: gpd.GeoDataFrame, gt: gpd.GeoDataFrame, iou_match: float = 0.5) -> dict:
    """Instance-level precision / recall / F1 (a prediction matches when IoU >= iou_match) plus
    pixel-style area IoU of the two unions."""
    pg, tg = list(pred.geometry), list(gt.geometry)
    tree = shapely.STRtree(tg)
    used, tp, ious = set(), 0, []
    for g in pg:
        best, best_j = 0.0, None
        for j in tree.query(g, predicate="intersects"):
            if j in used:
                continue
            inter = g.intersection(tg[j]).area
            iou = inter / (g.area + tg[j].area - inter + 1e-9)
            if iou > best:
                best, best_j = iou, j
        if best >= iou_match:
            tp += 1
            used.add(best_j)
            ious.append(best)
    fp, fn = len(pg) - tp, len(tg) - tp
    prec = tp / max(tp + fp, 1)
    rec = tp / max(tp + fn, 1)
    up, ut = unary_union(pg), unary_union(tg)
    inter = up.intersection(ut).area
    return {
        "n_pred": len(pg), "n_gt": len(tg), "tp": tp, "fp": fp, "fn": fn,
        "precision": prec, "recall": rec,
        "f1": 2 * prec * rec / max(prec + rec, 1e-9),
        "mean_matched_iou": float(np.mean(ious)) if ious else 0.0,
        "area_iou": inter / max(up.union(ut).area, 1e-9),
    }


def boundary_offset(pred: gpd.GeoDataFrame, gt: gpd.GeoDataFrame, step_m: float = 0.5) -> dict:
    """Distance (metres) from densified predicted boundaries to the nearest GT boundary."""
    gt_b = unary_union([g.boundary for g in gt.geometry])
    d = []
    for g in pred.geometry:
        b = g.boundary
        n = max(int(b.length // step_m), 2)
        pts = shapely.line_interpolate_point(b, np.linspace(0, b.length, n))
        d.extend(shapely.distance(pts, gt_b))
    d = np.asarray(d)
    return {"mean_m": float(d.mean()), "median_m": float(np.median(d)),
            "p90_m": float(np.percentile(d, 90)), "rmse_m": float(np.sqrt((d ** 2).mean()))}


def gnss_rmse(points_xy: np.ndarray, pred: gpd.GeoDataFrame) -> dict:
    """Horizontal error of surveyed GNSS/CORS control points vs the nearest predicted vertex."""
    verts = np.vstack([np.asarray(g.exterior.coords) for g in pred.geometry if g.geom_type == "Polygon"])
    err = np.array([np.min(np.hypot(*(verts - p).T)) for p in points_xy])
    return {"n": len(err), "rmse_m": float(np.sqrt((err ** 2).mean())), "max_m": float(err.max())}
