import geopandas as gpd
from shapely.geometry import box

from dhara.config import Params
from dhara.topology import autofix_overlaps, validate

P = Params()


def gdfs(parcel_boxes, building_boxes):
    parcels = gpd.GeoDataFrame({"parcel_id": [f"P{i}" for i in range(len(parcel_boxes))]}, geometry=parcel_boxes, crs=32643)
    buildings = gpd.GeoDataFrame({"building_id": [f"B{i}" for i in range(len(building_boxes))],
                                  "parcel_id": [f"P{i}" for i in range(len(building_boxes))]}, geometry=building_boxes, crs=32643)
    return parcels, buildings


def types(issues):
    return sorted({i.type for i in issues})


def test_clean_layout_has_no_errors():
    parcels, buildings = gdfs([box(0, 0, 10, 10), box(10, 0, 20, 10)], [box(2, 2, 8, 8), box(12, 2, 18, 8)])
    iss = validate(parcels, buildings, None, P)
    assert [i for i in iss if i.severity == "error"] == []


def test_overlap_detected_and_autofixed():
    parcels, buildings = gdfs([box(0, 0, 10, 10), box(8, 0, 20, 10)], [box(2, 2, 6, 8), box(12, 2, 18, 8)])
    assert "parcel_overlap" in types(validate(parcels, buildings, None, P))
    fixed = autofix_overlaps(parcels, buildings, P)
    assert "parcel_overlap" not in types(validate(fixed, buildings, None, P))
    assert abs(fixed.area.sum() - parcels.union_all().area) < 1e-6      # ground covered is unchanged; nothing double-counted


def test_thin_ribbon_is_noise_not_error():
    parcels, buildings = gdfs([box(0, 0, 10, 10), box(9.9, 0, 20, 10)], [box(2, 2, 6, 8), box(12, 2, 18, 8)])
    assert "parcel_overlap" not in types(validate(parcels, buildings, None, P))   # 10 cm ribbon


def test_gap_between_parcels_flagged():
    parcels, buildings = gdfs([box(0, 0, 10, 10), box(10.4, 0, 20, 10)], [box(2, 2, 8, 8), box(12, 2, 18, 8)])
    assert "parcel_gap" in types(validate(parcels, buildings, None, P))


def test_building_on_road_and_straddle():
    road = box(4, 0, 6, 10)
    parcels, buildings = gdfs([box(0, 0, 10, 10), box(10, 0, 20, 10)], [box(3, 3, 7, 7), box(9, 2, 13, 8)])
    t = types(validate(parcels, buildings, road, P))
    assert "building_on_road" in t
    assert "building_straddles" in t


def test_no_road_access():
    parcels, buildings = gdfs([box(0, 0, 10, 10), box(30, 0, 40, 10)], [box(2, 2, 8, 8), box(32, 2, 38, 8)])
    iss = validate(parcels, buildings, box(9.5, -5, 10.5, 15), P)
    assert [i.parcel_ids for i in iss if i.type == "no_road_access"] == [["P1"]]
