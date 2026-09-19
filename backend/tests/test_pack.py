import json
import zipfile
from pathlib import Path
import pytest
from dhara.cli import pack


def test_pack_village_tiled(tmp_path: Path):
    out_zip = tmp_path / "test_village_results.zip"
    res = pack("village_tiled", out=out_zip)
    assert res == out_zip
    assert out_zip.exists()

    with zipfile.ZipFile(out_zip, "r") as zf:
        names = zf.namelist()
        assert "manifest.json" in names
        assert "ortho.jpg" in names
        assert "masks.png" in names
        assert "segments.png" in names
        assert "parcels.geojson" in names
        assert "buildings.geojson" in names
        assert "roads.geojson" in names
        assert "vegetation.geojson" in names
        assert "open_ground.geojson" in names
        assert "issues.geojson" in names

        # check manifest contents
        man_data = json.loads(zf.read("manifest.json").decode("utf-8"))
        assert man_data.get("schema_version") == 1
        assert "data_fingerprint" in man_data
        assert man_data["scene"] == "village_tiled"
