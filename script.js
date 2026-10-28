import {
  LEVELS,
  aggregateStreets,
  classifyVolume,
  computeStats,
  escapeHtml,
  findStreet,
  formatCompact,
  formatNumber,
  lineWeight,
  matchesFilters
} from './js/traffic.js';

const DATA_URL = 'data/traffic.geojson';
const META_URL = 'data/metadata.json';

const TILE_LAYERS = {
  light: [
    'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}'
  ],
  dark: [
    'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}'
  ]
};

const TILE_ATTRIBUTION =
  'Tiles &copy; <a href="https://www.esri.com/">Esri</a> — Esri, HERE, Garmin, &copy; OpenStreetMap contributors, and the GIS user community';

const LONDON_CENTER = [42.9849, -81.2453];
const LONDON_MAX_BOUNDS = [
  [42.72, -81.58],
  [43.16, -80.92]
];
const RANKING_LIMIT = 12;

const state = {
  features: [],
  visibleFeatures: [],
  metadata: null,
  streets: [],
  level: 'all',
  roadClass: 'all',
  truckOnly: false,
  selectedStreet: null,
  rankingMetric: 'avg',
  theme: 'light',
  loaded: false,
  hasFit: false
};

const elements = {};
let map;
let basemapLayer;
let geojsonLayer;
let highlightLayer;
let layersById = new Map();

const getElement = (id) => document.getElementById(id);

function cacheElements() {
  const ids = [
    'sidebar',
    'sidebar-toggle',
    'sidebar-close',
    'backdrop',
    'theme-toggle',
    'intro-segments',
    'stat-streets',
    'stat-segments',
    'stat-vkt',
    'stat-busiest',
    'stat-busiest-value',
    'search-form',
    'street-search',
    'clear-search',
    'search-hint',
    'street-options',
    'traffic-filter',
    'class-filter',
    'truck-only',
    'reset-filters',
    'street-card',
    'street-card-name',
    'street-card-avg',
    'street-card-peak',
    'street-card-vkt',
    'street-card-meta',
    'street-card-close',
    'street-ranking',
    'ranking-sub',
    'metric-avg',
    'metric-vkt',
    'legend-items',
    'map-badge',
    'map-vintage',
    'reset-view',
    'map-status',
    'empty-state',
    'empty-reset',
    'error-state',
    'error-message',
    'error-retry',
    'data-vintage',
    'refreshed-date',
    'source-link',
    'license-link'
  ];

  for (const id of ids) {
    const key = id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    elements[key] = getElement(id);
  }
}

function initialiseTheme() {
  let stored = null;
  try {
    stored = localStorage.getItem('london-traffic-theme');
  } catch {
    stored = null;
  }

  const prefersDark =
    window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

  state.theme = stored === 'dark' || stored === 'light' ? stored : prefersDark ? 'dark' : 'light';
  document.documentElement.dataset.theme = state.theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', state.theme === 'dark' ? '#0d0f11' : '#f2eee4');
  updateThemeToggle();
}

function updateThemeToggle() {
  const isDark = state.theme === 'dark';
  elements.themeToggle.setAttribute(
    'aria-label',
    isDark ? 'Switch to light theme' : 'Switch to dark theme'
  );
  elements.themeToggle.title = isDark ? 'Switch to light theme' : 'Switch to dark theme';
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = state.theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', state.theme === 'dark' ? '#0d0f11' : '#f2eee4');
  updateThemeToggle();

  try {
    localStorage.setItem('london-traffic-theme', state.theme);
  } catch {
    /* localStorage can be unavailable in private mode. */
  }

  if (map) applyBasemap();

  if (state.selectedStreet) {
    drawStreetHighlight(state.selectedStreet, { openPopup: false, fit: false });
  }
}

function setupMap() {
  map = L.map('map', {
    center: LONDON_CENTER,
    zoom: 11,
    minZoom: 10,
    maxZoom: 18,
    zoomControl: false,
    maxBounds: LONDON_MAX_BOUNDS,
    maxBoundsViscosity: 0.8,
    worldCopyJump: false
  });

  applyBasemap();

  map.createPane('highlightPane');
  const highlightPane = map.getPane('highlightPane');
  highlightPane.style.zIndex = 450;
  highlightPane.style.pointerEvents = 'none';

  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.control
    .scale({ position: 'bottomright', imperial: false, maxWidth: 110 })
    .addTo(map);

  map.attributionControl.setPrefix(false);

  const container = map.getContainer();
  container.setAttribute('role', 'region');
  container.setAttribute('aria-label', 'Interactive map of daily traffic volumes in London, Ontario');

  map.on('popupopen', (event) => {
    const button = event.popup.getElement()?.querySelector('[data-street]');
    if (!button) return;

    button.addEventListener(
      'click',
      () => {
        map.closePopup();
        selectStreet(button.dataset.street);
      },
      { once: true }
    );
  });
}

function applyBasemap() {
  if (basemapLayer) {
    map.removeLayer(basemapLayer);
    basemapLayer = null;
  }

  const urls = TILE_LAYERS[state.theme];
  basemapLayer = L.layerGroup(
    urls.map((url, index) =>
      L.tileLayer(url, {
        attribution: index === 0 ? TILE_ATTRIBUTION : null,
        maxZoom: 19,
        maxNativeZoom: 19
      })
    )
  ).addTo(map);
}

function setupControls() {
  elements.trafficFilter.innerHTML = [
    '<option value="all">All traffic levels</option>',
    ...LEVELS.map(
      (level) =>
        `<option value="${level.id}">${escapeHtml(level.label)} (${escapeHtml(level.range)})</option>`
    )
  ].join('');

  elements.legendItems.innerHTML = LEVELS.map(
    (level) => `
      <button class="legend-item" type="button" data-level="${level.id}"
              aria-pressed="false" title="${escapeHtml(level.range)} vehicles per day">
        <span class="swatch" style="background:${level.color}" aria-hidden="true"></span>
        <span class="legend-label">${escapeHtml(level.label)}<small>${escapeHtml(level.shortLabel)}</small></span>
        <span class="legend-count" data-count="${level.id}">0</span>
      </button>`
  ).join('');
}

function bindEvents() {
  elements.themeToggle.addEventListener('click', toggleTheme);

  elements.searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    submitSearch();
  });

  elements.streetSearch.addEventListener('input', () => {
    updateClearSearch();
    setSearchHint('');
  });

  elements.streetSearch.addEventListener('change', () => {
    const query = elements.streetSearch.value.trim();
    if (!query) {
      clearStreetSelection();
      return;
    }

    const street = findStreet(state.streets, query);
    if (street) {
      setSearchHint('');
      selectStreet(street);
    }
  });

  elements.clearSearch.addEventListener('click', () => {
    clearStreetSelection();
    elements.streetSearch.focus();
  });

  elements.streetCardClose.addEventListener('click', () => clearStreetSelection());

  elements.trafficFilter.addEventListener('change', () => {
    state.level = elements.trafficFilter.value;
    applyFilters();
  });

  elements.classFilter.addEventListener('change', () => {
    state.roadClass = elements.classFilter.value;
    applyFilters();
  });

  elements.truckOnly.addEventListener('change', () => {
    state.truckOnly = elements.truckOnly.checked;
    applyFilters();
  });

  elements.resetFilters.addEventListener('click', () => resetFilters());
  elements.emptyReset.addEventListener('click', () => resetFilters());
  elements.errorRetry.addEventListener('click', () => window.location.reload());
  elements.resetView.addEventListener('click', resetView);

  elements.metricAvg.addEventListener('click', () => setRankingMetric('avg'));
  elements.metricVkt.addEventListener('click', () => setRankingMetric('vkt'));

  elements.streetRanking.addEventListener('click', (event) => {
    const button = event.target.closest('[data-street]');
    if (button) selectStreet(button.dataset.street);
  });

  elements.legendItems.addEventListener('click', (event) => {
    const button = event.target.closest('[data-level]');
    if (!button) return;

    state.level = state.level === button.dataset.level ? 'all' : button.dataset.level;
    applyFilters();
  });

  elements.sidebarToggle.addEventListener('click', openSidebar);
  elements.sidebarClose.addEventListener('click', closeSidebar);
  elements.backdrop.addEventListener('click', closeSidebar);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && elements.sidebar.classList.contains('is-open')) {
      closeSidebar();
    }
  });

  const desktopQuery = window.matchMedia('(min-width: 901px)');
  desktopQuery.addEventListener('change', (event) => {
    if (event.matches) closeSidebar();
    syncSidebarInert();
  });

  syncSidebarInert();
}

function syncSidebarInert() {
  const isMobile = window.matchMedia('(max-width: 900px)').matches;
  elements.sidebar.inert = isMobile && !elements.sidebar.classList.contains('is-open');
}

function openSidebar() {
  elements.sidebar.inert = false;
  elements.sidebar.classList.add('is-open');
  elements.backdrop.hidden = false;
  elements.sidebarToggle.setAttribute('aria-expanded', 'true');
  document.body.classList.add('sidebar-open');
  elements.sidebarClose.focus();
}

function closeSidebar() {
  elements.sidebar.classList.remove('is-open');
  elements.backdrop.hidden = true;
  elements.sidebarToggle.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('sidebar-open');
  syncSidebarInert();

  if (
    window.matchMedia('(max-width: 900px)').matches &&
    elements.sidebar.contains(document.activeElement)
  ) {
    elements.sidebarToggle.focus({ preventScroll: true });
  }
}

function closeSidebarOnMobile() {
  if (window.matchMedia('(max-width: 900px)').matches) closeSidebar();
}

async function loadData() {
  try {
    const [geoResponse, metaResponse] = await Promise.all([
      fetch(DATA_URL, { cache: 'no-cache' }),
      fetch(META_URL, { cache: 'no-cache' })
    ]);

    if (!geoResponse.ok) {
      throw new Error(`The traffic data file returned HTTP ${geoResponse.status}.`);
    }
    if (!metaResponse.ok) {
      throw new Error(`The metadata file returned HTTP ${metaResponse.status}.`);
    }

    const [geoData, metadata] = await Promise.all([
      geoResponse.json(),
      metaResponse.json()
    ]);

    if (!geoData || !Array.isArray(geoData.features)) {
      throw new Error('The traffic data file is malformed.');
    }

    const features = geoData.features.filter(isUsableFeature);
    if (features.length === 0) {
      throw new Error('The traffic data file contains no usable road segments.');
    }

    state.features = features;
    state.metadata = metadata;
    state.streets = [...new Set(features.map((feature) => feature.properties.street))].sort(
      (a, b) => a.localeCompare(b, 'en-CA')
    );
    state.loaded = true;

    populateClassFilter();
    populateStreetOptions();
    renderMetadata();
    applyFilters();
    leaveLoadingState();
  } catch (error) {
    if (window.location.protocol === 'file:') {
      showError(
        new Error(
          'This page needs a local web server. Run "npm run dev" and open http://127.0.0.1:8000.'
        )
      );
    } else {
      showError(error);
    }
  }
}

function isUsableFeature(feature) {
  if (!feature || !feature.geometry) return false;
  if (!['LineString', 'MultiLineString'].includes(feature.geometry.type)) return false;

  const props = feature.properties ?? {};
  return (
    typeof props.street === 'string' &&
    props.street.trim().length > 0 &&
    Number.isFinite(Number(props.aadt)) &&
    Number(props.aadt) > 0
  );
}

function populateClassFilter() {
  const counts = new Map();

  for (const feature of state.features) {
    const roadClass = feature.properties.class || 'Unknown';
    counts.set(roadClass, (counts.get(roadClass) ?? 0) + 1);
  }

  const options = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en-CA')
  );

  elements.classFilter.innerHTML = [
    '<option value="all">All road types</option>',
    ...options.map(
      ([roadClass, count]) =>
        `<option value="${escapeHtml(roadClass)}">${escapeHtml(roadClass)} (${formatNumber(count)})</option>`
    )
  ].join('');
}

function populateStreetOptions() {
  elements.streetOptions.innerHTML = state.streets
    .map((street) => `<option value="${escapeHtml(street)}"></option>`)
    .join('');
}

function renderMetadata() {
  const metadata = state.metadata;
  const vintageYear = metadata?.dataVintage
    ? new Date(`${metadata.dataVintage}T12:00:00`).getFullYear()
    : '—';

  elements.introSegments.textContent = formatNumber(state.features.length);
  elements.mapVintage.textContent = vintageYear;
  elements.dataVintage.textContent = metadata?.dataVintage
    ? formatDate(`${metadata.dataVintage}T12:00:00`)
    : '—';
  elements.refreshedDate.textContent = formatDate(metadata?.fetchedAt);

  if (metadata?.source?.datasetUrl) {
    elements.sourceLink.href = metadata.source.datasetUrl;
  }
  if (metadata?.source?.licenseUrl) {
    elements.licenseLink.href = metadata.source.licenseUrl;
  }

  elements.mapBadge.title = [
    'Annual average daily traffic',
    metadata?.dataVintage ? `City data from ${metadata.dataVintage}` : null,
    metadata?.fetchedAt ? `Snapshot refreshed ${formatDate(metadata.fetchedAt)}` : null,
    metadata?.notes
  ]
    .filter(Boolean)
    .join(' · ');
}

function updateStats() {
  const stats = computeStats(state.visibleFeatures);

  elements.statStreets.textContent = formatNumber(stats.streetCount);
  elements.statSegments.textContent = formatNumber(stats.segmentCount);
  elements.statVkt.textContent = formatCompact(stats.dailyVehicleKm);

  if (stats.busiestStreet) {
    elements.statBusiest.textContent = stats.busiestStreet.street;
    elements.statBusiestValue.textContent = `${formatNumber(
      stats.busiestStreet.avgAadt
    )} avg/day`;
  } else {
    elements.statBusiest.textContent = '—';
    elements.statBusiestValue.textContent = '';
  }
}

function updateRanking() {
  const ranked = aggregateStreets(state.visibleFeatures);
  const metric = state.rankingMetric;
  const sorted = [...ranked].sort((a, b) =>
    metric === 'vkt' ? b.dailyVehicleKm - a.dailyVehicleKm : b.avgAadt - a.avgAadt
  );

  const top = sorted.slice(0, RANKING_LIMIT);
  if (top.length === 0) {
    elements.streetRanking.innerHTML =
      '<li class="ranking-empty">No streets match these filters.</li>';
    return;
  }

  const maxValue =
    metric === 'vkt' ? top[0].dailyVehicleKm : top[0].avgAadt;

  elements.streetRanking.innerHTML = top
    .map((street, index) => {
      const value = metric === 'vkt' ? street.dailyVehicleKm : street.avgAadt;
      const barWidth = Math.max(3, Math.round((value / maxValue) * 100));
      const label = metric === 'vkt' ? 'vehicle-km per day' : 'average vehicles per day';
      const selected = street.street === state.selectedStreet ? ' is-selected' : '';

      return `
        <li>
          <button class="ranking-row${selected}" type="button"
                  data-street="${escapeHtml(street.street)}"
                  aria-label="${escapeHtml(street.street)}: ${formatNumber(value)} ${label}. Show on map.">
            <span class="rank">${String(index + 1).padStart(2, '0')}</span>
            <span class="rank-main">
              <span class="rank-name">${escapeHtml(street.street)}</span>
              <span class="rank-bar" aria-hidden="true"><span style="width:${barWidth}%"></span></span>
            </span>
            <span class="rank-value">${metric === 'vkt' ? formatCompact(value) : formatNumber(value)}
              <span>${metric === 'vkt' ? 'veh-km' : 'avg/day'}</span>
            </span>
          </button>
        </li>`;
    })
    .join('');
}

function updateLegendCounts() {
  const baseFilters = {
    level: 'all',
    roadClass: state.roadClass,
    truckOnly: state.truckOnly
  };
  const counts = Object.fromEntries(LEVELS.map((level) => [level.id, 0]));

  for (const feature of state.features) {
    if (!matchesFilters(feature.properties, baseFilters)) continue;
    counts[classifyVolume(feature.properties.aadt).id] += 1;
  }

  for (const level of LEVELS) {
    const countElement = document.querySelector(`[data-count="${level.id}"]`);
    if (countElement) countElement.textContent = formatNumber(counts[level.id]);

    const button = document.querySelector(`[data-level="${level.id}"]`);
    if (button) {
      const active = state.level === level.id;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }
}

function updateFilterChrome() {
  elements.trafficFilter.value = state.level;
  elements.classFilter.value = state.roadClass;
  elements.truckOnly.checked = state.truckOnly;

  const filtersActive =
    state.level !== 'all' || state.roadClass !== 'all' || state.truckOnly;
  elements.resetFilters.hidden = !filtersActive;

  updateClearSearch();
  updateRankingSelection();
}

function updateClearSearch() {
  elements.clearSearch.hidden =
    !state.selectedStreet && elements.streetSearch.value.trim().length === 0;
}

function updateRankingSelection() {
  const rows = elements.streetRanking.querySelectorAll('[data-street]');
  for (const row of rows) {
    row.classList.toggle('is-selected', row.dataset.street === state.selectedStreet);
  }
}

function updateEmptyState() {
  elements.emptyState.hidden = !state.loaded || state.visibleFeatures.length > 0;
}

function setRankingMetric(metric) {
  if (state.rankingMetric === metric) return;

  state.rankingMetric = metric;
  const isAvg = metric === 'avg';
  elements.metricAvg.classList.toggle('is-active', isAvg);
  elements.metricVkt.classList.toggle('is-active', !isAvg);
  elements.metricAvg.setAttribute('aria-pressed', String(isAvg));
  elements.metricVkt.setAttribute('aria-pressed', String(!isAvg));
  elements.rankingSub.textContent = isAvg
    ? 'Length-weighted average volume'
    : 'Total daily travel on each street';
  updateRanking();
}

function applyFilters() {
  state.visibleFeatures = state.features.filter((feature) =>
    matchesFilters(feature.properties, state)
  );

  renderLayer();
  updateStats();
  updateRanking();
  updateLegendCounts();
  updateFilterChrome();
  updateEmptyState();

  if (state.selectedStreet) {
    const stillVisible = state.visibleFeatures.some(
      (feature) => feature.properties.street === state.selectedStreet
    );

    if (stillVisible) {
      renderStreetCard(state.selectedStreet);
      drawStreetHighlight(state.selectedStreet, { openPopup: false, fit: false });
    } else {
      clearStreetSelection();
    }
  }
}

function renderLayer() {
  clearStreetHighlight();

  if (geojsonLayer) {
    map.removeLayer(geojsonLayer);
    geojsonLayer = null;
  }

  layersById = new Map();

  if (state.visibleFeatures.length === 0) return;

  geojsonLayer = L.geoJSON(
    { type: 'FeatureCollection', features: state.visibleFeatures },
    {
      style: featureStyle,
      onEachFeature: (feature, layer) => {
        const props = feature.properties;
        const key = featureKey(feature);

        layersById.set(key, layer);
        layer.bindTooltip(tooltipContent(props), {
          sticky: true,
          direction: 'top',
          offset: [0, -4],
          className: 'traffic-tooltip',
          opacity: 1
        });
        layer.bindPopup(popupContent(props), {
          className: 'traffic-popup',
          maxWidth: 340,
          minWidth: 268,
          autoPanPadding: [24, 24]
        });
        layer.on({
          mouseover: handleMouseOver,
          mouseout: handleMouseOut
        });
      }
    }
  ).addTo(map);

  if (!state.hasFit) {
    map.fitBounds(initialBounds(state.visibleFeatures), {
      padding: [24, 24],
      maxZoom: 12
    });
    state.hasFit = true;
  }
}

function initialBounds(features) {
  const lons = [];
  const lats = [];

  for (const feature of features) {
    const lines =
      feature.geometry.type === 'LineString'
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates;
    const line = lines[0];
    if (!line?.length) continue;

    const [lon, lat] = line[Math.floor(line.length / 2)];
    lons.push(lon);
    lats.push(lat);
  }

  if (lons.length < 20) {
    const bounds = L.latLngBounds([]);
    for (const feature of features) {
      bounds.extend(L.geoJSON(feature).getBounds());
    }
    return bounds;
  }

  lons.sort((a, b) => a - b);
  lats.sort((a, b) => a - b);
  const quantile = (values, percentile) =>
    values[Math.floor((values.length - 1) * percentile)];

  // Use the middle of the network so a few rural tails do not zoom the
  // initial view out to the whole county. Phones get a tighter view.
  const tail =
    window.innerWidth < 600 ? 0.15 : window.innerWidth < 900 ? 0.1 : 0.05;

  return L.latLngBounds(
    [quantile(lats, tail), quantile(lons, tail)],
    [quantile(lats, 1 - tail), quantile(lons, 1 - tail)]
  );
}

function featureKey(feature) {
  const props = feature.properties;
  if (props.id !== null && props.id !== undefined) return String(props.id);

  const first = feature.geometry.coordinates?.[0];
  return `${props.street}-${props.aadt}-${JSON.stringify(first)}`;
}

function featureStyle(feature) {
  const aadt = Number(feature.properties.aadt) || 0;
  const level = classifyVolume(aadt);

  return {
    color: level.color,
    weight: lineWeight(aadt),
    opacity: 0.9,
    lineCap: 'round',
    lineJoin: 'round'
  };
}

function handleMouseOver(event) {
  const layer = event.target;
  const aadt = Number(layer.feature.properties.aadt) || 0;

  layer.setStyle({
    weight: Math.min(13, lineWeight(aadt) + 2.5),
    opacity: 1
  });
  layer.bringToFront();
}

function handleMouseOut(event) {
  if (geojsonLayer) geojsonLayer.resetStyle(event.target);
}

function tooltipContent(props) {
  return `
    <div class="tt-street">${escapeHtml(props.street)}</div>
    <div class="tt-value">${formatNumber(props.aadt)} vehicles/day</div>`;
}

function popupContent(props) {
  const level = classifyVolume(props.aadt);
  const levelIndex = LEVELS.findIndex((entry) => entry.id === level.id);
  const scale = LEVELS.map(
    (entry, index) =>
      `<span style="background:${index <= levelIndex ? entry.color : 'var(--line)'}"></span>`
  ).join('');

  return `
    <div class="popup">
      <div class="popup-top">
        <span class="popup-level" style="--level-color:${level.color}">${escapeHtml(level.label)}</span>
        <span class="popup-class">${escapeHtml(props.class)}</span>
      </div>
      <h3>${escapeHtml(props.street)}</h3>
      <div class="popup-volume">${formatNumber(props.aadt)} <span>vehicles / day</span></div>
      <div class="popup-scale" aria-hidden="true">${scale}</div>
      <dl class="popup-facts">
        <div><dt>Truck route</dt><dd>${escapeHtml(props.truck)}</dd></div>
        <div><dt>Segment length</dt><dd>${formatNumber(props.length)} m</dd></div>
        <div><dt>City data</dt><dd>${props.updated ? escapeHtml(props.updated.slice(0, 4)) : '—'}</dd></div>
      </dl>
      <button class="popup-btn" type="button" data-street="${escapeHtml(props.street)}">
        Show the whole street
      </button>
    </div>`;
}

function drawStreetHighlight(street, { openPopup = false, fit = false } = {}) {
  clearStreetHighlight();

  const features = state.visibleFeatures.filter(
    (feature) => feature.properties.street === street
  );
  if (features.length === 0) return;

  const collection = { type: 'FeatureCollection', features };
  const casingColor = state.theme === 'dark' ? '#f8fafc' : '#0b0d0e';

  highlightLayer = L.layerGroup().addTo(map);

  L.geoJSON(collection, {
    pane: 'highlightPane',
    interactive: false,
    style: (feature) => ({
      color: casingColor,
      weight: lineWeight(feature.properties.aadt) + 4,
      opacity: 0.85,
      lineCap: 'round',
      lineJoin: 'round'
    })
  }).addTo(highlightLayer);

  L.geoJSON(collection, {
    pane: 'highlightPane',
    interactive: false,
    style: featureStyle
  }).addTo(highlightLayer);

  highlightLayer.eachLayer((layer) => layer.bringToFront());

  if (fit) {
    const bounds = L.geoJSON(collection).getBounds();
    map.flyToBounds(bounds, {
      padding: [48, 48],
      maxZoom: 15,
      duration: prefersReducedMotion() ? 0 : 0.7
    });
  }

  if (!openPopup) return;

  const peak = features.reduce((best, feature) =>
    feature.properties.aadt > best.properties.aadt ? feature : best
  );
  const peakLayer = layersById.get(featureKey(peak));

  if (!peakLayer) return;

  const showPopup = () => peakLayer.openPopup();
  if (fit) {
    map.once('moveend', showPopup);
  } else {
    showPopup();
  }
}

function clearStreetHighlight() {
  if (highlightLayer) {
    map.removeLayer(highlightLayer);
    highlightLayer = null;
  }
}

function renderStreetCard(street) {
  const features = state.visibleFeatures.filter(
    (feature) => feature.properties.street === street
  );
  const summary = aggregateStreets(features)[0];

  if (!summary) {
    elements.streetCard.hidden = true;
    return;
  }

  const roadClasses = [...new Set(features.map((feature) => feature.properties.class))];
  const className =
    roadClasses.length === 1 ? roadClasses[0] : `${roadClasses.length} road types`;

  elements.streetCardName.textContent = street;
  elements.streetCardAvg.textContent = formatNumber(summary.avgAadt);
  elements.streetCardPeak.textContent = formatNumber(summary.peakAadt);
  elements.streetCardVkt.textContent = formatCompact(summary.dailyVehicleKm);
  elements.streetCardMeta.textContent = `${formatNumber(
    summary.segmentCount
  )} segments · ${summary.lengthKm.toFixed(1)} km · ${className}`;
  elements.streetCard.hidden = false;

  updateRankingSelection();
}

function selectStreet(name) {
  const street =
    state.streets.find((candidate) => candidate === name) ??
    findStreet(state.streets, name);

  if (!street) {
    setSearchHint(`No street found for “${name}”. Try a shorter name.`, true);
    return;
  }

  state.selectedStreet = null;
  clearStreetHighlight();

  const isVisible = state.features.some(
    (feature) =>
      feature.properties.street === street && matchesFilters(feature.properties, state)
  );

  if (!isVisible) {
    state.level = 'all';
    state.roadClass = 'all';
    state.truckOnly = false;
    applyFilters();
  }

  state.selectedStreet = street;
  elements.streetSearch.value = street;
  setSearchHint('');
  renderStreetCard(street);
  drawStreetHighlight(street, { openPopup: true, fit: true });
  updateFilterChrome();
  closeSidebarOnMobile();
}

function clearStreetSelection() {
  state.selectedStreet = null;
  clearStreetHighlight();
  elements.streetCard.hidden = true;
  elements.streetSearch.value = '';
  setSearchHint('');
  updateClearSearch();
  updateRankingSelection();
}

function resetFilters() {
  state.level = 'all';
  state.roadClass = 'all';
  state.truckOnly = false;
  applyFilters();
}

function resetView() {
  const features = state.visibleFeatures.length
    ? state.visibleFeatures
    : state.features;
  if (features.length === 0) return;

  map.closePopup();
  map.fitBounds(initialBounds(features), {
    padding: [24, 24],
    maxZoom: 12,
    animate: !prefersReducedMotion()
  });
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function submitSearch() {
  const query = elements.streetSearch.value.trim();

  if (!query) {
    setSearchHint('Type a street name first.', true);
    elements.streetSearch.focus();
    return;
  }

  const street = findStreet(state.streets, query);
  if (!street) {
    setSearchHint(`No street matches “${query}”.`, true);
    return;
  }

  setSearchHint('');
  selectStreet(street);
}

function setSearchHint(message, isError = false) {
  elements.searchHint.textContent = message;
  elements.searchHint.classList.toggle('is-error', isError);
  elements.searchHint.hidden = message.length === 0;
}

function leaveLoadingState() {
  elements.mapStatus.classList.add('is-hidden');
  window.setTimeout(() => {
    elements.mapStatus.hidden = true;
  }, 300);
}

function showError(error) {
  elements.mapStatus.hidden = true;
  elements.errorState.hidden = false;
  elements.errorMessage.textContent =
    error?.message || 'The traffic data file could not be read.';
  elements.streetRanking.innerHTML =
    '<li class="ranking-empty">Traffic data is unavailable.</li>';
}

function formatDate(value) {
  if (!value) return '—';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  return date.toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function init() {
  cacheElements();
  initialiseTheme();
  setupMap();
  setupControls();
  bindEvents();
  loadData();
}

if (typeof window.L === 'undefined') {
  cacheElements();
  showError(
    new Error('The Leaflet map library did not load. Check your connection and reload.')
  );
} else {
  init();
}
