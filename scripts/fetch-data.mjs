#!/usr/bin/env node
/**
 * Fetch the City of London's Traffic Volumes layer and write a compact,
 * normalized GeoJSON snapshot plus a metadata file for the static site.
 *
 * The City's ArcGIS server does not send CORS headers, so the browser cannot
 * query it directly. This script is the build-time bridge.
 *
 * Usage: npm run fetch-data
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LEVELS,
  aggregateStreets,
  classifyVolume,
  computeStats
} from '../js/traffic.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, 'data');

const DATASET_ID = '6e425a70e4e24d2ab47e099c4720a80c';
const SERVICE_URL =
  'https://maps.london.ca/server/rest/services/OpenData/OpenData_Transportation/MapServer/21';
const DATASET_URL = `https://opendata.london.ca/datasets/${DATASET_ID}_21/about`;
const ITEM_URL = `https://www.arcgis.com/sharing/rest/content/items/${DATASET_ID}?f=json`;

const PAGE_SIZE = 1000;
const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 45_000;

// Generous box around London, Ontario. Used to catch projection mistakes.
const LONDON_BOUNDS = {
  west: -82.2,
  south: 42.4,
  east: -80.4,
  north: 43.6
};

function log(message) {
  console.log(`[fetch-data] ${message}`);
}

async function fetchJson(url) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'london-on-traffic-map data refresh'
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        const delay = attempt * 1_500;
        log(`Request failed (${error.message}); retrying in ${delay}ms…`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(`Could not fetch ${url}: ${lastError?.message ?? 'unknown error'}`);
}

function queryUrl({ offset = 0, count = PAGE_SIZE } = {}) {
  const params = new URLSearchParams({
    where: '1=1',
    outFields:
      'OBJECTID,GIS_ID,StreetName,StreetClassification,VolumeCount,TruckRoute,LastEditDate',
    returnGeometry: 'true',
    outSR: '4326',
    orderByFields: 'OBJECTID',
    resultOffset: String(offset),
    resultRecordCount: String(count),
    f: 'geojson'
  });

  return `${SERVICE_URL}/query?${params.toString()}`;
}

async function fetchAllFeatures() {
  const countUrl = new URL(`${SERVICE_URL}/query`);
  countUrl.search = new URLSearchParams({
    where: '1=1',
    returnCountOnly: 'true',
    f: 'json'
  }).toString();

  const countPayload = await fetchJson(countUrl.toString());
  const total = Number(countPayload.count);

  if (!Number.isFinite(total) || total <= 0) {
    throw new Error('The City service reported no traffic segments.');
  }

  log(`City service reports ${total.toLocaleString('en-CA')} segments.`);

  const features = [];
  for (let offset = 0; offset < total; offset += PAGE_SIZE) {
    const payload = await fetchJson(queryUrl({ offset }));
    const page = Array.isArray(payload.features) ? payload.features : [];

    features.push(...page);
    log(`Fetched ${Math.min(offset + page.length, total).toLocaleString('en-CA')} / ${total.toLocaleString('en-CA')}.`);

    if (page.length === 0) break;
  }

  return { features, total };
}

function haversineMetres([lon1, lat1], [lon2, lat2]) {
  const earthRadius = 6_371_008.8;
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) ** 2;

  return 2 * earthRadius * Math.asin(Math.sqrt(a));
}

function roundCoordinate(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function cleanLine(coordinates) {
  if (!Array.isArray(coordinates)) return null;

  const points = [];
  for (const point of coordinates) {
    if (!Array.isArray(point) || point.length < 2) continue;

    const lon = Number(point[0]);
    const lat = Number(point[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;

    const rounded = [roundCoordinate(lon), roundCoordinate(lat)];
    const previous = points.at(-1);
    if (previous && previous[0] === rounded[0] && previous[1] === rounded[1]) {
      continue;
    }
    points.push(rounded);
  }

  return points.length >= 2 ? points : null;
}

function geometryLength(geometry) {
  const lines =
    geometry?.type === 'LineString'
      ? [geometry.coordinates]
      : geometry?.type === 'MultiLineString'
        ? geometry.coordinates
        : [];

  let length = 0;
  for (const line of lines) {
    for (let index = 1; index < line.length; index += 1) {
      length += haversineMetres(line[index - 1], line[index]);
    }
  }

  return length;
}

function cleanGeometry(geometry) {
  if (geometry?.type === 'LineString') {
    const coordinates = cleanLine(geometry.coordinates);
    return coordinates ? { type: 'LineString', coordinates } : null;
  }

  if (geometry?.type === 'MultiLineString') {
    const parts = geometry.coordinates.map(cleanLine).filter(Boolean);
    if (parts.length === 0) return null;
    if (parts.length === 1) return { type: 'LineString', coordinates: parts[0] };
    return { type: 'MultiLineString', coordinates: parts };
  }

  return null;
}

function isoDate(value) {
  if (value === null || value === undefined || value === '') return null;

  const date = new Date(typeof value === 'number' ? value : String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function normalizeFeature(feature) {
  const props = feature?.properties ?? {};
  const street = String(props.StreetName ?? '').trim();
  const aadt = Number(props.VolumeCount);
  const geometry = cleanGeometry(feature?.geometry);

  if (!street) return { error: 'missing street name' };
  if (!Number.isFinite(aadt) || aadt <= 0) return { error: `invalid volume for ${street}` };
  if (!geometry) return { error: `invalid geometry for ${street}` };

  const length = Math.round(geometryLength(geometry));
  if (!Number.isFinite(length) || length <= 0) {
    return { error: `invalid length for ${street}` };
  }

  return {
    type: 'Feature',
    properties: {
      id: Number(props.OBJECTID) || null,
      street,
      class: String(props.StreetClassification ?? '').trim() || 'Unknown',
      aadt: Math.round(aadt),
      truck: String(props.TruckRoute ?? '').trim() || 'None',
      updated: isoDate(props.LastEditDate),
      length
    },
    geometry
  };
}

function assertLondonCoordinates(feature) {
  const lines =
    feature.geometry.type === 'LineString'
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;

  for (const line of lines) {
    for (const [lon, lat] of line) {
      if (
        lon < LONDON_BOUNDS.west ||
        lon > LONDON_BOUNDS.east ||
        lat < LONDON_BOUNDS.south ||
        lat > LONDON_BOUNDS.north
      ) {
        return false;
      }
    }
  }

  return true;
}

function boundsOf(features) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  for (const feature of features) {
    const lines =
      feature.geometry.type === 'LineString'
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates;

    for (const line of lines) {
      for (const [lon, lat] of line) {
        west = Math.min(west, lon);
        south = Math.min(south, lat);
        east = Math.max(east, lon);
        north = Math.max(north, lat);
      }
    }
  }

  return [
    [west, south],
    [east, north]
  ];
}

async function getSourceModified() {
  try {
    const item = await fetchJson(ITEM_URL);
    return item.modified ? new Date(item.modified).toISOString() : null;
  } catch (error) {
    log(`Could not read dataset metadata (${error.message}); continuing.`);
    return null;
  }
}

async function main() {
  log('Downloading City of London traffic volumes…');

  const [source, sourceModified] = await Promise.all([
    fetchAllFeatures(),
    getSourceModified()
  ]);

  if (source.features.length === 0) {
    throw new Error('No features returned by the City service.');
  }

  const features = [];
  const errors = [];
  const seenIds = new Set();

  for (const raw of source.features) {
    const result = normalizeFeature(raw);

    if (result.error) {
      errors.push(result.error);
      continue;
    }

    if (result.properties.id && seenIds.has(result.properties.id)) continue;
    if (result.properties.id) seenIds.add(result.properties.id);

    if (!assertLondonCoordinates(result)) {
      errors.push(`coordinates outside London for ${result.properties.street}`);
      continue;
    }

    features.push(result);
  }

  if (errors.length > 0) {
    log(`Skipped ${errors.length} invalid feature(s).`);
    for (const error of errors.slice(0, 10)) log(`  - ${error}`);
  }

  if (features.length < source.total * 0.95) {
    throw new Error(
      `Only ${features.length} of ${source.total} segments passed validation; refusing to overwrite good data.`
    );
  }

  features.sort((a, b) => (a.properties.id ?? 0) - (b.properties.id ?? 0));

  const stats = computeStats(features);
  const streets = aggregateStreets(features);
  const busiest = streets[0];
  const classCounts = {};
  const levelCounts = Object.fromEntries(LEVELS.map((level) => [level.id, 0]));
  let highest = { street: '—', aadt: 0 };
  let dataVintage = null;

  for (const feature of features) {
    const props = feature.properties;
    classCounts[props.class] = (classCounts[props.class] ?? 0) + 1;
    levelCounts[classifyVolume(props.aadt).id] += 1;

    if (props.aadt > highest.aadt) {
      highest = { street: props.street, aadt: props.aadt };
    }

    if (props.updated && (!dataVintage || props.updated > dataVintage)) {
      dataVintage = props.updated;
    }
  }

  const metadata = {
    source: {
      name: 'City of London Open Data — Traffic Volumes (AADT)',
      datasetUrl: DATASET_URL,
      serviceUrl: SERVICE_URL,
      licenseUrl:
        'https://london.maps.arcgis.com/sharing/rest/content/items/e31458fd0c7e41dd9f93144a9550781d/data'
    },
    fetchedAt: new Date().toISOString(),
    sourceModified,
    dataVintage,
    segmentCount: features.length,
    streetCount: stats.streetCount,
    totalLengthKm: Number(stats.totalLengthKm.toFixed(1)),
    dailyVehicleKm: Math.round(stats.dailyVehicleKm),
    highestVolume: highest,
    busiestStreet: busiest
      ? {
          street: busiest.street,
          avgAadt: Math.round(busiest.avgAadt),
          peakAadt: busiest.peakAadt,
          segmentCount: busiest.segmentCount
        }
      : null,
    classCounts,
    levelCounts,
    bounds: boundsOf(features),
    notes:
      'AADT is the annual average number of vehicles passing a point each day, not live traffic. Street averages are weighted by segment length.'
  };

  const collection = {
    type: 'FeatureCollection',
    name: 'LondonTrafficVolumes',
    features
  };

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(
    join(DATA_DIR, 'traffic.geojson'),
    `${JSON.stringify(collection)}\n`,
    'utf8'
  );
  await writeFile(
    join(DATA_DIR, 'metadata.json'),
    `${JSON.stringify(metadata, null, 2)}\n`,
    'utf8'
  );

  log(`Wrote ${features.length.toLocaleString('en-CA')} segments.`);
  log(`Data vintage: ${dataVintage ?? 'unknown'}.`);
  log(
    `Busiest street: ${metadata.busiestStreet?.street ?? '—'} (${metadata.busiestStreet?.avgAadt?.toLocaleString('en-CA') ?? '—'} avg AADT).`
  );
}

main().catch((error) => {
  console.error(`[fetch-data] ${error.stack ?? error.message}`);
  process.exitCode = 1;
});
