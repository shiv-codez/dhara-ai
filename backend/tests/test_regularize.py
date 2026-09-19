import numpy as np
from shapely.affinity import rotate
from shapely.geometry import Polygon, box

from dhara.regularize import orthogonalize, regularize, right_angle_ratio, dominant_angle


def jagged_rect(w=12, h=8, step=0.4, noise=0.15, seed=0, angle=0):
    rng = np.random.default_rng(seed)
    pts = []
    for x in np.arange(0, w, step): pts.append((x, 0 + rng.normal(0, noise)))
    for y in np.arange(0, h, step): pts.append((w + rng.normal(0, noise), y))
    for x in np.arange(w, 0, -step): pts.append((x, h + rng.normal(0, noise)))
    for y in np.arange(h, 0, -step): pts.append((0 + rng.normal(0, noise), y))
    return rotate(Polygon(pts), angle, origin=(0, 0))


def test_jagged_rectangle_becomes_rectangle():
    raw = jagged_rect()
    out = regularize(raw, tol_m=0.25, angle_tol_deg=22)
    assert out.is_valid
    assert len(out.exterior.coords) - 1 <= 6          # ~4 corners, not 100+
    assert right_angle_ratio(out) >= 0.99
    assert abs(out.area - raw.area) / raw.area < 0.1


def test_rotated_building_keeps_orientation():
    raw = jagged_rect(angle=31)
    theta = dominant_angle(raw)
    assert abs(((theta - 31) + 45) % 90 - 45) < 3
    out = orthogonalize(raw.simplify(0.25))
    assert right_angle_ratio(out) >= 0.99


def test_l_shape_preserved():
    l = Polygon([(0, 0), (10, 0), (10, 4), (4, 4), (4, 9), (0, 9)])
    noisy = Polygon([(x + np.sin(i) * 0.08, y + np.cos(i) * 0.08) for i, (x, y) in enumerate(l.exterior.coords[:-1])])
    out = orthogonalize(noisy)
    assert out.is_valid and len(out.exterior.coords) - 1 == 6
    assert right_angle_ratio(out) == 1.0
    assert abs(out.area - l.area) < 1.0


def test_oblique_edge_survives():
    tri_like = Polygon([(0, 0), (10, 0), (10, 5), (0, 8)])   # one slanted edge
    out = orthogonalize(tri_like, angle_tol_deg=10)
    assert out.is_valid and abs(out.area - tri_like.area) / tri_like.area < 0.25


def test_never_returns_invalid():
    bow = Polygon([(0, 0), (4, 4), (4, 0), (0, 4)])
    out = regularize(bow, 0.2, 20)
    assert out is None or out.is_valid
