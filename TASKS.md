# Dhara.ai - tasks (do one at a time, in order)

Tick a box only when its acceptance checks pass. See `CLAUDE.md` for rules and commands.

---

## [x] Task 0 - Rename everything to Dhara.ai and make the repo push-ready
**Goal:** no trace of "GeoCadastral" remains; the repo is ready for the first push as `dhara-ai`.

Steps
1. Search the whole repo (case-insensitive) for `geocadastral`, `GeoCadastral`, `geo-cadastral`, `Geo Cadastral`.
2. Rename the Python package folder `backend/geocadastral/` to `backend/dhara/` and update every import, test, CLI usage (`python -m dhara.cli`), API path (`uvicorn dhara.api:app`), `render.yaml`, README, docs and notebook. Add `backend/pyproject.toml` so `pip install -e backend` works and no `PYTHONPATH` is needed on Windows. Keep `requirements*.txt`.
3. Frontend: brand text in the header and boot screen becomes **Dhara.ai**; `<title>` and meta description; `package.json` name `dhara-ai-web`; `localStorage` key prefix `dhara:v1:`; export file names (`<scene>_dhara_candidates.geojson`, GeoPackage `<scene>_dhara_candidates.gpkg`, audit log). Keep the tagline "Drone imagery to candidate parcel maps".
4. Regenerate published data so the GeoPackage name and manifest use the new name: run the CLI with `--publish`.
5. Notebook `notebooks/run_on_colab.ipynb`: clone URL `https://github.com/shiv-codez/dhara-ai.git`, `%cd dhara-ai/backend`, use the new package name.
6. README + `docs/DEPLOY.md` + `docs/DEMO_SCRIPT.md`: new name, repo `dhara-ai`, Vercel project name `dhara-ai`. Add a one-line meaning note: "Dhara (धरा) means earth / land."
7. Add a short "Dhara.ai" note at the top of README that it was renamed from GeoCadastral AI only if useful for history; otherwise omit.
8. `git init`, make sure `.gitignore` is respected, and create the first commit (do NOT push; I will add the remote and push myself).

Acceptance
* `grep -ri geocadastral .` (excluding `node_modules`, `.git`, `dist`) returns nothing.
* `pytest -q`, `npm test`, `npm run build` all pass.
* App header shows **Dhara.ai**, browser tab title says Dhara.ai.
* `git log` shows one clean commit and `git status` is clean.

---

## [x] Task 1 - Make review priority reflect class evidence, not SAM stability
**Why:** parcel 0002 (63% vegetation) has segment quality 0.97 and was rated Low.

Steps
1. In the pipeline, store per-building **class evidence** in `buildings.geojson` and per-parcel in `parcels.geojson`: `veg_frac` (share of the building mask that is vegetation), `sat`, `val`, `hue`, `rect`, `solidity`, `area_m2`, and a `ground_likeness` score in [0,1] (dark-brown + blobby + low rectangularity + low contrast with surroundings).
2. Replace `review_priority` logic: priority is High/Medium/Low from **class uncertainty** (vegetation share, ground-likeness, shape irregularity, area outliers) and topology flags. SAM stability may be shown but must not lower priority.
3. Add `review_reasons`: a short list such as `["63% vegetation", "dark earth colour"]`. Show it in the Parcel tab as "Why this needs a look".
4. Unit-test with synthetic cases plus the village fixture: any parcel with vegetation share >= 0.45 must not be Low.

Acceptance: village parcel 0002 is High or Medium and its reason mentions vegetation; tests pass; Report tab wording no longer implies quality means accuracy.

---

## [x] Task 2 - Map readability and layout
Steps
1. Fit the scene to the available stage and refit on window resize. Make the left rail and right panel collapsible so the image can fill the screen.
2. Plot numbers: show only when zoomed in enough **and** avoid overlaps (simple collision hiding by priority/area); always show the selected parcel's number.
3. Default parcel style = outline only with a thin line; add a fill toggle and an opacity slider. Status mode keeps a light fill.
4. Hover: highlight the parcel and show a tooltip (plot number, area, land use, priority).
5. Add a small legend that changes with the active layers (class colours when masks are visible).

Acceptance: in the dense town scene labels do not overlap at the default zoom; the imagery is clearly visible with default settings; hover works; smoke tests still pass.

---

## [x] Task 3 - Officer workflow
Steps
1. **Review queue** in the Parcel tab (or a new tab): parcels sorted by priority then area, with status icons; clicking selects and zooms.
2. "Next flagged" button and keyboard shortcuts: `A` approve, `F` needs field check, `R` reject, `N` next in queue, `E` edit boundary, `Esc` deselect. Show a shortcut hint. Shortcuts must not fire while typing in the note box.
3. Bulk action: "Approve all Low priority parcels" with a confirmation that states how many.
4. Progress bar in the header: reviewed / approved / flagged / rejected counts.
5. Compare slider (swipe) between the raw orthomosaic and the detections layer.

Acceptance: a full review of the village scene can be done with keyboard only; counts update live; tests cover queue ordering and shortcuts.

---

## [x] Task 4 - Learn from officer decisions (human-in-the-loop classifier)
Steps
1. Export button "Review labels (JSON)": for every decided parcel, the building's class evidence (from Task 1) plus label (`building` / `not_building` derived from Approve vs Reject; Needs-field-check is excluded).
2. `backend/dhara/train_classifier.py`: train a small model (logistic regression or gradient boosting from scikit-learn) on those labels; save with `joblib`; report cross-validated precision/recall **on the labels supplied** and say how many labels were used.
3. `classify.py`: optional `--classifier path` to use the trained model instead of the rule in `classify_instance`; the rule-based path stays the default and the fallback.
4. Docs: describe honestly that this is trained on officer labels for the scenes reviewed, not a general model.

Acceptance: with a synthetic label file the trainer runs and the classifier changes decisions; pipeline still works without a model; no accuracy claim beyond the printed cross-validation on supplied labels.

---

## [x] Task 5 - Import results (works for any area without a server)
Steps
1. CLI `pack` command: zip a processed scene (`manifest.json`, `ortho.jpg`, `masks.png`, `segments.png`, all GeoJSON layers, GeoPackage) into `<scene>_dhara_results.zip`. The Colab notebook calls it at the end.
2. Frontend: "Open results" button plus drag-and-drop zone. Read the zip client-side (add `jszip`), validate the manifest, create object URLs for images, and load it as a scene selectable in the dropdown. Show a clear error if a required file is missing.
3. Imported scenes keep their own review state.

Acceptance: pack the village scene, import it into a fresh browser profile, and it behaves like the built-in scene. Tests cover the manifest validation.

---

## [ ] Task 6 - Ground-truth check in the app
Needs from me: a GeoJSON of hand-digitised buildings (20-30 is enough) for one scene. Ask me for it before starting.
Steps
1. "Load reference polygons" in the Report tab (GeoJSON, WGS84).
2. Compute and display: precision, recall, F1 at IoU >= 0.5, mean matched IoU, and boundary offset (mean / p90 in metres) for the building layer. Reuse `metrics.py` logic (Python via CLI for the committed scenes) or an equivalent in-browser implementation with Turf; whichever is chosen, unit-test it against the Python numbers on a small fixture.
3. Show the test conditions next to the numbers (scene, number of reference polygons, IoU threshold). Draw matched / missed / false-positive footprints in different colours.
4. Never show accuracy without a loaded reference.

Acceptance: numbers match `metrics.py` on the fixture; the Report tab states the conditions.

---

## [ ] Task 7 - Real upload -> analysis -> results (backend)
Steps
1. `api.py`: `POST /jobs` (multipart: image or GeoTIFF; for plain JPEG also gsd in metres per pixel and an assumed lon/lat, labelled assumed), `GET /jobs/{id}` (status, stage, progress), `GET /jobs/{id}/results` (zip, same format as Task 5). Run the pipeline in a background worker; progress stages: reading, segmentation (per tile), classification, vectorisation, parcels, topology, packaging.
2. Limits: max upload size, max pixels, one job at a time, job expiry and cleanup. Segmenter is injectable so tests use a fast stub.
3. Frontend: "Analyse a new image" dialog with drop zone, gsd field, progress stepper driven by the real job status, then the result opens as a scene (reuse Task 5 loader). Backend URL from `VITE_API_URL`; when unset or unreachable show "Upload needs the Dhara.ai backend. Run it locally or see docs" instead of failing silently.
4. `Dockerfile` for the backend (CPU torch). Document running it locally (for the demo video) and deploying it (ask me which host: my laptop, Azure student credit, or another).
5. Measure and record the real run time on the machine used; put it in docs, not in the UI as a promise.

Acceptance: end to end on the village image locally with progress shown; stub-segmenter tests pass in CI time; the static site still works with no backend.

---

## [ ] Task 8 - Optional: pretrained building prior (research task, Colab)
Try, in a Colab notebook, combining a pretrained aerial building-segmentation model (open weights) with SAM: accept a SAM mask only if the prior agrees. Report results **only** if Task 6 reference data exists, otherwise describe it as an experiment. Do not merge into the main pipeline unless it measurably improves the reference metrics.

---

## [ ] Task 9 - Polish for the submission
1. English / Hindi UI toggle (interface strings only; keep numbers and IDs unchanged). Mukta already covers Devanagari.
2. Table / dashboard view: sortable parcel table (id, area, land use, priority, status), summary counts, area distribution.
3. First-visit hint (three short lines: play, select a parcel, review) that can be dismissed and is not shown again.
4. Accessibility pass: keyboard focus, contrast, reduced motion.
5. Update `docs/DEMO_SCRIPT.md` to match the final UI, and README to match what is actually implemented. Re-check every claim in the README against the rules in `CLAUDE.md`.

Acceptance: all tests and build pass; README claims are all true of the current code.
