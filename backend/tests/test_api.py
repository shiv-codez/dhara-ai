from fastapi.testclient import TestClient
from shapely.geometry import box, mapping
from pyproj import Transformer

from dhara.api import app

client = TestClient(app)
to_ll = Transformer.from_crs(32643, 4326, always_xy=True)


def fc(items, key):
    feats = []
    for name, b in items:
        ring = [to_ll.transform(x, y) for x, y in mapping(b)["coordinates"][0]]
        feats.append({"type": "Feature", "properties": {key: name}, "geometry": {"type": "Polygon", "coordinates": [ring]}})
    return {"type": "FeatureCollection", "features": feats}


def test_health():
    assert client.get("/health").json()["status"] == "ok"


def test_validate_finds_overlap_over_http():
    x, y = 500000, 2980000
    parcels = fc([("P0", box(x, y, x + 10, y + 10)), ("P1", box(x + 8, y, x + 20, y + 10))], "parcel_id")
    r = client.post("/validate", json={"parcels": parcels})
    assert r.status_code == 200
    assert r.json()["by_type"].get("parcel_overlap") == 1


def test_validate_rejects_empty():
    assert client.post("/validate", json={"parcels": {"type": "FeatureCollection", "features": []}}).status_code == 422


def test_regularize_squares_up_polygon():
    x, y = 500000, 2980000
    jag = [(x, y), (x + 3, y + .12), (x + 6, y - .1), (x + 12, y + .05), (x + 12.1, y + 4), (x + 11.9, y + 8),
           (x + 6, y + 8.1), (x, y + 7.9)]
    ring = [to_ll.transform(a, b) for a, b in jag + [jag[0]]]
    body = {"polygons": {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {},
            "geometry": {"type": "Polygon", "coordinates": [ring]}}]}}
    out = client.post("/regularize", json=body).json()
    assert len(out["features"][0]["geometry"]["coordinates"][0]) - 1 <= 6
