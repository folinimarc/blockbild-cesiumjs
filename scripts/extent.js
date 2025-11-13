export function isValidExtent(extent) {
  if (!extent || typeof extent !== 'object') {
    return false;
  }

  const { west, south, east, north } = extent;

  if (![west, south, east, north].every((value) => typeof value === 'number' && Number.isFinite(value))) {
    return false;
  }

  if (west >= east || south >= north) {
    return false;
  }

  if (west < -180 || east > 180 || south < -90 || north > 90) {
    return false;
  }

  return true;
}

export function normalizeExtent(extent) {
  if (!isValidExtent(extent)) {
    return null;
  }

  const round = (value) => Number.parseFloat(Number(value).toFixed(5));

  return {
    west: round(extent.west),
    south: round(extent.south),
    east: round(extent.east),
    north: round(extent.north),
  };
}
