import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, login, api } from "./restock_helpers";

// ── selling:all wants to record the platform's solution — the checks behind docs/acceptances/inventory/restock.md ─────
//
// WHEN `resolve lost restock`, one given (status: lost · money refunded · operational account): 10 × Rp 10.000 raised,
// paid from the team's operational account, given up as lost — and the platform pays the money back into that account.
//
// EVERY THEN IS 🚧 unimplemented. The rows come from a discussion, not a decision (restock.md's 📝 note under
// § resolve: a lost restock is settled with the platform — goods sent again, money back, or another way). Nothing is built
// for it: no RPC, and a lost restock's page offers no action at all (SellingRestockActions: accepted · lost · cancelled
// → nothing). As it stands, marking lost moves no money — "once it is lost, the money was spent"
// (a-restock-is-cancelled-only-while-ongoing). So each then is its own test, marked `test.fail` with the status
// (guide.md) — its own, because `test.fail` flips a whole test and would hide a then that turns real while the other
// does not. Each runs as selling:owner on its own restock and its own operational account (so no balance read is moved
// by another test), as the 🚧 checks of resolve restock problem do; the day one turns red the then is built — ask the
// owner, then run it as every selling role on the built test ids.
//
// FIELD-AGNOSTIC, because how it will be built is not known: the GIVEN is proven on the rendered restock page (its
// status lost); the WHEN looks for a resolve action under any name it could be built with and clicks it — softly, so
// each test goes on to read its then where that then must land:
//   - `solution recorded on restock` — the restock's page shows a solution (a `solution`/`resol…` test id, or the word).
//   - `operational account balance increases by refund` — the paying account reads MORE than before. How much the
//     platform pays back is not in the given (the whole Rp 100.000 paid, or a part), so any increase counts.
test.describe("selling:all wants to record the platform's solution", () => {
  test.describe.configure({ timeout: 120_000 });

  const PASSWORD = "e2e-acceptance-pass-1";
  const OWNER = `e2ervlown${SUFFIX}`;
  const COND = "status: lost · money refunded · operational account";
  const SERVICE = "inventory.v1.RestockRequestService";

  const ORDERED = 10;
  const TOTAL = 100_000; // Rp 10.000 a unit, no shipping cost — the whole amount paid
  // RestockRequestStatus, as the badges' test ids carry it.
  const LOST = 5;
  const rupiah = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

  // One restock per 🚧 then. ⚠ No key, resi or reason may carry the words the action and the solution are looked for by
  // (resolve / solution / solusi / selesaikan / penyelesaian): a resi reading …-SOLUTION-… once named the resolve spec's
  // copy button, so its WHEN "found" it.
  const KEYS = ["record", "balance"] as const;

  const code = `RVLP${SUFFIX}`;
  const resi = (k: string) => `E2E-RVL-${k}-${SUFFIX}`.toUpperCase();

  const ground = {
    team: "",
    restocks: {} as Record<string, string>,
    accounts: {} as Record<string, string>,
  };

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    const page = await browser.newPage();
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);

    const team = async (name: string, teamCode: string, type: string) =>
      String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);

    ground.team = await team(`E2E RvL Seller ${SUFFIX}`, `RVLS${SUFFIX}`, "TEAM_TYPE_SELLING");
    const warehouse = await team(`E2E RvL Warehouse ${SUFFIX}`, `RVLW${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
    await api(page, "user.v1.UserService/CreateUser", {
      teamId: ground.team,
      username: OWNER,
      password: PASSWORD,
      name: OWNER,
      role: "ROLE_SELLING_OWNER",
    });

    const supplier = String(
      (await api(page, "supplier.v1.SupplierService/SupplierCreate", { teamId: ground.team, name: `E2E RvL Supplier ${SUFFIX}` }))
        .supplier.id,
    );
    const category = await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E RvL Cat ${SUFFIX}` });
    const product = String(
      (
        await api(page, "product.v1.ProductService/ProductCreate", {
          teamId: ground.team,
          productCodePart: code,
          name: `E2E ${code}`,
          categoryId: category.category.id,
        })
      ).product.id,
    );

    for (const k of KEYS) {
      // Its own operational account — the balance read is of this restock alone.
      const created = await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId: ground.team,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name: `E2E RvL ${k} ${SUFFIX}`,
        holderName: "E2E",
        accountNumber: `E2E-RVL-${k}-${SUFFIX}`,
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

      // GIVEN — raised for 10 × Rp 10.000 from that account, then given up as lost by the selling team.
      const raised = await api(page, `${SERVICE}/RestockRequestCreate`, {
        teamId: ground.team,
        warehouseId: warehouse,
        financeAccountId: accountId,
        receipt: resi(k),
        shipmentCost: 0,
        items: [{ productId: product, productCode: code, name: `E2E ${code}`, count: ORDERED, total: TOTAL, supplierId: supplier }],
      });
      ground.restocks[k] = String(raised.request.id);
      await api(page, `${SERVICE}/RestockRequestMarkLost`, {
        teamId: ground.team,
        requestId: raised.request.id,
        description: "paket hilang di kurir",
      });
    }

    await page.close();
  });

  async function signIn(page: Page, user: string, team: string) {
    await login(page, user, PASSWORD);
    await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), team);
  }

  // The GIVEN on the rendered screen: the restock's own page, its status lost.
  async function openLost(page: Page, id: string) {
    await page.goto(`/inventories/restock/${id}`);
    await expect(page.getByTestId("restock-detail-status").getByTestId(`restock-status-${LOST}`)).toBeVisible();
  }

  // WHEN — resolve lost restock, on the restock's page: a resolve action under any name it could be built with.
  // 🚧 none exists, so this is soft — the test goes on to read its then where it must land.
  async function resolve(page: Page) {
    const named = /resolve|solution|solusi|selesaikan|penyelesaian/i;
    const action = page
      .locator('[data-testid^="restock-action-resolve"], [data-testid^="restock-action-solution"], [data-testid^="restock-resolve"]')
      .or(page.getByRole("button", { name: named }))
      .or(page.getByRole("menuitem", { name: named }));
    await expect.soft(action.first(), "a resolve action on the lost restock's page").toBeVisible({ timeout: 5_000 });
    if ((await action.count()) > 0) await action.first().click();
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

  const MARK =
    "🚧 unimplemented (docs/acceptances/inventory/restock.md § resolve) — nothing records the platform's solution for a lost restock";

  test(`selling:owner resolve lost restock (${COND}): solution recorded on restock`, async ({ page }) => {
    test.fail(true, `${MARK}: a lost restock's page offers no resolve action`);
    const id = ground.restocks.record;
    await signIn(page, OWNER, ground.team);
    await openLost(page, id);
    await resolve(page);
    await test.step("then: solution recorded on restock", async () => {
      await page.goto(`/inventories/restock/${id}`);
      await expect(page.getByTestId("restock-detail-page")).toBeVisible();
      const shown = page
        .locator('[data-testid*="solution"], [data-testid*="resol"]')
        .or(page.getByTestId("restock-detail-page").getByText(/solution|solusi|penyelesaian/i));
      await expect(shown.first()).toBeVisible({ timeout: 5_000 });
    });
  });

  test(`selling:owner resolve lost restock (${COND}): operational account balance increases by refund`, async ({ page }) => {
    test.fail(true, `${MARK}: no refund reaches the operational account`);
    const id = ground.restocks.balance;
    const account = ground.accounts.balance;
    await signIn(page, OWNER, ground.team);
    // The create's payment is on the account; the mark lost posted nothing.
    const before = await balanceOnceRecorded(page, account, `Restock #${id}`);
    await openLost(page, id);
    await resolve(page);
    await test.step(`then: operational account balance increases by refund (from ${rupiah(before)}, up to ${rupiah(before + TOTAL)})`, async () => {
      await expect(async () => {
        await page.goto(`/financial-accounts/${account}`);
        const shown = page.getByTestId("account-detail-balance");
        await expect(shown).toHaveText(/\d/, { timeout: 2_000 });
        expect(Number((await shown.innerText()).replace(/[^\d-]/g, ""))).toBeGreaterThan(before);
      }).toPass({ timeout: 20_000 });
    });
  });
});
