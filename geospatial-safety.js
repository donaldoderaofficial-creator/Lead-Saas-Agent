const VALID_ENVIRONMENTS = ['micro', 'macro'];
const VALID_SEVERITIES = ['low', 'moderate', 'high', 'critical'];

function parseDataset(value) {
  if (!value) return [];
  let dataset;
  try {
    dataset = JSON.parse(value);
  } catch (_) {
    throw new Error('GEOSPATIAL_DATASET_JSON must contain valid JSON');
  }
  if (!Array.isArray(dataset)) throw new Error('GEOSPATIAL_DATASET_JSON must be a JSON array');
  return dataset;
}

function validateObservation(observation) {
  const latitude = Number(observation.latitude);
  const longitude = Number(observation.longitude);
  if (!VALID_ENVIRONMENTS.includes(observation.environment)) throw new Error('environment must be micro or macro');
  if (!observation.businessId || typeof observation.businessId !== 'string') throw new Error('businessId is required');
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new Error('latitude must be between -90 and 90');
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new Error('longitude must be between -180 and 180');
  if (!VALID_SEVERITIES.includes(observation.severity)) throw new Error(`severity must be one of ${VALID_SEVERITIES.join(', ')}`);
  if (!observation.injuryType || !observation.description) throw new Error('injuryType and description are required');
  const observedAt = observation.observedAt || new Date().toISOString();
  if (Number.isNaN(Date.parse(observedAt))) throw new Error('observedAt must be a valid date');
  return {
    businessId: observation.businessId.trim(),
    environment: observation.environment,
    observedAt: new Date(observedAt).toISOString(),
    latitude,
    longitude,
    injuryType: String(observation.injuryType).trim().slice(0, 120),
    severity: observation.severity,
    description: String(observation.description).trim().slice(0, 2000),
    sourceDataset: observation.sourceDataset || 'runtime-init',
  };
}

module.exports = { VALID_ENVIRONMENTS, VALID_SEVERITIES, parseDataset, validateObservation };