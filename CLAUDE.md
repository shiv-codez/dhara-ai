# Dhara.ai - project guide for Claude Code

**Product name: Dhara.ai** (write it exactly like that: capital D, lowercase `.ai`).
It was previously called "GeoCadastral AI". Any remaining use of the old name, in code, UI, docs, file names, storage keys or comments, is a bug.
Repo / URL slug: `dhara-ai`. GitHub user: `shiv-codez`. Hackathon: Smart India Hackathon 2026, problem statement **SIH26012**, team **Codesian**.

## What this is
Dhara.ai turns drone orthomosaic imagery into *candidate* cadastral layers: buildings, road corridors, vegetation, parcels, topology flags. A human officer then reviews, edits and approves them in a web GIS. It is a hackathon prototype that will be shown through a **deployed link, a demo video and this GitHub repo**, so it must be honest, robust and easy to run.

Pipeline: orthomosaic GeoTIFF -> MobileSAM instance masks (tiled) -> classify from evidence -> raster-to-vector -> Douglas-Peucker + edge-fitting orthogonalisation -> parcels from road-bounded blocks divided between buildings -> Shapely topology validation + auto-fix of overlaps -> React/Leaflet review UI -> GeoJSON / GeoPackage export.

## Repo layout
```
backend/dhara/          Python package (renamed in Task 0). config, georef, segment, classify, regularize,
                        parcels, topology, metrics, export, pipeline, cli, api
backend/tests/          pytest (regularisation, topology, API, full pipeline from cached SAM masks)
frontend/               Vite + React 18 + Leaflet + Leaflet-Geoman + Turf. public/data/<scene>/ holds published outputs
data/raw/               the two demo images (plain JPEGs, no survey metadata)
data/processed/<scene>/ sam_instances.pkl = CACHED real MobileSAM masks (committed on purpose)
notebooks/              run_on_colab.ipynb (GPU run on real GeoTIFFs)
docs/                   DEPLOY.md, DEMO_SCRIPT.md
```
The web app is **fully static** at runtime: it reads `frontend/public/data`. That folder is regenerated with the CLI (`run ... --publish ../frontend/public/data`). Never hand-edit those files.

## Commands (Windows PowerShell)
```powershell
# backend
cd backend
python -m venv .venv; .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
pip install -e .            # after Task 0 this makes `pytest` and `python -m dhara.cli` work with no PYTHONPATH
pytest -q
python -m <package>.cli run village_tiled town_dense --publish ..\frontend\public\data
# SAM itself (only needed to re-segment; cached masks exist). CPU torch:
#   pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
#   pip install timm git+https://github.com/ChaoningZhang/MobileSAM.git ; then bash backend/get_weights.sh (or download by hand)

# frontend
cd ..\frontend
npm install
npm run dev                 # http://localhost:5173
npm test                    # node geometry tests + vitest jsdom smoke tests
npm run build
```
If `rasterio` / `geopandas` fail to install with pip on Windows, use conda-forge for those two.

## Non-negotiable rules (honesty is a scoring criterion)
1. **Never invent a number.** No accuracy, speed or "time saved" figure may appear unless computed from real data in this repo. `metrics.py` computes IoU / F1 / boundary offset only from a ground-truth layer the user supplies. Until then the UI says no accuracy is claimed.
2. Every output is a **candidate**: status `Draft / Unverified` until an officer approves. Never call AI output a legal boundary.
3. The two demo images carry an **assumed** georeference (tag `GEOREF_SOURCE=assumed_demo`, chip in the UI). Keep that visible. Real GeoTIFFs bring their own CRS and must be in a metric CRS.
4. **One** segmentation model (MobileSAM). Do not describe or add a multi-model ensemble. Classes come from transparent rules or from a classifier trained on officer labels, and the docs must say which.
5. Boundary **walls are not detected**. Do not claim they are.
6. "Segment quality" is SAM's own stability score for an outline. It is **not** correctness and must not drive trust decisions (see Task 1).
7. Do not add authentication or database claims. There is no multi-user backend yet; decisions are stored in the browser (`localStorage`) and exported.
8. Do not commit model weights (`weights/*.pt`), `orthomosaic.tif` or `node_modules`. Do commit `data/processed/*/sam_instances.pkl` and `frontend/public/data`.
9. Do not rename the GitHub repo or the Vercel project after Task 0; those URLs go on the submission slide.
10. Keep UI copy plain, sentence case, no marketing filler. Errors say what happened and how to fix it.

## Known weaknesses (why the tasks exist)
* The building-vs-ground/tree decision is colour/shape rules, so trees, fields and dark earth leak in as buildings. Example: village parcel 0002 is 63% vegetation but has the *highest* segment quality (0.97) and was rated Low priority.
* In the town scene all 145 parcels are "Built-up"; dark ground mislabelled as a building passes every current check.
* Plot numbers overlap in dense areas; the grey draft fill hides the imagery; the map underuses the stage; no hover feedback; no review queue.
* No upload flow: detection needs SAM, which is heavy (about 5 min small image / 12 min large image on one CPU core).
* Right-angle share after regularisation is about 50-57%, decent but not survey-grade.

## How to work
* Work through `TASKS.md` **one task at a time, in order**. After each task: run `pytest` and `npm test` and `npm run build`, fix failures, commit with message `Task N: <title>`, tick the box in `TASKS.md`, then **stop and give a short summary** (what changed, what to click to check it, anything uncertain). Wait for the go-ahead before the next task.
* Small commits. Do not refactor unrelated code. Do not add heavy dependencies without saying why.
* You cannot see the browser unless you run it; when a change is visual, say exactly what I should look at.
* If a task needs data or a decision from me (e.g. ground-truth polygons, a hosting choice), ask instead of guessing.
