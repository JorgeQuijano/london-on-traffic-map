import assert from 'node:assert/strict';
import test from 'node:test';
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
} from '../js/traffic.js';

function feature(street, aadt, length, overrides = {}) {
  return {
    type: 'Feature',
    properties: {
      id: overrides.id ?? null,
      street,
      class: overrides.class ?? 'Urban Thoroughfare',
      aadt,
      truck: overrides.truck ?? 'None',
      updated: '2023-10-04',
      length,
      ...overrides
    },
    geometry: {
      type: 'LineString',
      coordinates: [
        [-81.25, 42.98],
        [-81.24, 42.99]
      ]
    }
  };
}

test('classifyVolume uses the expected boundaries', () => {
  assert.equal(classifyVolume(0).id, 'low');
  assert.equal(classifyVolume(2499).id, 'low');
  assert.equal(classifyVolume(2500).id, 'moderate');
  assert.equal(classifyVolume(7499).id, 'moderate');
  assert.equal(classifyVolume(7500).id, 'elevated');
  assert.equal(classifyVolume(14999).id, 'elevated');
  assert.equal(classifyVolume(15000).id, 'high');
  assert.equal(classifyVolume(29999).id, 'high');
  assert.equal(classifyVolume(30000).id, 'very-high');
  assert.equal(classifyVolume(110000).id, 'very-high');
});

test('classifyVolume handles invalid values safely', () => {
  assert.equal(classifyVolume(-1).id, 'low');
  assert.equal(classifyVolume(Number.NaN).id, 'low');
  assert.equal(classifyVolume('not a number').id, 'low');
});

test('lineWeight grows with volume and stays bounded', () => {
  const weights = [0, 1000, 7500, 15000, 30000, 110000].map(lineWeight);

  for (let index = 1; index < weights.length; index += 1) {
    assert.ok(weights[index] >= weights[index - 1]);
  }

  assert.ok(weights[0] >= 1.4);
  assert.ok(weights.at(-1) <= 9);
});

test('every level has display metadata and a unique id', () => {
  const ids = new Set(LEVELS.map((level) => level.id));
  assert.equal(ids.size, LEVELS.length);

  for (const level of LEVELS) {
    assert.ok(level.label);
    assert.ok(level.color.match(/^#[0-9a-f]{6}$/i));
    assert.ok(level.range);
  }
});

test('formatNumber and formatCompact format human-readable values', () => {
  assert.equal(formatNumber(1971), '1,971');
  assert.equal(formatCompact(8500676), '8.5M');
  assert.equal(formatCompact(489127), '489K');
  assert.equal(formatCompact(489657), '490K');
  assert.equal(formatCompact(150000), '150K');
  assert.equal(formatCompact(300000), '300K');
  assert.equal(formatCompact(999950), '1M');
  assert.equal(formatCompact(1500), '1.5K');
  assert.equal(formatCompact(999), '999');
});

test('aggregateStreets computes length-weighted averages and peaks', () => {
  const streets = aggregateStreets([
    feature('Test Rd', 1000, 1000, { id: 1 }),
    feature('Test Rd', 110000, 100, { id: 2 }),
    feature('Other Rd', 5000, 500, { id: 3 })
  ]);

  const testRoad = streets.find((entry) => entry.street === 'Test Rd');
  assert.equal(testRoad.segmentCount, 2);
  assert.equal(testRoad.peakAadt, 110000);
  assert.equal(Math.round(testRoad.avgAadt), 10909);
  assert.equal(Math.round(testRoad.dailyVehicleKm), 12000);
  assert.equal(streets[0].street, 'Test Rd');
});

test('aggregateStreets handles zero-length segments without dividing by zero', () => {
  const streets = aggregateStreets([feature('Zero Rd', 5000, 0)]);
  assert.equal(streets[0].avgAadt, 0);
  assert.equal(streets[0].peakAadt, 5000);
});

test('computeStats summarises visible features', () => {
  const stats = computeStats([
    feature('Alpha St', 1000, 1000),
    feature('Alpha St', 3000, 1000),
    feature('Beta Ave', 30000, 500)
  ]);

  assert.equal(stats.segmentCount, 3);
  assert.equal(stats.streetCount, 2);
  assert.equal(stats.totalLengthKm, 2.5);
  assert.equal(stats.dailyVehicleKm, 19000);
  assert.equal(stats.highestVolume, 30000);
  assert.equal(stats.highestVolumeStreet, 'Beta Ave');
  assert.equal(stats.busiestStreet.street, 'Beta Ave');
});

test('matchesFilters combines level, road class and truck filters', () => {
  const props = {
    aadt: 20000,
    class: 'Urban Thoroughfare',
    truck: '24 hrs'
  };

  assert.equal(matchesFilters(props, { level: 'all', roadClass: 'all', truckOnly: false }), true);
  assert.equal(matchesFilters(props, { level: 'high', roadClass: 'all', truckOnly: false }), true);
  assert.equal(matchesFilters(props, { level: 'low', roadClass: 'all', truckOnly: false }), false);
  assert.equal(
    matchesFilters(props, { level: 'all', roadClass: 'Urban Thoroughfare', truckOnly: false }),
    true
  );
  assert.equal(
    matchesFilters(props, { level: 'all', roadClass: 'Neighbourhood Street', truckOnly: false }),
    false
  );
  assert.equal(matchesFilters(props, { level: 'all', roadClass: 'all', truckOnly: true }), true);
  assert.equal(
    matchesFilters({ ...props, truck: 'None' }, { level: 'all', roadClass: 'all', truckOnly: true }),
    false
  );
});

test('findStreet prefers exact, then prefix, then partial matches', () => {
  const streets = ['Oxford St E', 'Oxford St W', 'Wonderland Rd N', "Robin's Hill Rd"];

  assert.equal(findStreet(streets, 'oxford st e'), 'Oxford St E');
  assert.equal(findStreet(streets, 'oxford'), 'Oxford St E');
  assert.equal(findStreet(streets, 'wonder'), 'Wonderland Rd N');
  assert.equal(findStreet(streets, "robin's"), "Robin's Hill Rd");
  assert.equal(findStreet(streets, 'missing'), null);
  assert.equal(findStreet(streets, '   '), null);
});

test('escapeHtml neutralises markup', () => {
  assert.equal(
    escapeHtml(`<img src=x onerror="alert('x')">`),
    '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;'
  );
});
