# London Traffic Map

An interactive map of **annual average daily traffic (AADT)** on road segments in
London, Ontario. Search for a street, filter by volume or road type, and compare the
busiest corridors in the city.

**Live:** https://jorgequijano.github.io/london-on-traffic-map/

## What it does

- **Real City data** — all ~1,970 mapped road segments from the City of London's
  open data *Traffic Volumes* layer, not mock data.
- **Volume-coloured roads** — five traffic classes with line thickness scaled to
  AADT, plus a click-through popup for road type, truck route, segment length and
  data year.
- **Street search** — jump to any of the 425 named streets and see the whole
  corridor highlighted.
- **Filters** — traffic level, road type, and truck routes only. The legend is
  clickable and doubles as a filter.
- **Rankings** — the busiest streets by length-weighted average AADT or by total
  daily vehicle-kilometres.
- **Network summary** — streets, segments and daily vehicle-km for the current
  filtered view.
- **Light/dark map themes** and a mobile-friendly slide-in panel.

## Data

The City publishes [Traffic Volumes](https://opendata.london.ca/datasets/6e425a70e4e24d2ab47e099c4720a80c_21/about)
through an ArcGIS service. Each feature is a road segment with a `VolumeCount`
representing **annual average daily traffic** — the average number of vehicles
passing a point each day over a full year.

AADT is **not live traffic**. The City maintains the layer roughly once per year;
the current snapshot's source records were last edited on **2023-10-04**. The app
shows both the City data vintage and the date the snapshot was refreshed.

The City's ArcGIS server does not send CORS headers, so the browser cannot query
it directly. Instead, `scripts/fetch-data.mjs` downloads, validates and normalises
the layer into `data/traffic.geojson` and `data/metadata.json`. The GitHub Actions
workflow refreshes that snapshot monthly and deploys it, with the committed files
as a fallback if the City service is unavailable.

### Data notes

- Street rankings use a **length-weighted average** so one short segment cannot
  make an entire street look like a highway.
- Two of the City's 1,973 records were dropped by validation: `Webster St` had an
  invalid geometry and `Bradley Ave W` had a zero-length segment. The app uses the
  remaining 1,971 segments.
- A handful of short source segments contain apparent anomalies (for example, one
  Cheapside St segment reports 110,000 AADT while the rest of the street is around
  10,500). Values are displayed as published; the length-weighted ranking keeps
  these from dominating street-level comparisons.

## Development

Requires Node.js 18+ and a modern browser.

```bash
git clone https://github.com/JorgeQuijano/london-on-traffic-map.git
cd london-on-traffic-map

npm run dev        # static server at http://127.0.0.1:8000
npm test           # unit + data integrity tests
npm run fetch-data # refresh data/traffic.geojson and data/metadata.json
```

`npm run dev` is a zero-dependency static server. There is no build step — the site
is plain HTML, CSS and ES modules.

### Project structure

```
index.html               page shell and map overlays
styles.css               design system and responsive layout
script.js                map, filters, search, rankings, popups
js/traffic.js            shared AADT helpers (also used by tests and the pipeline)
scripts/fetch-data.mjs   City ArcGIS → normalised GeoJSON snapshot
scripts/serve.mjs        local static server
data/traffic.geojson     generated, committed snapshot
data/metadata.json       generated source, counts and vintage metadata
test/                    Node test-runner tests
.github/workflows/       monthly refresh + GitHub Pages deploy
```

### Deploying

Pushing to `master` deploys through GitHub Pages. The workflow also runs on the
first of each month and can be triggered manually from the Actions tab. It
re-fetches the City snapshot, runs the tests, commits any data changes, and deploys.

## Tech

Leaflet 1.9 · vanilla ES modules · IBM Plex Sans/Mono · Esri Light/Dark Gray
Canvas basemaps · GitHub Pages.

## Attribution

Traffic data © Corporation of the City of London, from
[City of London Open Data](https://opendata.london.ca/), used under the City's
[terms of use](https://london.maps.arcgis.com/sharing/rest/content/items/e31458fd0c7e41dd9f93144a9550781d/data).
Basemap tiles © Esri, HERE, Garmin, © OpenStreetMap contributors.

Code is released under the MIT License.
