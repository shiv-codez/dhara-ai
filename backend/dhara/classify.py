"""Semantic labelling of SAM instances + open-space (road) extraction.

SAM is class-agnostic, so classes come from transparent, inspectable evidence:

* vegetation  - pixel-level green-dominance (chromatic Excess-Green + hue) map.
* building    - non-vegetation instance with roof-like geometry (area, solidity, rectangularity)
                and roof-like appearance (not ground-coloured). If a DSM/DTM is supplied, an
                nDSM height test replaces the appearance heuristic (see `ndsm_mask`).
* road/open   - the *free space* left after removing buildings and vegetation, split into narrow
                connected corridors (roads/lanes) and wide blobs (open ground) using a
                skeleton-based local-width test.

This is deliberately a replaceable module: swapping `classify_instances` for a small trained
head on SAM embeddings (or U-Net) keeps every downstream stage unchanged.
"""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np
from scipy import ndimage as ndi
from skimage.morphology import disk, remove_small_holes, remove_small_objects, skeletonize

from .config import Params
from .segment import Instance


# ----------------------------------------------------------------------------- pixel evidence
def vegetation_map(rgb: np.ndarray, exg_thresh: float = 0.035, min_sat: int = 35) -> np.ndarray:
    f = rgb.astype(np.float32) / 255.0
    s = f.sum(-1) + 1e-6
    r, g, b = f[..., 0] / s, f[..., 1] / s, f[..., 2] / s
    exg = 2 * g - r - b
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    hue, sat, val = hsv[..., 0].astype(int) * 2, hsv[..., 1], hsv[..., 2]
    veg = (exg > exg_thresh) & (g >= r) & (g >= b * 0.98) & (hue >= 45) & (hue <= 170) & (sat >= min_sat) & (val >= 25)
    veg = ndi.binary_opening(veg, structure=disk(1))
    veg = remove_small_objects(veg, 30)
    veg = remove_small_holes(veg, 40)
    return veg


def ndsm_mask(dsm: np.ndarray, dtm: np.ndarray, min_height_m: float = 2.0) -> np.ndarray:
    """Height above ground. Used when a DSM/DTM pair is available (nDSM = DSM - DTM)."""
    return (dsm - dtm) >= min_height_m


# ----------------------------------------------------------------------------- instance features
@dataclass
class Feat:
    area_m2: float
    solidity: float
    rect: float
    elong: float
    veg_frac: float
    mean_rgb: tuple
    sat: float
    val: float
    hue: float


def instance_features(inst: Instance, rgb: np.ndarray, veg: np.ndarray, gsd: float) -> Feat:
    m = inst.mask
    h, w = m.shape
    sub = rgb[inst.y0:inst.y0 + h, inst.x0:inst.x0 + w]
    area_px = float(m.sum())
    cnts, _ = cv2.findContours(m.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    c = max(cnts, key=cv2.contourArea)
    hull_area = max(cv2.contourArea(cv2.convexHull(c)), 1.0)
    (_, _), (rw, rh), _ = cv2.minAreaRect(c)
    rect_area = max(rw * rh, 1.0)
    px = sub[m]
    hsv = cv2.cvtColor(px.reshape(-1, 1, 3), cv2.COLOR_RGB2HSV).reshape(-1, 3)
    return Feat(
        area_m2=area_px * gsd * gsd,
        solidity=area_px / hull_area,
        rect=area_px / rect_area,
        elong=min(rw, rh) / max(max(rw, rh), 1.0),
        veg_frac=float(veg[inst.y0:inst.y0 + h, inst.x0:inst.x0 + w][m].mean()),
        mean_rgb=tuple(float(v) for v in px.mean(0)),
        sat=float(hsv[:, 1].mean()) / 255.0,
        val=float(hsv[:, 2].mean()) / 255.0,
        hue=float(np.median(hsv[:, 0])) * 2.0,          # degrees
    )


def ground_likeness(f: Feat) -> float:
    """Score in [0,1] for how much an instance looks like ground rather than a roof.

    Dark-brown + blobby + low rectangularity + low contrast. Used to triage review priority
    for instances classified as buildings that may actually be shadowed earth.
    """
    score = 0.0
    # dark brown colour (low val, low-to-mid sat, low hue)
    if f.val < 0.36 and f.sat > 0.18 and f.hue < 50:
        score += 0.35
    # blobby shape (low solidity, low rectangularity)
    if f.solidity < 0.82:
        score += 0.25 * (1.0 - min(f.solidity / 0.82, 1.0))
    if f.rect < 0.65:
        score += 0.25 * (1.0 - min(f.rect / 0.65, 1.0))
    # low contrast / uniform patch
    if f.sat < 0.15 and f.val < 0.42:
        score += 0.15
    return min(score, 1.0)


def classify_instance(f: Feat, p: Params) -> str:
    if f.veg_frac >= 0.45:
        return "vegetation"
    if not (p.building_min_area_m2 <= f.area_m2 <= p.building_max_area_m2):
        return "other"
    if f.solidity < 0.78 or f.rect < 0.52:
        return "other"
    if f.elong < 0.22:                      # long thin strips: lane fragments / walls, not roofs
        return "other"
    if f.sat > 0.90 and f.area_m2 > 50:     # large, over-saturated, uniform region: crop / bare soil
        return "other"
    if f.val < 0.36 and f.sat > 0.22 and f.hue < 45 and f.rect < 0.80:
        return "other"                      # dark brown, blobby: shadowed earth in lanes / courtyards
    return "building"


# ----------------------------------------------------------------------------- label maps
def paint_instances(insts: list[Instance], shape: tuple, order_key):
    """Greedy non-overlapping instance map (1..N). Later masks may only fill unclaimed pixels;
    a mask is skipped if >40% of it is already claimed (it is a part/duplicate of something)."""
    lab = np.zeros(shape, np.int32)
    owner: dict[int, Instance] = {}
    nxt = 1
    for inst in sorted(insts, key=order_key):
        h, w = inst.mask.shape
        win = lab[inst.y0:inst.y0 + h, inst.x0:inst.x0 + w]
        claimed = (win > 0) & inst.mask
        if claimed.sum() > 0.4 * inst.mask.sum():
            continue
        free = inst.mask & (win == 0)
        if free.sum() < 12:
            continue
        win[free] = nxt
        owner[nxt] = inst
        nxt += 1
    return lab, owner


# ----------------------------------------------------------------------------- roads / open ground
def extract_free_space(bld_mask: np.ndarray, veg: np.ndarray, gsd: float, p: Params):
    """Split the remaining ground into road corridors and open ground.

    Returns (road_mask, open_mask, skeleton). A free-space pixel is 'road' when the local width
    (twice the distance to the nearest edge, sampled along the skeleton and propagated) is below
    ~8 m and its connected corridor is long enough to be a route rather than a puddle of space.
    """
    free = ~(bld_mask | veg)
    # ignore slivers between attached buildings: they are party gaps, not lanes
    r_px = max(1, int(round(p.road_min_width_m / 2 / gsd)))
    core = ndi.binary_opening(free, structure=disk(r_px))
    core = remove_small_objects(core, int(30 / gsd / gsd))       # < 30 m2 blobs are not lanes
    dist = ndi.distance_transform_edt(core)
    sk = skeletonize(core)
    # local half-width propagated from skeleton to every pixel
    if sk.any():
        _, (iy, ix) = ndi.distance_transform_edt(~sk, return_indices=True)
        half_w = dist[iy, ix] * gsd
    else:
        half_w = np.zeros_like(dist)
    road_max_half = 4.0                                        # <= 8 m wide corridors
    road = core & (half_w <= road_max_half)
    lab, n = ndi.label(road)
    if n:
        sk_len = ndi.sum(sk & road, lab, index=np.arange(1, n + 1)) * gsd
        keep = np.zeros(n + 1, bool)
        keep[1:] = sk_len >= 12.0                              # >= 12 m of centreline
        road = keep[lab]
    road = ndi.binary_closing(road, structure=disk(2)) & core
    open_ground = core & ~road
    return road, open_ground, sk & road
