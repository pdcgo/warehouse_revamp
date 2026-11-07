import { afterEach, describe, expect, it, vi } from "vitest";

import type { DateRange } from "../components/datetime/DateRangePicker";
import { dateInputToUnix, daysSinceUnix, unixToDateInput } from "./datetime";
import {
  addDays,
  firstOfMonthBack,
  jakartaDayEndUnix,
  jakartaDayOfUnix,
  jakartaDaysSince,
  jakartaDayStartUnix,
  jakartaToday,
  jakartaUnixWindowOf,
  jakartaWindowOf,
  sameDayMonthsBack,
} from "./jakartaDay";

// THE WINDOW IS JAKARTA DAYS ON ANY MACHINE (backlog #37, the-system-runs-on-jakarta-time). `npm run test:unit`
// (vitest.unit.config.ts — plain Node, no browser).
//
// The browser's zone is played by Node's: vi.stubEnv sets process.env.TZ, which Node applies to every Date at once. So
// every rule below is run under zones on BOTH sides of WIB, and `theOldViewerMidnightWindow` — the `windowOf` the screens
// used before — is run beside it to prove the zones really differ there: this file fails for viewer-midnight math even
// when the machine running it sits in Jakarta.

const ZONES = ["UTC", "America/Los_Angeles", "Asia/Makassar", "Asia/Jayapura", "Asia/Jakarta"] as const;

afterEach(() => {
  vi.unstubAllEnvs();
});

const at = (iso: string): Date => new Date(iso);
const unix = (iso: string): bigint => BigInt(Math.floor(new Date(iso).getTime() / 1000));

const WEEK: DateRange = { kind: "relative", days: 7 };
const TODAY: DateRange = { kind: "relative", days: 1 };
const MONTH: DateRange = { kind: "relative", months: 1 };

// The old cut, kept here only as the mutant: resolveRange's local-Date arithmetic, formatted back in local time.
function theOldViewerMidnightWindow(range: DateRange, now: Date): { from: string; to: string } {
  const local = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (range.kind === "absolute") return { from: range.from, to: range.to };
  if (range.months !== undefined) {
    const first = new Date(now.getFullYear(), now.getMonth() - range.months, 1);
    const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const back = new Date(first.getFullYear(), first.getMonth(), Math.min(now.getDate(), lastDay) + 1);
    return { from: local(back), to: local(now) };
  }
  return { from: local(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (range.days - 1))), to: local(now) };
}

// The edges, each one an instant and the Jakarta answer for it.
const CASES: Array<{ name: string; now: string; range: DateRange; want: { from: string; to: string } }> = [
  // 00:30 WIB on 8 Nov is still 17:30 UTC on the 7th — a UTC viewer's midnight has not come yet
  { name: "00:30 WIB, a week", now: "2026-11-07T17:30:00Z", range: WEEK, want: { from: "2026-11-02", to: "2026-11-08" } },
  { name: "00:30 WIB, today", now: "2026-11-07T17:30:00Z", range: TODAY, want: { from: "2026-11-08", to: "2026-11-08" } },
  { name: "00:30 WIB, a month", now: "2026-11-07T17:30:00Z", range: MONTH, want: { from: "2026-10-09", to: "2026-11-08" } },
  // 23:30 WIB on the 7th — a viewer in Makassar or Jayapura is already on the 8th
  { name: "23:30 WIB, a week", now: "2026-11-07T16:30:00Z", range: WEEK, want: { from: "2026-11-01", to: "2026-11-07" } },
  // the last second of a Jakarta day and the first of the next
  { name: "23:59:59 WIB", now: "2026-11-07T16:59:59Z", range: TODAY, want: { from: "2026-11-07", to: "2026-11-07" } },
  { name: "00:00:00 WIB", now: "2026-11-07T17:00:00Z", range: TODAY, want: { from: "2026-11-08", to: "2026-11-08" } },
  // a month back from the 31st lands on February's last day, so the window opens on 1 Mar
  { name: "31 Mar, a month", now: "2026-03-31T03:00:00Z", range: MONTH, want: { from: "2026-03-01", to: "2026-03-31" } },
  // 00:30 WIB on 1 Dec — the month has turned in Jakarta, not yet on UTC
  { name: "1 Dec 00:30 WIB, a month", now: "2026-11-30T17:30:00Z", range: MONTH, want: { from: "2026-11-02", to: "2026-12-01" } },
  // and the year
  { name: "1 Jan 00:00 WIB, a week", now: "2026-12-31T17:00:00Z", range: WEEK, want: { from: "2026-12-26", to: "2027-01-01" } },
];

describe("jakartaWindowOf — a range in Jakarta days", () => {
  for (const c of CASES) {
    it(`${c.name} → ${c.want.from} … ${c.want.to}`, () => {
      expect(jakartaWindowOf(c.range, at(c.now))).toEqual(c.want);
    });
  }

  it("keeps an absolute range as typed, and an open end open", () => {
    expect(jakartaWindowOf({ kind: "absolute", from: "2026-10-01", to: "2026-10-15" })).toEqual({
      from: "2026-10-01",
      to: "2026-10-15",
    });
    expect(jakartaWindowOf({ kind: "absolute", from: "", to: "" })).toEqual({ from: "", to: "" });
  });

  for (const tz of ZONES) {
    it(`gives the same days in a browser on ${tz}`, () => {
      vi.stubEnv("TZ", tz);

      for (const c of CASES) {
        expect(jakartaWindowOf(c.range, at(c.now)), c.name).toEqual(c.want);
      }
    });
  }

  for (const tz of ZONES.filter((z) => z !== "Asia/Jakarta")) {
    it(`would catch the old viewer-midnight window on ${tz}`, () => {
      vi.stubEnv("TZ", tz);

      // the zone switch took effect, and the old cut answers at least one edge with another day there
      const wrong = CASES.filter((c) => JSON.stringify(theOldViewerMidnightWindow(c.range, at(c.now))) !== JSON.stringify(c.want));
      expect(wrong.length).toBeGreaterThan(0);
    });
  }
});

describe("jakartaUnixWindowOf / resolveRange's bounds — Jakarta midnights", () => {
  for (const tz of ZONES) {
    it(`on ${tz}: 00:00 WIB of the first day through 23:59:59 WIB of the last`, () => {
      vi.stubEnv("TZ", tz);

      expect(jakartaUnixWindowOf(TODAY, at("2026-11-07T17:30:00Z"))).toEqual({
        fromUnix: unix("2026-11-08T00:00:00+07:00"),
        toUnix: unix("2026-11-08T23:59:59+07:00"),
      });
      expect(jakartaUnixWindowOf({ kind: "absolute", from: "2026-11-07", to: "2026-11-07" })).toEqual({
        fromUnix: unix("2026-11-07T00:00:00+07:00"),
        toUnix: unix("2026-11-07T23:59:59+07:00"),
      });
      expect(jakartaUnixWindowOf({ kind: "absolute", from: "2026-08-01", to: "" })).toEqual({
        fromUnix: unix("2026-08-01T00:00:00+07:00"),
        toUnix: 0n,
      });
      expect(jakartaUnixWindowOf({ kind: "absolute", from: "", to: "" })).toEqual({ fromUnix: 0n, toUnix: 0n });
    });
  }
});

describe("the day helpers", () => {
  for (const tz of ZONES) {
    it(`on ${tz}`, () => {
      vi.stubEnv("TZ", tz);

      expect(jakartaToday(at("2026-11-07T16:59:59Z"))).toBe("2026-11-07");
      expect(jakartaToday(at("2026-11-07T17:00:00Z"))).toBe("2026-11-08");
      expect(jakartaDayOfUnix(unix("2026-11-07T17:30:00Z"))).toBe("2026-11-08");
      expect(jakartaDayOfUnix(0n)).toBe("");

      expect(jakartaDayStartUnix("2026-11-08")).toBe(unix("2026-11-07T17:00:00Z"));
      expect(jakartaDayEndUnix("2026-11-08")).toBe(unix("2026-11-08T16:59:59Z"));
      expect(jakartaDayStartUnix("")).toBe(0n);
      expect(jakartaDayEndUnix("not a day")).toBe(0n);

      expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
      expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
      expect(sameDayMonthsBack("2026-03-31", 1)).toBe("2026-02-28");
      expect(sameDayMonthsBack("2026-08-15", 12)).toBe("2025-08-15");
      expect(firstOfMonthBack("2026-11-07", 11)).toBe("2025-12-01");
      expect(firstOfMonthBack("2026-01-31", 0)).toBe("2026-01-01");

      // calendar days, not 24-hour blocks: 23:00 WIB last night is "1 day" at 08:00 WIB this morning
      expect(jakartaDaysSince(unix("2026-11-06T23:00:00+07:00"), at("2026-11-07T08:00:00+07:00"))).toBe(1);
      expect(jakartaDaysSince(unix("2026-11-07T00:10:00+07:00"), at("2026-11-07T23:50:00+07:00"))).toBe(0);
      expect(jakartaDaysSince(0n, at("2026-11-07T08:00:00+07:00"))).toBe(0);
    });
  }
});

describe("lib/datetime's day ↔ unix conversions read Jakarta days", () => {
  for (const tz of ZONES) {
    it(`on ${tz}`, () => {
      vi.stubEnv("TZ", tz);

      expect(dateInputToUnix("2026-08-15", false)).toBe(unix("2026-08-15T00:00:00+07:00"));
      expect(dateInputToUnix("2026-08-15", true)).toBe(unix("2026-08-15T23:59:59+07:00"));
      expect(dateInputToUnix("", false)).toBe(0n);
      // the round trip a DatePicker's label makes: the day it shows is the day it holds
      expect(unixToDateInput(dateInputToUnix("2026-08-15", false))).toBe("2026-08-15");
      expect(unixToDateInput(dateInputToUnix("2026-08-15", true))).toBe("2026-08-15");
      expect(unixToDateInput(0n)).toBe("");
      expect(daysSinceUnix(unix(new Date(Date.now() - 2 * 86_400_000).toISOString()))).toBe(2);
    });
  }
});
