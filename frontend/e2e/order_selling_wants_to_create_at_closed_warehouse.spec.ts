import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, api, login, tick } from "./restock_helpers";
import { listLanded } from "./pickers";
import { addDays, appShortDateTime, expectedNextOpening, grid, jakartaToday, jakartaUnix, weekdayOf } from "./warehouse_hours_helpers";

// ── selling:all wants to create an order at a closed warehouse — the checks behind docs/acceptances/teams/
// warehouse_hours.md, table *order warning* (givens 9–11).
//
// Business: a-closed-day-warns-and-never-refuses (an order into a closed warehouse is created as usual; the form says
// when it will be handled — the next slot of the receiving grid, Asia/Jakarta — and the picker marks the warehouse, still
// selectable), a-warehouse-records-its-holidays (a closure names its reason and the first opening after it),
// a-warehouse-with-no-hours-is-not-closed (no receiving hours set → no closed warning, no badge).
//
// One test per selling role (selling:owner, selling:admin, selling:cs — `selling:all`), each through the seller's own
// order form (/orders/new, order_selling_wants_to_create.spec.ts's ground and WHEN), on a shop of its own. Three
// warehouses, seeded by root through the API in beforeAll — each with its fee (a warehouse with no rate takes no
// orders), a rack and, per case, a product of the seller restocked there (10 units; each role orders 2):
//   (warehouse with no hours set) — no WarehouseInfoUpdate ever: no profile row, `hours_set` false.
//   (warehouse closed now · opens Sat 08:00) — receiving hours Saturday 08:00–17:00 only, so it is closed now. The
//      server judges in the warehouse's time (Asia/Jakarta): if the run's now is INSIDE Saturday 08:00–17:00 the grid
//      takes Sunday instead (the warehouse must be closed now; the opening is still a single day at 08:00).
//   (warehouse in closure "Idul Fitri") — receiving every day 08:00–17:00 and a closure "Idul Fitri" from today to the
//      day after tomorrow (Jakarta), so the opening after it is in three days at 08:00.
// The three are named "E2E Hrs<SUFFIX> …", so typing `Hrs<SUFFIX>` in the warehouse picker shows exactly them.
//
// How each then is read:
// - `no closed warning` — the warehouse picked (its name on the picker's face) and its WarehouseReceivingStatus answer
//   landed (`hours_set` false, no closure) — the form has what it judges by — and no `warehouse-closed-note`.
// - `picker shows no badge` — the picker open on the three: the closed one (Sat) carries `warehouse-closed-badge-<id>`
//   (the control that badges do draw), the no-hours one none once its answer landed.
// - `warning names next opening` — `warehouse-closed-note` reads the app's closed-until sentence with the next opening
//   worked out by the RULE in the spec (the next Saturday 08:00 WIB from now), written as the app writes a short date
//   and time ("28 Nov 08:00"); the server's `next_opening_unix` is the same instant.
// - `picker badges warehouse` — the Sat warehouse's option carries `warehouse-closed-badge-<id>` ("Closed").
// - `order created` — Save is not held: the order's own page opens, one line of the product, pending.
// - `warning names Idul Fitri and the opening after it` — `warehouse-closed-note` reads "Closed for Idul Fitri — … handled
//   from <today + 3> 08:00 WIB."; the server's answer names the reason and that instant.

const PASSWORD = "e2e-hours-order-pass-1";
const ROLES = [
  { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "own" },
  { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "adm" },
  { given: "selling:cs", role: "ROLE_SELLING_CS", key: "cs" },
] as const;
type Role = (typeof ROLES)[number];

const C9 = "warehouse with no hours set";
const C10 = "warehouse closed now · opens Sat 08:00";
const C11 = 'warehouse in closure "Idul Fitri"';
const REASON = "Idul Fitri";

const STOCK = 10;
const QTY = 2;
const PLATFORM_TOTAL = 100_000;

// The three warehouses, by case.
const WH = {
  none: { code: `HCN${SUFFIX}`, name: `E2E Hrs${SUFFIX} None` },
  sat: { code: `HCS${SUFFIX}`, name: `E2E Hrs${SUFFIX} Sat` },
  fitri: { code: `HCF${SUFFIX}`, name: `E2E Hrs${SUFFIX} Fitri` },
} as const;
type Case = keyof typeof WH;
const FILTER = `Hrs${SUFFIX}`;

// Given 10's one receiving day — Saturday, unless the run's now (Jakarta) is inside Saturday 08:00–17:00, when the
// warehouse would be OPEN now: then Sunday, which is never "now" on a Saturday.
function closedNowDay(nowMs = Date.now()): number {
  const today = jakartaToday(nowMs);
  const insideSaturday =
    weekdayOf(today) === 6 && nowMs >= jakartaUnix(today, "08:00") * 1000 && nowMs < jakartaUnix(today, "17:00") * 1000;
  return insideSaturday ? 7 : 6;
}
const SAT_DAY = closedNowDay();
// Given 11's closure: today to the day after tomorrow, Jakarta.
const CLOSURE_FIRST = jakartaToday();
const CLOSURE_LAST = addDays(CLOSURE_FIRST, 2);
const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];

const username = (r: Role) => `e2ehc${r.key}${SUFFIX}`;
const sku = (c: Case) => `HCP${c.toUpperCase()}${SUFFIX}`;
const ref = (r: Role, c: Case) => `HC${SUFFIX}${r.key.toUpperCase()}${c.toUpperCase()}`;

const ground = {
  team: "",
  warehouses: {} as Record<Case, string>,
  products: {} as Record<Case, string>,
  shops: {} as Record<string, string>,
};

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await browser.newPage();
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string) =>
    String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
  ground.team = await team(`E2E Hrs${SUFFIX} Seller`, `HCL${SUFFIX}`, "TEAM_TYPE_SELLING");

  const users: Record<string, string> = {};
  for (const r of ROLES) {
    const made = await api(page, "user.v1.UserService/CreateUser", {
      teamId: ground.team,
      username: username(r),
      password: PASSWORD,
      name: `Hrs ${r.given} ${SUFFIX}`,
      role: r.role,
    });
    users[r.key] = String(made.user.id);
  }

  const supplier = String(
    (await api(page, "supplier.v1.SupplierService/SupplierCreate", { teamId: ground.team, name: `E2E Hrs Supplier ${SUFFIX}` }))
      .supplier.id,
  );
  const category = await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Hrs Cat ${SUFFIX}` });
  const account = String(
    (
      await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId: ground.team,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name: `E2E Hrs BCA ${SUFFIX}`,
        holderName: "E2E",
        accountNumber: `83${SUFFIX}45`,
        openingBalance: 10_000_000,
        openingOn: jakartaToday(),
      })
    ).account.id,
  );
  await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: ground.team,
    accountId: account,
    operational: true,
  });

  for (const c of Object.keys(WH) as Case[]) {
    const id = await team(WH[c].name, WH[c].code, "TEAM_TYPE_WAREHOUSE");
    ground.warehouses[c] = id;
    await api(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: id, feePercent: 10, minFee: 0 });
    const rack = String(
      (await api(page, "inventory.v1.RackService/RackCreate", { teamId: id, code: `hc-${c}-${SUFFIX}`, name: "E2E hours shelf" })).rack.id,
    );

    // The case's product, 10 units restocked from the seller's supplier and accepted onto the warehouse's rack.
    const code = sku(c);
    const productId = String(
      (
        await api(page, "product.v1.ProductService/ProductCreate", {
          teamId: ground.team,
          productCodePart: code,
          name: `E2E ${code}`,
          categoryId: category.category.id,
        })
      ).product.id,
    );
    ground.products[c] = productId;
    const raised = await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
      teamId: ground.team,
      warehouseId: id,
      financeAccountId: account,
      items: [{ productId, productCode: code, name: `E2E ${code}`, count: STOCK, total: 100_000, supplierId: supplier }],
    });
    await api(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
      teamId: id,
      requestId: raised.request.id,
      lines: [{ itemId: raised.request.items[0].id, receivedCount: STOCK, placements: [{ placementId: rack, quantity: STOCK }] }],
    });
  }

  // GIVEN (warehouse closed now · opens Sat 08:00) — receiving one day only, 08:00–17:00.
  await api(page, "warehouse.v1.WarehouseInfoService/WarehouseInfoUpdate", {
    teamId: ground.warehouses.sat,
    receivingHours: grid([SAT_DAY], "08:00", "17:00"),
  });
  // GIVEN (warehouse in closure "Idul Fitri") — receiving every day, and the closure over today.
  await api(page, "warehouse.v1.WarehouseInfoService/WarehouseInfoUpdate", {
    teamId: ground.warehouses.fitri,
    receivingHours: grid(EVERY_DAY, "08:00", "17:00"),
  });
  await api(page, "warehouse.v1.WarehouseInfoService/WarehouseClosureAdd", {
    teamId: ground.warehouses.fitri,
    firstDay: CLOSURE_FIRST,
    lastDay: CLOSURE_LAST,
    reason: REASON,
  });
  // (warehouse with no hours set) — nothing: no profile row at all.

  // The seller returns to the no-hours warehouse (create refuses a team with no return warehouse).
  await api(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", {
    teamId: ground.team,
    warehouseId: ground.warehouses.none,
  });

  // A shop per role, the role on it.
  let n = 0;
  for (const r of ROLES) {
    const shop = String(
      (
        await api(page, "selling.v1.ShopService/ShopCreate", {
          teamId: ground.team,
          name: `E2E Hrs Shop ${r.key} ${SUFFIX}`,
          shopCode: `H${++n}${SUFFIX}`,
          marketplace: "MARKETPLACE_SHOPEE",
        })
      ).shop.id,
    );
    ground.shops[r.key] = shop;
    await api(page, "selling.v1.ShopService/ShopUserAdd", { teamId: ground.team, shopId: shop, userId: users[r.key] });
  }

  await page.close();
});

type ReceivingState = { hoursSet?: boolean; receivingNow?: boolean; nextOpeningUnix?: string; closureReason?: string };

// Every WarehouseReceivingStatus the form asks, by warehouse id — an id asked and answered with nothing to say (proto3
// JSON drops false/zero) is still recorded, as `{}`.
function watchReceiving(page: Page): Map<string, ReceivingState> {
  const states = new Map<string, ReceivingState>();
  page.on("response", async (res) => {
    if (!res.url().endsWith("WarehouseInfoService/WarehouseReceivingStatus") || res.status() !== 200) return;
    try {
      const asked = (res.request().postDataJSON() as { warehouseIds?: string[] }).warehouseIds ?? [];
      const body = (await res.json()) as { states?: Record<string, ReceivingState> };
      for (const id of asked) states.set(String(id), body.states?.[String(id)] ?? {});
    } catch {
      // a page closing mid-read — nothing to record
    }
  });
  return states;
}

async function signInAs(page: Page, r: Role) {
  await login(page, username(r), PASSWORD);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), ground.team);
}

// The order form up to its warehouse: the buyer and the role's shop, then the warehouse picker OPEN on this spec's three
// warehouses (typed `Hrs<SUFFIX>`), left open for the caller to read.
async function openFormAndPicker(page: Page, r: Role, c: Case) {
  await page.goto("/orders/new");
  await expect(page.getByTestId("order-create-page")).toBeVisible();
  await page.getByTestId("order-create-customer-name").fill(`E2E Buyer ${r.key} ${c}`);
  await listLanded(page.locator('[data-testid^="shop-select-option-"]'));
  await page.getByTestId("shop-select").click();
  await page.getByTestId(`shop-select-option-${ground.shops[r.key]}`).click();

  await listLanded(page.locator(`[data-testid="team-select-option-${WH.none.code}"]`));
  await page.getByTestId("order-warehouse").locator("input").fill(FILTER);
  for (const k of Object.keys(WH) as Case[]) {
    await expect(option(page, k)).toBeVisible();
  }
}

const option = (page: Page, c: Case) => page.locator(`[data-testid="team-select-option-${WH[c].code}"]`).filter({ visible: true });
const badge = (page: Page, c: Case) => option(page, c).getByTestId(`warehouse-closed-badge-${ground.warehouses[c]}`);

// Pick the case's warehouse off the open picker; its name then sits on the picker's face.
async function pickWarehouse(page: Page, c: Case) {
  await option(page, c).click();
  await expect(page.getByTestId("order-warehouse").getByTestId("team-select-selected")).toContainText(WH[c].name);
}

// The rest of the WHEN — create order: the product (2), the order date, the marketplace's total and Order ID, the
// courier, Save. Returns the new order's id once its page opens.
async function finishAndSave(page: Page, r: Role, c: Case): Promise<string> {
  await page.getByTestId("order-create-add-line").click();
  await tick(page, sku(c));
  await page.getByTestId("product-picker-confirm").click();
  await page.getByTestId("order-line-qty-0").fill(String(QTY));

  await page.getByTestId("order-create-order-date").click();
  const today = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  await page.getByTestId("order-create-order-date-content").locator(`[data-part="table-cell-trigger"][data-value="${today}"]`).click();
  await page.keyboard.press("Escape");

  await page.getByTestId("order-marketplace-total").fill(String(PLATFORM_TOTAL));
  await page.getByTestId("order-external-ref-id").fill(ref(r, c));
  await page.getByTestId("shipment-channel-select").getByRole("combobox").click();
  await page.getByTestId("shipment-channel-option-jne").click();

  // A closed warehouse never holds Save (a-closed-day-warns-and-never-refuses).
  await expect(page.getByTestId("order-create-save")).toBeEnabled();
  await page.getByTestId("order-create-save").click();
  await expect(page).toHaveURL(/\/orders\/\d+$/, { timeout: 20_000 });
  await expect(page.getByTestId("order-detail-page")).toBeVisible();
  return /\/orders\/(\d+)$/.exec(page.url())![1]!;
}

async function expectOrderCreated(page: Page, c: Case) {
  const lines = page.getByTestId("section-items").locator('[data-testid^="order-item-"]');
  await expect.soft(lines).toHaveCount(1);
  await expect.soft(lines.first()).toContainText(sku(c));
  await expect.soft(page.getByTestId("stage-stepper")).toHaveAttribute("data-stage", "pending");
}

test.describe(`selling all wants to create an order (${C9})`, () => {
  for (const r of ROLES) {
    test(`${r.given} create order (${C9})`, async ({ page }) => {
      test.setTimeout(120_000);
      const states = watchReceiving(page);
      const none = ground.warehouses.none;
      await signInAs(page, r);

      // WHEN — create order, at the warehouse with no hours set.
      await openFormAndPicker(page, r, "none");

      await test.step("then: picker shows no badge", async () => {
        // Control: badges do draw — the closed-now warehouse beside it carries one.
        await expect.soft(badge(page, "sat")).toBeVisible();
        // The no-hours warehouse's own answer has landed: hours not set, no closure — and no badge for it.
        await expect.poll(() => states.has(none), { timeout: 15_000 }).toBe(true);
        expect.soft(states.get(none)?.hoursSet ?? false).toBe(false);
        expect.soft(states.get(none)?.closureReason ?? "").toBe("");
        await expect.soft(option(page, "none").getByTestId(`warehouse-closed-badge-${none}`)).toHaveCount(0);
        await expect.soft(page.getByTestId(`warehouse-closed-badge-${none}`)).toHaveCount(0);
      });

      await pickWarehouse(page, "none");

      await test.step("then: no closed warning", async () => {
        // The form has the warehouse (its name on the picker) and the answer it judges by.
        expect(states.has(none)).toBe(true);
        await expect.soft(page.getByTestId("order-warehouse-band").getByTestId("warehouse-closed-note")).toHaveCount(0);
        await expect.soft(page.getByTestId("warehouse-closed-note")).toHaveCount(0);
      });

      await finishAndSave(page, r, "none");
      await test.step("regression: the order is created", async () => {
        await expectOrderCreated(page, "none");
      });
    });
  }
});

test.describe(`selling all wants to create an order (${C10})`, () => {
  for (const r of ROLES) {
    test(`${r.given} create order (${C10})`, async ({ page }) => {
      test.setTimeout(120_000);
      const states = watchReceiving(page);
      const sat = ground.warehouses.sat;
      await signInAs(page, r);

      // WHEN — create order, at the warehouse closed now.
      await openFormAndPicker(page, r, "sat");

      await test.step("then: picker badges warehouse", async () => {
        await expect.soft(badge(page, "sat")).toBeVisible();
        await expect.soft(badge(page, "sat")).toHaveText("Closed");
      });

      await pickWarehouse(page, "sat");

      await test.step("then: warning names next opening", async () => {
        // The rule's next opening: the next <receiving day> 08:00 in Jakarta after now.
        const expected = expectedNextOpening({ [SAT_DAY]: "08:00" }, []);
        expect(expected).toBeGreaterThan(0);
        expect.soft(weekdayOf(new Date((expected + 7 * 3600) * 1000).toISOString().slice(0, 10))).toBe(SAT_DAY);
        const when = await appShortDateTime(page, expected);
        expect.soft(when).toMatch(/^\d{1,2} \S+( \d{4})? 08:00$/);
        const note = page.getByTestId("order-warehouse-band").getByTestId("warehouse-closed-note");
        await expect.soft(note).toHaveText(`Closed now — the order is still recorded, and handled from ${when} WIB.`);
        // The server judged the same: closed, hours set, that instant.
        await expect.poll(() => states.has(sat), { timeout: 15_000 }).toBe(true);
        expect.soft(states.get(sat)?.hoursSet ?? false).toBe(true);
        expect.soft(states.get(sat)?.receivingNow ?? false).toBe(false);
        expect.soft(Number(states.get(sat)?.nextOpeningUnix ?? 0)).toBe(expected);
      });

      const orderId = await finishAndSave(page, r, "sat");
      await test.step("then: order created", async () => {
        expect.soft(Number(orderId)).toBeGreaterThan(0);
        await expectOrderCreated(page, "sat");
      });
    });
  }
});

test.describe(`selling all wants to create an order (${C11})`, () => {
  for (const r of ROLES) {
    test(`${r.given} create order (${C11})`, async ({ page }) => {
      test.setTimeout(120_000);
      const states = watchReceiving(page);
      const fitri = ground.warehouses.fitri;
      await signInAs(page, r);

      // WHEN — create order, at the warehouse in its closure.
      await openFormAndPicker(page, r, "fitri");
      await expect.soft(badge(page, "fitri"), "regression: the picker badges it too").toBeVisible();
      await pickWarehouse(page, "fitri");

      await test.step("then: warning names Idul Fitri and the opening after it", async () => {
        // The rule's opening after the closure: the first slot after its last day — 08:00 the day after.
        const expected = expectedNextOpening({ 1: "08:00", 2: "08:00", 3: "08:00", 4: "08:00", 5: "08:00", 6: "08:00", 7: "08:00" }, [
          [CLOSURE_FIRST, CLOSURE_LAST],
        ]);
        expect(expected).toBe(jakartaUnix(addDays(CLOSURE_LAST, 1), "08:00"));
        const when = await appShortDateTime(page, expected);
        const note = page.getByTestId("order-warehouse-band").getByTestId("warehouse-closed-note");
        await expect.soft(note).toHaveText(`Closed for ${REASON} — the order is still recorded, and handled from ${when} WIB.`);
        await expect.poll(() => states.has(fitri), { timeout: 15_000 }).toBe(true);
        expect.soft(states.get(fitri)?.closureReason).toBe(REASON);
        expect.soft(Number(states.get(fitri)?.nextOpeningUnix ?? 0)).toBe(expected);
      });

      const orderId = await finishAndSave(page, r, "fitri");
      await test.step("then: order created", async () => {
        expect.soft(Number(orderId)).toBeGreaterThan(0);
        await expectOrderCreated(page, "fitri");
      });
    });
  }
});
