import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, api, login } from "./restock_helpers";
import { WEEKDAYS, grid, jakartaToday, pickDay, send } from "./warehouse_hours_helpers";

// ── a warehouse sets its hours — the checks behind docs/acceptances/teams/warehouse_hours.md, table *set up* (givens 1–8)
//
// Business: the-warehouse-sets-its-own-hours-in-settings (the warehouse's owner and admin set the receiving hours, the
// operating hours, the closures and the location on their own Settings, with the editors Edit warehouse uses; root and
// the administrator keep Teams → Edit warehouse; staff get no editor), a-warehouse-with-no-hours-is-not-closed (the
// *set your hours* prompt while none are set), a-warehouse-records-its-holidays (the closures).
//
// One test per role the given names, each signed in as a person of that role in a warehouse team of its OWN — one per
// (given, role) — so no row sees another's hours or closures. The ground (warehouses, people, given 5's closure) is
// seeded by root through the API in beforeAll; every WHEN is driven through the screen as the role.
//
//   1 (no hours set) → open settings
//      then: prompt to set hours — `settings-warehouse-hours-prompt` in the Hours and location card.
//   2 (receiving Mon–Sat 08:00–17:00) → set receiving hours on Settings (`receiving-hours-*`, one Save)
//      then: Settings shows new hours — the grid read again (reload): Mon–Sat open 08:00–17:00, Sunday closed; the
//            WarehouseInfoUpdate answer holds the same;
//      then: prompt gone — the prompt that stood before the save is gone, on the page and read again;
//      then: root's Edit warehouse shows same hours — root, Teams → the warehouse → Edit warehouse, the same grid.
//   3 (operating Mon–Sun 07:00–20:00) → set operating hours on Settings
//      then: warehouse profile shows new hours — the warehouse's profile is the team detail page's Warehouse section
//            (/teams/<id>, WarehouseInfoSection — the one screen that shows a warehouse's operating hours and location,
//            reached from Teams), read by root: every day 07:00–20:00.
//   4 (30 Mar – 6 Apr · "Idul Fitri") → add closure on Settings (`closure-first-day`, `closure-last-day`,
//      `closure-reason`, `closure-add`). The range is taken in the NEXT 30 Mar – 6 Apr from today (this year's while it
//      is still ahead), so it is a closure still to come — the list shows those only.
//      then: closure listed in Settings — its row `warehouse-closure-<id>` (the id from WarehouseClosureAdd's answer):
//            "<first> – <last> · Idul Fitri", on the page and read again.
//   5 (closure listed — seeded by root, a future "Idul Fitri") → delete closure (the row's bin → the confirm)
//      then: closure gone from Settings — the row gone, the list empty, on the page and read again.
//   6 (new address) → set location on Settings (`settings-warehouse-location`, Save)
//      then: warehouse profile shows new location — the profile's Location, read by root on /teams/<id>.
//   7 (warehouse:staff · no hours set) → open settings
//      then: no hours editor — the warehouse's Settings draws (its fee card), but no Hours and location card, no grid,
//            no location field, no closures card, no prompt. regression: WarehouseInfoUpdate and WarehouseClosureAdd
//            under the staff's own token answer permission_denied.
//   8 (root:administrator · receiving Mon–Sat 08:00–17:00) → set receiving hours, as root, on Teams → Edit warehouse
//      then: warehouse's Settings shows same hours — the warehouse's owner, signed in on a page of its own, reads the
//            same grid on its Settings, and no prompt.

const PASSWORD = "e2e-hours-setup-pass-1";
const SETTERS = [
  { given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", key: "O" },
  { given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", key: "A" },
] as const;
const STAFF = { given: "warehouse:staff", role: "ROLE_WAREHOUSE_STAFF", key: "S" } as const;
// Given 8's reader: the owner of the warehouse root edits.
const READER = { given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", key: "R" } as const;
type Person = { given: string; role: string; key: string };

const C1 = "no hours set";
const C2 = "receiving Mon–Sat 08:00–17:00";
const C3 = "operating Mon–Sun 07:00–20:00";
const C4 = '30 Mar – 6 Apr · "Idul Fitri"';
const C5 = "closure listed";
const C6 = "new address";
const C7 = "no hours set";
const C8 = "receiving Mon–Sat 08:00–17:00";

const MON_SAT = [1, 2, 3, 4, 5, 6];
const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];
const REASON = "Idul Fitri";

// The next 30 Mar – 6 Apr from today (Jakarta): this year's while 30 Mar is still ahead, else next year's.
const TODAY = jakartaToday();
const YEAR = TODAY < `${TODAY.slice(0, 4)}-03-30` ? Number(TODAY.slice(0, 4)) : Number(TODAY.slice(0, 4)) + 1;
const FIRST_DAY = `${YEAR}-03-30`;
const LAST_DAY = `${YEAR}-04-06`;

// A warehouse per (given, role): slot "2O" = given 2's owner. Team code HR<slot><SUFFIX> — 10 characters.
const slot = (given: number, p: Person) => `${given}${p.key}`;
const username = (s: string) => `e2ehr${s.toLowerCase()}${SUFFIX}`;
const address = (s: string) => `Jl. Gudang Jam ${s} No. ${SUFFIX}, Bekasi`;

const ground = {
  warehouses: {} as Record<string, string>,
  names: {} as Record<string, string>,
  // Given 5 — the closure already listed, per slot.
  closures: {} as Record<string, string>,
};

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await browser.newPage();
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const warehouseFor = async (s: string, p: Person) => {
    const name = `E2E Hours ${s} ${SUFFIX}`;
    const team = await api(page, "team.v1.TeamService/TeamCreate", {
      name,
      teamCode: `HR${s}${SUFFIX}`,
      type: "TEAM_TYPE_WAREHOUSE",
      ownerUserId: ROOT_USER_ID,
    });
    ground.warehouses[s] = String(team.team.id);
    ground.names[s] = name;
    await api(page, "user.v1.UserService/CreateUser", {
      teamId: ground.warehouses[s],
      username: username(s),
      password: PASSWORD,
      name: `Hours ${s} ${p.given} ${SUFFIX}`,
      role: p.role,
    });
  };

  // GIVEN — no hours set anywhere: no WarehouseInfoUpdate is ever sent for these warehouses before the WHEN.
  for (const given of [1, 2, 3, 4, 5, 6]) {
    for (const r of SETTERS) await warehouseFor(slot(given, r), r);
  }
  await warehouseFor(slot(7, STAFF), STAFF);
  await warehouseFor(slot(8, READER), READER);

  // GIVEN 5 — a closure listed: a future "Idul Fitri", added by root.
  for (const r of SETTERS) {
    const s = slot(5, r);
    const added = await api(page, "warehouse.v1.WarehouseInfoService/WarehouseClosureAdd", {
      teamId: ground.warehouses[s],
      firstDay: FIRST_DAY,
      lastDay: LAST_DAY,
      reason: REASON,
    });
    ground.closures[s] = String(added.closure.id);
  }

  await page.close();
});

async function asPerson(page: Page, s: string) {
  await login(page, username(s), PASSWORD);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), ground.warehouses[s]);
}

// WHEN — open settings: the warehouse's own Settings page, its Hours and location card loaded (the form seeded).
async function openSettings(page: Page) {
  await page.goto("/settings");
  // The warehouse's Settings is drawn: its fee card shows for every warehouse role.
  await expect(page.getByTestId("settings-warehouse-fee")).toBeVisible();
}

async function openHoursCard(page: Page) {
  await openSettings(page);
  await expect(page.getByTestId("settings-warehouse-hours")).toBeVisible();
  // Seeded from the saved profile — the location field replaces the loading spinner.
  await expect(page.getByTestId("settings-warehouse-location")).toBeVisible();
  await expect(page.getByTestId("settings-warehouse-hours-loading")).toHaveCount(0);
}

// Root on a page of its own (the saved sign-in) — the profile and Edit warehouse are root's Teams screens.
async function rootPage(browser: Browser): Promise<Page> {
  const root = await browser.newPage();
  await login(root, ROOT_USERNAME, ROOT_PASSWORD);
  return root;
}

// The warehouse's profile: Teams → the warehouse's detail page, its Warehouse section.
async function openProfile(page: Page, warehouseId: string) {
  await page.goto(`/teams/${warehouseId}`);
  await expect(page.getByTestId("team-detail-page")).toBeVisible();
  await expect(page.getByTestId("warehouse-detail-section")).toBeVisible();
}

// Root's Teams → Edit warehouse, from the warehouse's detail page.
async function openEditWarehouse(page: Page, warehouseId: string) {
  await openProfile(page, warehouseId);
  await page.getByTestId("warehouse-detail-edit").click();
  await expect(page.getByTestId("warehouse-edit-page")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/teams/${warehouseId}/edit$`));
}

// Type a weekly grid (WeeklyHoursEditor, `<id>-open-<day>` / `-from-<day>` / `-to-<day>`): `days` opened and timed.
async function typeGrid(page: Page, id: string, days: number[], from: string, to: string) {
  for (const day of days) {
    const toggle = page.getByTestId(`${id}-open-${day}`);
    if (!(await toggle.locator("input").isChecked())) await toggle.click();
    await expect(toggle.locator("input")).toBeChecked();
    await page.getByTestId(`${id}-from-${day}`).fill(from);
    await page.getByTestId(`${id}-to-${day}`).fill(to);
  }
}

// The grid as a page shows it: `days` open from–to, every other day closed (no time fields).
async function expectGrid(page: Page, id: string, days: number[], from: string, to: string) {
  for (const w of WEEKDAYS) {
    const toggle = page.getByTestId(`${id}-open-${w.day}`);
    if (days.includes(w.day)) {
      await expect.soft(toggle.locator("input"), `${id} ${w.name} open`).toBeChecked();
      await expect.soft(page.getByTestId(`${id}-from-${w.day}`), `${id} ${w.name} from`).toHaveValue(from);
      await expect.soft(page.getByTestId(`${id}-to-${w.day}`), `${id} ${w.name} to`).toHaveValue(to);
    } else {
      await expect.soft(toggle.locator("input"), `${id} ${w.name} closed`).not.toBeChecked();
      await expect.soft(page.getByTestId(`${id}-from-${w.day}`), `${id} ${w.name} no time`).toHaveCount(0);
    }
  }
}

type DayHours = { weekday?: string; open?: boolean; openTime?: string; closeTime?: string };

// The open days of a saved grid, as "WEEKDAY_x from–to" — proto3 JSON drops a closed day's false and empty times.
function openDays(rows: DayHours[] | undefined): string[] {
  return (rows ?? []).filter((d) => d.open).map((d) => `${d.weekday} ${d.openTime}–${d.closeTime}`);
}
function expectedDays(days: number[], from: string, to: string): string[] {
  return WEEKDAYS.filter((w) => days.includes(w.day)).map((w) => `${w.proto} ${from}–${to}`);
}

// Settings' one Save → WarehouseInfoUpdate; its answer.
async function saveSettings(page: Page): Promise<{ info?: { receivingHours?: DayHours[]; operatingHours?: DayHours[]; location?: string } }> {
  const answered = page.waitForResponse((res) => res.url().endsWith("WarehouseInfoService/WarehouseInfoUpdate"));
  await page.getByTestId("settings-warehouse-hours-save").click();
  const res = await answered;
  expect(res.status()).toBe(200);
  return res.json();
}

test.describe(`warehouse owner · admin wants to set their hours (${C1})`, () => {
  for (const r of SETTERS) {
    test(`${r.given} open settings (${C1})`, async ({ page }) => {
      const s = slot(1, r);
      await asPerson(page, s);

      // WHEN — open settings.
      await openHoursCard(page);

      await test.step("then: prompt to set hours", async () => {
        const prompt = page.getByTestId("settings-warehouse-hours").getByTestId("settings-warehouse-hours-prompt");
        await expect.soft(prompt).toBeVisible();
        await expect.soft(prompt).toContainText("Set your order-receiving hours");
        // …beside the editors to set them with.
        await expect.soft(page.getByTestId("receiving-hours")).toBeVisible();
        await expect.soft(page.getByTestId("operating-hours")).toBeVisible();
      });
    });
  }
});

test.describe(`warehouse owner · admin wants to set their hours (${C2})`, () => {
  for (const r of SETTERS) {
    test(`${r.given} set receiving hours (${C2})`, async ({ page, browser }) => {
      test.setTimeout(90_000);
      const s = slot(2, r);
      await asPerson(page, s);
      await openHoursCard(page);
      // GIVEN — no hours set: the prompt stands.
      const prompt = page.getByTestId("settings-warehouse-hours-prompt");
      await expect(prompt).toBeVisible();

      // WHEN — set receiving hours: Monday to Saturday, 08:00–17:00, one Save.
      await typeGrid(page, "receiving-hours", MON_SAT, "08:00", "17:00");
      const answer = await saveSettings(page);

      await test.step("then: prompt gone", async () => {
        await expect.soft(prompt).toHaveCount(0);
        await page.reload();
        await openHoursCard(page);
        await expect.soft(prompt).toHaveCount(0);
      });

      await test.step("then: Settings shows new hours", async () => {
        expect.soft(openDays(answer.info?.receivingHours)).toEqual(expectedDays(MON_SAT, "08:00", "17:00"));
        // Read again (the page reloaded above): the grid as saved.
        await expectGrid(page, "receiving-hours", MON_SAT, "08:00", "17:00");
      });

      await test.step("then: root's Edit warehouse shows same hours", async () => {
        const root = await rootPage(browser);
        await openEditWarehouse(root, ground.warehouses[s]!);
        await expectGrid(root, "receiving-hours", MON_SAT, "08:00", "17:00");
        await root.close();
      });
    });
  }
});

test.describe(`warehouse owner · admin wants to set their hours (${C3})`, () => {
  for (const r of SETTERS) {
    test(`${r.given} set operating hours (${C3})`, async ({ page, browser }) => {
      test.setTimeout(90_000);
      const s = slot(3, r);
      await asPerson(page, s);
      await openHoursCard(page);

      // WHEN — set operating hours: every day, 07:00–20:00, one Save.
      await typeGrid(page, "operating-hours", EVERY_DAY, "07:00", "20:00");
      const answer = await saveSettings(page);
      expect.soft(openDays(answer.info?.operatingHours)).toEqual(expectedDays(EVERY_DAY, "07:00", "20:00"));

      await test.step("then: warehouse profile shows new hours", async () => {
        const root = await rootPage(browser);
        await openProfile(root, ground.warehouses[s]!);
        const rows = root.getByTestId("warehouse-detail-operating").locator("tr");
        await expect.soft(rows).toHaveCount(7);
        for (const [i, w] of WEEKDAYS.entries()) {
          await expect.soft(rows.nth(i).locator("td").first()).toHaveText(w.name);
          await expect.soft(rows.nth(i).locator("td").nth(1), `${w.name} operating`).toHaveText("07:00–20:00");
        }
        await root.close();
      });
    });
  }
});

test.describe(`warehouse owner · admin wants to record a holiday (${C4})`, () => {
  for (const r of SETTERS) {
    test(`${r.given} add closure (${C4})`, async ({ page }) => {
      const s = slot(4, r);
      await asPerson(page, s);
      await openHoursCard(page);
      await expect(page.getByTestId("warehouse-closures-empty")).toBeVisible();

      // WHEN — add closure: 30 Mar – 6 Apr, "Idul Fitri".
      await pickDay(page, "closure-first-day", FIRST_DAY);
      await pickDay(page, "closure-last-day", LAST_DAY);
      await page.getByTestId("closure-reason").fill(REASON);
      const answered = page.waitForResponse((res) => res.url().endsWith("WarehouseInfoService/WarehouseClosureAdd"));
      await page.getByTestId("closure-add").click();
      const res = await answered;
      expect(res.status()).toBe(200);
      const closureId = String(((await res.json()) as { closure: { id: string } }).closure.id);

      await test.step("then: closure listed in Settings", async () => {
        const row = page.getByTestId(`warehouse-closure-${closureId}`);
        await expect.soft(row).toHaveText(`${FIRST_DAY} – ${LAST_DAY} · ${REASON}`);
        await expect.soft(page.getByTestId("warehouse-closures-empty")).toHaveCount(0);
        // …and still, read again.
        await page.reload();
        await openHoursCard(page);
        await expect.soft(page.getByTestId("warehouse-closures").locator('[data-testid^="warehouse-closure-"]:not([data-testid*="delete"]):not([data-testid$="-empty"])')).toHaveCount(1);
        await expect.soft(row).toHaveText(`${FIRST_DAY} – ${LAST_DAY} · ${REASON}`);
      });
    });
  }
});

test.describe(`warehouse owner · admin wants to record a holiday (${C5})`, () => {
  for (const r of SETTERS) {
    test(`${r.given} delete closure (${C5})`, async ({ page }) => {
      const s = slot(5, r);
      const closureId = ground.closures[s]!;
      await asPerson(page, s);
      await openHoursCard(page);
      // GIVEN — the closure listed.
      const row = page.getByTestId(`warehouse-closure-${closureId}`);
      await expect(row).toContainText(REASON);

      // WHEN — delete closure: the row's bin, then the confirm.
      await page.getByTestId(`warehouse-closure-delete-${closureId}`).click();
      const confirm = page.getByRole("alertdialog", { name: "Delete Closure" });
      await expect(confirm).toBeVisible();
      const answered = page.waitForResponse((res) => res.url().endsWith("WarehouseInfoService/WarehouseClosureDelete"));
      await confirm.getByTestId("confirm-action").click();
      expect((await answered).status()).toBe(200);

      await test.step("then: closure gone from Settings", async () => {
        await expect.soft(row).toHaveCount(0);
        await expect.soft(page.getByTestId("warehouse-closures-empty")).toBeVisible();
        // …and still gone, read again.
        await page.reload();
        await openHoursCard(page);
        await expect.soft(page.getByTestId("warehouse-closures-empty")).toBeVisible();
        await expect.soft(row).toHaveCount(0);
      });
    });
  }
});

test.describe(`warehouse owner · admin wants to set their location (${C6})`, () => {
  for (const r of SETTERS) {
    test(`${r.given} set location (${C6})`, async ({ page, browser }) => {
      test.setTimeout(90_000);
      const s = slot(6, r);
      await asPerson(page, s);
      await openHoursCard(page);

      // WHEN — set location: a new address, Save.
      await page.getByTestId("settings-warehouse-location").fill(address(s));
      const answer = await saveSettings(page);
      expect.soft(answer.info?.location).toBe(address(s));

      await test.step("then: warehouse profile shows new location", async () => {
        const root = await rootPage(browser);
        await openProfile(root, ground.warehouses[s]!);
        await expect.soft(root.getByTestId("warehouse-detail-section").getByText(address(s), { exact: true })).toBeVisible();
        await root.close();
      });
    });
  }
});

test.describe(`warehouse staff wants to set their hours (${C7})`, () => {
  test(`${STAFF.given} open settings (${C7})`, async ({ page }) => {
    const s = slot(7, STAFF);
    await asPerson(page, s);

    // WHEN — open settings (the page is drawn: its fee card).
    await openSettings(page);

    await test.step("then: no hours editor", async () => {
      await expect.soft(page.getByTestId("settings-warehouse-hours")).toHaveCount(0);
      await expect.soft(page.getByTestId("settings-warehouse-hours-prompt")).toHaveCount(0);
      await expect.soft(page.getByTestId("settings-warehouse-location")).toHaveCount(0);
      await expect.soft(page.getByTestId("receiving-hours")).toHaveCount(0);
      await expect.soft(page.getByTestId("operating-hours")).toHaveCount(0);
      await expect.soft(page.getByTestId("warehouse-closures")).toHaveCount(0);
      await expect.soft(page.getByTestId("settings-warehouse-hours-save")).toHaveCount(0);
    });

    await test.step("regression: the profile's writes refuse the staff", async () => {
      const update = await send(page, "warehouse.v1.WarehouseInfoService/WarehouseInfoUpdate", {
        teamId: ground.warehouses[s],
        receivingHours: grid(MON_SAT, "08:00", "17:00"),
      });
      expect.soft(update.json.code).toBe("permission_denied");
      const closure = await send(page, "warehouse.v1.WarehouseInfoService/WarehouseClosureAdd", {
        teamId: ground.warehouses[s],
        firstDay: FIRST_DAY,
        lastDay: LAST_DAY,
        reason: REASON,
      });
      expect.soft(closure.json.code).toBe("permission_denied");
    });
  });
});

test.describe(`root administrator wants to set a warehouse's hours (${C8})`, () => {
  test(`root:administrator set receiving hours (${C8})`, async ({ page, browser }) => {
    test.setTimeout(90_000);
    const s = slot(8, READER);
    const warehouseId = ground.warehouses[s]!;
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);

    // WHEN — set receiving hours, as root, on Teams → Edit warehouse: Monday to Saturday, 08:00–17:00, Save.
    await openEditWarehouse(page, warehouseId);
    await typeGrid(page, "receiving-hours", MON_SAT, "08:00", "17:00");
    const answered = page.waitForResponse((res) => res.url().endsWith("WarehouseInfoService/WarehouseInfoUpdate"));
    await page.getByTestId("warehouse-edit-save").click();
    expect((await answered).status()).toBe(200);
    await expect(page.getByTestId("team-detail-page")).toBeVisible();

    await test.step("then: warehouse's Settings shows same hours", async () => {
      // The warehouse's owner, on its own Settings.
      const owner = await browser.newPage();
      await asPerson(owner, s);
      await openHoursCard(owner);
      await expectGrid(owner, "receiving-hours", MON_SAT, "08:00", "17:00");
      await expect.soft(owner.getByTestId("settings-warehouse-hours-prompt")).toHaveCount(0);
      await owner.close();
    });
  });
});
