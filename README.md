# London Ontario Traffic Map

An interactive map showing daily traffic volumes by street in London, Ontario.

## 🚗 Live Demo

Visit: https://jquijano.github.io/london-on-traffic-map/

## Features

- 🗺️ Interactive map centered on London, Ontario
- 🎨 Color-coded streets by traffic volume (green → yellow → red)
- 🔍 Filter by traffic level (low/medium/high)
- 🖱️ Hover to highlight streets
- 📍 Click for details (street name + traffic count)
- 📱 Mobile responsive

## Tech Stack

- **Leaflet.js** - Open-source mapping library
- **OpenStreetMap** - Map tiles
- **GeoJSON** - Traffic data format
- **GitHub Pages** - Free hosting

## Data Source

Traffic volume data from [City of London Open Data](https://opendata.london.ca/)

## Development

```bash
# Clone the repo
git clone https://github.com/jquijano/london-on-traffic-map.git
cd london-on-traffic-map

# Open in browser (or use a local server)
# For local development, use a simple server:
python -m http.server 8000
# Then visit http://localhost:8000
```

## Getting Real Data

1. Visit [City of London Open Data](https://opendata.london.ca/)
2. Search for "Traffic Volumes"
3. Export as GeoJSON
4. Place in `/data/traffic.json`

## License

MIT
