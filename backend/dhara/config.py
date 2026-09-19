"""Scene registry + pipeline parameters.

The demo images supplied by the team are plain JPEG crops (no CRS). For them we attach an
*assumed* georeference so the whole geospatial chain (CRS -> vectors -> GIS export) can be
demonstrated. Real survey deliveries (Orthomosaic GeoTIFF from SVAMITVA / Survey of India) carry
their own CRS + transform and skip `georef.create_demo_geotiff` entirely.
"""
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_RAW = ROOT / "data" / "raw"
DATA_OUT = ROOT / "data" / "processed"
WEIGHTS = ROOT / "weights" / "mobile_sam.pt"


@dataclass(frozen=True)
class Scene:
    id: str
    title: str
    image: str                      # filename inside data/raw
    origin_lonlat: tuple            # top-left corner (lon, lat) - ASSUMED placement for demo
    gsd_m: float                    # ground sample distance, metres/pixel - ASSUMED for demo
    epsg: int = 32643               # UTM 43N (metric CRS used for all measurements)
    description: str = ""


SCENES = {
    "town_dense": Scene(
        id="town_dense",
        title="Dense old-town settlement",
        image="town_dense.jpg",
        origin_lonlat=(75.7873, 26.9124),
        gsd_m=0.08,
        description="Compact multi-storey settlement, narrow lanes, touching buildings.",
    ),
    "village_tiled": Scene(
        id="village_tiled",
        title="Village with tiled roofs",
        image="village_tiled.jpg",
        origin_lonlat=(77.1000, 22.8000),
        gsd_m=0.20,
        description="Low-density village: tiled roofs, tree cover, open ground, paddy edge.",
    ),
}


@dataclass
class Params:
    """Tunable knobs. Metric values are in metres so they stay meaningful across GSDs."""
    # segmentation
    points_per_side: int = 40
    points_per_batch: int = 32
    pred_iou_thresh: float = 0.82
    stability_thresh: float = 0.88
    min_mask_area_m2: float = 6.0
    tile_size_px: int = 1600        # >= image size -> single tile for the demo images
    tile_overlap_px: int = 128
    # classification
    building_min_area_m2: float = 14.0
    building_max_area_m2: float = 700.0
    # vectorisation / regularisation
    simplify_tol_m: float = 0.25    # Douglas-Peucker tolerance (calibrated ~ 3 px at 0.08 m GSD)
    ortho_angle_tol_deg: float = 22.0
    min_polygon_area_m2: float = 8.0
    # parcels
    max_setback_m: float = 6.0      # how far a parcel may extend beyond the building footprint
    road_min_width_m: float = 1.2
    min_parcel_area_m2: float = 12.0
    # topology
    sliver_thickness_m: float = 0.35
    overlap_tol_m2: float = 0.25
