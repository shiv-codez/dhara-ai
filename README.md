# Dhara.ai

> Dhara (धरा) means earth / land.

**Drone imagery to candidate cadastral parcel maps, with deterministic topology validation and officer review.**
Smart India Hackathon 2026, problem statement **SIH26012**, Team Codesian.

> Every output is a **candidate** (`Draft / Unverified`). A building footprint is not a legal parcel, and AI does not
> create the legal record: the pipeline proposes, geometry rules validate, a human officer approves.

## What it does

```
Orthomosaic GeoTIFF (CRS + transform kept)
   -> MobileSAM instance masks (tiled)
   -> classification from evidence (buildings / vegetation / lanes / open ground)
   -> raster-to-vector + Douglas-Peucker + edge-fitting orthogonalisation
   -> evidence fusion: road-bounded blocks divided between buildings (candidate parcels)
   -> topology validation (Shapely) + deterministic auto-fix of overlaps
   -> Web-GIS review: inspect, edit boundaries, approve / flag / reject, export GeoJSON + GeoPackage
```

| Stage | Where |
|---|---|
| Georeferencing, tiling | `backend/dhara/georef.py`, `segment.py` |
| Segmentation (one primary model: MobileSAM) | `segment.py` |
| Classification, lane / open-ground extraction | `classify.py` |
| Polygon regularisation (simplify + edge fitting) | `regularize.py` |
| Parcel inference | `parcels.py` |
| Topology rules + auto-fix | `topology.py` |
| Ground-truth metrics (IoU, F1, boundary offset, GNSS RMSE) | `metrics.py` |
| Orchestration, exports | `pipeline.py`, `export.py`, `cli.py` |
| Optional HTTP API (`/validate`, `/regularize`) | `api.py` |
| Web-GIS (React + Leaflet + Leaflet-Geoman + Turf) | `frontend/` |

### Topology rules implemented
invalid geometry, parcel overlap, gap between parcels, sliver / tiny parcel, building overlap,
building on road corridor, building split across parcels, parcel with no road access.
Overlaps thinner than 35 cm are treated as digitising noise, not errors.

## Run it

```bash
# 1. web app (uses the published outputs in frontend/public/data)
cd frontend && npm install && npm run dev          # http://localhost:5173

# 2. re-run the pipeline (uses cached SAM masks; no GPU/torch needed)
cd backend && pip install -r requirements.txt && pip install -e .
python -m dhara.cli run village_tiled town_dense --publish ../frontend/public/data

# 3. re-run SAM itself (CPU works, GPU is far faster)
pip install -r requirements-ml.txt && bash get_weights.sh
python -m dhara.cli run village_tiled --fresh
```

Your own orthomosaic: open `notebooks/run_on_colab.ipynb` (T4 GPU). It needs a GeoTIFF in a **metric CRS**.

## Tests

```bash
cd backend  && pytest -q      # regularisation, topology rules, API, full pipeline from cached masks
cd frontend && npm test        # geometry helpers + app smoke test (jsdom)
```

## Deploy (all free)

* **Web app -> Vercel:** import the GitHub repo, set *Root Directory* to `frontend`. Every push to `main` redeploys
  the same URL.
* **Optional API -> Render:** `render.yaml` is a blueprint. Free instances sleep after 15 minutes idle
  (first request takes ~30-60 s). The demo web app does not depend on it.

## Honest scope (what this prototype does and does not claim)

* Input is an already-produced **orthomosaic**; photogrammetry is upstream and not part of the app.
* The two demo images are plain JPEGs with **no survey metadata**. They carry an explicit *assumed* georeference
  (tagged `GEOREF_SOURCE=assumed_demo`, shown in the UI). Real deliveries bring their own CRS.
* Segmentation is **one** model (MobileSAM). SAM is class-agnostic; classes come from transparent heuristics
  (shape, colour, green dominance, free-space width). With a DSM/DTM, `classify.ndsm_mask` gives a height test.
* Boundary walls are **not** detected. Candidate parcel edges come from road corridors and the split between
  neighbouring buildings.
* "Segment quality" is the model's own stability score for the building outline, **not** a measured accuracy.
* **No accuracy figure is shown without reference data.** `metrics.py` computes IoU / F1 / boundary offset /
  GNSS RMSE from a ground-truth layer you supply.
* Land use is rule-based on evidence composition (built-up / vegetated / vacant), not a trained classifier.
* Review decisions and boundary edits are stored in the browser (`localStorage`) and exportable; there is no
  multi-user database or authentication in this prototype.

## Roadmap
PostGIS-backed approval store with role-based access and audit trail; trained land-use head on SAM embeddings;
GT / GNSS upload in the UI; DSM/DTM channel; wall/line detector for boundary evidence; OGC WFS/WMS and ULPIN-format IDs.
