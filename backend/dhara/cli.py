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


def main() -> None:
    warnings.filterwarnings("ignore")
    ap = argparse.ArgumentParser(prog="dhara")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="run the pipeline (uses cached SAM masks if present)")
    r.add_argument("scenes", nargs="*", default=list(SCENES))
    r.add_argument("--publish", type=Path, help="copy outputs into this web data dir")
    r.add_argument("--fresh", action="store_true", help="ignore cached SAM masks and re-segment")
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
            run_scene(SCENES[sid], Params(), segmenter=seg)
        if a.publish:
            publish(a.scenes, a.publish)


if __name__ == "__main__":
    main()
