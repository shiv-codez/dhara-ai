"""GIS-ready outputs: GeoJSON (WGS84, for the web), GeoPackage (metric CRS, for QGIS/ArcGIS)."""
from __future__ import annotations

import json
from pathlib import Path

import geopandas as gpd
import numpy as np
import shapely
from PIL import Image

CLASS_COLORS = {          # RGBA for the raster "feature masks" stage
    "building": (239, 83, 80, 200),
    "road": (66, 165, 245, 200),
    "vegetation": (102, 187, 106, 190),
    "open": (255, 213, 79, 130),
}


def write_geojson(gdf: gpd.GeoDataFrame, path: Path, to_epsg: int = 4326) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    out = gdf.to_crs(epsg=to_epsg) if len(gdf) else gdf
    if len(out):
        out = out.copy()
        # snap to a ~1 cm grid (1e-7 deg) - keeps web files small; handles every geometry type
        out["geometry"] = shapely.set_precision(out.geometry.values, 1e-7)
        out = out[~out.geometry.is_empty]
    path.write_text(out.to_json(drop_id=True, separators=(",", ":")) if len(out) else '{"type":"FeatureCollection","features":[]}')


def write_geopackage(layers: dict[str, gpd.GeoDataFrame], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        path.unlink()
    for name, gdf in layers.items():
        if len(gdf):
            gdf.to_file(path, layer=name, driver="GPKG")


def class_mask_png(classes: dict[str, np.ndarray], shape: tuple, path: Path) -> None:
    rgba = np.zeros((*shape, 4), np.uint8)
    for name in ("open", "road", "vegetation", "building"):      # later = on top
        m = classes.get(name)
        if m is not None:
            rgba[m] = CLASS_COLORS[name]
    Image.fromarray(rgba, "RGBA").save(path, optimize=True)


def segments_png(instances, shape: tuple, path: Path, seed: int = 7) -> None:
    """Every raw SAM instance in its own colour (largest first, so small parts stay visible).
    Purely a visual of what the model proposed *before* any classification."""
    rng = np.random.default_rng(seed)
    rgba = np.zeros((*shape, 4), np.uint8)
    for inst in sorted(instances, key=lambda i: -i.mask.sum()):
        h, w = inst.mask.shape
        col = (*rng.integers(60, 255, 3), 150)
        win = rgba[inst.y0:inst.y0 + h, inst.x0:inst.x0 + w]
        win[inst.mask] = col
    Image.fromarray(rgba, "RGBA").save(path, optimize=True)
