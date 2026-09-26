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
   -> Web-GIS & Dashboard: inspect, edit boundaries, approve / flag / reject, export GeoJSON + GeoPackage
```

| Stage | Where |
|---|---|
| Georeferencing, tiling | `backend/dhara/georef.py`, `segment.py` |
| Segmentation (one primary model: MobileSAM) | `segment.py` |
| Classification, lane / open-ground extraction | `classify.py` |
| Officer-decision ML classifier (optional) | `backend/dhara/classifier.py` |
| Polygon regularisation (simplify + edge fitting) | `regularize.py` |
| Parcel inference | `parcels.py` |
| Topology rules + auto-fix | `topology.py` |
| Ground-truth metrics (IoU, F1, boundary offset, GNSS RMSE) | `metrics.py`, `frontend/src/lib/metrics.js` |
| Orchestration, exports | `pipeline.py`, `export.py`, `cli.py` |
| Optional HTTP API (`/validate`, `/regularize`) | `api.py` |
| Web-GIS & KPI Dashboard (React + Leaflet + Geoman + Turf) | `frontend/` |

### Key Features

* **Interactive Web-GIS Review Workspace**: Map-based boundary inspection, polygon vertex editing (drag/add/delete vertices), instantaneous topological overlap detection with one-click resolution.
* **Bilingual Interface (English / Hindi `EN / हि`)**: Dynamic localization toggle translating interface labels into Hindi Devanagari while preserving cadastral plot IDs (`TMP-XX-####`), coordinates, numeric values, and metric units (`m²`, `ha`).
* **Sortable Parcel Table & KPI Dashboard**: Tabular view with multi-column sorting (plot ID, area, land use, building coverage, review priority, status), reactive search and filtering, summary KPI metric cards, and area distribution histogram.
* **Officer Review Queue & Keyboard Shortcuts**: Prioritized review workflow (`High`, `Medium`, `Low`) with single-key shortcuts (`A` Approve, `F` Field Check, `R` Reject, `E` Edit Boundary, `N` Next Unreviewed, `Esc` Deselect) and bulk approval of Low-priority parcels.
* **Ground-Truth Validation & Reference Comparison**: In-browser calculation of spatial accuracy metrics against loaded survey data (Precision, Recall, F1 Score at IoU ≥ 0.50, Mean Matched IoU, Boundary Offset Mean/Median/P90/RMSE). Includes built-in sample survey reference polygons for the village scene.
* **Fingerprint-Bound State Persistence**: Browser review decisions and edits are bound to SHA-256 data fingerprints (`dhara:v1:state:<fingerprint>`), preventing stale annotations from applying to updated scenes.
* **Cadastral & Audit Exports**: Export approved or all candidate parcels as GeoJSON, multi-layer GeoPackage (for QGIS / ArcGIS), structured review audit log JSON, and officer review labels for retraining classifiers.

### Topology rules implemented
Invalid geometry, parcel overlap, gap between parcels, sliver / tiny parcel, building overlap,
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
cd backend  && pytest -q      # regularisation, topology rules, API, classifier, full pipeline from cached masks
cd frontend && npm test        # geometry helpers, ground-truth metrics, officer workflow, i18n, table & smoke tests
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
  (shape, colour, green dominance, free-space width) or an optional logistic regression head trained on officer labels.
* Boundary walls are **not** detected. Candidate parcel edges come from road corridors and the split between
  neighbouring buildings.
* "Segment quality" is the model's own stability score for the building outline, **not** a measured accuracy.
* **No accuracy figure is shown without reference data.** `metrics.py` / `frontend/src/lib/metrics.js` compute IoU / F1 / boundary offset /
  GNSS RMSE strictly from a ground-truth layer supplied by the user or sample reference data.
* Review decisions and boundary edits are stored in the browser (`localStorage`) and exportable; there is no
  multi-user database or authentication in this prototype.

## Roadmap
PostGIS-backed approval store with role-based access and audit trail; trained land-use head on SAM embeddings;
GNSS RTK field surveyor mobile app; DSM/DTM height channel; wall/boundary line detection; OGC WFS/WMS services and standard ULPIN cadastral identifiers.
