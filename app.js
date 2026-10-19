// Initialize Lucide icons on page load
document.addEventListener("DOMContentLoaded", () => {
    lucide.createIcons();
    initApp();
});

// --- DATA DEFINITIONS (Pune Coordinates & Parameters) ---
const NEIGHBORHOODS = {
    "Kothrud": { lat: 18.5074, lon: 73.8077, type: "residential_commercial" },
    "Karve Nagar": { lat: 18.4870, lon: 73.8194, type: "residential" },
    "Erandwane": { lat: 18.5057, lon: 73.8298, type: "educational" },
    "Deccan Gymkhana": { lat: 18.5158, lon: 73.8412, type: "commercial" },
    "Shivajinagar": { lat: 18.5304, lon: 73.8446, type: "commercial" },
    "FC Road": { lat: 18.5246, lon: 73.8412, type: "commercial" },
    "Camp": { lat: 18.5126, lon: 73.8784, type: "market" },
    "Swargate": { lat: 18.5018, lon: 73.8580, type: "transit_hub" },
    "Aundh": { lat: 18.5642, lon: 73.8077, type: "residential" },
    "Baner": { lat: 18.5590, lon: 73.7868, type: "residential_commercial" },
    "Hinjewadi": { lat: 18.5912, lon: 73.7389, type: "it_park" },
    "Hadapsar": { lat: 18.5089, lon: 73.9260, type: "it_park" },
    "Yerawada": { lat: 18.5580, lon: 73.8800, type: "industrial_residential" },
    "Koregaon Park": { lat: 18.5362, lon: 73.8939, type: "upscale_nightlife" },
    "Wanowrie": { lat: 18.4961, lon: 73.8961, type: "residential" }
};

const POLICE_STATIONS = [
    { lat: 18.5074, lon: 73.8077, name: "Kothrud PS" },
    { lat: 18.5158, lon: 73.8412, name: "Deccan Gymkhana PS" },
    { lat: 18.5304, lon: 73.8446, name: "Shivajinagar PS" },
    { lat: 18.5018, lon: 73.8580, name: "Swargate PS" },
    { lat: 18.5126, lon: 73.8784, name: "Camp PS" },
    { lat: 18.5089, lon: 73.9260, name: "Hadapsar PS" },
    { lat: 18.5580, lon: 73.8800, name: "Yerawada PS" },
    { lat: 18.5390, lon: 73.8230, name: "Chatushrungi PS" },
    { lat: 18.4961, lon: 73.8961, name: "Wanowrie PS" },
    { lat: 18.5912, lon: 73.7389, name: "Hinjewadi PS" }
];

const TRANSIT_HUBS = [
    { lat: 18.5286, lon: 73.8746, name: "Pune Railway Station" },
    { lat: 18.5018, lon: 73.8580, name: "Swargate Bus Stand" },
    { lat: 18.5304, lon: 73.8446, name: "Shivajinagar Bus Stand" }
];

// Key illuminated arterial corridors & security checkpoints in Pune
const SAFE_CORRIDORS = [
    { name: "Aundh DP Road Illuminated Corridor", lat: 18.5680, lon: 73.8010, type: "arterial" },
    { name: "Pashan-Aundh Link Road", lat: 18.5480, lon: 73.7980, type: "arterial" },
    { name: "Chatushrungi PS & Ganeshkhind Boulevard", lat: 18.5390, lon: 73.8230, type: "police" },
    { name: "University Circle Arterial", lat: 18.5412, lon: 73.8260, type: "arterial" },
    { name: "FC Road / Deccan Commercial", lat: 18.5200, lon: 73.8410, type: "commercial" },
    { name: "Shivajinagar PS & Transit Hub", lat: 18.5304, lon: 73.8446, type: "police" },
    { name: "Kothrud PS / Karve Road Boulevard", lat: 18.5074, lon: 73.8077, type: "police" },
    { name: "Swargate PS & Transport Hub", lat: 18.5018, lon: 73.8580, type: "police" },
    { name: "Pune Station / RTO Boulevard", lat: 18.5286, lon: 73.8746, type: "arterial" },
    { name: "Camp PS / MG Road Commercial", lat: 18.5126, lon: 73.8784, type: "police" },
    { name: "Yerawada PS / Airport Road", lat: 18.5580, lon: 73.8800, type: "police" },
    { name: "Hinjewadi PS / IT Expressway", lat: 18.5912, lon: 73.7389, type: "police" }
];

const AREA_BASE_RISK = {
    "commercial": 0.20,
    "educational": 0.25,
    "residential_commercial": 0.30,
    "transit_hub": 0.30,
    "upscale_nightlife": 0.30,
    "market": 0.35,
    "residential": 0.40,
    "it_park": 0.45,
    "industrial_residential": 0.55
};

const ROAD_RISK = {
    "arterial_main_road": -0.10,
    "market_lane": -0.05,
    "residential_lane": 0.08
};

// Global App State
let map;
let tileLayer;
let heatLayer = null;
let pathLayerGroup;
let startMarker = null;
let endMarker = null;
let startCoords = null;
let endCoords = null;
let currentRouteMode = "shortest";
let activeRouteRequest = 0;

// In-memory cache for raw OSRM road geometry queries
const rawRouteCache = new Map();

// --- HELPER MATH & GEOGRAPHY FUNCTIONS ---

function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function distToNearest(lat, lon, points) {
    let minDist = Infinity;
    for (let p of points) {
        const d = haversineDistance(lat, lon, p.lat, p.lon);
        if (d < minDist) minDist = d;
    }
    return minDist;
}

function getNearestAreaType(lat, lon) {
    let nearestType = "residential";
    let nearestDist = Infinity;
    for (let name in NEIGHBORHOODS) {
        const n = NEIGHBORHOODS[name];
        const d = haversineDistance(lat, lon, n.lat, n.lon);
        if (d < nearestDist) {
            nearestDist = d;
            nearestType = n.type;
        }
    }
    return nearestType;
}

function getNightMultiplier(hour) {
    // Night Peak (10 PM to 4 AM)
    if (hour >= 22 || hour < 5) return 1.60;
    // Dusk / Late Evening (7 PM to 10 PM) or Early Dawn (5 AM to 7 AM)
    if ((hour >= 19 && hour < 22) || (hour >= 5 && hour < 7)) return 1.25;
    // Daytime baseline (7 AM to 7 PM)
    return 1.0;
}

function evaluateRiskScore(lat, lon, hour) {
    const areaType = getNearestAreaType(lat, lon);

    const distTransit = distToNearest(lat, lon, TRANSIT_HUBS);
    let roadType = "residential_lane";
    if (distTransit < 1.0) {
        roadType = "market_lane";
    } else if ((Math.sin(lat * 500) + Math.cos(lon * 500)) > 0.3) {
        roadType = "arterial_main_road";
    }

    const distPolice = distToNearest(lat, lon, POLICE_STATIONS);

    const base = AREA_BASE_RISK[areaType] || 0.3;
    const roadMod = ROAD_RISK[roadType] || 0.08;
    const security = 0.12 * Math.tanh(distPolice / 1.5);
    const transport = 0.08 * Math.tanh(distTransit / 2.0);

    let risk = (base + roadMod + security + transport) * getNightMultiplier(hour);

    const noise = 0.04 * Math.sin(lat * 800) * Math.cos(lon * 800);
    risk += noise;

    return Math.max(0, Math.min(1, risk));
}

function refreshMapSize() {
    if (!map) return;
    map.invalidateSize({ pan: false, reset: true });
    if (tileLayer) {
        tileLayer._resetView();
        tileLayer._update();
    }
}

// --- MAIN APPLICATION INIT ---

function initApp() {
    // 1. Initialize Leaflet Map centered in Pune
    map = L.map("map", {
        zoomControl: true,
        attributionControl: false
    }).setView([18.530, 73.830], 13);

    // Zoom control in bottom right
    map.zoomControl.setPosition('bottomright');

    // OpenStreetMap standard tile layer
    // maxZoom: 20 with maxNativeZoom: 19 prevents any "Map data not yet available" placeholders!
    tileLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 20,
        maxNativeZoom: 19,
        subdomains: ["a", "b", "c"],
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    // Layer group for Route rendering
    pathLayerGroup = L.layerGroup().addTo(map);

    // Refresh dimensions after layout settles
    setTimeout(refreshMapSize, 100);
    setTimeout(refreshMapSize, 400);

    // Populate Neighborhood Dropdowns
    const startSelect = document.getElementById("start-node");
    const endSelect = document.getElementById("end-node");

    const sortedNames = Object.keys(NEIGHBORHOODS).sort();
    sortedNames.forEach(name => {
        const startOpt = document.createElement("option");
        startOpt.value = name;
        startOpt.textContent = name;
        startSelect.appendChild(startOpt);

        const endOpt = document.createElement("option");
        endOpt.value = name;
        endOpt.textContent = name;
        endSelect.appendChild(endOpt);
    });

    // 2. Add Static Infrastructure Markers
    addInfrastructureMarkers();

    // 3. Event Listeners & UI Controls
    setupEventHandlers();

    // 4. Initial Heatmap Check (only renders if checkbox is checked)
    updateHeatmap();
}

function addInfrastructureMarkers() {
    const policeIcon = L.divIcon({
        className: 'custom-div-icon',
        html: `<div style="background-color: #ffffff; border: 2px solid #2563eb; border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; color: #2563eb; box-shadow: 0 2px 6px rgba(37,99,235,0.28);"><svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
    });

    const transitIcon = L.divIcon({
        className: 'custom-div-icon',
        html: `<div style="background-color: #ffffff; border: 2px solid #d97706; border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; color: #d97706; box-shadow: 0 2px 6px rgba(217,119,6,0.28);"><svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"/><path d="M12 18h.01"/><path d="M6 6h12"/><path d="M6 10h12"/><path d="M6 22V18"/><path d="M18 22V18"/></svg></div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
    });

    POLICE_STATIONS.forEach(ps => {
        L.marker([ps.lat, ps.lon], { icon: policeIcon })
            .bindPopup(`<strong style="color:#2563eb; font-size: 0.9rem;">Police Station Nearby</strong><br><span style="color:#475569;">${ps.name}</span>`)
            .addTo(map);
    });

    TRANSIT_HUBS.forEach(hub => {
        L.marker([hub.lat, hub.lon], { icon: transitIcon })
            .bindPopup(`<strong style="color:#d97706; font-size: 0.9rem;">Transit Center Nearby</strong><br><span style="color:#475569;">${hub.name}</span>`)
            .addTo(map);
    });
}

function setupEventHandlers() {
    const timeSlider = document.getElementById("time-of-day");
    const weightSlider = document.getElementById("safety-weight");
    const startSelect = document.getElementById("start-node");
    const endSelect = document.getElementById("end-node");
    const toggleHeatmap = document.getElementById("toggle-heatmap");
    const sidebar = document.getElementById("sidebar");
    const collapseBtn = document.getElementById("sidebar-collapse-btn");
    const expandBtn = document.getElementById("sidebar-expand-btn");
    const clearRouteBtn = document.getElementById("btn-clear-route");

    // Sidebar Collapse / Expand Toggle
    if (collapseBtn) {
        collapseBtn.addEventListener("click", () => {
            sidebar.classList.add("collapsed");
            expandBtn.classList.remove("hidden");
            setTimeout(refreshMapSize, 320);
        });
    }

    if (expandBtn) {
        expandBtn.addEventListener("click", () => {
            sidebar.classList.remove("collapsed");
            expandBtn.classList.add("hidden");
            setTimeout(refreshMapSize, 320);
        });
    }

    // Reset Route Button
    if (clearRouteBtn) {
        clearRouteBtn.addEventListener("click", () => {
            clearRoute();
        });
    }

    // Window Resize Handler
    window.addEventListener("resize", refreshMapSize);

    // Time Slider Event: Instantly recalculates route & heatmap
    timeSlider.addEventListener("input", (e) => {
        const hour = parseInt(e.target.value);
        updateTimeDisplay(hour);
        updateHeatmap();
        if (startCoords && endCoords) {
            calculateAndDrawRoute();
        }
    });

    // Safety Weight Event
    weightSlider.addEventListener("input", (e) => {
        const weight = parseInt(e.target.value);
        updateWeightDisplay(weight);
        if (startCoords && endCoords) {
            calculateAndDrawRoute();
        }
    });

    // Dropdown Selectors
    startSelect.addEventListener("change", (e) => {
        const name = e.target.value;
        if (name && NEIGHBORHOODS[name]) {
            setStartNode(NEIGHBORHOODS[name].lat, NEIGHBORHOODS[name].lon, name);
            map.panTo([NEIGHBORHOODS[name].lat, NEIGHBORHOODS[name].lon]);
        }
    });

    endSelect.addEventListener("change", (e) => {
        const name = e.target.value;
        if (name && NEIGHBORHOODS[name]) {
            setEndNode(NEIGHBORHOODS[name].lat, NEIGHBORHOODS[name].lon, name);
            map.panTo([NEIGHBORHOODS[name].lat, NEIGHBORHOODS[name].lon]);
        }
    });

    // Heatmap Toggle
    toggleHeatmap.addEventListener("change", () => {
        updateHeatmap();
    });

    // Map Click Drawing
    map.on("click", (e) => {
        if (!startCoords) {
            setStartNode(e.latlng.lat, e.latlng.lng, "Custom Origin Point");
        } else if (!endCoords) {
            setEndNode(e.latlng.lat, e.latlng.lng, "Custom Destination Point");
        } else {
            clearRoute();
            setStartNode(e.latlng.lat, e.latlng.lng, "Custom Origin Point");
        }
    });

    // Mode Toggle Buttons
    const btnShortest = document.getElementById("mode-shortest");
    const btnSafest = document.getElementById("mode-safest");

    btnShortest.addEventListener("click", () => {
        currentRouteMode = "shortest";
        btnShortest.classList.add("active");
        btnSafest.classList.remove("active");
        if (startCoords && endCoords) calculateAndDrawRoute();
    });

    btnSafest.addEventListener("click", () => {
        currentRouteMode = "safest";
        btnSafest.classList.add("active");
        btnShortest.classList.remove("active");
        if (startCoords && endCoords) calculateAndDrawRoute();
    });
}

function updateTimeDisplay(hour) {
    const timeDisplay = document.getElementById("time-display");
    let label = "";
    if (hour === 0) label = "12:00 AM (Midnight)";
    else if (hour === 12) label = "12:00 PM (Noon)";
    else if (hour > 12) label = `${hour - 12}:00 PM`;
    else label = `${hour}:00 AM`;

    if (hour >= 22 || hour < 5) {
        timeDisplay.className = "badge night";
        timeDisplay.textContent = `${label} • Night Risk Active`;
    } else if (hour >= 19 && hour < 22) {
        timeDisplay.className = "badge";
        timeDisplay.textContent = `${label} • Evening Dusk`;
    } else {
        timeDisplay.className = "badge";
        timeDisplay.textContent = `${label} • Daylight`;
    }
}

function updateWeightDisplay(weight) {
    const weightDisplay = document.getElementById("weight-display");
    if (weight === 0) {
        weightDisplay.textContent = "Shortest Distance Only";
        weightDisplay.className = "badge";
    } else if (weight <= 3) {
        weightDisplay.textContent = "Low Safety Bias";
        weightDisplay.className = "badge badge-green";
    } else if (weight <= 7) {
        weightDisplay.textContent = "Balanced Safety";
        weightDisplay.className = "badge badge-green";
    } else {
        weightDisplay.textContent = "Maximum Safety";
        weightDisplay.className = "badge badge-green";
    }
}

// --- SMOOTH THERMAL HEATMAP GENERATOR ---

function updateHeatmap() {
    if (heatLayer) {
        map.removeLayer(heatLayer);
        heatLayer = null;
    }

    const toggleHeatmap = document.getElementById("toggle-heatmap");
    const legend = document.getElementById("heatmap-legend");
    const isChecked = toggleHeatmap && toggleHeatmap.checked;

    if (legend) {
        legend.style.display = isChecked ? "flex" : "none";
    }

    if (!isChecked) return;

    const hour = parseInt(document.getElementById("time-of-day").value);

    // Sample points across Pune corridor
    const points = [];
    const latMin = 18.475, latMax = 18.575;
    const lonMin = 73.740, lonMax = 73.910;
    const stepsX = 26;
    const stepsY = 22;

    for (let y = 0; y <= stepsY; y++) {
        for (let x = 0; x <= stepsX; x++) {
            const lat = latMin + (y / stepsY) * (latMax - latMin);
            const lon = lonMin + (x / stepsX) * (lonMax - lonMin);
            const risk = evaluateRiskScore(lat, lon, hour);

            if (risk > 0.22) {
                points.push([lat, lon, Math.pow(risk, 1.3) * 0.9]);
            }
        }
    }

    if (typeof L.heatLayer === "function") {
        heatLayer = L.heatLayer(points, {
            radius: 36,
            blur: 24,
            maxZoom: 16,
            max: 0.9,
            gradient: {
                0.2: '#10b981',
                0.45: '#3b82f6',
                0.65: '#f59e0b',
                0.85: '#ef4444',
                1.0: '#991b1b'
            }
        }).addTo(map);
    }
}

// --- START & END POINT MARKERS ---

function setStartNode(lat, lon, label) {
    if (startMarker) map.removeLayer(startMarker);

    const startPin = L.divIcon({
        className: 'custom-map-pin',
        html: `<div class="pin-marker pin-start" title="Start: ${label}"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg></div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
        popupAnchor: [0, -18]
    });

    startMarker = L.marker([lat, lon], { icon: startPin, draggable: true })
        .bindPopup(`<strong style="color:#059669; font-size: 0.9rem;">Start Location</strong><br><span style="color:#0f172a; font-weight:600;">${label}</span>`)
        .addTo(map);

    startCoords = { lat, lon };
    const nearestName = findNearestNeighborhoodName(lat, lon);
    document.getElementById("start-node").value = nearestName;

    if (endCoords) calculateAndDrawRoute();

    startMarker.on("dragend", (e) => {
        const newLat = e.target.getLatLng().lat;
        const newLon = e.target.getLatLng().lng;
        startCoords = { lat: newLat, lon: newLon };
        document.getElementById("start-node").value = findNearestNeighborhoodName(newLat, newLon);
        calculateAndDrawRoute();
    });
}

function setEndNode(lat, lon, label) {
    if (endMarker) map.removeLayer(endMarker);

    const endPin = L.divIcon({
        className: 'custom-map-pin',
        html: `<div class="pin-marker pin-end" title="Destination: ${label}"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg></div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
        popupAnchor: [0, -18]
    });

    endMarker = L.marker([lat, lon], { icon: endPin, draggable: true })
        .bindPopup(`<strong style="color:#dc2626; font-size: 0.9rem;">Destination</strong><br><span style="color:#0f172a; font-weight:600;">${label}</span>`)
        .addTo(map);

    endCoords = { lat, lon };
    const nearestName = findNearestNeighborhoodName(lat, lon);
    document.getElementById("end-node").value = nearestName;

    calculateAndDrawRoute();

    endMarker.on("dragend", (e) => {
        const newLat = e.target.getLatLng().lat;
        const newLon = e.target.getLatLng().lng;
        endCoords = { lat: newLat, lon: newLon };
        document.getElementById("end-node").value = findNearestNeighborhoodName(newLat, newLon);
        calculateAndDrawRoute();
    });
}

function findNearestNeighborhoodName(lat, lon) {
    let nearest = "";
    let nearestDist = Infinity;
    for (let name in NEIGHBORHOODS) {
        const n = NEIGHBORHOODS[name];
        const d = haversineDistance(lat, lon, n.lat, n.lon);
        if (d < nearestDist) {
            nearestDist = d;
            nearest = name;
        }
    }
    return nearestDist < 4.0 ? nearest : "";
}

function clearRoute() {
    pathLayerGroup.clearLayers();
    startCoords = null;
    endCoords = null;
    if (startMarker) {
        map.removeLayer(startMarker);
        startMarker = null;
    }
    if (endMarker) {
        map.removeLayer(endMarker);
        endMarker = null;
    }
    document.getElementById("start-node").value = "";
    document.getElementById("end-node").value = "";

    // Clear Stats Card
    document.getElementById("metric-distance").textContent = "-- km";
    const riskLabel = document.getElementById("metric-risk");
    riskLabel.textContent = "--";
    riskLabel.style.color = "var(--text-primary)";
    document.getElementById("metric-safety-index").textContent = "-- % Safe";
    document.getElementById("safety-progress").style.width = "0%";
    document.getElementById("metric-avoided").textContent = "--";
    document.getElementById("metric-police").textContent = "--";
}

// --- REAL ROAD NAVIGATION ENGINE (OSRM API + AI RISK OPTIMIZATION) ---

function evaluatePathSafety(coords, hour) {
    if (!coords || coords.length === 0) return { avgRisk: 0.3, highRiskCount: 0, policeCount: 0 };

    let sumRisk = 0;
    let highRiskCount = 0;
    const step = Math.max(1, Math.floor(coords.length / 45));
    let sampleCount = 0;

    for (let i = 0; i < coords.length; i += step) {
        const pt = coords[i];
        const risk = evaluateRiskScore(pt[0], pt[1], hour);
        sumRisk += risk;
        // Night risk threshold: segments above 0.50 are considered high risk
        if (risk > 0.50) highRiskCount++;
        sampleCount++;
    }

    const avgRisk = sumRisk / (sampleCount || 1);

    let policeCount = 0;
    for (let ps of POLICE_STATIONS) {
        for (let i = 0; i < coords.length; i += step) {
            if (haversineDistance(coords[i][0], coords[i][1], ps.lat, ps.lon) < 1.3) {
                policeCount++;
                break;
            }
        }
    }

    return { avgRisk, highRiskCount, policeCount };
}

// Helper to query OSRM geometry with caching
async function fetchOsrmGeometry(coordsList) {
    const coordString = coordsList.map(pt => `${pt[1].toFixed(5)},${pt[0].toFixed(5)}`).join(';');
    if (rawRouteCache.has(coordString)) {
        return rawRouteCache.get(coordString);
    }

    try {
        const url = `https://router.project-osrm.org/route/v1/driving/${coordString}?overview=full&geometries=geojson&alternatives=true`;
        const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (!res.ok) return null;
        const data = await res.json();
        if (data && data.routes && data.routes.length > 0) {
            rawRouteCache.set(coordString, data.routes);
            return data.routes;
        }
    } catch (e) {
        console.warn("OSRM query failed:", e);
    }
    return null;
}

// Finds candidate illuminated arterial road corridors and police checkpoints between start and end
function getCandidateCorridors(start, end) {
    const directDist = haversineDistance(start.lat, start.lon, end.lat, end.lon);
    const candidates = [];

    for (let c of SAFE_CORRIDORS) {
        const dStart = haversineDistance(start.lat, start.lon, c.lat, c.lon);
        const dEnd = haversineDistance(c.lat, c.lon, end.lat, end.lon);
        const totalDetour = dStart + dEnd;

        // Ensure waypoint isn't start/end itself and detour distance is physically reasonable
        if (dStart > 0.35 && dEnd > 0.35 && totalDetour <= (directDist * 1.85 + 2.0)) {
            candidates.push({
                corridor: c,
                detourDist: totalDetour,
                proximityToMid: Math.abs(dStart - dEnd)
            });
        }
    }

    // Sort by most natural detour and take the top 3 best corridors
    candidates.sort((a, b) => a.detourDist - b.detourDist);
    return candidates.slice(0, 3).map(c => c.corridor);
}

// Cost function that dynamically balances distance vs. time-of-day safety risk
function calculateRouteCost(cand, hour, safetyWeight, isSafeMode) {
    if (!isSafeMode) {
        // Shortest Mode: solely minimize actual road distance
        return cand.distance;
    }

    const isNight = (hour >= 21 || hour < 6);
    const isDusk = ((hour >= 18 && hour < 21) || (hour >= 6 && hour < 8));
    const timeMultiplier = isNight ? 1.70 : (isDusk ? 1.25 : 1.0);
    const safetyFactor = Math.max(0.1, safetyWeight / 5.0); // 0 to 2.0 (1.0 at Medium)

    let cost = cand.distance;

    if (isNight) {
        // At night, unlit residential shortcuts / dark river cuts receive heavy penalties
        const unlitPenalty = (cand.highRiskCount * 0.95 * safetyFactor);
        const policeBonus = cand.policeCount * 0.70;
        const arterialBonus = cand.isArterial ? 1.5 : 0.0;
        cost += (cand.avgRisk * 9.0 * timeMultiplier * safetyFactor) + unlitPenalty - policeBonus - arterialBonus;
    } else if (isDusk) {
        // Evening / Dusk
        const policeBonus = cand.policeCount * 0.35;
        cost += (cand.avgRisk * 4.8 * timeMultiplier * safetyFactor) - policeBonus;
    } else {
        // Daytime: distance dominates, mild risk penalty
        cost += (cand.avgRisk * 2.4 * safetyFactor);
    }

    return cost;
}

async function fetchRealRoadRoute(start, end, safeMode = false, safetyWeight = 5, hour = 12) {
    try {
        const candidateRoutes = [];

        // 1. Fetch direct routes from OSRM
        const directRoutes = await fetchOsrmGeometry([[start.lat, start.lon], [end.lat, end.lon]]);
        if (directRoutes && directRoutes.length > 0) {
            for (let r of directRoutes) {
                const coords = r.geometry.coordinates.map(pt => [pt[1], pt[0]]);
                const distanceKm = r.distance / 1000;
                const evalResult = evaluatePathSafety(coords, hour);
                candidateRoutes.push({
                    coords,
                    distance: distanceKm,
                    avgRisk: evalResult.avgRisk,
                    highRiskCount: evalResult.highRiskCount,
                    policeCount: evalResult.policeCount,
                    isArterial: false,
                    label: "Direct Road Route"
                });
            }
        }

        // 2. Fetch candidate arterial corridors & police checkpoint routes
        const corridors = getCandidateCorridors(start, end);
        for (let c of corridors) {
            const viaRoutes = await fetchOsrmGeometry([[start.lat, start.lon], [c.lat, c.lon], [end.lat, end.lon]]);
            if (viaRoutes && viaRoutes.length > 0) {
                const r = viaRoutes[0];
                const coords = r.geometry.coordinates.map(pt => [pt[1], pt[0]]);
                const distanceKm = r.distance / 1000;
                const evalResult = evaluatePathSafety(coords, hour);
                candidateRoutes.push({
                    coords,
                    distance: distanceKm,
                    avgRisk: evalResult.avgRisk,
                    highRiskCount: evalResult.highRiskCount,
                    policeCount: evalResult.policeCount,
                    isArterial: true,
                    label: `Via ${c.name}`
                });
            }
        }

        if (candidateRoutes.length === 0) {
            throw new Error("No road routes found");
        }

        // 3. Score candidate routes with the time-of-day calibrated cost formula
        let bestRoute = candidateRoutes[0];
        let lowestCost = Infinity;

        for (let cand of candidateRoutes) {
            const cost = calculateRouteCost(cand, hour, safetyWeight, safeMode);
            if (cost < lowestCost) {
                lowestCost = cost;
                bestRoute = cand;
            }
        }

        return bestRoute;

    } catch (err) {
        console.warn("OSRM routing API unavailable, falling back to road network:", err);
        return getFallbackRoadRoute(start, end, safeMode, safetyWeight, hour);
    }
}

// Fallback Pune road network geometry (used only if OSRM is offline)
function getFallbackRoadRoute(start, end, safeMode, safetyWeight, hour) {
    const path = [];
    const steps = 30;
    
    // Check if crossing Mula river between Baner/Aundh
    const crossesRiver = (start.lon < 73.800 && end.lon > 73.800) || (start.lon > 73.800 && end.lon < 73.800);
    const bridgePt = [18.5637, 73.7966]; // Mahadji Shinde Bridge coordinates

    if (crossesRiver) {
        for (let i = 0; i <= 15; i++) {
            const t = i / 15;
            path.push([start.lat + t * (bridgePt[0] - start.lat), start.lon + t * (bridgePt[1] - start.lon)]);
        }
        for (let i = 1; i <= 15; i++) {
            const t = i / 15;
            path.push([bridgePt[0] + t * (end.lat - bridgePt[0]), bridgePt[1] + t * (end.lon - bridgePt[1])]);
        }
    } else {
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            path.push([start.lat + t * (end.lat - start.lat), start.lon + t * (end.lon - start.lon)]);
        }
    }

    let dist = 0;
    for (let i = 1; i < path.length; i++) {
        dist += haversineDistance(path[i-1][0], path[i-1][1], path[i][0], path[i][1]);
    }
    const evalRes = evaluatePathSafety(path, hour);

    return {
        coords: path,
        distance: dist,
        avgRisk: evalRes.avgRisk,
        highRiskCount: evalRes.highRiskCount,
        policeCount: evalRes.policeCount,
        label: "Road Route"
    };
}

// --- CALCULATE AND DRAW ROUTE ---

async function calculateAndDrawRoute() {
    if (!startCoords || !endCoords) return;

    pathLayerGroup.clearLayers();

    const hour = parseInt(document.getElementById("time-of-day").value);
    const safetyWeight = parseFloat(document.getElementById("safety-weight").value);
    const isSafeMode = (currentRouteMode === "safest");

    const requestId = ++activeRouteRequest;

    const distElement = document.getElementById("metric-distance");
    distElement.textContent = "Routing...";

    const routeData = await fetchRealRoadRoute(startCoords, endCoords, isSafeMode, safetyWeight, hour);

    if (requestId !== activeRouteRequest) return;

    if (!routeData || !routeData.coords || routeData.coords.length < 2) {
        distElement.textContent = "-- km";
        console.error("No valid road route found!");
        return;
    }

    const path = routeData.coords;
    const primaryColor = isSafeMode ? "#059669" : "#2563eb";

    // Soft glow halo
    const lineGlow = L.polyline(path, {
        color: primaryColor,
        weight: 12,
        opacity: 0.22,
        lineCap: "round",
        lineJoin: "round"
    });

    // Solid road route
    const lineMain = L.polyline(path, {
        color: primaryColor,
        weight: 5.5,
        opacity: 0.95,
        lineCap: "round",
        lineJoin: "round",
        dashArray: isSafeMode ? null : "8, 10"
    });

    pathLayerGroup.addLayer(lineGlow);
    pathLayerGroup.addLayer(lineMain);

    // Fit map bounds to show route nicely with padding
    map.fitBounds(lineMain.getBounds(), { padding: [65, 65], maxZoom: 16 });

    // Update Sidebar Analytics
    updateMetrics(path, routeData.distance, routeData.avgRisk, routeData.highRiskCount, routeData.policeCount, routeData.label, hour);
}

function updateMetrics(path, distanceKm, avgRisk, highRiskCount, nearbyPolice, routeLabel, hour) {
    const safetyIndex = Math.max(10, Math.min(99, Math.round((1.0 - avgRisk) * 100)));

    document.getElementById("metric-distance").textContent = `${distanceKm.toFixed(2)} km`;

    let riskRating = "Medium Risk";
    let riskColor = "var(--accent-amber)";
    if (avgRisk < 0.32) {
        riskRating = "Low Risk";
        riskColor = "var(--accent-green)";
    } else if (avgRisk > 0.50) {
        riskRating = "High Risk";
        riskColor = "var(--accent-red)";
    }

    const riskLabel = document.getElementById("metric-risk");
    riskLabel.textContent = riskRating;
    riskLabel.style.color = riskColor;

    document.getElementById("metric-safety-index").textContent = `${safetyIndex}% Safe`;
    const progress = document.getElementById("safety-progress");
    progress.style.width = `${safetyIndex}%`;

    if (safetyIndex >= 70) {
        progress.style.background = "var(--accent-green)";
    } else if (safetyIndex >= 45) {
        progress.style.background = "var(--accent-amber)";
    } else {
        progress.style.background = "var(--accent-red)";
    }

    const isNight = (hour >= 21 || hour < 6);
    let avoidedText = "";
    if (isNight) {
        avoidedText = highRiskCount > 0 ? `${highRiskCount} dark zones bypassed` : "0 (Lit Arterial Corridor)";
    } else {
        avoidedText = highRiskCount > 0 ? `${highRiskCount} risk zones mitigated` : "0 (Clear Daytime Path)";
    }

    document.getElementById("metric-avoided").textContent = avoidedText;
    document.getElementById("metric-police").textContent = `${nearbyPolice} active stations`;
}
