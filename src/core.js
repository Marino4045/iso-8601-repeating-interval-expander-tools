// Core implementation of the ISO 8601 repeating-interval expander.
//
// Scope decision (see README): we support the repeating form
//
//     R<n>/<start>/<duration>
//
// where <n> is a non-negative integer (or omitted/`R` for "unbounded"), <start>
// is an ISO 8601 datetime, and <duration> is an ISO 8601 duration that advances
// the start of each occurrence. We deliberately do NOT support the
// `<start>/<duration>` (no repeat count) form or the `<start>/<end>` form: the
// brief asks for a *bounded* list, so every expansion must be finite. An
// unbounded repeat (`R/...`) therefore throws unless the caller supplies an
// explicit `maxCount` cap.
//
// The awkward edge the reader will hit: ISO 8601 durations are calendar-aware,
// not fixed-length. `P1M` is 28, 29, 30 or 31 days depending on the month, and
// `P1D` can be 23 or 25 hours across a DST transition. We resolve that by doing
// all arithmetic in UTC fields, so a day is always 24 hours and a month is a
// calendar month. This makes expansions deterministic and independent of the
// host timezone, which is the only sane choice for a library that must be
// testable.

const DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/;

// ISO 8601 duration grammar, restricted to the designators we actually honour.
// Years and months are calendar units; weeks are exactly 7 days; days, hours,
// minutes and seconds are fixed-length. We do not support fractional components
// other than the seconds field, because mixing fractional months with calendar
// arithmetic is ambiguous.
const DURATION_RE =
  /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)(?:\.(\d{1,9}))?S)?)?$/;

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * A half-open datetime interval `[start, end)`.
 *
 * `start` and `end` are `Date` instances in UTC. We expose a class rather than a
 * plain object so that callers get a stable `instanceof` check and a useful
 * `toString`.
 */
export class Interval {
  /**
   * @param {Date} start inclusive lower bound
   * @param {Date} end exclusive upper bound
   */
  constructor(start, end) {
    if (!(start instanceof Date) || Number.isNaN(start.getTime())) {
      throw new TypeError('Interval start must be a valid Date');
    }
    if (!(end instanceof Date) || Number.isNaN(end.getTime())) {
      throw new TypeError('Interval end must be a valid Date');
    }
    if (end.getTime() < start.getTime()) {
      throw new RangeError('Interval end must not precede start');
    }
    this.start = start;
    this.end = end;
  }

  /** @returns {number} length in milliseconds */
  get durationMs() {
    return this.end.getTime() - this.start.getTime();
  }

  /** @returns {string} ISO 8601 representation, e.g. `2024-01-01T00:00:00.000Z/2024-01-02T00:00:00.000Z` */
  toString() {
    return `${this.start.toISOString()}/${this.end.toISOString()}`;
  }
}

/**
 * Parse an ISO 8601 datetime into a `Date`.
 *
 * We require an explicit offset (`Z` or `±HH:MM`) because a bare local time has
 * no unambiguous instant. Rejecting it keeps the library deterministic.
 *
 * @param {string} text
 * @returns {Date}
 */
function parseDateTime(text) {
  const m = DATETIME_RE.exec(text);
  if (!m) {
    throw new SyntaxError(`invalid ISO 8601 datetime: ${text}`);
  }
  const [, year, month, day, hour, minute, second, fraction, offset] = m;
  const y = Number(year);
  const mo = Number(month);
  const d = Number(day);
  const h = Number(hour);
  const mi = Number(minute);
  const s = second === undefined ? 0 : Number(second);
  const ms = fraction === undefined ? 0 : Number(fraction.padEnd(3, '0').slice(0, 3));

  if (mo < 1 || mo > 12) throw new SyntaxError(`month out of range: ${month}`);
  if (d < 1 || d > 31) throw new SyntaxError(`day out of range: ${day}`);
  if (h > 23) throw new SyntaxError(`hour out of range: ${hour}`);
  if (mi > 59) throw new SyntaxError(`minute out of range: ${minute}`);
  if (s > 60) throw new SyntaxError(`second out of range: ${second}`);

  let offsetMinutes = 0;
  if (offset !== 'Z') {
    const sign = offset[0] === '-' ? -1 : 1;
    const oh = Number(offset.slice(1, 3));
    const om = Number(offset.slice(4, 6));
    if (oh > 23 || om > 59) throw new SyntaxError(`offset out of range: ${offset}`);
    offsetMinutes = sign * (oh * 60 + om);
  }

  // `Date.UTC` normalises overflow, so we validate the calendar day ourselves by
  // round-tripping through the constructed date.
  const utcMs = Date.UTC(y, mo - 1, d, h, mi, s, ms) - offsetMinutes * MS_PER_MINUTE;
  const result = new Date(utcMs);
  if (Number.isNaN(result.getTime())) {
    throw new SyntaxError(`invalid datetime: ${text}`);
  }
  const check = new Date(utcMs + offsetMinutes * MS_PER_MINUTE);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    throw new SyntaxError(`calendar day does not exist: ${text}`);
  }
  return result;
}

/**
 * Parse an ISO 8601 duration into its component parts.
 *
 * @param {string} text
 * @returns {{years:number, months:number, weeks:number, days:number, hours:number, minutes:number, seconds:number, milliseconds:number}}
 */
function parseDuration(text) {
  const m = DURATION_RE.exec(text);
  if (!m) {
    throw new SyntaxError(`invalid ISO 8601 duration: ${text}`);
  }
  const [, y, mo, w, d, h, mi, s, frac] = m;
  if (y === undefined && mo === undefined && w === undefined && d === undefined &&
      h === undefined && mi === undefined && s === undefined) {
    throw new SyntaxError(`duration has no components: ${text}`);
  }
  return {
    years: y === undefined ? 0 : Number(y),
    months: mo === undefined ? 0 : Number(mo),
    weeks: w === undefined ? 0 : Number(w),
    days: d === undefined ? 0 : Number(d),
    hours: h === undefined ? 0 : Number(h),
    minutes: mi === undefined ? 0 : Number(mi),
    seconds: s === undefined ? 0 : Number(s),
    milliseconds: frac === undefined ? 0 : Number(frac.padEnd(3, '0').slice(0, 3)),
  };
}

/**
 * Add a parsed duration to a `Date`, using calendar arithmetic for years and
 * months and fixed-length arithmetic for the rest.
 *
 * Month addition clamps to the last valid day of the target month (Jan 31 +
 * 1 month = Feb 28/29) rather than overflowing into March. This matches the
 * behaviour of every calendar library I would want to interoperate with.
 *
 * @param {Date} date
 * @param {ReturnType<typeof parseDuration>} duration
 * @returns {Date}
 */
function addDuration(date, duration) {
  let year = date.getUTCFullYear() + duration.years;
  let month = date.getUTCMonth() + duration.months;
  year += Math.floor(month / 12);
  month = ((month % 12) + 12) % 12;

  const day = date.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDay);

  const base = Date.UTC(
    year,
    month,
    clampedDay,
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds(),
  );

  const fixedMs =
    duration.weeks * 7 * MS_PER_DAY +
    duration.days * MS_PER_DAY +
    duration.hours * MS_PER_HOUR +
    duration.minutes * MS_PER_MINUTE +
    duration.seconds * MS_PER_SECOND +
    duration.milliseconds;

  return new Date(base + fixedMs);
}

/**
 * Parse a repeating interval string.
 *
 * @param {string} text
 * @returns {{repeatCount:number|null, start:Date, duration:ReturnType<typeof parseDuration>, end:Date}}
 *   `repeatCount` is `null` for the unbounded `R/...` form.
 */
export function parseRepeatingInterval(text) {
  if (typeof text !== 'string') {
    throw new TypeError('repeating interval must be a string');
  }
  const parts = text.split('/');
  if (parts.length !== 3) {
    throw new SyntaxError(`repeating interval must have three parts: ${text}`);
  }
  const [repeat, startText, durationText] = parts;
  if (!repeat.startsWith('R')) {
    throw new SyntaxError(`repeating interval must start with R: ${text}`);
  }
  const countText = repeat.slice(1);
  let repeatCount;
  if (countText === '') {
    repeatCount = null;
  } else {
    if (!/^\d+$/.test(countText)) {
      throw new SyntaxError(`invalid repeat count: ${repeat}`);
    }
    repeatCount = Number(countText);
  }
  const start = parseDateTime(startText);
  const duration = parseDuration(durationText);
  const end = addDuration(start, duration);
  return { repeatCount, start, duration, end };
}

/**
 * Expand a repeating interval into a list of concrete `Interval`s.
 *
 * @param {string} text
 * @param {{maxCount?:number}} [options]
 * @returns {Interval[]}
 */
export function expandRepeatingInterval(text, options = {}) {
  const { repeatCount, start, duration, end } = parseRepeatingInterval(text);
  const maxCount = options.maxCount;

  let count;
  if (repeatCount === null) {
    if (!Number.isInteger(maxCount) || maxCount < 0) {
      throw new RangeError('unbounded repeating interval requires a non-negative integer maxCount');
    }
    count = maxCount;
  } else {
    count = repeatCount;
    if (Number.isInteger(maxCount) && maxCount >= 0 && maxCount < count) {
      count = maxCount;
    }
  }

  if (count === 0) return [];

  const intervals = [];
  let cursor = start;
  for (let i = 0; i < count; i++) {
    intervals.push(new Interval(cursor, addDuration(cursor, duration)));
    // Advance by re-adding the duration to the *original* start rather than
    // chaining additions. Chaining would accumulate month-clamping drift
    // (Jan 31 -> Feb 28 -> Mar 28 instead of Mar 31).
    cursor = addDuration(start, scaleDuration(duration, i + 1));
  }
  // The loop above computes `end` for the first interval twice; keep the parsed
  // `end` for the first element so the caller sees exactly what was parsed.
  if (intervals.length > 0) {
    intervals[0] = new Interval(start, end);
  }
  return intervals;
}

/**
 * Multiply every component of a duration by an integer factor.
 * @param {ReturnType<typeof parseDuration>} duration
 * @param {number} factor
 */
function scaleDuration(duration, factor) {
  return {
    years: duration.years * factor,
    months: duration.months * factor,
    weeks: duration.weeks * factor,
    days: duration.days * factor,
    hours: duration.hours * factor,
    minutes: duration.minutes * factor,
    seconds: duration.seconds * factor,
    milliseconds: duration.milliseconds * factor,
  };
}
