import shutil
import pytest
import geopandas as gpd

from dhara.config import DATA_OUT, SCENES
from dhara.pipeline import run_scene
from dhara.classify import Feat, ground_likeness


def test_ground_likeness():
    # dark-brown blobby low-rect patch -> high ground-likeness
    f_ground = Feat(
        area_m2=45.0, solidity=0.70, rect=0.50, elong=0.6,
        veg_frac=0.05, mean_rgb=(50, 40, 30), sat=0.25, val=0.30, hue=30.0
    )
    score_ground = ground_likeness(f_ground)
    assert score_ground > 0.4, f"Expected high ground-likeness, got {score_ground}"

    # clean roof -> low ground-likeness
    f_roof = Feat(
        area_m2=65.0, solidity=0.95, rect=0.88, elong=0.7,
        veg_frac=0.0, mean_rgb=(180, 160, 150), sat=0.10, val=0.70, hue=20.0
    )
    score_roof = ground_likeness(f_roof)
    assert score_roof < 0.2, f"Expected low ground-likeness, got {score_roof}"


@pytest.mark.skipif(not (DATA_OUT / "village_tiled" / "sam_instances.pkl").exists(), reason="cached SAM masks not present")
def test_priority_and_class_evidence_in_outputs(tmp_path):
    out = tmp_path / "village_test"
    out.mkdir()
    shutil.copy(DATA_OUT / "village_tiled" / "sam_instances.pkl", out / "sam_instances.pkl")
    run_scene(SCENES["village_tiled"], out_dir=out, log=lambda *_: None)

    # 1. verify class evidence stored in buildings.geojson
    bld_gdf = gpd.read_file(out / "web" / "buildings.geojson")
    for col in ("veg_frac", "sat", "val", "hue", "rect", "solidity", "area_m2", "ground_likeness"):
        assert col in bld_gdf.columns, f"Column {col} missing from buildings.geojson"

    # 2. verify class evidence and review_reasons stored in parcels.geojson
    prc_gdf = gpd.read_file(out / "web" / "parcels.geojson")
    assert "review_priority" in prc_gdf.columns
    assert "review_reasons" in prc_gdf.columns

    # 3. any parcel with vegetation_share >= 0.45 must NOT be Low
    high_veg_parcels = prc_gdf[prc_gdf["vegetation_share"] >= 0.45]
    for _, p in high_veg_parcels.iterrows():
        assert p["review_priority"] in ("High", "Medium"), (
            f"Parcel {p['parcel_id']} with veg_share {p['vegetation_share']} has priority {p['review_priority']}, expected High or Medium"
        )
        assert "vegetation" in p["review_reasons"].lower(), (
            f"Parcel {p['parcel_id']} review reasons '{p['review_reasons']}' should mention vegetation"
        )

    # 4. village parcel 0002 specifically
    p0002 = prc_gdf[prc_gdf["parcel_id"].str.endswith("0002")].iloc[0]
    assert p0002["review_priority"] in ("High", "Medium"), f"Parcel 0002 has priority {p0002['review_priority']}"
    assert "vegetation" in p0002["review_reasons"].lower(), f"Reasons: {p0002['review_reasons']}"
