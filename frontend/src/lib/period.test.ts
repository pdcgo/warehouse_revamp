import { describe, expect, it } from "vitest";

import { MAX_PERIOD_BUCKETS, MAX_PERIOD_DAYS, bucketSpine, spanBuckets, type PeriodGrain } from "./period";

// THE SPAN EACH GRAIN UNLOCKS (periods-are-grouped-on-the-server) — the browser's copy of backend/pkgs/san_period.
//
// The screen holds back a range the server would refuse and sends every range it would take, so both sides must count
// the same buckets against the same limits. Each case below is one of san_period's own (`grain_test.go`
// `TestCheckSpan`): if a number here ever moves without the Go one, the screen and the server disagree about a range.
describe("the span each grain unlocks", () => {
  it("is 366 days, 60 months and 20 years — the server's MaxBuckets", () => {
    expect(MAX_PERIOD_BUCKETS).toEqual({ day: 366, month: 60, year: 20 });
    expect(MAX_PERIOD_BUCKETS.day).toBe(MAX_PERIOD_DAYS);
  });

  const cases: [string, string, string, PeriodGrain, number, boolean][] = [
    ["a leap year of days fits", "2028-01-01", "2028-12-31", "day", 366, false],
    ["367 days do not", "2027-12-31", "2028-12-31", "day", 367, true],
    ["a month boundary is two months", "2026-01-31", "2026-02-01", "month", 2, false],
    ["60 months fit", "2022-01-01", "2026-12-31", "month", 60, false],
    ["61 months do not, by a day", "2021-12-31", "2026-12-31", "month", 61, true],
    ["a year boundary is two years", "2025-12-31", "2026-01-01", "year", 2, false],
    ["20 years fit", "2007-06-01", "2026-06-01", "year", 20, false],
    ["21 years do not", "2006-12-31", "2026-01-01", "year", 21, true],
    ["three years of days are refused", "2024-01-01", "2026-12-31", "day", 1096, true],
    ["three years of years are three rows", "2024-01-01", "2026-12-31", "year", 3, false],
  ];

  it.each(cases)("%s", (_name, from, to, grain, buckets, refused) => {
    expect(spanBuckets(from, to, grain)).toBe(buckets);
    expect(spanBuckets(from, to, grain) > MAX_PERIOD_BUCKETS[grain]).toBe(refused);
  });

  it("counts the same buckets the spine lays rows on", () => {
    for (const [, from, to, grain] of cases) {
      expect(bucketSpine(from, to, grain)).toHaveLength(spanBuckets(from, to, grain));
    }
  });

  it("is 0 for a missing end or a range that runs backwards, at every grain", () => {
    for (const grain of ["day", "month", "year"] as const) {
      expect(spanBuckets("", "2026-01-01", grain)).toBe(0);
      expect(spanBuckets("2026-01-01", "", grain)).toBe(0);
      expect(spanBuckets("2026-02-01", "2026-01-31", grain)).toBe(0);
    }
  });
});
