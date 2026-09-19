import shutil
import pytest

from dhara.config import DATA_OUT, SCENES
from dhara.pipeline import run_scene


@pytest.mark.skipif(not (DATA_OUT / "village_tiled" / "sam_instances.pkl").exists(), reason="cached SAM masks not present")
def test_full_pipeline_from_cached_masks(tmp_path):
    out = tmp_path / "village"
    out.mkdir()
    shutil.copy(DATA_OUT / "village_tiled" / "sam_instances.pkl", out / "sam_instances.pkl")
    m = run_scene(SCENES["village_tiled"], out_dir=out, log=lambda *_: None)
    assert m["counts"]["buildings"] > 20 and m["counts"]["parcels"] == m["counts"]["buildings"]
    assert m["georef_source"] == "assumed_demo"
    # regularisation must genuinely reduce vertices and raise right-angle share
    r = m["regularisation"]
    assert r["vertices_regularised"] < 0.3 * r["vertices_raw"]
    assert r["right_angle_share_regularised"] > r["right_angle_share_simplified_only"] + 0.2
    # outputs exist
    for f in ("parcels.geojson", "buildings.geojson", "roads.geojson", "issues.geojson", "manifest.json", "masks.png"):
        assert (out / "web" / f).exists(), f
    # after the deterministic auto-fix no parcel overlaps may remain
    assert m["topology"]["after_fix"].get("parcel_overlap", 0) == 0
