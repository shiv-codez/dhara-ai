"""Optional FastAPI service. The demo web app is fully static; this API exposes the same Shapely
geometry engine over HTTP so the deterministic checks can run server-side (and be integrated with
state land-record systems later).

    uvicorn dhara.api:app --port 8000
"""
from __future__ import annotations

import json

import geopandas as gpd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from shapely.ops import unary_union

from . import __version__
from .config import SCENES, Params
from .regularize import regularize
from .topology import validate

app = FastAPI(title="Dhara.ai API", version=__version__,
              description="Deterministic topology validation and polygon regularisation for candidate cadastral layers.")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

MAX_FEATURES = 5000


class ValidateRequest(BaseModel):
    parcels: dict = Field(description="GeoJSON FeatureCollection (EPSG:4326) with parcel_id properties")
    buildings: dict | None = Field(default=None, description="optional FeatureCollection with building_id, parcel_id")
    roads: dict | None = Field(default=None, description="optional FeatureCollection of road corridor polygons")


class RegularizeRequest(BaseModel):
    polygons: dict
    simplify_tol_m: float = 0.25
    ortho_angle_tol_deg: float = 22.0
    orthogonalize: bool = True


def _gdf(fc: dict | None, cols: list[str]) -> gpd.GeoDataFrame:
    if not fc or not fc.get("features"):
        return gpd.GeoDataFrame({c: [] for c in cols}, geometry=[], crs=4326)
    if len(fc["features"]) > MAX_FEATURES:
        raise HTTPException(413, f"too many features (max {MAX_FEATURES})")
    return gpd.GeoDataFrame.from_features(fc["features"], crs=4326)


@app.get("/health")
def health():
    return {"status": "ok", "version": __version__}


@app.get("/scenes")
def scenes():
    return [{"id": s.id, "title": s.title, "gsd_m": s.gsd_m, "description": s.description} for s in SCENES.values()]


@app.post("/validate")
def validate_layers(req: ValidateRequest):
    parcels = _gdf(req.parcels, ["parcel_id"])
    if parcels.empty or "parcel_id" not in parcels:
        raise HTTPException(422, "parcels must be a non-empty FeatureCollection with parcel_id properties")
    buildings = _gdf(req.buildings, ["building_id", "parcel_id"])
    for col in ("building_id", "parcel_id"):
        if col not in buildings:
            buildings[col] = []
    utm = parcels.estimate_utm_crs()                      # metric CRS so tolerances are in metres
    parcels_m, buildings_m = parcels.to_crs(utm), buildings.to_crs(utm)
    roads = _gdf(req.roads, [])
    roads_m = unary_union(roads.to_crs(utm).geometry) if len(roads) else None
    issues = validate(parcels_m, buildings_m, roads_m, Params())
    rows = [{"type": i.type, "severity": i.severity, "message": i.message, "fix": i.fix,
             "parcel_ids": ",".join(map(str, i.parcel_ids)), "area_m2": round(i.area_m2, 2)} for i in issues]
    out = gpd.GeoDataFrame(rows, geometry=[i.geometry for i in issues], crs=utm).to_crs(4326) if issues else None
    return {"n_issues": len(issues),
            "by_type": {t: sum(1 for i in issues if i.type == t) for t in {i.type for i in issues}},
            "issues": json.loads(out.to_json()) if out is not None else {"type": "FeatureCollection", "features": []}}


@app.post("/regularize")
def regularize_polygons(req: RegularizeRequest):
    gdf = _gdf(req.polygons, [])
    if gdf.empty:
        raise HTTPException(422, "polygons must be a non-empty FeatureCollection")
    utm = gdf.estimate_utm_crs()
    m = gdf.to_crs(utm)
    geoms = [regularize(g, req.simplify_tol_m, req.ortho_angle_tol_deg, req.orthogonalize) if g.geom_type == "Polygon" else g
             for g in m.geometry]
    m["geometry"] = geoms
    return json.loads(m.to_crs(4326).to_json())
