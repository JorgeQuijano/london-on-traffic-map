import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  LEVELS,
  aggregateStreets,
  classifyVolume,
  computeStats
} from '../js/traffic.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

async function loadJson(path) {
  return JSON.parse(await readFile(join(ROOT, path), 'utf8'));
}

test('generated traffic snapshot exists and is valid GeoJSON', async () => {
  const geo = await loadJson('data/traffic.geojson');

  assert.equal(geo.type, 'FeatureCollection');
  assert.ok(Array.isArray(geo.features));
  assert.ok(geo.features.length > 1500, 'expected the full London road network');
});

test('metadata matches the generated snapshot', async () => {
  const [geo, metadata] = await Promise.all([
    loadJson('data/traffic.geojson'),
    loadJson('data/metadata.json')
  ]);

  assert.equal(metadata.segmentCount, geo.features.length);
  assert.ok(metadata.streetCount > 300);
  assert.ok(metadata.dailyVehicleKm > 0);
  assert.ok(metadata.dataVintage);
  assert.ok(metadata.fetchedAt);
  assert.ok(metadata.source.datasetUrl.includes('opendata.london.ca'));

  const levelTotal = Object.values(metadata.levelCounts).reduce((sum, count) => sum + count, 0);
  assert.equal(levelTotal, geo.features.length);

  const classTotal = Object.values(metadata.classCounts).reduce((sum, count) => sum + count, 0);
  assert.equal(classTotal, geo.features.length);

  const stats = computeStats(geo.features);
  assert.equal(stats.streetCount, metadata.streetCount);
  assert.equal(Math.round(stats.dailyVehicleKm), metadata.dailyVehicleKm);

  const busiest = aggregateStreets(geo.features)[0];
  assert.equal(busiest.street, metadata.busiestStreet.street);
});

test('every road segment has usable properties and London coordinates', async () => {
  const geo = await loadJson('data/traffic.geojson');
  const ids = new Set();

  for (const feature of geo.features) {
    const props = feature.properties;

    assert.ok(props.street.length > 0, 'street name is required');
    assert.ok(Number.isFinite(props.aadt) && props.aadt > 0, `bad AADT for ${props.street}`);
    assert.ok(Number.isFinite(props.length) && props.length > 0, `bad length for ${props.street}`);
    assert.ok(props.class.length > 0, `bad class for ${props.street}`);
    assert.ok(props.truck.length > 0, `bad truck route for ${props.street}`);

    if (props.id !== null) {
      assert.ok(!ids.has(props.id), `duplicate id ${props.id}`);
      ids.add(props.id);
    }

    const lines =
      feature.geometry.type === 'LineString'
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates;

    for (const line of lines) {
      assert.ok(line.length >= 2, `line for ${props.street} has fewer than two points`);

      for (const [lon, lat] of line) {
        assert.ok(lon >= -82.2 && lon <= -80.4, `lon out of range for ${props.street}`);
        assert.ok(lat >= 42.4 && lat <= 43.6, `lat out of range for ${props.street}`);
      }
    }

    assert.ok(LEVELS.some((level) => level.id === classifyVolume(props.aadt).id));
  }
});
