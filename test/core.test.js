import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseRepeatingInterval,
  expandRepeatingInterval,
  Interval,
} from '../src/index.js';

test('parses a bounded repeating interval', () => {
  const parsed = parseRepeatingInterval('R3/2024-01-01T00:00:00Z/P1D');
  assert.equal(parsed.repeatCount, 3);
  assert.equal(parsed.start.toISOString(), '2024-01-01T00:00:00.000Z');
  assert.equal(parsed.end.toISOString(), '2024-01-02T00:00:00.000Z');
  assert.equal(parsed.duration.days, 1);
});

test('expands a bounded daily interval', () => {
  const intervals = expandRepeatingInterval('R3/2024-01-01T00:00:00Z/P1D');
  assert.equal(intervals.length, 3);
  assert.deepEqual(
    intervals.map((i) => i.toString()),
    [
      '2024-01-01T00:00:00.000Z/2024-01-02T00:00:00.000Z',
      '2024-01-02T00:00:00.000Z/2024-01-03T00:00:00.000Z',
      '2024-01-03T00:00:00.000Z/2024-01-04T00:00:00.000Z',
    ],
  );
  assert.ok(intervals[0] instanceof Interval);
});

test('R0 yields an empty list', () => {
  assert.deepEqual(expandRepeatingInterval('R0/2024-01-01T00:00:00Z/P1D'), []);
});

test('unbounded repeat requires maxCount', () => {
  assert.throws(
    () => expandRepeatingInterval('R/2024-01-01T00:00:00Z/P1D'),
    /maxCount/,
  );
  const intervals = expandRepeatingInterval('R/2024-01-01T00:00:00Z/P1D', { maxCount: 2 });
  assert.equal(intervals.length, 2);
  assert.equal(intervals[1].start.toISOString(), '2024-01-02T00:00:00.000Z');
});

test('maxCount caps a bounded repeat', () => {
  const intervals = expandRepeatingInterval('R10/2024-01-01T00:00:00Z/P1D', { maxCount: 3 });
  assert.equal(intervals.length, 3);
});

test('month arithmetic clamps to the last valid day', () => {
  const intervals = expandRepeatingInterval('R3/2024-01-31T00:00:00Z/P1M');
  assert.deepEqual(
    intervals.map((i) => i.start.toISOString()),
    [
      '2024-01-31T00:00:00.000Z',
      '2024-02-29T00:00:00.000Z', // 2024 is a leap year
      '2024-03-31T00:00:00.000Z', // not 2024-03-29
    ],
  );
});

test('month arithmetic does not drift across a year boundary', () => {
  const intervals = expandRepeatingInterval('R3/2023-11-30T00:00:00Z/P1M');
  assert.deepEqual(
    intervals.map((i) => i.start.toISOString()),
    [
      '2023-11-30T00:00:00.000Z',
      '2023-12-30T00:00:00.000Z',
      '2024-01-30T00:00:00.000Z',
    ],
  );
});

test('honours an explicit UTC offset', () => {
  const intervals = expandRepeatingInterval('R2/2024-01-01T05:30:00+05:30/PT1H');
  assert.equal(intervals[0].start.toISOString(), '2024-01-01T00:00:00.000Z');
  assert.equal(intervals[0].end.toISOString(), '2024-01-01T01:00:00.000Z');
  assert.equal(intervals[1].start.toISOString(), '2024-01-01T01:00:00.000Z');
});

test('fractional seconds are preserved and truncated to milliseconds', () => {
  const intervals = expandRepeatingInterval('R2/2024-01-01T00:00:00.5Z/PT0.25S');
  assert.equal(intervals[0].start.toISOString(), '2024-01-01T00:00:00.500Z');
  assert.equal(intervals[0].end.toISOString(), '2024-01-01T00:00:00.750Z');
  assert.equal(intervals[1].start.toISOString(), '2024-01-01T00:00:00.750Z');
});

test('weeks are exactly seven days', () => {
  const intervals = expandRepeatingInterval('R2/2024-03-01T00:00:00Z/P1W');
  assert.equal(intervals[1].start.toISOString(), '2024-03-08T00:00:00.000Z');
});

test('rejects malformed input', () => {
  assert.throws(() => parseRepeatingInterval('P1D'), /three parts/);
  assert.throws(() => parseRepeatingInterval('R3/2024-01-01T00:00:00Z'), /three parts/);
  assert.throws(() => parseRepeatingInterval('X3/2024-01-01T00:00:00Z/P1D'), /must start with R/);
  assert.throws(() => parseRepeatingInterval('R3/2024-01-01T00:00:00/P1D'), /invalid ISO 8601 datetime/);
  assert.throws(() => parseRepeatingInterval('R3/2024-02-30T00:00:00Z/P1D'), /calendar day/);
  assert.throws(() => parseRepeatingInterval('R3/2024-01-01T00:00:00Z/P'), /no components/);
  assert.throws(() => parseRepeatingInterval('R3/2024-01-01T00:00:00Z/P1X'), /invalid ISO 8601 duration/);
});

test('Interval rejects an inverted range', () => {
  const start = new Date('2024-01-02T00:00:00Z');
  const end = new Date('2024-01-01T00:00:00Z');
  assert.throws(() => new Interval(start, end), /precede/);
});

test('durationMs reports the interval length', () => {
  const intervals = expandRepeatingInterval('R1/2024-01-01T00:00:00Z/PT1H30M');
  assert.equal(intervals[0].durationMs, 90 * 60 * 1000);
});
