"""
Generate a risk grid over a REAL Pune corridor (Kothrud - Karve Nagar -
Erandwane, ~3.5km stretch) matching the existing C++ simulator's 30x20 grid,
for both a daytime and nighttime scenario, using the trained risk model.
"""
import numpy as np
import pandas as pd
import joblib
from math import radians, sin, cos, sqrt, atan2

COLS, ROWS = 30, 20

# Same bounding geography used in training (real coordinates)
POLICE_STATIONS = [
    (18.5074, 73.8077), (18.5158, 73.8412), (18.5304, 73.8446),
    (18.5018, 73.8580), (18.5126, 73.8784), (18.5089, 73.9260),
    (18.5580, 73.8800), (18.5390, 73.8230), (18.4961, 73.8961),
    (18.5912, 73.7389),
]
TRANSIT_HUBS = [(18.5286, 73.8746), (18.5018, 73.8580), (18.5304, 73.8446)]

# Bounding box spanning Kothrud -> Karve Nagar -> Erandwane
LAT_MIN, LAT_MAX = 18.480, 18.520
LON_MIN, LON_MAX = 73.800, 73.835

NEIGHBORHOOD_CENTERS = {
    "residential_commercial": (18.5074, 73.8077),  # Kothrud
    "residential": (18.4870, 73.8194),              # Karve Nagar
    "educational": (18.5057, 73.8298),               # Erandwane
}


def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    p1, p2 = radians(lat1), radians(lat2)
    dphi, dlambda = radians(lat2 - lat1), radians(lon2 - lon1)
    a = sin(dphi / 2) ** 2 + cos(p1) * cos(p2) * sin(dlambda / 2) ** 2
    return 2 * R * atan2(sqrt(a), sqrt(1 - a))


def dist_to_nearest(lat, lon, points):
    return min(haversine_km(lat, lon, p[0], p[1]) for p in points)


def nearest_area_type(lat, lon):
    best, best_d = None, 1e9
    for area_type, (clat, clon) in NEIGHBORHOOD_CENTERS.items():
        d = haversine_km(lat, lon, clat, clon)
        if d < best_d:
            best, best_d = area_type, d
    return best


rng = np.random.default_rng(7)
model = joblib.load("/home/claude/pune_risk_ml/risk_model.joblib")

rows = []
for gy in range(ROWS):
    for gx in range(COLS):
        lat = LAT_MAX - (gy / (ROWS - 1)) * (LAT_MAX - LAT_MIN)
        lon = LON_MIN + (gx / (COLS - 1)) * (LON_MAX - LON_MIN)

        area_type = nearest_area_type(lat, lon)
        # deterministic pseudo-random road type per cell (seeded by coords)
        local_rng = np.random.default_rng(gx * 1000 + gy)
        road_type = local_rng.choice(
            ["arterial_main_road", "residential_lane", "market_lane"],
            p=[0.30, 0.55, 0.15],
        )
        dist_police = dist_to_nearest(lat, lon, POLICE_STATIONS)
        dist_transit = dist_to_nearest(lat, lon, TRANSIT_HUBS)

        rows.append(
            {
                "gx": gx, "gy": gy, "lat": lat, "lon": lon,
                "area_type": area_type, "road_type": road_type,
                "dist_police_km": dist_police, "dist_transit_km": dist_transit,
            }
        )

grid_df = pd.DataFrame(rows)

for scenario, hour in [("day", 14), ("night", 22)]:
    grid_df["hour_of_day"] = hour
    X = grid_df[["area_type", "road_type", "hour_of_day", "dist_police_km", "dist_transit_km"]]
    preds = model.predict(X)
    preds = np.clip(preds, 0, 1)

    matrix = np.zeros((ROWS, COLS))
    for _, r in grid_df.assign(risk=preds).iterrows():
        matrix[int(r.gy), int(r.gx)] = r.risk

    out_path = f"/home/claude/pune_risk_ml/risk_grid_{scenario}.csv"
    pd.DataFrame(matrix).to_csv(out_path, header=False, index=False, float_format="%.4f")
    print(f"{scenario:6s} -> mean risk {matrix.mean():.3f}, max {matrix.max():.3f}, saved to {out_path}")

print("\nSample (night) grid corner:")
print(pd.DataFrame(matrix).iloc[:5, :8].round(2))
