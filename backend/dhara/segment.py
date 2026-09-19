"""AI segmentation (Layer 2): one primary SAM-family model - MobileSAM (ViT-Tiny SAM).

SAM is class-agnostic: it proposes *instance masks* for every visible object. Turning masks into
semantic classes (building / vegetation / open ground ...) happens in `classify.py`. Large
orthomosaics are processed as overlapping tiles; masks that are cut by an *interior* tile edge
are dropped (their neighbour tile sees the whole object).
"""
from __future__ import annotations

import pickle
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .config import Params, WEIGHTS


@dataclass
class Instance:
    x0: int
    y0: int
    mask: np.ndarray          # cropped boolean mask (h, w)
    pred_iou: float
    stability: float

    @property
    def area_px(self) -> int:
        return int(self.mask.sum())


def tile_windows(h: int, w: int, size: int, overlap: int):
    """Yield (x0, y0, x1, y1) windows covering the image with evenly spaced starts."""
    if size >= max(h, w):
        yield 0, 0, w, h
        return

    def starts(n_px):
        if n_px <= size:
            return [0]
        n = int(np.ceil((n_px - overlap) / (size - overlap)))
        return [int(v) for v in np.linspace(0, n_px - size, n)]

    for y in starts(h):
        for x in starts(w):
            yield x, y, min(x + size, w), min(y + size, h)


class MobileSamSegmenter:
    name = "MobileSAM (vit_t) automatic mask generator"

    def __init__(self, params: Params | None = None, weights: Path = WEIGHTS, device: str = "cpu"):
        import torch
        from mobile_sam import SamAutomaticMaskGenerator, sam_model_registry

        self.params = params or Params()
        torch.set_num_threads(max(1, torch.get_num_threads()))
        sam = sam_model_registry["vit_t"](checkpoint=str(weights))
        sam.to(device=device).eval()
        p = self.params
        self.generator = SamAutomaticMaskGenerator(
            sam,
            points_per_side=p.points_per_side,
            pred_iou_thresh=p.pred_iou_thresh,
            stability_score_thresh=p.stability_thresh,
            points_per_batch=self.params.points_per_batch,
            box_nms_thresh=0.6,
            min_mask_region_area=40,
            output_mode="binary_mask",
        )

    def segment(self, rgb: np.ndarray, gsd_m: float, log=print, checkpoint: Path | None = None) -> list[Instance]:
        p = self.params
        h, w, _ = rgb.shape
        out: list[Instance] = []
        min_px = p.min_mask_area_m2 / (gsd_m ** 2)
        wins = list(tile_windows(h, w, p.tile_size_px, p.tile_overlap_px))
        for i, (x0, y0, x1, y1) in enumerate(wins):
            t = time.time()
            ck = checkpoint / f"tile_{i}.pkl" if checkpoint else None
            if ck is not None and ck.exists():          # resume after a crash / interruption
                out.extend(load_instances(ck))
                log(f"  tile {i + 1}/{len(wins)}: resumed from checkpoint")
                continue
            tile_start = len(out)
            masks = self.generator.generate(np.ascontiguousarray(rgb[y0:y1, x0:x1]))
            kept = 0
            for m in masks:
                bx, by, bw, bh = (int(v) for v in m["bbox"])
                if m["area"] < min_px:
                    continue
                # drop objects cut by an interior tile edge
                cut_l = x0 > 0 and bx <= 1
                cut_t = y0 > 0 and by <= 1
                cut_r = x1 < w and bx + bw >= (x1 - x0) - 1
                cut_b = y1 < h and by + bh >= (y1 - y0) - 1
                if cut_l or cut_t or cut_r or cut_b:
                    continue
                crop = m["segmentation"][by:by + bh, bx:bx + bw].copy()
                out.append(Instance(x0 + bx, y0 + by, crop, float(m["predicted_iou"]), float(m["stability_score"])))
                kept += 1
            if ck is not None:
                save_instances(out[tile_start:], ck)
            log(f"  tile {i + 1}/{len(wins)} ({x1 - x0}x{y1 - y0}px): {len(masks)} raw masks -> {kept} kept in {time.time() - t:.0f}s")
        return out


def save_instances(instances: list[Instance], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as f:
        pickle.dump([(i.x0, i.y0, np.packbits(i.mask), i.mask.shape, i.pred_iou, i.stability) for i in instances], f)


def load_instances(path: Path) -> list[Instance]:
    with open(path, "rb") as f:
        rows = pickle.load(f)
    res = []
    for x0, y0, bits, shape, piou, stab in rows:
        m = np.unpackbits(bits)[: shape[0] * shape[1]].reshape(shape).astype(bool)
        res.append(Instance(x0, y0, m, piou, stab))
    return res
