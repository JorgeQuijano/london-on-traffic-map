/**
 * Shared traffic helpers used by the browser app, the data pipeline, and tests.
 *
 * Volumes are annual average daily traffic (AADT): the average number of
 * vehicles that pass a point on a road each day over a full year.
 */

export const LEVELS = [
  {
    id: 'low',
    label: 'Low',
    range: 'under 2,500',
    shortLabel: '< 2.5K',
    color: '#3a9d78',
    min: 0,
    max: 2500
  },
  {
    id: 'moderate',
    label: 'Moderate',
    range: '2,500 – 7,500',
    shortLabel: '2.5K – 7.5K',
    color: '#f0b429',
    min: 2500,
    max: 7500
  },
  {
    id: 'elevated',
    label: 'Elevated',
    range: '7,500 – 15,000',
    shortLabel: '7.5K – 15K',
    color: '#f07d2f',
    min: 7500,
    max: 15000
  },
  {
    id: 'high',
    label: 'High',
    range: '15,000 – 30,000',
    shortLabel: '15K – 30K',
    color: '#df3b3b',
    min: 15000,
    max: 30000
  },
  {
    id: 'very-high',
    label: 'Very high',
    range: '30,000+',
    shortLabel: '30K+',
    color: '#8f1d1d',
    min: 30000,
    max: Infinity
  }
];

const LEVEL_BY_ID = new Map(LEVELS.map((level) => [level.id, level]));

/** Return the traffic level bucket for an AADT value. */
export function classifyVolume(aadt) {
  const volume = Number(aadt);
  if (!Number.isFinite(volume) || volume < 0) {
    return LEVEL_BY_ID.get('low');
  }

  for (const level of LEVELS) {
    if (volume >= level.min && volume < level.max) return level;
  }

  return LEVEL_BY_ID.get('very-high');
}

/** Line thickness grows with volume but stays readable at both extremes. */
export function lineWeight(aadt) {
  const volume = Math.max(0, Number(aadt) || 0);
  return Math.min(9, 1.4 + Math.pow(volume / 30000, 0.6) * 5);
}

export function formatNumber(value) {
  return new Intl.NumberFormat('en-CA', { maximumFractionDigits: 0 }).format(
    Number(value) || 0
  );
}

export function formatCompact(value) {
  const number = Number(value) || 0;

  const trimDecimalZeros = (text) =>
    text.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');

  if (number >= 1_000_000) {
    const millions = number / 1_000_000;
    const digits = millions >= 10 ? 1 : 2;
    return `${trimDecimalZeros(millions.toFixed(digits))}M`;
  }

  if (number >= 1_000) {
    const thousands = number / 1_000;

    if (thousands >= 999.5) {
      return `${trimDecimalZeros((number / 1_000_000).toFixed(1))}M`;
    }

    if (thousands >= 100) {
      return `${Math.round(thousands)}K`;
    }

    return `${trimDecimalZeros(thousands.toFixed(1))}K`;
  }

  return formatNumber(number);
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

/**
 * Group segments by street.
 *
 * The headline value is a length-weighted average AADT, so one short anomalous
 * segment cannot make an entire street look like a highway.
 */
export function aggregateStreets(features) {
  const streets = new Map();

  for (const feature of features) {
    const props = feature.properties ?? {};
    const street = String(props.street ?? '').trim() || 'Unnamed road';
    const aadt = Number(props.aadt) || 0;
    const length = Number(props.length) || 0;

    let entry = streets.get(street);
    if (!entry) {
      entry = {
        street,
        segmentCount: 0,
        totalLength: 0,
        weightedVolume: 0,
        peakAadt: 0
      };
      streets.set(street, entry);
    }

    entry.segmentCount += 1;
    entry.totalLength += length;
    entry.weightedVolume += aadt * length;
    entry.peakAadt = Math.max(entry.peakAadt, aadt);
  }

  return [...streets.values()]
    .map((entry) => ({
      street: entry.street,
      segmentCount: entry.segmentCount,
      lengthKm: entry.totalLength / 1000,
      avgAadt: entry.totalLength > 0 ? entry.weightedVolume / entry.totalLength : 0,
      peakAadt: entry.peakAadt,
      dailyVehicleKm: entry.weightedVolume / 1000
    }))
    .sort((a, b) => b.avgAadt - a.avgAadt);
}

/** Summary numbers for the current set of visible segments. */
export function computeStats(features) {
  let totalLength = 0;
  let dailyVehicleKm = 0;
  let highestVolume = 0;
  let highestVolumeStreet = '—';
  const streets = new Set();

  for (const feature of features) {
    const props = feature.properties ?? {};
    const aadt = Number(props.aadt) || 0;
    const length = Number(props.length) || 0;

    totalLength += length;
    dailyVehicleKm += (aadt * length) / 1000;
    streets.add(String(props.street ?? '').trim() || 'Unnamed road');

    if (aadt > highestVolume) {
      highestVolume = aadt;
      highestVolumeStreet = props.street || 'Unknown street';
    }
  }

  const ranked = aggregateStreets(features);
  const busiest = ranked[0] ?? null;

  return {
    segmentCount: features.length,
    streetCount: streets.size,
    totalLengthKm: totalLength / 1000,
    dailyVehicleKm,
    highestVolume,
    highestVolumeStreet,
    busiestStreet: busiest
  };
}

export function matchesFilters(props, filters) {
  const aadt = Number(props.aadt) || 0;

  if (filters.level && filters.level !== 'all') {
    if (classifyVolume(aadt).id !== filters.level) return false;
  }

  if (filters.roadClass && filters.roadClass !== 'all') {
    if (props.class !== filters.roadClass) return false;
  }

  if (filters.truckOnly) {
    const truck = String(props.truck ?? 'None').trim();
    if (!truck || truck.toLowerCase() === 'none') return false;
  }

  return true;
}

/** Pick the closest matching street name for a free-text query. */
export function findStreet(streets, query) {
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle) return null;

  const names = [...streets];
  return (
    names.find((name) => name.toLowerCase() === needle) ??
    names.find((name) => name.toLowerCase().startsWith(needle)) ??
    names.find((name) => name.toLowerCase().includes(needle)) ??
    null
  );
}
