"""Evidence fusion -> candidate parcels (pipeline step 7).

A building footprint is NOT a legal parcel (see the technical-approach PDF). Candidate parcels
are inferred by combining evidence layers:

  road corridors  - hard separators: a parcel never crosses a lane
  buildings       - seeds: each building anchors one parcel
  free ground     - allocated to the nearest seed of the *same block*, up to `max_setback_m`
  vegetation      - kept inside a parcel if within the setback, never a seed

Result: a gap-free, overlap-free partition of every road-bounded block (up to the setback), then
coverage-aware simplification so neighbouring parcels keep sharing exact boundaries. Everything
produced here is a *candidate* for officer review, never a legal boundary.
"""
from __future__ import annotations

import numpy as np
import shapely
from rasterio import features
from scipy import ndimage as ndi
from shapely.geometry import shape
from shapely.ops import unary_union

from .config import Params
from .regularize import clean


def allocate_parcels(bld_lab: np.ndarray, road: np.ndarray, gsd: float, p: Params) -> np.ndarray:
    """Raster allocation of free ground to the nearest building inside the same block."""
    h, w = bld_lab.shape
    bld = bld_lab > 0
    allowed = ~road
    blocks, _ = ndi.label(allowed | bld)                       # road-bounded blocks
    dist, (iy, ix) = ndi.distance_transform_edt(~bld, return_indices=True)
    nearest = bld_lab[iy, ix]
    same_block = blocks == blocks[iy, ix]
    within = dist * gsd <= p.max_setback_m
    lab = np.where(bld, bld_lab, np.where(allowed & same_block & within, nearest, 0)).astype(np.int32)
    # smooth ragged raster borders without letting labels bleed: majority-style opening per label
    return lab


def polygonize_labels(lab: np.ndarray, transform) -> dict[int, "shapely.Geometry"]:
    out: dict[int, list] = {}
    for geom, val in features.shapes(lab, mask=lab > 0, transform=transform, connectivity=4):
        out.setdefault(int(val), []).append(shape(geom))
    return {k: clean(unary_union(v)) for k, v in out.items()}


def build_parcels(bld_lab, road, transform, gsd, p: Params):
    """Return ({building_label: parcel polygon}, allocation label raster); shared boundaries are
    preserved when simplified."""
    lab = allocate_parcels(bld_lab, road, gsd, p)
    polys = polygonize_labels(lab, transform)
    ids = [k for k, g in polys.items() if g is not None and g.area >= p.min_parcel_area_m2]
    geoms = np.array([polys[k] for k in ids], dtype=object)
    if len(geoms) > 1:
        # topology-preserving simplification of a polygon *coverage*: neighbours stay aligned
        geoms = shapely.coverage_simplify(geoms, p.simplify_tol_m * 2.0)
    out = {}
    for k, g in zip(ids, geoms):
        g = clean(g)
        if g is not None and g.area >= p.min_parcel_area_m2:
            out[k] = g
    return out, lab


def landuse_label(coverage: float, veg_frac: float, area_m2: float) -> str:
    """Rule-based land-use from evidence composition (placeholder for a trained classifier)."""
    if coverage >= 0.30:
        return "Built-up"
    if veg_frac >= 0.45:
        return "Vegetated plot"
    if coverage < 0.05:
        return "Vacant / open plot"
    return "Built-up (low coverage)"
