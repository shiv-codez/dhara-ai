import geopandas as gpd
import pytest
from shapely.geometry import Polygon

from dhara.pipeline import compute_data_fingerprint


def _make_test_gdf():
    poly1 = Polygon([(0.0, 0.0), (0.0, 10.0), (10.0, 10.0), (10.0, 0.0), (0.0, 0.0)])
    poly2 = Polygon([(10.0, 0.0), (10.0, 10.0), (20.0, 10.0), (20.0, 0.0), (10.0, 0.0)])
    gdf = gpd.GeoDataFrame(
        [
            {"parcel_id": "TMP-VI-0001", "geometry": poly1},
            {"parcel_id": "TMP-VI-0002", "geometry": poly2},
        ],
        crs="EPSG:32643",
    )
    return gdf


def test_fingerprint_deterministic():
    gdf1 = _make_test_gdf()
    gdf2 = _make_test_gdf()
    fp1 = compute_data_fingerprint(gdf1)
    fp2 = compute_data_fingerprint(gdf2)
    assert fp1 == fp2
    assert isinstance(fp1, str)
    assert len(fp1) == 64  # SHA-256 hex string


def test_fingerprint_changes_on_parcel_removal():
    gdf1 = _make_test_gdf()
    gdf2 = gdf1.iloc[:1].copy()  # Remove TMP-VI-0002
    fp1 = compute_data_fingerprint(gdf1)
    fp2 = compute_data_fingerprint(gdf2)
    assert fp1 != fp2


def test_fingerprint_changes_on_geometry_edit():
    gdf1 = _make_test_gdf()
    poly_mod = Polygon([(0.0, 0.0), (0.0, 12.0), (10.0, 10.0), (10.0, 0.0), (0.0, 0.0)])
    gdf2 = gdf1.copy()
    gdf2.loc[0, "geometry"] = poly_mod
    fp1 = compute_data_fingerprint(gdf1)
    fp2 = compute_data_fingerprint(gdf2)
    assert fp1 != fp2


def test_fingerprint_changes_on_id_rename():
    gdf1 = _make_test_gdf()
    gdf2 = gdf1.copy()
    gdf2.loc[1, "parcel_id"] = "TMP-VI-0003"
    fp1 = compute_data_fingerprint(gdf1)
    fp2 = compute_data_fingerprint(gdf2)
    assert fp1 != fp2


def test_fingerprint_changes_on_version_change():
    gdf = _make_test_gdf()
    fp1 = compute_data_fingerprint(gdf, version="dhara:v1")
    fp2 = compute_data_fingerprint(gdf, version="dhara:v2")
    assert fp1 != fp2
