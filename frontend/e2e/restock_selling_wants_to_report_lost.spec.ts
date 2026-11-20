import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, login, api, ongoingOf, inboundRow } from "./restock_helpers";

// ── selling:all wants to report a lost restock — the checks behind docs/acceptances/inventory/restock.md ──────────────
//
// One test for the GIVEN — ongoing, a reason given — run as EVERY selling role, through the restock's own page and its
// Mark Lost (Tandai Hilang), whose dialog takes an optional reason. Each THEN is its own step, named exactly as its row,
// and checked SOFTLY so one failing then does not hide the next. The warehouse's side is read as one warehouse role
// (status-is-per-then). The restocks are the GIVEN, seeded through the API: each is 10 × one product for Rp 100.000, sent
// by JNE, paid from its OWN operational account (so no balance read is moved by another test's events) to its OWN
// warehouse (so that warehouse's queue is exactly this one restock).
//
// `lost` is set only while the restock is ongoing, by the selling team (lost-is-set-only-before-the-box-arrives,
// the-warehouse-signs-and-accepts-the-team-does-the-rest), and it moves no money: the parcel was paid for, and giving it
// up returns nothing (a-restock-is-cancelled-only-while-ongoing — "once it is lost, the money was spent").
//
// Where each then is read:
// - `status changed from ongoing to lost` — the restock's page, its title-row status (`restock-detail-status`); Mark Lost
//   and Cancel are gone.
// - `lost recorded in restock timeline` — the restock's Riwayat: ONE status row, ongoing → lost.
// - `reason shown in restock timeline` — that row's words carry the reason typed in the dialog.
// - `ongoing stock of 1 product decreases` — the product's Ongoing on the seller's product picker: 10 before, none after.
// - `target warehouse sees restock lost` — as the warehouse: its inbound list (every status) and the restock's page.
// - `total warehouse receive decreases` — the warehouse's inbound summary (what is on its way or at the door): 1 restock
//   and 10 pcs before, 0 and 0 after.
// - `operational account balance unchanged` — nothing is posted, so nothing arrives to wait for: the balance is read again
//   and again for ten seconds after the mark and never moves, and the account's history holds no new line for the restock.
//
// `lost recorded in analytic metric` — built by #85 (the-restock-before-the-accept-prototype-is-accepted: Units / Value
// lost on the way count on the LOST day). It is checked in every role's test, on the restock that role marked lost, as
// that role: Analytic › Inventory › Restock by product, this week, filtered to the product: `lost_count` = the 10 units,
// `lost_value` = their Rp 100.000 (the restock's whole total, no shipping), and `ordered_count` keeps its 10 — a lost box
// is not a cancel, so nothing takes the ordered back. Then, as a regression of
// a-lost-box-that-turns-up-takes-its-lost-back-on-its-day, its own test, on its own restock marked lost by selling:owner:
// the same box turns up, its warehouse signs for it as arrived (a-late-lost-box-is-signed-for-as-arrived), and the week's
// lost nets back to 0 while the ordered stays 10.
test.describe("selling:all wants to report a lost restock", () => {
  test.describe.configure({ timeout: 120_000 });

  const PASSWORD = "e2e-acceptance-pass-1";
  const ROLES = [
    { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "own" },
    { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "adm" },
    { given: "selling:cs", role: "ROLE_SELLING_CS", key: "cs" },
  ] as const;
  // The regression test's own restock — raised for, and marked lost by, selling:owner.
  const METRIC = "met";
  const COND = "status: ongoing · reason given · 1 product · 1 warehouse · operational account";

  const TOTAL = 100_000;
  const UNITS = 10;
  const reason = (role: string) => `kurir tidak bisa melacak paket ${role} ${SUFFIX}`;
  const rupiah = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;
  // RestockRequestStatus, as the badges' test ids carry it.
  const ONGOING = 1;
  const LOST = 5;

  const username = (role: string) => `e2elst${role}${SUFFIX}`;
  const productCode = (role: string) => `LS${role.toUpperCase()}${SUFFIX}`;
  const receipt = (role: string) => `E2E-LST-${role}-${SUFFIX}`.toUpperCase();

  const ground = {
    team: "",
    supplier: "",
    couriers: {} as Record<string, string>,
    // Per role (and the analytic check's own): its warehouse, that warehouse's staff user, the paying account, the product and
    // the restock.
    warehouses: {} as Record<string, string>,
    warehouseUsers: {} as Record<string, string>,
    accounts: {} as Record<string, string>,
    products: {} as Record<string, string>,
    restocks: {} as Record<string, string>,
  };

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    const page = await browser.newPage();
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);

    const team = async (name: string, teamCode: string, type: string) =>
      String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
    const user = (teamId: string, name: string, role: string) =>
      api(page, "user.v1.UserService/CreateUser", { teamId, username: name, password: PASSWORD, name, role });

    ground.team = await team(`E2E Lst Seller ${SUFFIX}`, `LSS${SUFFIX}`, "TEAM_TYPE_SELLING");
    for (const r of ROLES) await user(ground.team, username(r.key), r.role);

    // The seeded couriers' ids, by code.
    const channels = await api(page, "shipment.v1.ShipmentChannelService/ShipmentChannelList", {
      dataRequest: ["SHIPMENT_CHANNEL_LIST_DATA_TYPE_CHANNEL"],
      page: { page: 1, limit: 100 },
    });
    const map = (channels.items as { channel?: { mapData: Record<string, { code: string }> } }[]).find((item) => item.channel)
      ?.channel?.mapData;
    for (const [id, channel] of Object.entries(map ?? {})) ground.couriers[channel.code] = id;
    expect(ground.couriers.jne).toBeTruthy();

    ground.supplier = String(
      (await api(page, "supplier.v1.SupplierService/SupplierCreate", { teamId: ground.team, name: `E2E Lst Supplier ${SUFFIX}` }))
        .supplier.id,
    );
    const category = await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Lst Cat ${SUFFIX}` });

    let n = 0;
    for (const k of [...ROLES.map((r) => r.key), METRIC]) {
      n++;

      // The warehouse this restock goes to — its own, so its queue is this restock alone — and its staff.
      const warehouse = await team(`E2E Lst Warehouse ${n} ${SUFFIX}`, `LSW${n}${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
      ground.warehouses[k] = warehouse;
      ground.warehouseUsers[k] = `e2elstw${n}${SUFFIX}`;
      await user(warehouse, ground.warehouseUsers[k], "ROLE_WAREHOUSE_STAFF");

      const p = productCode(k);
      const productId = String(
        (
          await api(page, "product.v1.ProductService/ProductCreate", {
            teamId: ground.team,
            productCodePart: p,
            name: `E2E ${p}`,
            categoryId: category.category.id,
          })
        ).product.id,
      );
      ground.products[k] = productId;

      const created = await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId: ground.team,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name: `E2E Lst ${k} ${SUFFIX}`,
        holderName: "E2E",
        accountNumber: `82${SUFFIX}${n}`,
        openingBalance: 10_000_000,
        openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
      });
      const accountId = String(created.account.id);
      await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
        teamId: ground.team,
        accountId,
        operational: true,
      });
      ground.accounts[k] = accountId;

      // GIVEN — an ongoing restock of 10 × Rp 10.000, by JNE, paid from its own account.
      const restock = await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
        teamId: ground.team,
        warehouseId: warehouse,
        financeAccountId: accountId,
        shipmentId: ground.couriers.jne,
        receipt: receipt(k),
        shipmentCost: 0,
        items: [{ productId, productCode: p, name: `E2E ${p}`, count: UNITS, total: TOTAL, supplierId: ground.supplier }],
      });
      ground.restocks[k] = String(restock.request.id);
    }

    await page.close();
  });

  async function signIn(page: Page, user: string, team: string) {
    await login(page, user, PASSWORD);
    await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), team);
  }

  // An account's balance as its page shows it, once the line `text` is in its history — the create's payment — so a read
  // is never of an account an event has yet to reach.
  async function balanceOnceRecorded(page: Page, accountId: string, text: string): Promise<number> {
    let balance = 0;
    await expect(async () => {
      await page.goto(`/financial-accounts/${accountId}`);
      await expect(page.getByTestId("account-log-table")).toContainText(text, { timeout: 2_000 });
      const shown = page.getByTestId("account-detail-balance");
      await expect(shown).toHaveText(/\d/, { timeout: 2_000 });
      balance = Number((await shown.innerText()).replace(/[^\d-]/g, ""));
    }).toPass({ timeout: 30_000 });
    return balance;
  }

  // The account's history lines naming this restock — `Restock #12`, never `Restock #123`.
  const restockLines = (page: Page, id: string) =>
    page.locator("[data-testid^='account-log-row-']").filter({ hasText: new RegExp(`Restock #${id}(?!\\d)`) });

  // The warehouse's inbound summary — what is on its way or at the door: how many restocks, how many pieces.
  async function queueIs(page: Page, restocks: string, units: string) {
    await page.goto("/inventories/restock");
    await expect(page.getByTestId("restock-stat-restocks-value")).toHaveText(restocks);
    await expect(page.getByTestId("restock-stat-units-value")).toHaveText(units);
  }

  // A product's Ongoing on the seller's picker, re-read until it says `expected`.
  async function ongoingIs(page: Page, code: string, expected: string | RegExp) {
    await expect(async () => {
      await expect(await ongoingOf(page, code)).toHaveText(expected, { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
  }

  // WHEN — Mark Lost on the restock's own page, the reason typed, confirmed.
  async function markLost(page: Page, id: string, why: string) {
    await page.goto(`/inventories/restock/${id}`);
    await expect(page.getByTestId("restock-detail-status").getByTestId(`restock-status-${ONGOING}`)).toBeVisible();
    await page.getByTestId(`restock-action-mark-lost-${id}`).click();
    await page.getByTestId("restock-lost-reason").fill(why);
    await page.getByTestId("confirm-action").click();
    await expect(page.getByTestId("confirm-action")).toHaveCount(0);
  }

  // Restock by product, this week, filtered to the product, as `page`'s user: its lost units and value, and its ordered,
  // re-read until they land.
  async function restockReads(page: Page, product: string, lost: number) {
    await expect
      .soft(async () => {
        await page.goto(`/analytic?g=product&m=metrics/inventory/restock&r=7d&product=${product}`);
        await expect(page.getByTestId(`analytic-cell-${product}-lost_count`)).toHaveText(String(lost), { timeout: 3_000 });
        await expect(page.getByTestId(`analytic-cell-${product}-lost_value`)).toHaveText(rupiah(lost === 0 ? 0 : TOTAL));
        await expect(page.getByTestId(`analytic-cell-${product}-ordered_count`)).toHaveText(String(UNITS));
      })
      .toPass({ timeout: 30_000 });
  }

  for (const r of ROLES) {
    test(`${r.given} mark lost restock (${COND})`, async ({ page }) => {
      const id = ground.restocks[r.key];
      const account = ground.accounts[r.key];
      const warehouse = ground.warehouses[r.key];
      const warehouseUser = ground.warehouseUsers[r.key];
      const p = productCode(r.key);
      const why = reason(r.key);

      // GIVEN, as the warehouse: the restock is its whole queue — 1 restock, 10 pcs on their way.
      await signIn(page, warehouseUser, warehouse);
      await queueIs(page, "1", String(UNITS));

      // …and as the seller: the payment is on the account, the 10 pcs are Ongoing.
      await signIn(page, username(r.key), ground.team);
      const before = await balanceOnceRecorded(page, account, `Restock #${id}`);
      const linesBefore = await restockLines(page, id).count();
      expect(linesBefore).toBeGreaterThan(0);
      await ongoingIs(page, p, String(UNITS));

      // WHEN — as this role.
      await markLost(page, id, why);

      // THEN — as the seller: the restock's page and its Riwayat, the picker's Ongoing, the account.
      await test.step("then: status changed from ongoing to lost", async () => {
        await page.goto(`/inventories/restock/${id}`);
        await expect.soft(page.getByTestId("restock-detail-status").getByTestId(`restock-status-${LOST}`)).toBeVisible();
        // A lost restock takes neither again — no Mark Lost, no Cancel.
        await expect.soft(page.getByTestId(`restock-action-mark-lost-${id}`)).toHaveCount(0);
        await expect.soft(page.getByTestId(`restock-action-cancel-${id}`)).toHaveCount(0);
      });
      const moves = page.locator("[data-testid^='restock-timeline-'][data-kind='status']");
      await test.step("then: lost recorded in restock timeline", async () => {
        await page.goto(`/inventories/restock/${id}`);
        await expect.soft(moves).toHaveCount(1);
        const move = moves.first().locator("[data-testid$='-move']");
        await expect.soft(move.getByTestId(`restock-status-${ONGOING}`)).toBeVisible();
        await expect.soft(move.getByTestId(`restock-status-${LOST}`)).toBeVisible();
      });
      await test.step("then: reason shown in restock timeline", async () => {
        await expect.soft(moves.first().locator("[data-testid$='-description']")).toContainText(why);
      });
      await test.step("then: ongoing stock of 1 product decreases", async () => {
        // From 10 to none — a dash or a 0, whichever the picker draws for none.
        await expect.soft(async () => ongoingIs(page, p, /^(0|—)$/)).toPass({ timeout: 25_000 });
      });
      // Nothing is posted, so nothing arrives to wait for: the balance is read again and again for ten seconds after the
      // mark and must never move, and the account's history holds no new line for the restock.
      await test.step("then: operational account balance unchanged", async () => {
        for (let i = 0; i < 5; i++) {
          await page.goto(`/financial-accounts/${account}`);
          await expect.soft(page.getByTestId("account-detail-balance")).toHaveText(rupiah(before));
          await page.waitForTimeout(2_000);
        }
        await expect.soft(restockLines(page, id)).toHaveCount(linesBefore);
      });
      // Lost on the lost day, read by this role: the 10 units and their Rp 100.000, the ordered still 10.
      await test.step("then: lost recorded in analytic metric", async () => {
        await restockReads(page, ground.products[r.key], UNITS);
      });

      // THEN — as the warehouse: its inbound list and the restock's page, and its queue's totals.
      await signIn(page, warehouseUser, warehouse);
      await test.step("then: target warehouse sees restock lost", async () => {
        const row = await inboundRow(page, id);
        await expect.soft(row.getByTestId(`restock-status-${LOST}`)).toBeVisible();
        await page.goto(`/inventories/restock/${id}`);
        await expect.soft(page.getByTestId("restock-detail-status").getByTestId(`restock-status-${LOST}`)).toBeVisible();
      });
      await test.step("then: total warehouse receive decreases", async () => {
        await page.goto("/inventories/restock");
        await expect.soft(page.getByTestId("restock-stat-restocks-value")).toHaveText("0");
        await expect.soft(page.getByTestId("restock-stat-units-value")).toHaveText("0");
      });
    });
  }

  // Its own test, on its own restock (see the head of this file): lost on the lost day, taken back when the box turns up.
  test(`selling:owner mark lost restock (${COND}): a lost box signed for as arrived takes its lost back`, async ({ page }) => {
    const id = ground.restocks[METRIC];
    const product = ground.products[METRIC];
    await signIn(page, username("own"), ground.team);
    await markLost(page, id, reason(METRIC));
    await expect(page.getByTestId("restock-detail-status").getByTestId(`restock-status-${LOST}`)).toBeVisible();

    await test.step("regression: lost recorded on the lost day", async () => {
      await restockReads(page, product, UNITS);
    });

    // Regression (a-lost-box-that-turns-up-takes-its-lost-back-on-its-day): the box turns up and its warehouse signs for
    // it as arrived — the week's lost nets back to 0, the ordered keeps its 10.
    await signIn(page, ground.warehouseUsers[METRIC], ground.warehouses[METRIC]);
    await api(page, "inventory.v1.RestockRequestService/RestockRequestArrive", { teamId: ground.warehouses[METRIC], requestId: id });
    await signIn(page, username("own"), ground.team);
    await test.step("regression: a lost box signed for as arrived takes its lost back", async () => {
      await restockReads(page, product, 0);
    });
  });
});
