import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, login, api, tick, ongoingOf, inboundRow } from "./restock_helpers";

// selling:all wants to restock — split out of restock.spec.ts by its describe block (backlog #51), every test and title
// unchanged. Self-contained: the block seeds its own ground in beforeAll; the helpers live in restock_helpers.ts.

// ── selling:all wants to restock — the checks behind docs/acceptances/inventory/restock.md ─────────────────────────────
//
// An acceptance has no test file of its own (docs/acceptances/guide.md#acceptances-are-markdown): its checks live here,
// in the regression spec of the feature its WHEN belongs to. The rows' statuses are the owner's, set by hand on the
// owner's instruction — never by this block.
//
// One test per GIVEN — `selling:all wants to restock` in each of its cases — run as EVERY selling role, through the
// seller's own list and form. Each THEN is its own step, named exactly as its row, and checked SOFTLY so one failing then
// does not hide the next. The warehouse's side is read as one warehouse role (status-is-per-then). Every role and case
// pays from its OWN account, so a balance read in one test is never moved by another test's event. The ground is seeded
// in beforeAll, so a worker restarted after a failure seeds its own instead of reading a moved SUFFIX.
//
// `restock recorded in analytic metric` is 🚧 unimplemented — no analytic metric counts a restock when it is raised — so it has no check
// here yet.
test.describe("selling:all wants to restock", () => {
  test.describe.configure({ timeout: 120_000 });

  const PASSWORD = "e2e-acceptance-pass-1";
  const ROLES = [
    { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "own" },
    { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "adm" },
    { given: "selling:cs", role: "ROLE_SELLING_CS", key: "cs" },
  ] as const;
  // The givens' cases, each with its thens as its rows say them — a then names the given's fact it checks
  // (given-is-who-wants-what-in-which-case).
  const CASES = [
    {
      cond: "1 product · 1 warehouse · operational account · no shipping cost",
      key: "p1",
      products: 1,
      shipping: 0,
      created: "restock created with 1 product",
      warehouse: "1 product recorded at warehouse",
      ongoing: "ongoing stock of 1 product increases",
      balance: "operational account balance decreases by product total",
    },
    {
      cond: "2 products · 1 warehouse · operational account · no shipping cost",
      key: "p2",
      products: 2,
      shipping: 0,
      created: "restock created with 2 products",
      warehouse: "2 products recorded at warehouse",
      ongoing: "ongoing stock of 2 products increases",
      balance: "operational account balance decreases by product total",
    },
    {
      cond: "1 product · 1 warehouse · operational account · shipping cost",
      key: "sc",
      products: 1,
      shipping: 15_000,
      created: "restock created with 1 product and shipping cost",
      warehouse: "1 product recorded at warehouse",
      ongoing: "ongoing stock of 1 product increases",
      balance: "operational account balance decreases by product total + shipping cost",
    },
  ] as const;
  // Every line of every case: 10 pcs for Rp 100.000.
  const LINE_COUNT = 10;
  const LINE_TOTAL = 100_000;

  const rupiah = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;
  const username = (role: string) => `e2eacc${role}${SUFFIX}`;
  const WH_USER = `e2eaccwh${SUFFIX}`;
  // One product code per role, case and line, so a list row is found by what only that restock carries.
  const code = (role: string, kase: string, line: number) => `AC${role.toUpperCase()}${kase.toUpperCase()}${line}${SUFFIX}`;
  const at = (role: string, kase: string) => `${role}-${kase}`;
  const WH_CODE = `AW${SUFFIX}`;
  const SUPPLIER_NAME = `E2E Acc Supplier ${SUFFIX}`;
  const ground = { team: "", warehouse: "", supplier: "", accounts: {} as Record<string, string> };

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);

    const team = async (name: string, teamCode: string, type: string) =>
      String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
    ground.team = await team(`E2E Acc Seller ${SUFFIX}`, `AS${SUFFIX}`, "TEAM_TYPE_SELLING");
    ground.warehouse = await team(`E2E Acc Warehouse ${SUFFIX}`, WH_CODE, "TEAM_TYPE_WAREHOUSE");

    const user = (teamId: string, name: string, role: string) =>
      api(page, "user.v1.UserService/CreateUser", { teamId, username: name, password: PASSWORD, name, role });
    for (const r of ROLES) await user(ground.team, username(r.key), r.role);
    await user(ground.warehouse, WH_USER, "ROLE_WAREHOUSE_STAFF");

    ground.supplier = String(
      (await api(page, "supplier.v1.SupplierService/SupplierCreate", { teamId: ground.team, name: SUPPLIER_NAME })).supplier.id,
    );

    const category = await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Acc Cat ${SUFFIX}` });
    let n = 0;
    for (const r of ROLES) {
      for (const c of CASES) {
        for (let line = 0; line < c.products; line++) {
          await api(page, "product.v1.ProductService/ProductCreate", {
            teamId: ground.team,
            productCodePart: code(r.key, c.key, line),
            name: `E2E ${code(r.key, c.key, line)}`,
            categoryId: category.category.id,
          });
        }

        const account = await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
          teamId: ground.team,
          type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
          provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
          name: `E2E Acc ${r.key} ${c.key} ${SUFFIX}`,
          holderName: "E2E",
          accountNumber: `77${SUFFIX}${++n}`,
          openingBalance: 10_000_000,
          openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
        });
        const accountId = String(account.account.id);
        await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
          teamId: ground.team,
          accountId,
          operational: true,
        });
        ground.accounts[at(r.key, c.key)] = accountId;
      }
    }

    await page.close();
  });

  async function signIn(page: Page, user: string, team: string) {
    await login(page, user, PASSWORD);
    await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), team);
  }

  // An account's balance as its own page shows it — "—" until it has loaded, so the figure is waited for.
  async function balanceOf(page: Page, accountId: string): Promise<number> {
    await page.goto(`/financial-accounts/${accountId}`);
    const balance = page.getByTestId("account-detail-balance");
    await expect(balance).toHaveText(/\d/);
    return Number((await balance.innerText()).replace(/[^\d-]/g, ""));
  }

  for (const c of CASES) {
    for (const r of ROLES) {
      test(`${r.given} create restock (${c.cond})`, async ({ page }) => {
        const account = ground.accounts[at(r.key, c.key)];
        const lines = Array.from({ length: c.products }, (_, line) => code(r.key, c.key, line));
        const paid = c.products * LINE_TOTAL + c.shipping;
        // How a list row sizes the box — the seller's list and the warehouse's alike.
        const size = `${c.products} ${c.products === 1 ? "product" : "products"} · ${c.products * LINE_COUNT} pcs`;

        await signIn(page, username(r.key), ground.team);
        const before = await balanceOf(page, account);

        // WHEN — through the seller's own list and form, as this role.
        await page.goto("/inventories/restock");
        await page.getByTestId("open-create-restock").or(page.getByTestId("open-create-restock-empty")).first().click();
        await expect(page).toHaveURL(/\/inventories\/restock\/new$/);

        await page.getByTestId("restock-pick-products").click();
        for (const line of lines) {
          await tick(page, line);
        }
        await page.getByTestId("product-picker-confirm").click();

        for (let line = 0; line < lines.length; line++) {
          await page.getByTestId(`restock-qty-${line}`).fill(String(LINE_COUNT));
          await page.getByTestId(`restock-total-price-${line}`).fill(String(LINE_TOTAL));
        }

        await page.getByTestId("restock-warehouse").locator("input").fill(WH_CODE);
        await page.getByTestId(`team-select-option-${WH_CODE}`).click();

        await page.getByTestId("restock-finance-account").click();
        await page.getByTestId(`restock-finance-account-option-${account}`).click();

        await page.getByTestId("restock-all-supplier-picker-trigger").click();
        await page.getByTestId("restock-all-supplier-picker-search").fill(SUPPLIER_NAME);
        await page.getByTestId(`restock-all-supplier-picker-supplier-${ground.supplier}`).click();
        await page.getByTestId("restock-all-supplier-picker-confirm").click();

        await page.getByTestId("restock-courier").getByRole("combobox").click();
        await page.getByTestId("shipment-channel-option-jne").click();

        await page.getByTestId("restock-receipt").fill(`E2E-ACC-${r.key.toUpperCase()}-${c.key.toUpperCase()}-${SUFFIX}`);
        if (c.shipping > 0) {
          await page.getByTestId("restock-shipping-cost").fill(String(c.shipping));
        }

        await expect(page.getByTestId("restock-form-ready")).toBeVisible();
        await page.getByTestId("submit-restock").click();
        await expect(page).toHaveURL(/\/inventories\/restock$/);

        // The restock just made: the ongoing row carrying this case's first product.
        const made = page
          .getByTestId("restock-requests-table")
          .locator("tbody tr")
          .filter({ hasText: lines[0] })
          .filter({ has: page.getByTestId("restock-status-1") });
        await expect(made).toHaveCount(1);
        const restockId = (await made.getAttribute("data-testid"))!.replace("restock-row-", "");

        // THEN — as the seller. Listed as ongoing and sized as raised; the shipping cost is read on its own page.
        await test.step(`then: ${c.created}`, async () => {
          await expect.soft(made).toContainText(size);
          if (c.shipping > 0) {
            await page.goto(`/inventories/restock/${restockId}`);
            await expect.soft(page.getByTestId("restock-detail-shipping")).toContainText(c.shipping.toLocaleString("id-ID"));
          }
        });

        // Each line's Ongoing, as the seller's picker shows it — re-read until it lands rather than once.
        await test.step(`then: ${c.ongoing}`, async () => {
          for (const line of lines) {
            await expect
              .soft(async () => {
                await expect(await ongoingOf(page, line)).toContainText(String(LINE_COUNT), { timeout: 2_000 });
              })
              .toPass({ timeout: 30_000 });
          }
        });

        // The account moves when financial_account_service takes the Restock Created event, so it is re-read until
        // it lands rather than once.
        await test.step(`then: ${c.balance} (by ${rupiah(paid)}, from ${rupiah(before)})`, async () => {
          await expect
            .soft(async () => {
              await page.goto(`/financial-accounts/${account}`);
              await expect(page.getByTestId("account-detail-balance")).toHaveText(rupiah(before - paid), {
                timeout: 2_000,
              });
            })
            .toPass({ timeout: 30_000 });
        });

        // The line financial_account_service writes for it: "Restock #<id>".
        await test.step(`then: recorded in operational account history (Restock #${restockId})`, async () => {
          await expect
            .soft(async () => {
              await page.goto(`/financial-accounts/${account}`);
              await expect(page.getByTestId("account-log-table")).toContainText(`Restock #${restockId}`, {
                timeout: 2_000,
              });
            })
            .toPass({ timeout: 30_000 });
        });

        // THEN — as the warehouse: on its inbound list, sized as raised.
        await signIn(page, WH_USER, ground.warehouse);
        await test.step(`then: ${c.warehouse}`, async () => {
          await expect.soft(await inboundRow(page, restockId)).toContainText(size);
        });
      });
    }
  }
});
