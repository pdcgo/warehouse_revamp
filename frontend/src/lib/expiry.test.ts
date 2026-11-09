import { afterEach, describe, expect, it, vi } from "vitest";

import { EXPIRING_SOON_DAYS, expiringSoonCutoffMs, isExpiringSoon } from "./expiry";

// The amber "expiring soon" state counts JAKARTA days, as the server's soonCutoff does: expiring on a Jakarta day up to
// and including today + 30. `npm run test:unit` (vitest.unit.config.ts — plain Node, no browser).

const wib = (iso: string): Date => new Date(`${iso}+07:00`);
const unix = (iso: string): bigint => BigInt(Math.floor(wib(iso).getTime() / 1000));

// The browser's zone, played by Node's: vi.stubEnv sets process.env.TZ, which Node applies to every Date at once.
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isExpiringSoon (Jakarta days, the server's soonCutoff)", () => {
  it("counts 30 days from today in Jakarta — 30 is the window", () => {
    expect(EXPIRING_SOON_DAYS).toBe(30);
  });

  it("at 23:30 WIB, the whole of today + 30 is soon and today + 31 is not", () => {
    const now = wib("2026-11-06T23:30:00");

    expect(new Date(expiringSoonCutoffMs(now)).toISOString()).toBe(wib("2026-12-07T00:00:00").toISOString());
    // late on the 30th day: the old now + 30 × 24 h (which ended 2026-12-06 23:30) read this as normal
    expect(isExpiringSoon(unix("2026-12-06T23:45:00"), now)).toBe(true);
    expect(isExpiringSoon(unix("2026-12-06T23:59:59"), now)).toBe(true);
    expect(isExpiringSoon(unix("2026-12-07T00:00:00"), now)).toBe(false);
  });

  it("at 00:30 WIB the day has turned: today + 30 is the next date, and the day after it is not soon", () => {
    // 00:30 WIB on the 7th is still 17:30 UTC on the 6th — a UTC day would cut here
    const now = wib("2026-11-07T00:30:00");

    expect(isExpiringSoon(unix("2026-12-07T23:59:59"), now)).toBe(true);
    expect(isExpiringSoon(unix("2026-12-08T00:00:00"), now)).toBe(false);
    // the old now + 30 × 24 h ended 2026-12-07 00:30 and missed the rest of that day
    expect(isExpiringSoon(unix("2026-12-07T12:00:00"), now)).toBe(true);
  });

  it("keeps an expired batch soon, and a batch with no expiry never", () => {
    const now = wib("2026-11-06T10:00:00");

    expect(isExpiringSoon(unix("2026-10-01T00:00:00"), now)).toBe(true);
    expect(isExpiringSoon(0n, now)).toBe(false);
  });

  for (const tz of ["UTC", "America/Los_Angeles", "Asia/Makassar"]) {
    it(`gives the same answer in a browser on ${tz}`, () => {
      vi.stubEnv("TZ", tz);
      // the zone switch took effect: 23:30 WIB on the 6th reads as another local day or hour there
      expect(new Date(wib("2026-11-06T23:30:00")).getHours()).not.toBe(23);

      for (const at of ["2026-11-06T23:30:00", "2026-11-07T00:30:00"]) {
        const now = wib(at);
        const cutoff = expiringSoonCutoffMs(now);

        vi.stubEnv("TZ", "Asia/Jakarta");
        const inJakarta = expiringSoonCutoffMs(now);
        vi.stubEnv("TZ", tz);

        expect(cutoff).toBe(inJakarta);
      }

      expect(isExpiringSoon(unix("2026-12-06T23:45:00"), wib("2026-11-06T23:30:00"))).toBe(true);
      expect(isExpiringSoon(unix("2026-12-07T00:00:00"), wib("2026-11-06T23:30:00"))).toBe(false);
      expect(isExpiringSoon(unix("2026-12-07T23:59:59"), wib("2026-11-07T00:30:00"))).toBe(true);
      expect(isExpiringSoon(unix("2026-12-08T00:00:00"), wib("2026-11-07T00:30:00"))).toBe(false);
    });
  }
});
