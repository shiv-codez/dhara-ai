import json
import shutil
import pytest

from dhara.config import DATA_OUT, SCENES
from dhara.pipeline import run_scene
from dhara.train_classifier import (
    FEATURE_COLS,
    Label,
    TrainedClassifier,
    extract_labels,
    train,
)


def _make_dummy_label(label: str, decided_by: str = "individual", scene: str = "scene_a", **feature_overrides) -> dict:
    feats = {
        "veg_frac": 0.05,
        "sat": 0.15,
        "val": 0.60,
        "hue": 25.0,
        "rect": 0.85,
        "solidity": 0.92,
        "area_m2": 75.0,
        "ground_likeness": 0.10,
    }
    feats.update(feature_overrides)
    return {
        "scene": scene,
        "parcel_id": "P-001",
        "building_id": "B-001",
        "label": label,
        "decided_by": decided_by,
        "features": feats,
        "exported_at": "2026-09-19T00:00:00Z",
    }


def test_label_extraction_rules():
    raw = [
        _make_dummy_label("building", decided_by="individual"),
        _make_dummy_label("not_building", decided_by="individual"),
        _make_dummy_label("building", decided_by="bulk"),  # bulk -> ignored
        _make_dummy_label("not_building", decided_by="bulk"),  # bulk -> ignored
        _make_dummy_label("needs_field_check", decided_by="individual"),  # field_check -> ignored
        _make_dummy_label("draft", decided_by="individual"),  # draft -> ignored
    ]
    extracted = extract_labels(raw)
    assert len(extracted) == 2
    assert extracted[0].label == "building"
    assert extracted[0].decided_by == "individual"
    assert extracted[1].label == "not_building"
    assert extracted[1].decided_by == "individual"
    for item in extracted:
        assert set(item.features.keys()) == set(FEATURE_COLS)


def test_min_training_data_guard():
    # 1. Fewer than 20 labels total
    labels_few = [
        Label(
            scene="s1",
            parcel_id=f"P-{i}",
            building_id=f"B-{i}",
            label="building" if i % 2 == 0 else "not_building",
            decided_by="individual",
            features={c: 0.5 for c in FEATURE_COLS},
        )
        for i in range(19)
    ]
    with pytest.raises(ValueError, match="at least 20 labels"):
        train(labels_few, log=lambda *_: None)

    # 2. Fewer than 5 of one class (e.g., 20 building, 3 not_building)
    labels_imbalanced = [
        Label(
            scene="s1",
            parcel_id=f"P-{i}",
            building_id=f"B-{i}",
            label="building" if i < 20 else "not_building",
            decided_by="individual",
            features={c: 0.5 for c in FEATURE_COLS},
        )
        for i in range(23)
    ]
    with pytest.raises(ValueError, match="at least 5"):
        train(labels_imbalanced, log=lambda *_: None)


def test_feature_name_guard(tmp_path):
    labels = []
    for i in range(15):
        labels.append(
            Label(
                scene="s1",
                parcel_id=f"P-b-{i}",
                building_id=f"B-b-{i}",
                label="building",
                decided_by="individual",
                features={
                    "veg_frac": 0.05, "sat": 0.1, "val": 0.7, "hue": 20.0,
                    "rect": 0.9, "solidity": 0.95, "area_m2": 80.0, "ground_likeness": 0.05,
                },
            )
        )
    for i in range(10):
        labels.append(
            Label(
                scene="s2",
                parcel_id=f"P-nb-{i}",
                building_id=f"B-nb-{i}",
                label="not_building",
                decided_by="individual",
                features={
                    "veg_frac": 0.6, "sat": 0.4, "val": 0.3, "hue": 35.0,
                    "rect": 0.4, "solidity": 0.6, "area_m2": 30.0, "ground_likeness": 0.7,
                },
            )
        )

    clf = train(labels, log=lambda *_: None)
    model_path = tmp_path / "model.joblib"
    clf.save(model_path)

    # 1. Prediction fails on missing feature column
    bad_features = [
        {
            "veg_frac": 0.1, "sat": 0.1, "val": 0.7, "hue": 20.0,
            "rect": 0.9, "solidity": 0.95, "area_m2": 80.0,
            # ground_likeness missing
        }
    ]
    with pytest.raises(ValueError, match="Feature mismatch"):
        clf.predict_proba_building(bad_features)

    # 2. Loading model with mismatched feature columns fails
    import joblib
    d = joblib.load(model_path)
    d["feature_cols"] = ["veg_frac", "sat", "val"]  # corrupted features list
    joblib.dump(d, model_path)
    with pytest.raises(ValueError, match="current code expects"):
        TrainedClassifier.load(model_path)


def test_classifier_veto_planted_false_positive():
    labels = []
    # 15 clear buildings
    for i in range(15):
        labels.append(
            Label(
                scene="s1",
                parcel_id=f"P-b-{i}",
                building_id=f"B-b-{i}",
                label="building",
                decided_by="individual",
                features={
                    "veg_frac": 0.02, "sat": 0.1, "val": 0.75, "hue": 20.0,
                    "rect": 0.88, "solidity": 0.95, "area_m2": 90.0, "ground_likeness": 0.05,
                },
            )
        )
    # 10 not_building (vegetation and dark earth)
    for i in range(10):
        labels.append(
            Label(
                scene="s1",
                parcel_id=f"P-nb-{i}",
                building_id=f"B-nb-{i}",
                label="not_building",
                decided_by="individual",
                features={
                    "veg_frac": 0.55, "sat": 0.35, "val": 0.25, "hue": 35.0,
                    "rect": 0.45, "solidity": 0.65, "area_m2": 40.0, "ground_likeness": 0.80,
                },
            )
        )

    clf = train(labels, log=lambda *_: None)

    # Clear building should pass veto (p_building >= 0.5)
    clear_building = [{
        "veg_frac": 0.01, "sat": 0.1, "val": 0.8, "hue": 20.0,
        "rect": 0.9, "solidity": 0.95, "area_m2": 100.0, "ground_likeness": 0.02,
    }]
    prob_bld = clf.predict_proba_building(clear_building)[0]
    assert prob_bld >= 0.5, f"Expected clear building probability >= 0.5, got {prob_bld}"

    # Planted false positive (dark muddy ground) should be vetoed (p_building < 0.5)
    planted_false_positive = [{
        "veg_frac": 0.50, "sat": 0.4, "val": 0.2, "hue": 35.0,
        "rect": 0.4, "solidity": 0.6, "area_m2": 35.0, "ground_likeness": 0.85,
    }]
    prob_fp = clf.predict_proba_building(planted_false_positive)[0]
    assert prob_fp < 0.5, f"Expected planted false positive probability < 0.5, got {prob_fp}"


@pytest.mark.skipif(not (DATA_OUT / "village_tiled" / "sam_instances.pkl").exists(), reason="cached SAM masks not present")
def test_pipeline_with_and_without_classifier(tmp_path):
    # 1. Train classifier on mock data
    labels = []
    for i in range(15):
        labels.append(
            Label(
                scene="village_tiled",
                parcel_id=f"P-b-{i}",
                building_id=f"B-b-{i}",
                label="building",
                decided_by="individual",
                features={
                    "veg_frac": 0.05, "sat": 0.1, "val": 0.7, "hue": 20.0,
                    "rect": 0.9, "solidity": 0.95, "area_m2": 80.0, "ground_likeness": 0.05,
                },
            )
        )
    for i in range(10):
        labels.append(
            Label(
                scene="town_dense",
                parcel_id=f"P-nb-{i}",
                building_id=f"B-nb-{i}",
                label="not_building",
                decided_by="individual",
                features={
                    "veg_frac": 0.6, "sat": 0.4, "val": 0.3, "hue": 35.0,
                    "rect": 0.4, "solidity": 0.6, "area_m2": 30.0, "ground_likeness": 0.7,
                },
            )
        )
    clf = train(labels, log=lambda *_: None)
    clf_path = tmp_path / "test_clf.joblib"
    clf.save(clf_path)

    # 2. Run without classifier
    out_no_clf = tmp_path / "out_no_clf"
    out_no_clf.mkdir()
    shutil.copy(DATA_OUT / "village_tiled" / "sam_instances.pkl", out_no_clf / "sam_instances.pkl")
    m_no_clf = run_scene(SCENES["village_tiled"], out_dir=out_no_clf, log=lambda *_: None)
    assert m_no_clf["classifier"] is None

    # 3. Run with classifier
    out_clf = tmp_path / "out_clf"
    out_clf.mkdir()
    shutil.copy(DATA_OUT / "village_tiled" / "sam_instances.pkl", out_clf / "sam_instances.pkl")
    m_clf = run_scene(SCENES["village_tiled"], classifier=clf_path, out_dir=out_clf, log=lambda *_: None)
    assert m_clf["classifier"] is not None
    assert m_clf["classifier"]["source"] == "trained_officer_labels"
    assert m_clf["classifier"]["n_labels"] == 25
    assert m_clf["classifier"]["threshold"] == 0.5

    # Classifier acting as a veto can only keep or reduce candidate buildings, never invent them
    assert m_clf["counts"]["buildings"] <= m_no_clf["counts"]["buildings"]
