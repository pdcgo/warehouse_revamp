import { expect, test } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, login, api } from "./restock_helpers";

// warehouse:all wants to receive a restock — split out of restock.spec.ts by its describe block (backlog #51), every test and title
// unchanged. Self-contained: the block seeds its own ground in beforeAll; the helpers live in restock_helpers.ts.

// ── warehouse:all wants to receive a restock — the checks behind docs/acceptances/inventory/restock.md ─────────────────
//
// Same shape as the create block above: one test per GIVEN, run as EVERY warehouse role, marking the box arrived on its
// own inbound list. The restock is the given's state — ongoing, or given up as lost by the seller
// (a-late-lost-box-is-signed-for-as-arrived) — so it is seeded through the API; the mark is the WHEN, through the
// screen. (status: ongoing · COD) is 🚧 unimplemented — the server drops the charge — so it has no check here yet.
test.describe("warehouse:all wants to receive a restock", () => {
  const PASSWORD = "e2e-acceptance-pass-1";
  const ROLES = [
    { given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", key: "own" },
    { given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", key: "adm" },
    { given: "warehouse:staff", role: "ROLE_WAREHOUSE_STAFF", key: "stf" },
  ] as const;
  // The givens' cases: the status the restock is in when the box is marked arrived.
  const CASES = [
    { cond: "status: ongoing · no COD", key: "on", from: "ongoing", status: 1 },
    { cond: "status: lost · no COD", key: "lo", from: "lost", status: 5 },
  ] as const;

  const username = (role: string) => `e2earr${role}${SUFFIX}`;
  const displayName = (given: string) => `Arr ${given} ${SUFFIX}`;
  const ground = { team: "", warehouse: "", restocks: {} as Record<string, string> };

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
    const product = await api(page, "product.v1.ProductService/ProductCreate", {
      teamId: ground.team,
      productCodePart: sku,
      name: `E2E ${sku}`,
      categoryId: category.category.id,
    });

    // GIVEN — per role and case, a restock on its way to the warehouse; the (from lost) ones given up by the seller.
    for (const r of ROLES) {
      for (const c of CASES) {
        const created = await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
          teamId: ground.team,
          warehouseId: ground.warehouse,
          financeAccountId: account.account.id,
          items: [{ productId: product.product.id, productCode: sku, name: `E2E ${sku}`, count: 10, total: 100_000 }],
        });
        const id = String(created.request.id);
        if (c.key === "lo") {
          await api(page, "inventory.v1.RestockRequestService/RestockRequestMarkLost", { teamId: ground.team, requestId: id });
        }
        ground.restocks[`${r.key}-${c.key}`] = id;
      }
    }

    await page.close();
  });

  for (const c of CASES) {
    for (const r of ROLES) {
      test(`${r.given} mark arrived restock (${c.cond})`, async ({ page }) => {
        const id = ground.restocks[`${r.key}-${c.key}`];

        // WHEN — Mark Arrived on the warehouse's own inbound list, as this role, from the case's status.
        await login(page, username(r.key), PASSWORD);
        await page.evaluate((team) => window.sessionStorage.setItem("warehouse_revamp.team", team), ground.warehouse);
        await page.goto("/inventories/restock?status=all");
        await expect(page.getByTestId("restock-inbound-page")).toBeVisible();
        const row = page.getByTestId(`restock-row-${id}`);
        await expect(row.getByTestId(`restock-status-${c.status}`)).toBeVisible();
        await page.getByTestId(`restock-action-sign-${id}`).click();
        await page.getByTestId("confirm-action").click();

        await test.step(`then: status changed from ${c.from} to arrived`, async () => {
          await expect.soft(row.getByTestId("restock-status-4")).toBeVisible();
          await expect.soft(row.getByTestId(`restock-status-${c.status}`)).toHaveCount(0);
        });

        await test.step("then: receiver and time recorded", async () => {
          await expect.soft(page.getByTestId(`restock-arrived-${id}`)).toContainText(/\d/);
          await expect.soft(page.getByTestId(`restock-arrived-${id}-by`)).toContainText(displayName(r.given));
        });
      });
    }
  }
});
