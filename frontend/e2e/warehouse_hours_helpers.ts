import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { API_URL } from "./env";

// THE WAREHOUSE-HOURS SPECS' SHARED HELPERS (docs/acceptances/teams/warehouse_hours.md) — warehouse_hours_wants_to_set_up
// (the set up table) and order_selling_wants_to_create_at_closed_warehouse (the order warning table). Not a spec file —
// it holds no test — so Playwright never runs it.

/** Monday … Sunday as the weekly grid's test ids number them (Weekday 1..7), with the names the profile table prints. */
export const WEEKDAYS = [
  { day: 1, name: "Monday", proto: "WEEKDAY_MONDAY" },
  { day: 2, name: "Tuesday", proto: "WEEKDAY_TUESDAY" },
  { day: 3, name: "Wednesday", proto: "WEEKDAY_WEDNESDAY" },
  { day: 4, name: "Thursday", proto: "WEEKDAY_THURSDAY" },
  { day: 5, name: "Friday", proto: "WEEKDAY_FRIDAY" },
  { day: 6, name: "Saturday", proto: "WEEKDAY_SATURDAY" },
  { day: 7, name: "Sunday", proto: "WEEKDAY_SUNDAY" },
] as const;

/** A weekly grid in WarehouseInfoUpdate's shape: `days` open from `from` to `to`, every other day closed. */
export function grid(days: readonly number[], from: string, to: string) {
  return WEEKDAYS.map((w) =>
    days.includes(w.day)
      ? { weekday: w.proto, open: true, openTime: from, closeTime: to }
      : { weekday: w.proto, open: false, openTime: "", closeTime: "" },
  );
}

/** A call that may be refused — its HTTP status and its JSON answer, never a throw — under the page's signed-in token. */
export async function send(page: Page, method: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  return page.evaluate(
    async ([m, b, apiUrl]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ?? window.localStorage.getItem("warehouse_revamp.token");
      const res = await fetch(`${apiUrl}/warehouse.${m as string}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(b),
      });
      return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
    },
    [method, body, API_URL] as const,
  );
}

// ── Asia/Jakarta days (UTC+7, no DST) — the warehouse's own clock, which the server judges in ──────────────────────────
const WIB_MS = 7 * 3600 * 1000;

/** Today in Jakarta, `YYYY-MM-DD`. */
export function jakartaToday(nowMs = Date.now()): string {
  return new Date(nowMs + WIB_MS).toISOString().slice(0, 10);
}

/** `iso` plus `n` calendar days. */
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The weekday of a `YYYY-MM-DD`, Monday 1 … Sunday 7 (the grid's numbering). */
export function weekdayOf(iso: string): number {
  const w = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return w === 0 ? 7 : w;
}

/** The instant `hh:mm` Jakarta time on day `iso`, in unix seconds. */
export function jakartaUnix(iso: string, hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return Math.floor((Date.parse(`${iso}T00:00:00Z`) + (h * 60 + m) * 60_000 - WIB_MS) / 1000);
}

/**
 * The next opening a receiving grid gives after now — the business rule (a-closed-day-warns-and-never-refuses: *the
 * next slot in the weekly grid, in Asia/Jakarta*; a-warehouse-records-its-holidays: *the first slot of the weekly grid
 * after the closure's last day*), worked out in the spec on its own, so the screen is checked against the RULE and not
 * against whatever the app answered. `open` maps a weekday (1..7) to its opening time; `closed` lists closure days.
 */
export function expectedNextOpening(open: Record<number, string>, closed: [string, string][], nowMs = Date.now()): number {
  const today = jakartaToday(nowMs);
  for (let i = 0; i <= 60; i++) {
    const day = addDays(today, i);
    if (closed.some(([first, last]) => first <= day && day <= last)) continue;
    const at = open[weekdayOf(day)];
    if (at !== undefined && jakartaUnix(day, at) * 1000 > nowMs) return jakartaUnix(day, at);
  }
  return 0;
}

/**
 * A unix instant as the app writes a short date and time (lib/datetime.ts `formatUnixDateTimeShort`: `28 Nov 08:00`, the
 * year only when it is not this year, the clock `HH:mm`, Jakarta), in the page's own language.
 */
export async function appShortDateTime(page: Page, unix: number): Promise<string> {
  return page.evaluate((u) => {
    const lang = document.documentElement.lang || undefined;
    const parts = (at: Date) =>
      Object.fromEntries(
        new Intl.DateTimeFormat(lang, {
          day: "numeric",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
          timeZone: "Asia/Jakarta",
        })
          .formatToParts(at)
          .map((p) => [p.type, p.value]),
      );
    const p = parts(new Date(u * 1000));
    const year = p.year !== parts(new Date()).year ? ` ${p.year}` : "";
    return `${p.day} ${p.month}${year} ${p.hour}:${p.minute}`;
  }, unix);
}

/**
 * Pick a day on a DatePicker (components/datetime/DatePicker.tsx): open its calendar (`<testId>` → `<testId>-content`),
 * page forward month by month until the day is drawn, click it (the calendar closes on a pick).
 */
export async function pickDay(page: Page, testId: string, iso: string): Promise<void> {
  await page.getByTestId(testId).click();
  const content = page.getByTestId(`${testId}-content`);
  await expect(content).toBeVisible();
  const cell = content
    .locator(`[data-part="table-cell-trigger"][data-value="${iso}"]:not([data-outside-range])`)
    .filter({ visible: true });
  for (let i = 0; i < 30; i++) {
    if ((await cell.count()) > 0) break;
    await content.locator('[data-part="next-trigger"]').filter({ visible: true }).click();
    await page.waitForTimeout(100);
  }
  await cell.click();
  await expect(content).toBeHidden();
}
