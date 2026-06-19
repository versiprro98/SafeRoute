"""
Train a model to predict route-segment risk score from engineered features.
Reports REAL metrics computed on a held-out test split (no fabricated numbers).
"""
import pandas as pd
import numpy as np
import json
from sklearn.model_selection import train_test_split
from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.linear_model import LinearRegression
from sklearn.metrics import r2_score, mean_absolute_error, mean_squared_error
from sklearn.preprocessing import OneHotEncoder
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
import joblib

df = pd.read_csv("/home/claude/pune_risk_ml/pune_risk_dataset.csv")

FEATURES = ["area_type", "road_type", "hour_of_day", "dist_police_km", "dist_transit_km"]
TARGET = "risk_score"

X = df[FEATURES]
y = df[TARGET]

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

categorical = ["area_type", "road_type"]
numeric = ["hour_of_day", "dist_police_km", "dist_transit_km"]

preprocess = ColumnTransformer(
    transformers=[
        ("cat", OneHotEncoder(handle_unknown="ignore"), categorical),
    ],
    remainder="passthrough",
)

models = {
    "LinearRegression": LinearRegression(),
    "RandomForest": RandomForestRegressor(n_estimators=300, max_depth=6, random_state=42),
    "GradientBoosting": GradientBoostingRegressor(
        n_estimators=300, max_depth=3, learning_rate=0.05, random_state=42
    ),
}

results = {}
best_name, best_pipe, best_r2 = None, None, -np.inf

for name, model in models.items():
    pipe = Pipeline([("prep", preprocess), ("model", model)])
    pipe.fit(X_train, y_train)
    preds = pipe.predict(X_test)
    r2 = r2_score(y_test, preds)
    mae = mean_absolute_error(y_test, preds)
    rmse = np.sqrt(mean_squared_error(y_test, preds))
    results[name] = {"r2": round(r2, 4), "mae": round(mae, 4), "rmse": round(rmse, 4)}
    print(f"{name:18s}  R2={r2:.4f}  MAE={mae:.4f}  RMSE={rmse:.4f}")
    if r2 > best_r2:
        best_name, best_pipe, best_r2 = name, pipe, r2

print(f"\nBest model: {best_name} (R2={best_r2:.4f})")

# Feature importance (for tree models)
if best_name in ("RandomForest", "GradientBoosting"):
    ohe = best_pipe.named_steps["prep"].named_transformers_["cat"]
    cat_names = list(ohe.get_feature_names_out(categorical))
    all_feature_names = cat_names + numeric
    importances = best_pipe.named_steps["model"].feature_importances_
    fi = sorted(zip(all_feature_names, importances), key=lambda x: -x[1])
    print("\nFeature importances:")
    for fname, imp in fi[:10]:
        print(f"  {fname:30s} {imp:.4f}")

joblib.dump(best_pipe, "/home/claude/pune_risk_ml/risk_model.joblib")
with open("/home/claude/pune_risk_ml/results.json", "w") as f:
    json.dump({"results": results, "best_model": best_name, "best_r2": round(best_r2, 4)}, f, indent=2)
