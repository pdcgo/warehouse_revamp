import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, login, api, ongoingOf, inboundRow } from "./restock_helpers";

// ── selling:all wants to cancel a restock — the checks behind docs/acceptances/inventory/restock.md ─────────────────────
//
// One test per GIVEN — money returned, money not returned — run as EVERY selling role, through the restock's own page and
// its Cancel (Batalkan), which asks one question: did the money come back? Each THEN is its own step, named exactly as its
// row, and checked SOFTLY so one failing then does not hide the next. The warehouse's side is read as one warehouse role
// (status-is-per-then). The restocks are the GIVEN, seeded through the API: each is 10 × one product for Rp 100.000 plus
// Rp 10.000 shipping, sent by JNE, paid from its OWN operational account (so no balance read is moved by another test's
// events) to its OWN warehouse (so that warehouse's queue is exactly this one restock).
//
// ⚠ The cancel is still to be checked (restock.md § Warnings, cancel-restock-is-still-to-be-checked): yes puts the whole
// amount back, no posts nothing, and the dialog warns the cancel will be checked while nothing checks it yet. These givens
// check the system AS IT IS — a part refund or an over-refund has no given, so no check.
//
// Where each then is read:
// - `status changed from ongoing to cancelled` — the restock's page, its title-row status (`restock-detail-status`).
// - `cancel recorded in restock timeline` — the restock's Riwayat: ONE status row, ongoing → cancelled, saying whether the
//   money came back.
// - `ongoing stock of 1 product decreases` — the product's Ongoing on the seller's product picker: 10 before, none after.
// - `target warehouse sees restock cancelled` — as the warehouse: its inbound list (every status) and the restock's page.
// - `total warehouse receive decreases` — the warehouse's inbound summary (what is on its way or at the door): 1 restock
//   and 10 pcs before the cancel, 0 and 0 after.
// - `operational account balance …` — the paying account's page. Money returned: up by Rp 110.000. Money not returned:
//   no event posts anything to see, so "unchanged" is the balance read again and again for ten seconds after the cancel,
//   never moving, and no cancel line in its history.
// - `cancel recorded in operational account history` — the account's page: `Restock #<id> cancelled — money returned`.
// - `cancel recorded in finance analytic metric` — Analytic › Finance › Account changes, by account, filtered to the paying
//   account: its Restock figure this week, −Rp 110.000 once paid, nets back to nothing once the money is returned.
test.describe("selling:all wants to cancel a restock", () => {
  test.describe.configure({ timeout: 120_000 });

  const PASSWORD = "e2e-acceptance-pass-1";
  const ROLES = [
    { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "own" },
    { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "adm" },
    { given: "selling:cs", role: "ROLE_SELLING_CS", key: "cs" },
  ] as const;

  type Key = "ret" | "kept";
  const CASES: { key: Key; cond: string; returned: boolean }[] = [
    {
      key: "ret",
      cond: "status: ongoing · money returned · 1 product · shipping cost · 1 warehouse · operational account",
      returned: true,
    },
    {
      key: "kept",
      cond: "status: ongoing · money not returned · 1 product · shipping cost · 1 warehouse · operational account",
      returned: false,
    },
  ];

  const TOTAL = 100_000;
  const SHIPPING = 10_000;
  const rupiah = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;
  // Money out, as Analytic writes it — a true minus sign.
  const out = (n: number) => `−${rupiah(n)}`;
  // RestockRequestStatus, as the badges' test ids carry it.
  const ONGOING = 1;
  const CANCELLED = 3;

  const at = (role: string, kase: string) => `${role}-${kase}`;
  const username = (role: string) => `e2ecnl${role}${SUFFIX}`;
  const productCode = (role: string, kase: string) => `CN${role.toUpperCase()}${kase.toUpperCase()}${SUFFIX}`;
  const receipt = (role: string, kase: string) => `E2E-CNL-${role}-${kase}-${SUFFIX}`.toUpperCase();

  const ground = {
    team: "",
    supplier: "",
    couriers: {} as Record<string, string>,
    // Per role and given: its warehouse, that warehouse's staff user, the paying account, the product and the restock.
    warehouses: {} as Record<string, string>,
    warehouseUsers: {} as Record<string, string>,
    accounts: {} as Record<string, string>,
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

    ground.team = await team(`E2E Cnl Seller ${SUFFIX}`, `CNS${SUFFIX}`, "TEAM_TYPE_SELLING");
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
      (await api(page, "supplier.v1.SupplierService/SupplierCreate", { teamId: ground.team, name: `E2E Cnl Supplier ${SUFFIX}` }))
        .supplier.id,
    );
    const category = await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Cnl Cat ${SUFFIX}` });

    let n = 0;
    for (const r of ROLES) {
      for (const c of CASES) {
        const k = at(r.key, c.key);
        n++;

        // The warehouse this restock goes to — its own, so its queue is this restock alone — and its staff.
        const warehouse = await team(`E2E Cnl Warehouse ${n} ${SUFFIX}`, `CNW${n}${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
        ground.warehouses[k] = warehouse;
        ground.warehouseUsers[k] = `e2ecnlw${n}${SUFFIX}`;
        await user(warehouse, ground.warehouseUsers[k], "ROLE_WAREHOUSE_STAFF");

        const p = productCode(r.key, c.key);
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

        const created = await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
          teamId: ground.team,
          type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
          provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
          name: `E2E Cnl ${r.key} ${c.key} ${SUFFIX}`,
          holderName: "E2E",
          accountNumber: `81${SUFFIX}${n}`,
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

        // GIVEN — an ongoing restock of 10 × Rp 10.000 plus Rp 10.000 shipping, by JNE, paid from its own account.
        const restock = await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
          teamId: ground.team,
          warehouseId: warehouse,
          financeAccountId: accountId,
          shipmentId: ground.couriers.jne,
          receipt: receipt(r.key, c.key),
          shipmentCost: SHIPPING,
          items: [{ productId, productCode: p, name: `E2E ${p}`, count: 10, total: TOTAL, supplierId: ground.supplier }],
        });
        ground.restocks[k] = String(restock.request.id);
      }
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

  async function balanceIs(page: Page, accountId: string, expected: number) {
    await expect(async () => {
      await page.goto(`/financial-accounts/${accountId}`);
      await expect(page.getByTestId("account-detail-balance")).toHaveText(rupiah(expected), { timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
  }

  async function historySays(page: Page, accountId: string, text: string) {
    await expect(async () => {
      await page.goto(`/financial-accounts/${accountId}`);
      await expect(page.getByTestId("account-log-table")).toContainText(text, { timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
  }

  // Analytic › Finance › Account changes, by account, filtered to the one account: its Restock figure this week. Re-read
  // until the posting lands.
  async function financeRestock(page: Page, accountId: string, expected: string | RegExp) {
    await expect(async () => {
      await page.goto(`/analytic?g=account&m=metrics/financial_accounts&r=7d&acc=${accountId}`);
      await expect(page.getByTestId(`analytic-cell-${accountId}-restock`)).toHaveText(expected, { timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
  }

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

  // WHEN — Cancel on the restock's own page, the money question answered, confirmed.
  async function cancel(page: Page, id: string, returned: boolean) {
    await page.goto(`/inventories/restock/${id}`);
    await expect(page.getByTestId("restock-detail-status").getByTestId(`restock-status-${ONGOING}`)).toBeVisible();
    await page.getByTestId(`restock-action-cancel-${id}`).click();
    await expect(page.getByTestId("restock-cancel-review")).toBeVisible();
    // No default: the confirm waits for the answer.
    await expect(page.getByTestId("confirm-action")).toBeDisabled();
    await page.getByTestId(returned ? "restock-cancel-money-yes" : "restock-cancel-money-no").click();
    await page.getByTestId("confirm-action").click();
    await expect(page.getByTestId("confirm-action")).toHaveCount(0);
  }

  for (const r of ROLES) {
    for (const c of CASES) {
      test(`${r.given} cancel restock (${c.cond})`, async ({ page }) => {
        const k = at(r.key, c.key);
        const id = ground.restocks[k];
        const account = ground.accounts[k];
        const warehouse = ground.warehouses[k];
        const warehouseUser = ground.warehouseUsers[k];
        const p = productCode(r.key, c.key);
        const amount = TOTAL + SHIPPING;

        // GIVEN, as the warehouse: the restock is its whole queue — 1 restock, 10 pcs on their way.
        await signIn(page, warehouseUser, warehouse);
        await queueIs(page, "1", "10");

        // …and as the seller: the payment is on the account, the 10 pcs are Ongoing.
        await signIn(page, username(r.key), ground.team);
        const before = await balanceOnceRecorded(page, account, `Restock #${id}`);
        if (c.returned) await financeRestock(page, account, out(amount));
        await ongoingIs(page, p, "10");

        // WHEN — as this role.
        await cancel(page, id, c.returned);

        // THEN — as the seller: the restock's page and its Riwayat, the picker's Ongoing, the account and Analytic.
        await test.step("then: status changed from ongoing to cancelled", async () => {
          await page.goto(`/inventories/restock/${id}`);
          await expect.soft(page.getByTestId("restock-detail-status").getByTestId(`restock-status-${CANCELLED}`)).toBeVisible();
          // Nothing is left to do to a cancelled restock — no Cancel, no Edit.
          await expect.soft(page.getByTestId(`restock-action-cancel-${id}`)).toHaveCount(0);
        });
        await test.step("then: cancel recorded in restock timeline", async () => {
          await page.goto(`/inventories/restock/${id}`);
          const moves = page.locator("[data-testid^='restock-timeline-'][data-kind='status']");
          await expect.soft(moves).toHaveCount(1);
          const move = moves.first().locator("[data-testid$='-move']");
          await expect.soft(move.getByTestId(`restock-status-${ONGOING}`)).toBeVisible();
          await expect.soft(move.getByTestId(`restock-status-${CANCELLED}`)).toBeVisible();
          await expect
            .soft(moves.first().locator("[data-testid$='-description']"))
            .toHaveText(c.returned ? "cancelled — money returned" : "cancelled — money not returned");
        });
        await test.step("then: ongoing stock of 1 product decreases", async () => {
          // From 10 to none — a dash or a 0, whichever the picker draws for none.
          await expect.soft(async () => ongoingIs(page, p, /^(0|—)$/)).toPass({ timeout: 25_000 });
        });

        if (c.returned) {
          await test.step(`then: operational account balance increases by product total + shipping cost (by ${rupiah(amount)})`, async () => {
            await expect.soft(async () => balanceIs(page, account, before + amount)).toPass({ timeout: 35_000 });
          });
          await test.step("then: cancel recorded in operational account history", async () => {
            await expect
              .soft(async () => historySays(page, account, `Restock #${id} cancelled — money returned`))
              .toPass({ timeout: 35_000 });
          });
          // Paid, then given back: the week's Restock figure nets to nothing.
          await test.step("then: cancel recorded in finance analytic metric", async () => {
            await expect.soft(async () => financeRestock(page, account, /^(Rp 0|—)$/)).toPass({ timeout: 35_000 });
          });
        } else {
          // Nothing is posted, so nothing arrives to wait for: the balance is read again and again for ten seconds after
          // the cancel and must never move, and the account's history holds no cancel line.
          await test.step("then: operational account balance unchanged", async () => {
            for (let i = 0; i < 5; i++) {
              await page.goto(`/financial-accounts/${account}`);
              await expect.soft(page.getByTestId("account-detail-balance")).toHaveText(rupiah(before));
              await page.waitForTimeout(2_000);
            }
            await expect.soft(page.getByTestId("account-log-table")).not.toContainText(`Restock #${id} cancelled`);
          });
        }

        // THEN — as the warehouse: its inbound list and the restock's page, and its queue's totals.
        await signIn(page, warehouseUser, warehouse);
        await test.step("then: target warehouse sees restock cancelled", async () => {
          const row = await inboundRow(page, id);
          await expect.soft(row.getByTestId(`restock-status-${CANCELLED}`)).toBeVisible();
          await page.goto(`/inventories/restock/${id}`);
          await expect.soft(page.getByTestId("restock-detail-status").getByTestId(`restock-status-${CANCELLED}`)).toBeVisible();
        });
        await test.step("then: total warehouse receive decreases", async () => {
          await page.goto("/inventories/restock");
          await expect.soft(page.getByTestId("restock-stat-restocks-value")).toHaveText("0");
          await expect.soft(page.getByTestId("restock-stat-units-value")).toHaveText("0");
        });
      });
    }
  }
});
