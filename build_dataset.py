"""
Pune Route-Risk Dataset Builder
---------------------------------
Ground truth, granular (point-level) crime/incident data is NOT publicly
available for Indian cities (NCRB only publishes city/district-level yearly
aggregates - verified). The most credible public methodology for street-level
urban safety in India is Safetipin's 8-parameter Safety Audit framework
(Lighting, Openness, Visibility, Security/Policing, People, Public Transport,
Gender Usage, Walkpath) - Safetipin actually audited Pune in 2019 (6,632
audit points, 650km of road covered, published as area-level averages).

This script builds a feature-engineered dataset for real Pune neighborhoods
and constructs risk labels using a documented, weighted version of that
8-parameter framework. Coordinates for neighborhoods/police stations are
approximate (area-level), not survey-precise. Gaussian noise is added to
labels to simulate real-world subjectivity/measurement variance, so the
learning task is non-trivial.
"""

import numpy as np
import pandas as pd
from math import radians, sin, cos, sqrt, atan2

rng = np.random.default_rng(42)

# ---------------------------------------------------------------
# 1. REAL PUNE GEOGRAPHY (approximate area-center coordinates)
# ---------------------------------------------------------------
NEIGHBORHOODS = {
    # name:            (lat,     lon,     area_type)
    "Kothrud":         (18.5074, 73.8077, "residential_commercial"),
    "Karve Nagar":     (18.4870, 73.8194, "residential"),
    "Erandwane":       (18.5057, 73.8298, "educational"),
    "Deccan Gymkhana": (18.5158, 73.8412, "commercial"),
    "Shivajinagar":    (18.5304, 73.8446, "commercial"),
    "FC Road":         (18.5246, 73.8412, "commercial"),
    "Camp":            (18.5126, 73.8784, "market"),
    "Swargate":        (18.5018, 73.8580, "transit_hub"),
    "Aundh":           (18.5642, 73.8077, "residential"),
    "Baner":           (18.5590, 73.7868, "residential_commercial"),
    "Hinjewadi":       (18.5912, 73.7389, "it_park"),
    "Hadapsar":        (18.5089, 73.9260, "it_park"),
    "Yerawada":        (18.5580, 73.8800, "industrial_residential"),
    "Koregaon Park":   (18.5362, 73.8939, "upscale_nightlife"),
    "Wanowrie":        (18.4961, 73.8961, "residential"),
}

# Known police station locations (approx, named after the area they serve)
POLICE_STATIONS = [
    (18.5074, 73.8077),  # Kothrud PS
    (18.5158, 73.8412),  # Deccan Gymkhana PS
    (18.5304, 73.8446),  # Shivajinagar PS
    (18.5018, 73.8580),  # Swargate PS
    (18.5126, 73.8784),  # Camp PS
    (18.5089, 73.9260),  # Hadapsar PS
    (18.5580, 73.8800),  # Yerawada PS
    (18.5390, 73.8230),  # Chatushrungi PS
    (18.4961, 73.8961),  # Wanowrie PS
    (18.5912, 73.7389),  # Hinjewadi PS
]

# Major transit hubs (railway station, bus stands)
TRANSIT_HUBS = [
    (18.5286, 73.8746),  # Pune Railway Station
    (18.5018, 73.8580),  # Swargate bus stand
    (18.5304, 73.8446),  # Shivajinagar bus stand
]

ROAD_TYPES = ["arterial_main_road", "residential_lane", "market_lane"]


def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    p1, p2 = radians(lat1), radians(lat2)
    dphi = radians(lat2 - lat1)
    dlambda = radians(lon2 - lon1)
    a = sin(dphi / 2) ** 2 + cos(p1) * cos(p2) * sin(dlambda / 2) ** 2
    return 2 * R * atan2(sqrt(a), sqrt(1 - a))


def dist_to_nearest(lat, lon, points):
    return min(haversine_km(lat, lon, p[0], p[1]) for p in points)


# ---------------------------------------------------------------
# 2. GENERATE POINTS (scattered streets within each neighborhood)
# ---------------------------------------------------------------
N_PER_NEIGHBORHOOD = 60
rows = []

for name, (lat0, lon0, area_type) in NEIGHBORHOODS.items():
    for _ in range(N_PER_NEIGHBORHOOD):
        # scatter within roughly a 1.2km radius of the neighborhood center
        jitter_lat = rng.normal(0, 0.006)
        jitter_lon = rng.normal(0, 0.006)
        lat, lon = lat0 + jitter_lat, lon0 + jitter_lon

        road_type = rng.choice(
            ROAD_TYPES,
            p=[0.45, 0.40, 0.15] if area_type != "market" else [0.20, 0.20, 0.60],
        )
        hour = int(rng.integers(0, 24))

        dist_police = dist_to_nearest(lat, lon, POLICE_STATIONS)
        dist_transit = dist_to_nearest(lat, lon, TRANSIT_HUBS)

        rows.append(
            {
                "neighborhood": name,
                "lat": lat,
                "lon": lon,
                "area_type": area_type,
                "road_type": road_type,
                "hour_of_day": hour,
                "dist_police_km": round(dist_police, 3),
                "dist_transit_km": round(dist_transit, 3),
            }
        )

df = pd.DataFrame(rows)

# ---------------------------------------------------------------
# 3. CONSTRUCT RISK LABEL (Safetipin 8-parameter-inspired, weighted)
#    Mapped onto our available proxies:
#      Security      <- proximity to police
#      Transport     <- proximity to transit
#      Lighting      <- road_type + area_type, worse at night
#      Openness/Vis  <- area_type (crowd/eyes-on-street), worse at night
#      People        <- area_type footfall, worse at night for residential
#    Final score normalized 0 (safest) - 1 (riskiest)
# ---------------------------------------------------------------
AREA_BASE_RISK = {
    "commercial": 0.20,
    "educational": 0.25,
    "residential_commercial": 0.30,
    "transit_hub": 0.30,
    "upscale_nightlife": 0.30,
    "market": 0.35,
    "residential": 0.40,
    "it_park": 0.45,            # empty after office hours
    "industrial_residential": 0.55,
}

ROAD_RISK = {
    "arterial_main_road": -0.10,   # well lit, more eyes
    "market_lane": -0.05,          # crowded but narrow
    "residential_lane": 0.08,      # quieter, less consistently lit
}


def night_multiplier(hour):
    if 22 <= hour or hour < 5:
        return 1.45
    elif 19 <= hour < 22 or 5 <= hour < 7:
        return 1.15
    else:
        return 1.0


def compute_risk(row):
    base = AREA_BASE_RISK[row.area_type]
    base += ROAD_RISK[row.road_type]
    security = 0.12 * np.tanh(row.dist_police_km / 1.5)       # farther = riskier
    transport = 0.08 * np.tanh(row.dist_transit_km / 2.0)     # farther = riskier
    risk = (base + security + transport) * night_multiplier(row.hour_of_day)
    return risk


df["risk_raw"] = df.apply(compute_risk, axis=1)
# add measurement/subjective noise
df["risk_raw"] += rng.normal(0, 0.06, size=len(df))
# normalize to 0-1
df["risk_score"] = (df["risk_raw"] - df["risk_raw"].min()) / (
    df["risk_raw"].max() - df["risk_raw"].min()
)
df = df.drop(columns=["risk_raw"])

df.to_csv("/home/claude/pune_risk_ml/pune_risk_dataset.csv", index=False)
print(f"Generated {len(df)} rows across {df.neighborhood.nunique()} real Pune neighborhoods")
print(df.head(8).to_string())
print("\nRisk score distribution:")
print(df["risk_score"].describe())
