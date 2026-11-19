import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, login, api } from "./restock_helpers";

// warehouse:all wants to receive a restock — split out of restock.spec.ts by its describe block (backlog #51), every test and title
// unchanged. Self-contained: the block seeds its own ground in beforeAll; the helpers live in restock_helpers.ts.

// ── warehouse:all wants to receive a restock — the checks behind docs/acceptances/inventory/restock.md ─────────────────
//
// Same shape as the create block: one test per GIVEN, run as EVERY warehouse role (team:all), marking the box arrived on
// its own inbound list. The restock is the given's state — ongoing, or given up as lost by the seller
// (a-late-lost-box-is-signed-for-as-arrived) — so it is seeded through the API; the mark is the WHEN, through the screen.
// One test.step per then, named as its row says it.
//
// `can print barcode` — once arrived, the row offers Print (labels-print-from-arrived): it opens Cetak Label on this
// restock, one label per ordered unit, each drawn with its code, and Cetak reaches the browser's print (stubbed, so a
// headless run never opens a dialog).
//
// (status: ongoing · COD) — the courier's charge is typed in the sign dialog (the-cod-can-be-noted-when-the-box-arrives).
// `COD recorded on restock` — the then's status in docs/acceptances/inventory/restock.md is still the owner's (🚧 when
// this was written); the app keeps the charge since backlog #76 (the-courier-charge-is-noted-at-tiba-and-final-at-
// terima, snapshot 30db0086), where its old `test.fail` check (warehouse:owner, field-agnostic) reported "expected to
// fail, but passed". It now runs as EVERY warehouse role, in the COD case's own test, and reads the field that was
// built: the restock's page, Kiriman's charge (`restock-detail-courier-charge`) and its note, said as NOTED — final at
// Terima (`restock-detail-courier-charge-owed`).
test.describe("warehouse:all wants to receive a restock", () => {
  test.describe.configure({ timeout: 90_000 });

  const PASSWORD = "e2e-acceptance-pass-1";
  const ROLES = [
    { given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", key: "own" },
    { given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", key: "adm" },
    { given: "warehouse:staff", role: "ROLE_WAREHOUSE_STAFF", key: "stf" },
  ] as const;
  // The givens' cases: the status the restock is in when the box is marked arrived, and whether the courier asks for a
  // charge at the door. Each case runs the thens its rows list.
  const CASES = [
    { cond: "status: ongoing · no COD", key: "on", from: "ongoing", status: 1, cod: false },
    { cond: "status: lost · no COD", key: "lo", from: "lost", status: 5, cod: false },
    { cond: "status: ongoing · COD", key: "cod", from: "ongoing", status: 1, cod: true },
  ] as const;
  // The courier's charge typed at the door — an amount no other figure on the restock's page reads (10 × Rp 10.000).
  const COD = { typed: "7350", shown: "7.350", note: `COD asked at the door ${SUFFIX}` };
  const UNITS = 10;

  const username = (role: string) => `e2earr${role}${SUFFIX}`;
  const displayName = (given: string) => `Arr ${given} ${SUFFIX}`;
  const ground = { team: "", warehouse: "", sku: "", restocks: {} as Record<string, string> };

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);

    const team = async (name: string, teamCode: string, type: string) =>
      String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
    ground.team = await team(`E2E Arr Seller ${SUFFIX}`, `RS${SUFFIX}`, "TEAM_TYPE_SELLING");
    ground.warehouse = await team(`E2E Arr Warehouse ${SUFFIX}`, `RA${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");

    for (const r of ROLES) {
      await api(page, "user.v1.UserService/CreateUser", {
        teamId: ground.warehouse,
        username: username(r.key),
        password: PASSWORD,
        name: displayName(r.given),
        role: r.role,
      });
    }

    const account = await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
      teamId: ground.team,
      type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
      name: `E2E Arr BCA ${SUFFIX}`,
      holderName: "E2E",
      accountNumber: `78${SUFFIX}01`,
      openingBalance: 10_000_000,
      openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
    });
    await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
      teamId: ground.team,
      accountId: account.account.id,
      operational: true,
    });

    const category = await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Arr Cat ${SUFFIX}` });
    const sku = `ARR${SUFFIX}`;
    ground.sku = sku;
    const product = await api(page, "product.v1.ProductService/ProductCreate", {
      teamId: ground.team,
      productCodePart: sku,
      name: `E2E ${sku}`,
      categoryId: category.category.id,
    });

    const raise = async (lost: boolean) => {
      const created = await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
        teamId: ground.team,
        warehouseId: ground.warehouse,
        financeAccountId: account.account.id,
        items: [{ productId: product.product.id, productCode: sku, name: `E2E ${sku}`, count: UNITS, total: 100_000 }],
      });
      const id = String(created.request.id);
      if (lost) {
        await api(page, "inventory.v1.RestockRequestService/RestockRequestMarkLost", { teamId: ground.team, requestId: id });
      }
      return id;
    };

    // GIVEN — per role and case, a restock on its way to the warehouse; the (from lost) ones given up by the seller.
    for (const r of ROLES) {
      for (const c of CASES) {
        ground.restocks[`${r.key}-${c.key}`] = await raise(c.key === "lo");
      }
    }
    await page.close();
  });

  // Signed in as the role, on the warehouse's own inbound list, with the restock's row in the given's status.
  async function openInbound(page: Page, key: string, id: string, status: number) {
    await login(page, username(key), PASSWORD);
    await page.evaluate((team) => window.sessionStorage.setItem("warehouse_revamp.team", team), ground.warehouse);
    await page.goto("/inventories/restock?status=all");
    await expect(page.getByTestId("restock-inbound-page")).toBeVisible();
    const row = page.getByTestId(`restock-row-${id}`);
    await expect(row.getByTestId(`restock-status-${status}`)).toBeVisible();
    return row;
  }

  // THE WHEN — Mark Arrived (Sign for Box) from the row; with COD, the courier's charge is asked for, typed and noted first.
  async function markArrived(page: Page, id: string, cod: boolean) {
    await page.getByTestId(`restock-action-sign-${id}`).click();
    if (cod) {
      await page.getByTestId("sign-courier-asked-yes").click();
      await page.getByTestId("sign-courier-charge").fill(COD.typed);
      await page.getByTestId("sign-courier-note").fill(COD.note);
    }
    await page.getByTestId("confirm-action").click();
  }

  for (const c of CASES) {
    for (const r of ROLES) {
      test(`${r.given} mark arrived restock (${c.cond})`, async ({ page }) => {
        const id = ground.restocks[`${r.key}-${c.key}`];

        // WHEN — Mark Arrived on the warehouse's own inbound list, as this role, from the case's status.
        const row = await openInbound(page, r.key, id, c.status);
        await markArrived(page, id, c.cod);

        if (!c.cod) {
          await test.step(`then: status changed from ${c.from} to arrived`, async () => {
            await expect.soft(row.getByTestId("restock-status-4")).toBeVisible();
            await expect.soft(row.getByTestId(`restock-status-${c.status}`)).toHaveCount(0);
          });

          await test.step("then: receiver and time recorded", async () => {
            await expect.soft(page.getByTestId(`restock-arrived-${id}`)).toContainText(/\d/);
            await expect.soft(page.getByTestId(`restock-arrived-${id}-by`)).toContainText(displayName(r.given));
          });
        } else {
          // Not a then of this given — the sign went through, so the box has its labels.
          await expect(row.getByTestId("restock-status-4")).toBeVisible();
        }

        await test.step("then: can print barcode", async () => {
          // Print is the arrived row's act (labels-print-from-arrived) — Cetak Label, on this restock.
          await page.getByTestId(`restock-action-labels-${id}`).click();
          await expect(page.getByTestId("labels-page")).toBeVisible();
          const group = page.getByTestId(`labels-group-${id}`);
          await expect(group).toBeVisible();
          await expect.soft(group.getByTestId("labels-arrived-note")).toBeVisible();

          // What prints: one label per ordered unit, each drawn with its code and the product's SKU.
          const printed = page.getByTestId("labels-print-root");
          await expect.soft(printed.locator(".print-label")).toHaveCount(UNITS);
          await expect.soft(printed.locator(".print-label svg")).toHaveCount(UNITS);
          await expect.soft(printed.getByTestId("label-sku").first()).toHaveText(ground.sku);

          // Cetak reaches the browser's print.
          await page.evaluate(() => {
            const w = window as unknown as { __printed: number; print: () => void };
            w.__printed = 0;
            w.print = () => {
              w.__printed += 1;
            };
          });
          await expect(page.getByTestId("labels-print")).toBeEnabled();
          await page.getByTestId("labels-print").click();
          await expect
            .poll(() => page.evaluate(() => (window as unknown as { __printed: number }).__printed))
            .toBe(1);
        });

        if (c.cod) {
          await test.step("then: COD recorded on restock", async () => {
            // The restock's own page, as the role that signed for it: Kiriman's charge, its note, said as noted at the sign.
            await page.goto(`/inventories/restock/${id}`);
            await expect(page.getByTestId("restock-detail-page")).toBeVisible();
            await expect.soft(page.getByTestId("restock-detail-courier-charge")).toContainText(COD.shown, { timeout: 10_000 });
            await expect.soft(page.getByTestId("restock-detail-courier-charge-note")).toHaveText(COD.note);
            await expect.soft(page.getByTestId("restock-detail-courier-charge-owed")).toContainText("Noted by this warehouse");
          });
        }
      });
    }
  }
});
