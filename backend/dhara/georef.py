"""Georeferencing helpers (Layer 1 - GDAL/Rasterio in the technical approach)."""
from __future__ import annotations

from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from pyproj import Transformer
from rasterio.transform import from_origin
from rasterio.warp import transform_bounds

from .config import Scene


def create_demo_geotiff(scene: Scene, src: Path, dst: Path) -> Path:
    """Wrap a plain JPEG in a GeoTIFF with an explicit ASSUMED CRS/transform.

    Every written file is tagged GEOREF_SOURCE=assumed_demo so downstream code and the UI can
    never mistake it for a surveyed product.
    """
    rgb = np.asarray(Image.open(src).convert("RGB"))
    h, w, _ = rgb.shape
    to_utm = Transformer.from_crs(4326, scene.epsg, always_xy=True)
    x0, y0 = to_utm.transform(*scene.origin_lonlat)
    transform = from_origin(x0, y0, scene.gsd_m, scene.gsd_m)
    dst.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(
        dst, "w", driver="GTiff", height=h, width=w, count=3, dtype="uint8",
        crs=f"EPSG:{scene.epsg}", transform=transform, compress="deflate",
    ) as ds:
        ds.write(rgb.transpose(2, 0, 1))
        ds.update_tags(GEOREF_SOURCE="assumed_demo", GSD_M=str(scene.gsd_m), SCENE=scene.id)
    return dst


def read_orthomosaic(path: Path):
    """Return (rgb HxWx3 uint8, affine transform, crs, tags). Fails loudly without a CRS."""
    with rasterio.open(path) as ds:
        if ds.crs is None:
            raise ValueError(f"{path} has no CRS - not a georeferenced orthomosaic")
        arr = ds.read([1, 2, 3]).transpose(1, 2, 0)
        return arr, ds.transform, ds.crs, ds.tags()


def wgs84_bounds(path: Path):
    """[[south, west], [north, east]] for Leaflet's imageOverlay."""
    with rasterio.open(path) as ds:
        w, s, e, n = transform_bounds(ds.crs, "EPSG:4326", *ds.bounds)
    return [[s, w], [n, e]]
