/**
 * Maps raw Meta Lead Form field names to display labels.
 * Meta API can return long/internal names (e.g. sugar level poll with Tamil text);
 * we normalize them for storage and UI.
 */
const FIELD_LABELS = {
  // Sugar poll – various possible raw names from Meta
  'what_is_your_sugar_level?_உங்கள்_சர்க்கரை_அளவு_என்ன?': 'Sugar Poll',
  'what_is_your_sugar_level?': 'Sugar Poll',
  'sugar_level': 'Sugar Poll',
  'Sugar Poll': 'Sugar Poll',
  'Sugar Level': 'Sugar Poll',
  'sugar level': 'Sugar Poll',

  // City – common variants so extraction finds fieldData.city
  'City': 'city',
  'city': 'city',
  'Your City': 'city',
  'Town': 'city',
  'town': 'city',
  'நகரம்': 'city',

  // Street / Address – normalize to "street" for fieldData.street
  'Street': 'street',
  'street': 'street',
  'Address': 'street',
  'address': 'street',
  'Street Address': 'street',
  'street_address': 'street',
  'Full Address': 'street',
  'Full address': 'street',
  'முகவரி': 'street',
};

/**
 * @param {string} rawName - Raw field name from API
 * @returns {string} Display label (FIELD_LABELS[rawName] or rawName)
 */
function getFieldLabel(rawName) {
  if (rawName == null || typeof rawName !== 'string') return String(rawName);
  return FIELD_LABELS[rawName] || rawName;
}

/**
 * Parse Meta lead field_data array into an object keyed by display labels.
 * Preserves both normalized keys (e.g. "Sugar Poll") and common lowercase keys for compatibility.
 *
 * @param {Array<{ name?: string, values?: string[] }>} fieldDataArray - From Meta API lead.field_data
 * @returns {Record<string, string>} Object with label keys and first value as string
 */
function parseFieldData(fieldDataArray) {
  const result = {};
  if (!Array.isArray(fieldDataArray)) return result;

  for (const item of fieldDataArray) {
    const rawName = item && item.name;
    if (rawName == null) continue;
    const label = getFieldLabel(String(rawName).trim());
    const values = item.values;
    const value = Array.isArray(values) && values.length > 0
      ? String(values[0]).trim()
      : '';
    result[label] = value;
    // Keep raw key for compatibility where code still looks up by raw name
    if (label !== rawName) {
      result[rawName] = value;
    }
  }

  return result;
}

/**
 * Get first value from object where key matches the pattern (e.g. /city/i).
 * Used as fallback when exact keys are not present (e.g. Meta uses "Your City").
 *
 * @param {Record<string, string>} obj - Parsed field data object
 * @param {RegExp} pattern - Pattern to match key
 * @returns {string} First non-empty value or 'N/A'
 */
function findFirstValueByKeyPattern(obj, pattern) {
  if (!obj || typeof obj !== 'object') return 'N/A';
  for (const [key, value] of Object.entries(obj)) {
    if (key && typeof key === 'string' && pattern.test(key) && value != null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return 'N/A';
}

module.exports = {
  FIELD_LABELS,
  getFieldLabel,
  parseFieldData,
  findFirstValueByKeyPattern,
};
