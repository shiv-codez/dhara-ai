"""Command line: run the pipeline on the demo scenes and publish outputs to the web app.

    python -m dhara.cli run village_tiled town_dense --publish ../frontend/public/data
"""
from __future__ import annotations

import argparse
import json
import shutil
import warnings
from pathlib import Path

from .config import DATA_OUT, SCENES, Params

PUBLISH_FILES = ["manifest.json", "ortho.jpg", "masks.png", "segments.png", "parcels.geojson",
                 "parcels_before_fix.geojson", "buildings.geojson", "buildings_raw.geojson",
                 "roads.geojson", "vegetation.geojson", "open_ground.geojson", "issues.geojson",
                 "issues_before_fix.geojson"]


def publish(scene_ids: list[str], dest: Path) -> None:
    index = []
    for sid in scene_ids:
        src = DATA_OUT / sid / "web"
        out = dest / sid
        out.mkdir(parents=True, exist_ok=True)
        for f in PUBLISH_FILES + [f"{sid}_dhara_candidates.gpkg"]:
            if (src / f).exists():
                shutil.copy2(src / f, out / f)
        man = json.loads((src / "manifest.json").read_text())
        index.append({"id": sid, "title": man["title"], "description": man["description"]})
    (dest / "index.json").write_text(json.dumps(index, indent=1))
    print(f"published {len(index)} scene(s) -> {dest}")


"""Command line: run the pipeline on the demo scenes and publish outputs to the web app,
or train a second-stage classifier from officer review labels.

    python -m dhara.cli run village_tiled town_dense --publish ../frontend/public/data
    python -m dhara.cli train labels.json [more.json ...] --out models/dhara_classifier.joblib
    python -m dhara.cli run village_tiled --classifier models/dhara_classifier.joblib --publish ../frontend/public/data
"""
from __future__ import annotations

import argparse
import json
import shutil
import warnings
from pathlib import Path

from .config import DATA_OUT, SCENES, Params

PUBLISH_FILES = ["manifest.json", "ortho.jpg", "masks.png", "segments.png", "parcels.geojson",
                 "parcels_before_fix.geojson", "buildings.geojson", "buildings_raw.geojson",
                 "roads.geojson", "vegetation.geojson", "open_ground.geojson", "issues.geojson",
                 "issues_before_fix.geojson"]


def publish(scene_ids: list[str], dest: Path) -> None:
    index = []
    for sid in scene_ids:
        src = DATA_OUT / sid / "web"
        out = dest / sid
        out.mkdir(parents=True, exist_ok=True)
        for f in PUBLISH_FILES + [f"{sid}_dhara_candidates.gpkg"]:
            if (src / f).exists():
                shutil.copy2(src / f, out / f)
        man = json.loads((src / "manifest.json").read_text())
        index.append({"id": sid, "title": man["title"], "description": man["description"]})
    (dest / "index.json").write_text(json.dumps(index, indent=1))
    print(f"published {len(index)} scene(s) -> {dest}")


def main() -> None:
    warnings.filterwarnings("ignore")
    ap = argparse.ArgumentParser(prog="dhara")
    sub = ap.add_subparsers(dest="cmd", required=True)

    # Subcommand: run
    r = sub.add_parser("run", help="run the pipeline (uses cached SAM masks if present)")
    r.add_argument("scenes", nargs="*", default=list(SCENES))
    r.add_argument("--publish", type=Path, help="copy outputs into this web data dir")
    r.add_argument("--fresh", action="store_true", help="ignore cached SAM masks and re-segment")
    r.add_argument("--classifier", type=Path, default=None, help="path to trained joblib classifier for second-stage veto")
    r.add_argument("--threshold", type=float, default=0.5, help="p(building) veto threshold (default 0.5)")

    # Subcommand: train
    tr = sub.add_parser("train", help="train a second-stage veto classifier from officer label files")
    tr.add_argument("labels", nargs="+", type=Path, help="one or more exported review label JSON files")
    tr.add_argument("--out", type=Path, default=Path("models/dhara_classifier.joblib"), help="output joblib path")

    a = ap.parse_args()
    if a.cmd == "run":
        from .pipeline import run_scene
        seg = None
        for sid in a.scenes:
            cache = DATA_OUT / sid / "sam_instances.pkl"
            if a.fresh and cache.exists():
                cache.unlink()
            if not cache.exists() and seg is None:
                from .segment import MobileSamSegmenter
                seg = MobileSamSegmenter(Params())
            run_scene(SCENES[sid], Params(), segmenter=seg, classifier=a.classifier, classifier_threshold=a.threshold)
        if a.publish:
            publish(a.scenes, a.publish)

    elif a.cmd == "train":
        from .train_classifier import extract_labels, load_labels_files, train
        raw = load_labels_files(a.labels)
        labels = extract_labels(raw)
        print(f"Loaded {len(raw)} raw records -> {len(labels)} individual approve/reject labels")
        clf = train(labels, log=print)
        clf.save(a.out)
        print(f"Saved classifier -> {a.out}")


if __name__ == "__main__":
    main()

