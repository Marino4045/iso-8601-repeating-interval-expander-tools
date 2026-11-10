# iso-8601-repeating-interval-expander-tools

Expands the ISO 8601 repeating-interval form `R<n>/<start>/<duration>` into a
bounded list of concrete `[start, end)` intervals.

```js
import { expandRepeatingInterval } from 'iso-8601-repeating-interval-expander-tools';

const intervals = expandRepeatingInterval('R3/2024-01-31T00:00:00Z/P1M');
for (const interval of intervals) {
  console.log(interval.toString());
}
// 2024-01-31T00:00:00.000Z/2024-02-29T00:00:00.000Z
// 2024-02-29T00:00:00.000Z/2024-03-31T00:00:00.000Z
// 2024-03-31T00:00:00.000Z/2024-04-30T00:00:00.000Z
```

The package exports three names:

- `parseRepeatingInterval(text)` returns `{ repeatCount, start, duration, end }`.
  `repeatCount` is `null` for the unbounded `R/...` form.
- `expandRepeatingInterval(text, options?)` returns an array of `Interval`s.
  `options.maxCount` caps the result, and is *required* for the unbounded form.
- `Interval` is the class of each result, with `start`, `end`, `durationMs` and
  `toString()`.

## Why this exists

The interesting part of ISO 8601 repeating intervals is not the parsing, it is
the arithmetic. A duration like `P1M` is not a fixed number of milliseconds: it
is a calendar month, and adding it to January 31 has to land on February 28 or
29 rather than spilling into March. A naive implementation that converts the
duration to milliseconds once and then adds it repeatedly produces a visibly
wrong expansion.

The trade-off this library makes is to do all arithmetic in UTC fields and to
advance each occurrence from the *original* start rather than from the previous
occurrence. That means a month-based expansion never accumulates clamping
drift, and the output does not depend on the host timezone. The cost is that
the library does not model DST transitions: a `P1D` step is always exactly 24
hours. If you need local-time semantics, convert your inputs to the relevant
offset before calling in.

## The edge you will hit

The unbounded form `R/2024-01-01T00:00:00Z/P1D` has no finite expansion, so
`expandRepeatingInterval` throws unless you pass `maxCount`. This is a
deliberate choice: the brief asks for a bounded list, and silently picking a cap
would hide the ambiguity. Pass `{ maxCount: n }` and you get exactly `n`
intervals (or fewer, if the repeat count is smaller).

Inputs must carry an explicit UTC offset (`Z` or `±HH:MM`); a bare local time
is rejected because it has no unambiguous instant.
