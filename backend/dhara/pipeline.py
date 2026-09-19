"""End-to-end pipeline: georeferenced orthomosaic -> candidate cadastral layers.

    ortho GeoTIFF -> SAM masks -> classify -> label maps -> vectorise + regularise
      -> road corridors -> parcel inference -> topology validation (+auto-fix) -> exports
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import geopandas as gpd
import numpy as np
from PIL import Image
from rasterio import features
from shapely.geometry import box, shape
from shapely.ops import unary_union

from . import export
from .classify import (classify_instance, extract_free_space, instance_features, paint_instances,
                       vegetation_map)
from .config import DATA_OUT, DATA_RAW, Params, Scene
from .georef import create_demo_geotiff, read_orthomosaic, wgs84_bounds
from .parcels import build_parcels, landuse_label
from .regularize import clean, regularize, right_angle_ratio, simplify
from .segment import load_instances, save_instances
from .topology import Issue, autofix_overlaps, validate


def _polys_from_mask(mask: np.ndarray, transform, min_area_m2: float, connectivity=8):
    out = []
    for geom, val in features.shapes(mask.astype(np.uint8), mask=mask, transform=transform, connectivity=connectivity):
        g = clean(shape(geom))
        if g is not None and g.area >= min_area_m2:
            out.append(g)
    return out


def _issues_gdf(issues: list[Issue], crs) -> gpd.GeoDataFrame:
    if not issues:
        return gpd.GeoDataFrame({"type": [], "severity": [], "message": [], "fix": [], "parcel_ids": [], "area_m2": []},
                                geometry=[], crs=crs)
    rows = [{"issue_id": f"E-{i + 1:03d}", "type": s.type, "severity": s.severity, "message": s.message,
             "fix": s.fix, "parcel_ids": ",".join(map(str, s.parcel_ids)), "area_m2": round(s.area_m2, 2)}
            for i, s in enumerate(issues)]
    return gpd.GeoDataFrame(rows, geometry=[s.geometry for s in issues], crs=crs)


def _count(issues: list[Issue]) -> dict:
    d: dict[str, int] = {}
    for i in issues:
        d[i.type] = d.get(i.type, 0) + 1
    return d


def run_scene(scene: Scene, params: Params | None = None, segmenter=None, out_dir: Path | None = None,
              web_dir: Path | None = None, log=print) -> dict:
    p = params or Params()
    t0 = time.time()
    out_dir = out_dir or DATA_OUT / scene.id
    tif = out_dir / "orthomosaic.tif"
    if not tif.exists():
        create_demo_geotiff(scene, DATA_RAW / scene.image, tif)
    rgb, transform, crs, tags = read_orthomosaic(tif)
    h, w, _ = rgb.shape
    if not crs.is_projected:
        raise ValueError(f"{tif} uses a geographic CRS ({crs}); reproject the orthomosaic to a metric CRS (e.g. UTM) first")
    gsd = abs(transform.a)          # ground resolution comes from the raster itself, never from config
    timings = {}
    extent = box(*(transform * (0, h)), *(transform * (w, 0)))   # raster footprint in map units

    # ---- 1. AI segmentation (cached masks reused when present)
    cache = out_dir / "sam_instances.pkl"
    t = time.time()
    if cache.exists():
        insts = load_instances(cache)
        log(f"[{scene.id}] loaded {len(insts)} cached SAM instances")
        model_name = "MobileSAM (vit_t) automatic mask generator"
    else:
        insts = segmenter.segment(rgb, gsd, log=log)
        save_instances(insts, cache)
        model_name = segmenter.name
    timings["segmentation_s"] = round(time.time() - t, 1)

    # ---- 2. classify instances -> classes
    t = time.time()
    veg = vegetation_map(rgb)
    feats = [instance_features(i, rgb, veg, gsd) for i in insts]
    cls = [classify_instance(f, p) for f in feats]
    b_insts = [i for i, c in zip(insts, cls) if c == "building"]
    bld_lab, owner = paint_instances(b_insts, (h, w), order_key=lambda i: -i.area_px)
    bld_mask = bld_lab > 0
    road, open_ground, skel = extract_free_space(bld_mask, veg, gsd, p)
    timings["classification_s"] = round(time.time() - t, 1)

    # ---- 3. raster -> vector + regularisation (buildings)
    t = time.time()
    raw_rows, reg_rows = [], []
    verts_raw = verts_reg = 0
    rar_raw, rar_reg = [], []
    for lab_id, inst in owner.items():
        m = bld_lab == lab_id
        polys = _polys_from_mask(m, transform, p.min_polygon_area_m2)
        if not polys:
            continue
        raw = max(polys, key=lambda g: g.area)
        reg = clean(regularize(raw, p.simplify_tol_m, p.ortho_angle_tol_deg).intersection(extent)) if raw is not None else None
        if reg is None or reg.area < p.min_polygon_area_m2:
            continue
        verts_raw += len(raw.exterior.coords) - 1
        verts_reg += len(reg.exterior.coords) - 1
        dp = simplify(raw, p.simplify_tol_m) or raw
        rar_raw.append(right_angle_ratio(dp)); rar_reg.append(right_angle_ratio(reg))
        raw_rows.append((lab_id, raw))
        reg_rows.append((lab_id, reg, inst))
    order = sorted(range(len(reg_rows)), key=lambda k: (round(reg_rows[k][1].centroid.y, 0) * -1, reg_rows[k][1].centroid.x))
    reg_rows = [reg_rows[k] for k in order]
    bid = {lab_id: f"B-{n + 1:04d}" for n, (lab_id, _, _) in enumerate(reg_rows)}
    buildings = gpd.GeoDataFrame(
        [{"building_id": bid[l], "area_m2": round(g.area, 1), "vertices": len(g.exterior.coords) - 1,
          "sam_quality": round((i.pred_iou + i.stability) / 2, 3)} for l, g, i in reg_rows],
        geometry=[g for _, g, _ in reg_rows], crs=crs)
    buildings_raw = gpd.GeoDataFrame(
        [{"building_id": bid.get(l, ""), "vertices": len(g.exterior.coords) - 1} for l, g in raw_rows if l in bid],
        geometry=[g for l, g in raw_rows if l in bid], crs=crs)

    road_polys = _polys_from_mask(road, transform, 8.0)
    road_union = unary_union([g.simplify(p.simplify_tol_m, preserve_topology=True) for g in road_polys]) if road_polys else None
    roads = gpd.GeoDataFrame({"kind": ["road corridor"] * len(road_polys)},
                             geometry=[clean(g.simplify(p.simplify_tol_m, preserve_topology=True)) for g in road_polys], crs=crs)
    veg_polys = _polys_from_mask(veg, transform, 6.0)
    vegetation = gpd.GeoDataFrame({"kind": ["vegetation"] * len(veg_polys)},
                                  geometry=[clean(g.simplify(p.simplify_tol_m, preserve_topology=True)) for g in veg_polys], crs=crs)
    open_polys = _polys_from_mask(open_ground, transform, 20.0)
    open_gdf = gpd.GeoDataFrame({"kind": ["open ground"] * len(open_polys)},
                                geometry=[clean(g.simplify(p.simplify_tol_m, preserve_topology=True)) for g in open_polys], crs=crs)
    timings["vectorisation_s"] = round(time.time() - t, 1)

    # ---- 4. parcel inference (evidence fusion)
    t = time.time()
    parcel_polys, alloc = build_parcels(bld_lab, road, transform, gsd, p)
    keep = [l for l in parcel_polys if l in bid]
    keep.sort(key=lambda l: (-round(parcel_polys[l].centroid.y, 0), parcel_polys[l].centroid.x))
    short = scene.id.split("_")[0][:2].upper()
    pid = {l: f"TMP-{short}-{n + 1:04d}" for n, l in enumerate(keep)}
    veg_frac = {}
    for l in keep:
        m = alloc == l
        veg_frac[l] = float(veg[m].mean()) if m.any() else 0.0
    b_area = {bid[l]: g.area for l, g, _ in reg_rows}
    rows = []
    for l in keep:
        g = parcel_polys[l]
        cov = min(1.0, b_area.get(bid[l], 0.0) / g.area)
        rows.append({"parcel_id": pid[l], "building_id": bid[l], "area_m2": round(g.area, 1),
                     "perimeter_m": round(g.length, 1), "building_coverage": round(cov, 2),
                     "vegetation_share": round(veg_frac[l], 2), "landuse": landuse_label(cov, veg_frac[l], g.area),
                     "status": "Draft / Unverified"})
    parcels = gpd.GeoDataFrame(rows, geometry=[parcel_polys[l] for l in keep], crs=crs)
    buildings["parcel_id"] = buildings["building_id"].map({bid[l]: pid[l] for l in keep})
    buildings = buildings.dropna(subset=["parcel_id"]).reset_index(drop=True)
    timings["parcel_inference_s"] = round(time.time() - t, 1)

    # ---- 5. topology validation, auto-fix overlaps, re-validate
    t = time.time()
    issues_before = validate(parcels, buildings, road_union, p)
    parcels_fixed = autofix_overlaps(parcels, buildings, p)
    issues_after = validate(parcels_fixed, buildings, road_union, p)
    timings["topology_s"] = round(time.time() - t, 1)

    # review priority (triage, NOT an accuracy claim)
    sev = {"error": 2, "warning": 1, "info": 0}
    flag = {}
    for iss in issues_after:
        for x in iss.parcel_ids:
            flag[x] = max(flag.get(x, 0), sev[iss.severity])
    # building-level issues (no parcel_ids) are located spatially
    q = {b["building_id"]: b["sam_quality"] for b in buildings.to_dict("records")}
    prio, notes = [], []
    for r in parcels_fixed.to_dict("records"):
        f = flag.get(r["parcel_id"], 0)
        qual = q.get(r["building_id"], 0.0)
        pr = "High" if (f == 2 or qual < 0.86) else ("Medium" if (f == 1 or qual < 0.92) else "Low")
        prio.append(pr)
    parcels_fixed = parcels_fixed.copy()
    parcels_fixed["sam_quality"] = parcels_fixed["building_id"].map(q).round(3)
    parcels_fixed["review_priority"] = prio
    issues_gdf = _issues_gdf(issues_after, crs)
    issues_before_gdf = _issues_gdf(issues_before, crs)

    # ---- 6. exports
    web_dir = web_dir or (out_dir / "web")
    web_dir.mkdir(parents=True, exist_ok=True)
    for name, gdf in [("parcels", parcels_fixed), ("parcels_before_fix", parcels), ("buildings", buildings),
                      ("buildings_raw", buildings_raw), ("roads", roads), ("vegetation", vegetation),
                      ("open_ground", open_gdf), ("issues", issues_gdf), ("issues_before_fix", issues_before_gdf)]:
        export.write_geojson(gdf, web_dir / f"{name}.geojson")
    export.class_mask_png({"building": bld_mask, "road": road, "vegetation": veg & ~bld_mask, "open": open_ground},
                          (h, w), web_dir / "masks.png")
    export.segments_png(insts, (h, w), web_dir / "segments.png")
    Image.fromarray(rgb).save(web_dir / "ortho.jpg", quality=92)
    export.write_geopackage({"parcels": parcels_fixed, "buildings": buildings, "roads": roads,
                             "vegetation": vegetation, "open_ground": open_gdf, "topology_issues": issues_gdf},
                            web_dir / f"{scene.id}_dhara_candidates.gpkg")

    manifest = {
        "scene": scene.id, "title": scene.title, "description": scene.description,
        "bounds": wgs84_bounds(tif), "size_px": [w, h], "gsd_m": round(gsd, 4), "crs": str(crs),
        "georef_source": tags.get("GEOREF_SOURCE", "embedded"),
        "area_ha": round(w * h * gsd * gsd / 10000, 3),
        "model": model_name,
        "counts": {"sam_instances": len(insts), "buildings": len(buildings), "parcels": len(parcels_fixed),
                   "road_corridors": len(roads), "vegetation_patches": len(vegetation)},
        "regularisation": {
            "vertices_raw": verts_raw, "vertices_regularised": verts_reg,
            "right_angle_share_simplified_only": round(float(np.mean(rar_raw)), 3) if rar_raw else 0,
            "right_angle_share_regularised": round(float(np.mean(rar_reg)), 3) if rar_reg else 0,
            "simplify_tol_m": p.simplify_tol_m, "ortho_angle_tol_deg": p.ortho_angle_tol_deg},
        "topology": {"before_fix": _count(issues_before), "after_fix": _count(issues_after),
                     "parcels_with_error_before": len({x for i in issues_before if i.severity == "error" for x in i.parcel_ids}),
                     "parcels_with_error_after": len({x for i in issues_after if i.severity == "error" for x in i.parcel_ids})},
        "coverage": {"building_pct": round(100 * bld_mask.mean(), 1), "road_pct": round(100 * road.mean(), 1),
                     "vegetation_pct": round(100 * (veg & ~bld_mask).mean(), 1)},
        "timings_s": timings, "total_s": round(time.time() - t0, 1),
        "params": {k: v for k, v in vars(p).items()},
        "status_note": "All outputs are candidate geometries (Draft / Unverified) pending officer review and field verification.",
    }
    (web_dir / "manifest.json").write_text(json.dumps(manifest, indent=1))
    log(f"[{scene.id}] done: {manifest['counts']} | topology before {manifest['topology']['before_fix']} after {manifest['topology']['after_fix']}")
    return manifest
