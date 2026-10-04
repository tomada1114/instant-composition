/** Optional local resource budget; the runner still executes every selected test.
 * @param {string | undefined} value @returns {number | undefined}
 */
export function testWorkers(value) {
  if (value === undefined) return undefined;
  const workers = Number(value);
  if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(workers))
    throw new RangeError(
      "ERR_TEST_WORKERS: INSTANT_COMPOSITION_TEST_WORKERS must be a positive integer. Next: unset it or use 1 on a busy machine.",
    );
  return workers;
}
