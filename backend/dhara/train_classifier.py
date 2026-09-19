"""Train a second-stage veto classifier from officer review labels.

The classifier removes false positives that the rule-based pipeline accepted:
instances with p(building) below a threshold are vetoed. It cannot recover
buildings the rules already rejected.

scikit-learn and joblib are optional dependencies (requirements-train.txt).
The default pipeline runs without them.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

# The 8 class-evidence features, in canonical order.
# A saved model will refuse to predict if the feature names differ.
FEATURE_COLS = ["veg_frac", "sat", "val", "hue", "rect", "solidity", "area_m2", "ground_likeness"]


@dataclass
class Label:
    scene: str
    parcel_id: str
    building_id: str
    label: str          # "building" or "not_building"
    decided_by: str     # should be "individual"
    features: dict      # the 8 class-evidence features


def extract_labels(labels_json: list[dict]) -> list[Label]:
    """Keep only individually-decided Approve/Reject labels.

    - Approve  -> building
    - Reject   -> not_building
    - field-check, draft, bulk -> excluded
    """
    out = []
    for rec in labels_json:
        if rec.get("decided_by") != "individual":
            continue
        lbl = rec.get("label")
        if lbl not in ("building", "not_building"):
            continue
        out.append(Label(
            scene=rec["scene"],
            parcel_id=rec["parcel_id"],
            building_id=rec["building_id"],
            label=lbl,
            decided_by=rec["decided_by"],
            features={k: rec["features"][k] for k in FEATURE_COLS},
        ))
    return out


class TrainedClassifier:
    """Thin wrapper around a scikit-learn pipeline (StandardScaler + LogisticRegression).

    Persisted via joblib; the saved file embeds the expected feature names
    for the feature-name guard.
    """

    def __init__(self, pipeline, feature_cols: list[str], metadata: dict):
        self.pipeline = pipeline
        self.feature_cols = list(feature_cols)
        self.metadata = dict(metadata)

    def predict_proba_building(self, feature_dicts: list[dict]) -> list[float]:
        """Return p(building) for each feature dict."""
        import numpy as np
        # Feature-name guard
        for fd in feature_dicts:
            keys = set(fd.keys())
            expected = set(self.feature_cols)
            if keys != expected:
                raise ValueError(
                    f"Feature mismatch: model expects {sorted(expected)}, got {sorted(keys)}"
                )
        X = np.array([[fd[c] for c in self.feature_cols] for fd in feature_dicts])
        idx = list(self.pipeline.classes_).index("building")
        return self.pipeline.predict_proba(X)[:, idx].tolist()

    def save(self, path: str | Path) -> None:
        import joblib
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump({
            "pipeline": self.pipeline,
            "feature_cols": self.feature_cols,
            "metadata": self.metadata,
        }, path)

    @staticmethod
    def load(path: str | Path) -> "TrainedClassifier":
        import joblib
        d = joblib.load(path)
        # Feature-name guard on load
        if set(d["feature_cols"]) != set(FEATURE_COLS):
            raise ValueError(
                f"Saved model has features {d['feature_cols']} but current code expects {FEATURE_COLS}"
            )
        return TrainedClassifier(d["pipeline"], d["feature_cols"], d["metadata"])


def train(labels: list[Label], log=print) -> TrainedClassifier:
    """Train a StandardScaler + LogisticRegression classifier.

    Raises ValueError if there are fewer than 20 labels or fewer than 5 of either class.
    Reports stratified cross-validated precision/recall for the `not_building` class.
    If labels span ≥2 scenes, also reports leave-one-scene-out results.
    """
    # --- guard: minimum data requirements (checked before importing optional dependencies)
    n = len(labels)
    n_building = sum(1 for lb in labels if lb.label == "building")
    n_not = n - n_building
    if n < 20:
        raise ValueError(f"Need at least 20 labels to train, got {n}")
    if n_building < 5:
        raise ValueError(f"Need at least 5 'building' labels, got {n_building}")
    if n_not < 5:
        raise ValueError(f"Need at least 5 'not_building' labels, got {n_not}")

    import numpy as np
    from sklearn.linear_model import LogisticRegression
    from sklearn.model_selection import StratifiedKFold, cross_validate
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import StandardScaler

    X = np.array([[lb.features[c] for c in FEATURE_COLS] for lb in labels])
    y = np.array([lb.label for lb in labels])

    pipe = Pipeline([
        ("scaler", StandardScaler()),
        ("clf", LogisticRegression(
            class_weight="balanced",
            C=1.0,
            max_iter=500,
            random_state=42,
        )),
    ])
    pipe.fit(X, y)

    # --- stratified 5-fold CV
    skf = StratifiedKFold(n_splits=min(5, n_building, n_not), shuffle=True, random_state=42)
    cv = cross_validate(pipe, X, y, cv=skf, scoring=["precision_macro", "recall_macro", "f1_macro"])
    # per-class report for not_building
    from sklearn.metrics import precision_score, recall_score
    from sklearn.model_selection import cross_val_predict
    y_pred = cross_val_predict(pipe, X, y, cv=skf)
    nb_prec = precision_score(y, y_pred, labels=["not_building"], average=None, zero_division=0)[0]
    nb_rec = recall_score(y, y_pred, labels=["not_building"], average=None, zero_division=0)[0]

    scenes = sorted(set(lb.scene for lb in labels))
    scene_counts = {s: sum(1 for lb in labels if lb.scene == s) for s in scenes}

    log(f"Labels: {n} total ({n_building} building, {n_not} not_building)")
    for s in scenes:
        log(f"  {s}: {scene_counts[s]} labels")
    log(f"Stratified CV not_building precision: {nb_prec:.3f}, recall: {nb_rec:.3f}")

    meta = {
        "n_labels": n,
        "n_building": n_building,
        "n_not_building": n_not,
        "scenes": scenes,
        "scene_counts": scene_counts,
        "cv_not_building_precision": round(float(nb_prec), 4),
        "cv_not_building_recall": round(float(nb_rec), 4),
    }

    # --- leave-one-scene-out CV (if ≥2 scenes)
    if len(scenes) >= 2:
        log("Leave-one-scene-out CV:")
        loso_precs, loso_recs = [], []
        for held in scenes:
            train_idx = [i for i, lb in enumerate(labels) if lb.scene != held]
            test_idx = [i for i, lb in enumerate(labels) if lb.scene == held]
            if len(set(y[test_idx])) < 2:
                log(f"  held out {held}: skipped (only one class in test set)")
                continue
            p2 = Pipeline([
                ("scaler", StandardScaler()),
                ("clf", LogisticRegression(class_weight="balanced", C=1.0, max_iter=500, random_state=42)),
            ])
            p2.fit(X[train_idx], y[train_idx])
            yp = p2.predict(X[test_idx])
            pr = precision_score(y[test_idx], yp, labels=["not_building"], average=None, zero_division=0)[0]
            rc = recall_score(y[test_idx], yp, labels=["not_building"], average=None, zero_division=0)[0]
            loso_precs.append(pr)
            loso_recs.append(rc)
            log(f"  held out {held}: not_building precision={pr:.3f}, recall={rc:.3f}")
        if loso_precs:
            meta["loso_not_building_precision"] = round(float(np.mean(loso_precs)), 4)
            meta["loso_not_building_recall"] = round(float(np.mean(loso_recs)), 4)

    return TrainedClassifier(pipe, FEATURE_COLS, meta)


def load_labels_files(paths: list[str | Path]) -> list[dict]:
    """Load and merge label JSON files (each is a JSON array)."""
    all_labels = []
    for p in paths:
        with open(p) as f:
            data = json.load(f)
        if isinstance(data, list):
            all_labels.extend(data)
        else:
            raise ValueError(f"{p}: expected a JSON array at the top level")
    return all_labels
