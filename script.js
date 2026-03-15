// London Ontario Traffic Map
// Uses Leaflet.js with GeoJSON data

// London Ontario bounds (approximately)
const LONDON_BOUNDS = [
    [43.05, -81.32],  // Northeast
    [42.98, -81.18]   // Southwest
];

// Traffic color scale
function getTrafficColor(volume) {
    if (volume >= 15000) return '#ef4444';  // Red - High
    if (volume >= 5000) return '#facc15';    // Yellow - Medium
    return '#22c55e';                         // Green - Low
}

// Traffic weight (line thickness)
function getTrafficWeight(volume) {
    if (volume >= 15000) return 6;
    if (volume >= 5000) return 4;
    return 2;
}

// Style function for GeoJSON layer
function style(feature) {
    const volume = feature.properties?.traffic_volume || feature.properties?.avg_daily_traffic || 0;
    return {
        color: getTrafficColor(volume),
        weight: getTrafficWeight(volume),
        opacity: 0.85,
        lineCap: 'round'
    };
}

// Highlight on hover
function highlightFeature(e) {
    const layer = e.target;
    layer.setStyle({
        weight: 8,
        opacity: 1
    });
    layer.bringToFront();
}

// Reset highlight
function resetHighlight(e) {
    geojsonLayer.resetStyle(e.target);
}

// Click handler for popup
function onEachFeature(feature, layer) {
    const streetName = feature.properties?.street_name || feature.properties?.name || 'Unknown Street';
    const volume = feature.properties?.traffic_volume || feature.properties?.avg_daily_traffic || 0;
    
    const popupContent = `
        <div class="popup-street">${streetName}</div>
        <div class="popup-traffic">Daily Traffic: <strong>${volume.toLocaleString()}</strong></div>
    `;
    
    layer.bindPopup(popupContent);
    
    layer.on({
        mouseover: highlightFeature,
        mouseout: resetHighlight
    });
}

// Initialize map
const map = L.map('map', {
    center: [43.015, -81.25],
    zoom: 12,
    minZoom: 11,
    maxZoom: 16,
    maxBounds: LONDON_BOUNDS,
    maxBoundsViscosity: 1.0
});

// Add tile layer (OpenStreetMap)
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

// Add dark map alternative (CartoDB Positron)
const darkTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19
});

// Variable to hold GeoJSON layer
let geojsonLayer = null;

// Filter function
function filterTraffic(level) {
    if (!geojsonLayer) return;
    
    geojsonLayer.eachLayer(function(layer) {
        const volume = layer.feature.properties?.traffic_volume || layer.feature.properties?.avg_daily_traffic || 0;
        let show = true;
        
        if (level === 'low') show = volume < 5000;
        else if (level === 'medium') show = volume >= 5000 && volume < 15000;
        else if (level === 'high') show = volume >= 15000;
        
        if (show) {
            layer.setStyle({ opacity: 0.85, weight: getTrafficWeight(volume) });
        } else {
            layer.setStyle({ opacity: 0, weight: 0 });
        }
    });
}

// Load GeoJSON data
async function loadTrafficData() {
    try {
        const response = await fetch('data/traffic.json');
        const data = await response.json();
        
        geojsonLayer = L.geoJSON(data, {
            style: style,
            onEachFeature: onEachFeature
        }).addTo(map);
        
        // Fit bounds to data
        if (data.features && data.features.length > 0) {
            // map.fitBounds(geojsonLayer.getBounds());
        }
        
        console.log('Loaded', data.features?.length || 0, 'street segments');
        
    } catch (error) {
        console.error('Error loading traffic data:', error);
        
        // If no data file, generate mock data for demo
        console.log('Using demo mode with mock data');
        addMockData();
    }
}

// Generate mock data for demonstration
function addMockData() {
    // Mock street data around London Ontario
    const mockStreets = [
        { name: 'Wellington Road', coords: [[43.015, -81.32], [43.015, -81.28], [43.015, -81.24], [43.015, -81.20]], volume: 25000 },
        { name: 'Commissioners Road', coords: [[43.00, -81.32], [43.00, -81.25], [43.00, -81.18]], volume: 18000 },
        { name: 'Oxford Street', coords: [[43.02, -81.30], [43.02, -81.25], [43.02, -81.20]], volume: 15000 },
        { name: 'Richmond Street', coords: [[43.03, -81.28], [43.01, -81.28], [42.99, -81.28]], volume: 12000 },
        { name: 'King Street', coords: [[43.025, -81.30], [43.025, -81.25], [43.025, -81.20]], volume: 10000 },
        { name: 'Dundas Street', coords: [[43.02, -81.32], [43.02, -81.27], [43.02, -81.22]], volume: 8500 },
        { name: 'Adelaide Street', coords: [[43.028, -81.28], [43.01, -81.28], [42.99, -81.28]], volume: 7000 },
        { name: 'Queens Avenue', coords: [[43.03, -81.26], [43.01, -81.26], [42.99, -81.26]], volume: 5000 },
        { name: 'Pall Mall Street', coords: [[43.018, -81.30], [43.018, -81.25], [43.018, -81.20]], volume: 4000 },
        { name: 'Kensington Avenue', coords: [[43.012, -81.28], [43.008, -81.28], [43.004, -81.28]], volume: 3000 },
        { name: 'Riverside Drive', coords: [[43.035, -81.25], [43.025, -81.22], [43.015, -81.20]], volume: 2500 },
        { name: 'Sunningdale Road', coords: [[43.04, -81.30], [43.04, -81.25], [43.04, -81.20]], volume: 2000 },
    ];
    
    const features = mockStreets.map(street => ({
        type: 'Feature',
        properties: {
            street_name: street.name,
            traffic_volume: street.volume
        },
        geometry: {
            type: 'LineString',
            coordinates: street.coords.map(c => [c[1], c[0]])
        }
    }));
    
    const geojsonData = {
        type: 'FeatureCollection',
        features: features
    };
    
    geojsonLayer = L.geoJSON(geojsonData, {
        style: style,
        onEachFeature: onEachFeature
    }).addTo(map);
    
    map.fitBounds(geojsonLayer.getBounds());
}

// Event listeners
document.getElementById('traffic-filter').addEventListener('change', (e) => {
    filterTraffic(e.target.value);
});

document.getElementById('reset-view').addEventListener('click', () => {
    map.setView([43.015, -81.25], 12);
});

// Initialize
loadTrafficData();

// Add scale control
L.control.scale({
    imperial: true,
    metric: true
}).addTo(map);
