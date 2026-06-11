/**
 * Canonical IST (Asia/Kolkata) date helper.
 *
 * ROOT-CAUSE FIX: every lead write path must derive `date_char` / `Date` from this
 * helper so the stored date is ALWAYS the India-local calendar date that the
 * dashboard displays — never the server/UTC date.
 *
 * The recurring "early-morning lead filed under the previous day" bug happened
 * because different sync paths computed the date inconsistently:
 *   - `created_time.split('T')[0]`  → correct ONLY if the timestamp carries the
 *                                      +05:30 offset; gives the UTC day for `...Z`.
 *   - `new Date(t).toISOString().split('T')[0]` → always the UTC day (wrong for
 *                                      00:00–05:29 IST, which is the prior UTC day).
 *
 * `istDateChar` is correct for ANY input form (offset, `Z`, or naive) because it
 * converts the absolute instant to the Asia/Kolkata calendar date. IST has no DST,
 * so this is stable year-round.
 */

const IST_TZ = 'Asia/Kolkata';

/**
 * IST calendar date as 'YYYY-MM-DD' for any timestamp. Returns '' if unparseable.
 * @param {string|Date|number} input
 * @returns {string}
 */
function istDateChar(input) {
  if (input == null || input === '') return '';
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) return '';
  // 'en-CA' locale formats as YYYY-MM-DD; timeZone pins it to India local date.
  return d.toLocaleDateString('en-CA', { timeZone: IST_TZ });
}

module.exports = { istDateChar, IST_TZ };
