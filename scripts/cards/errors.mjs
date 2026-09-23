// The one error type every `pnpm cards:*` command raises for a failure that
// stops the command. A card-level rejection (a dropped card in `cards:add`, a
// rejected entry in `cards:update`) is a normal result, not one of these.

/**
 * Every code a `cards:*` command can exit with, grouped by what the caller
 * can do about it.
 *
 * - Fix the invocation: `ERR_CARDS_USAGE`, `ERR_CARDS_UNKNOWN_ID`,
 *   `ERR_CARDS_UNKNOWN_FIELD`, `ERR_CARDS_INPUT`.
 * - Fix the data the command read: `ERR_CARDS_CONTENT`,
 *   `ERR_CARDS_CARD_FILE`, `ERR_CARDS_TOMBSTONES`.
 * - Review the cards first: `ERR_CARDS_LINT`, `ERR_CARDS_STAMP_REFUSED`.
 * - Fix the environment: `ERR_CARDS_FORMATTER`, `ERR_CARDS_ID_SPACE`.
 *
 * @typedef {"ERR_CARDS_USAGE"
 *   | "ERR_CARDS_UNKNOWN_ID"
 *   | "ERR_CARDS_UNKNOWN_FIELD"
 *   | "ERR_CARDS_INPUT"
 *   | "ERR_CARDS_CONTENT"
 *   | "ERR_CARDS_CARD_FILE"
 *   | "ERR_CARDS_TOMBSTONES"
 *   | "ERR_CARDS_LINT"
 *   | "ERR_CARDS_STAMP_REFUSED"
 *   | "ERR_CARDS_FORMATTER"
 *   | "ERR_CARDS_ID_SPACE"} CardsErrorCode
 */

/**
 * @typedef {object} CardsErrorDetails
 * @property {string} expected - What the command needed.
 * @property {string} actual - What it found instead.
 * @property {string} next - The next safe command or step.
 * @property {unknown} [cause] - The underlying failure, when there is one.
 */

/** A failure that stops a `cards:*` command, reported on stderr. */
export class CardsError extends Error {
  /**
   * @param {CardsErrorCode} code - Stable identifier a caller branches on.
   * @param {string} message - One sentence saying what failed.
   * @param {CardsErrorDetails} details - Expected, actual and next step.
   */
  constructor(code, message, details) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = "CardsError";
    /** @type {CardsErrorCode} */
    this.code = code;
    this.expected = details.expected;
    this.actual = details.actual;
    this.next = details.next;
  }

  /**
   * The stderr report: code, what failed, expected versus actual, next step.
   *
   * @returns {string} The multi-line report.
   */
  report() {
    return (
      `${this.code}: ${this.message}\n` +
      `Expected: ${this.expected}\n` +
      `Actual: ${this.actual}\n` +
      `Next: ${this.next}`
    );
  }
}
