import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";
import { openShops } from "./pickers";

// SETTLEMENT AND EXPENSE ASK THE SHOP FIRST — end to end, on the real server
// (docs/business/shop/context_decision.md#settlement-and-expense-ask-the-shop-first):
//
//   Before settlement opens a shop's account (a row with no order naming a shop) and before an expense stores its shop,
//   each asks ShopAccessCheck for the caller's team. Another team's shop, or one that never existed, answers NotFound
//   "shop #N is not one of this team's shops" — the same words for both — and NOTHING is written. Who in the team may
//   post or spend is unchanged. A CLOSED shop of the team still takes both (a-closed-shop-refuses-only-new-selling).
//
// The case the rule closes: team A posting first to team B's shop used to OPEN B's shop account under A, and every post
// B made on its own shop after that was refused. So team A's owner tries it, then team B's owner posts on B's shop and
// must be taken.
//
// TWO SELLING TEAMS OF THEIR OWN (root owns both), each with an owner of its own who does the posting — so no root
// override is in play and root's team, whose totals financial_accounts.spec checks, is never touched. Named to sort
// after orders.spec.ts, statement.spec.ts and the_settlement_report.spec.ts, as a spec posting money must.
//
//   team A   shop A1 (open) · shop A2 (closed in the setup) · one operational account · owner `e2easkaown<suffix>`
//   team B   shop B1 (open)                                                         · owner `e2easkbown<suffix>`

const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-ask-shop-pass-1";
// A username is lowercase letters and digits only.
const A_OWNER = `e2easkaown${SUFFIX}`;
const B_OWNER = `e2easkbown${SUFFIX}`;
const SHOP_A1 = `E2E Ask Shop A1 ${SUFFIX}`;
const SHOP_A2 = `E2E Ask Shop A2 ${SUFFIX}`;
const SHOP_B1 = `E2E Ask Shop B1 ${SUFFIX}`;
// No shop has this id: the run's database holds a few hundred.
const UNKNOWN_SHOP = "987654321";

const notTheTeams = (shop: string) => `shop #${shop} is not one of this team's shops`;

/** Today, as a Jakarta day. */
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

// An RPC as the signed-in person — the status and the JSON body, so a refusal is asserted as well as a success.
async function call(page: Page, method: string, body: unknown) {
  return page.evaluate(
    async ([m, b, apiUrl]) => {
      const bearer =
        window.sessionStorage.getItem("warehouse_revamp.token") ?? window.localStorage.getItem("warehouse_revamp.token");

      const res = await fetch(`${apiUrl}/warehouse.${m as string}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
        body: JSON.stringify(b),
      });

      return { status: res.status, body: (await res.json()) as Record<string, any> };
    },
    [method, body, API_URL] as const,
  );
}

// The same, failing the test by name when refused.
async function rpc<T = Record<string, any>>(page: Page, method: string, body: unknown): Promise<T> {
  const res = await call(page, method, body);
  if (res.status !== 200) throw new Error(`${method}: ${res.status} ${JSON.stringify(res.body)}`);

  return res.body as T;
}

// Work in the given team: the active team is per tab, in sessionStorage (TeamContext).
async function useTeam(page: Page, teamId: string) {
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

// A shop row by hand — no order, so it addresses the shop's own account.
const shopRow = (teamId: string, shopId: string, key: string, change: number) => ({
  teamId,
  shopId,
  orderId: "0",
  uniqueId: `e2e-ask-${key}-${SUFFIX}`,
  settlementType: "SETTLEMENT_TYPE_FUND",
  sourceType: "SOURCE_TYPE_MANUAL",
  change,
  occurredOn: today(),
  note: "e2e ask the shop first",
});

const POST = "settlement.v1.SettlementWriteService/SettlementPost";
const EXPENSE = "expense.v1.ExpenseService/ExpenseCreate";

const state = { teamA: "", teamB: "", shopA1: "", shopA2: "", shopB1: "", account: "" };

test.describe.configure({ mode: "serial" });

test("Setup: two selling teams, each with its shop and its own owner; team A's second shop closed", async ({ page }) => {
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (code: string, name: string) =>
    (
      await rpc<{ team: { id: string } }>(page, "team.v1.TeamService/TeamCreate", {
        name,
        teamCode: code,
        type: "TEAM_TYPE_SELLING",
        ownerUserId: ROOT_USER_ID,
      })
    ).team.id;
  state.teamA = await team(`SA${SUFFIX}`, `E2E Ask Team A ${SUFFIX}`);
  state.teamB = await team(`SB${SUFFIX}`, `E2E Ask Team B ${SUFFIX}`);

  const shop = async (teamId: string, name: string, code: string) =>
    (
      await rpc<{ shop: { id: string } }>(page, "selling.v1.ShopService/ShopCreate", {
        teamId,
        name,
        shopCode: code,
        marketplace: "MARKETPLACE_SHOPEE",
      })
    ).shop.id;
  state.shopA1 = await shop(state.teamA, SHOP_A1, `SAA${SUFFIX}`);
  state.shopA2 = await shop(state.teamA, SHOP_A2, `SAB${SUFFIX}`);
  state.shopB1 = await shop(state.teamB, SHOP_B1, `SBA${SUFFIX}`);

  // A2 is closed — a closed shop refuses only NEW SELLING (a-closed-shop-refuses-only-new-selling).
  await rpc(page, "selling.v1.ShopService/ShopClose", { teamId: state.teamA, shopId: state.shopA2 });

  await rpc(page, "user.v1.UserService/CreateUser", {
    teamId: state.teamA,
    username: A_OWNER,
    password: PASSWORD,
    name: `Ask A Owner ${SUFFIX}`,
    role: "ROLE_SELLING_OWNER",
  });
  await rpc(page, "user.v1.UserService/CreateUser", {
    teamId: state.teamB,
    username: B_OWNER,
    password: PASSWORD,
    name: `Ask B Owner ${SUFFIX}`,
    role: "ROLE_SELLING_OWNER",
  });

  // ⚠ Seeded BEFORE any expense screen opens: Paid from reads the operational accounts once, as reference data
  // (expenses.spec.ts says why). One account, so the form picks it by itself.
  state.account = (
    await rpc<{ account: { id: string } }>(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
      teamId: state.teamA,
      type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
      name: `E2E Ask BCA ${SUFFIX}`,
      holderName: "PT E2E",
      accountNumber: `77${SUFFIX}01`,
      openingBalance: 5_000_000,
      openingOn: today(),
    })
  ).account.id;
  await rpc(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: state.teamA,
    accountId: state.account,
    operational: true,
  });
});

test("Settlement: team A posting on team B's shop, or on a shop that never existed, is NotFound — nothing written", async ({
  page,
}) => {
  await signIn(page, A_OWNER, PASSWORD);
  await useTeam(page, state.teamA);

  const claim = await call(page, POST, shopRow(state.teamA, state.shopB1, "claim", 40_000));
  expect(claim.status).toBe(404);
  expect(claim.body.code).toBe("not_found");
  expect(claim.body.message).toBe(notTheTeams(state.shopB1));

  // The same words for a shop that does not exist — the answer confirms no id.
  const unknown = await call(page, POST, shopRow(state.teamA, UNKNOWN_SHOP, "unknown", 40_000));
  expect(unknown.status).toBe(404);
  expect(unknown.body.code).toBe("not_found");
  expect(unknown.body.message).toBe(notTheTeams(UNKNOWN_SHOP));

  // Nothing landed under team A.
  await page.goto("/settlement/shop-entries");
  await expect(page.getByTestId("shop-entries-empty")).toBeVisible();
  await expect(page.locator('[data-testid^="shop-entry-amount-"]')).toHaveCount(0);
});

test("Settlement: team B's own post still opens B's shop account — the claim left nothing behind", async ({ page }) => {
  await signIn(page, B_OWNER, PASSWORD);
  await useTeam(page, state.teamB);

  // Before the rule this was PermissionDenied: team A's claim had opened B1's account under team A.
  const own = await rpc<{ created: boolean; entry: { id: string } }>(page, POST, shopRow(state.teamB, state.shopB1, "b-own", 25_000));
  expect(own.created).toBe(true);

  await page.goto("/settlement/shop-entries");
  await expect(page.getByTestId("shop-entries-count")).toHaveText("1");
  await expect(page.getByTestId(`shop-entry-amount-${own.entry.id}`)).toContainText("25.000");
  // Only B's own row — none of team A's 40.000.
  await expect(page.locator('[data-testid^="shop-entry-amount-"]')).toHaveCount(1);
});

test("Settlement: team A's own shops take a row — the open one and the closed one", async ({ page }) => {
  await signIn(page, A_OWNER, PASSWORD);
  await useTeam(page, state.teamA);

  const open = await rpc<{ created: boolean; entry: { id: string } }>(page, POST, shopRow(state.teamA, state.shopA1, "a1", 15_000));
  expect(open.created).toBe(true);
  const closed = await rpc<{ created: boolean; entry: { id: string } }>(page, POST, shopRow(state.teamA, state.shopA2, "a2", 12_000));
  expect(closed.created).toBe(true);

  await page.goto("/settlement/shop-entries");
  await expect(page.getByTestId("shop-entries-count")).toHaveText("2");
  await expect(page.getByTestId(`shop-entry-amount-${open.entry.id}`)).toContainText("15.000");
  await expect(page.getByTestId(`shop-entry-amount-${closed.entry.id}`)).toContainText("12.000");
});

test("Expense: an ad naming another team's shop, or an unknown one, is NotFound — said on the form, nothing stored", async ({
  page,
}) => {
  await signIn(page, A_OWNER, PASSWORD);
  await useTeam(page, state.teamA);

  const ad = (shopId: string) => ({
    teamId: state.teamA,
    kind: "EXPENSE_KIND_ADS",
    type: "EXPENSE_TYPE_ADS_MARKETPLACE", // a type is required since #99 (expense-types-sit-under-groups)
    amount: 150_000,
    occurredAt: today(),
    shopId,
    note: "e2e ask ad",
    financeAccountId: state.account,
  });

  const other = await call(page, EXPENSE, ad(state.shopB1));
  expect(other.status).toBe(404);
  expect(other.body.code).toBe("not_found");
  expect(other.body.message).toBe(notTheTeams(state.shopB1));

  const unknown = await call(page, EXPENSE, ad(UNKNOWN_SHOP));
  expect(unknown.status).toBe(404);
  expect(unknown.body.code).toBe("not_found");
  expect(unknown.body.message).toBe(notTheTeams(UNKNOWN_SHOP));

  // On the form: the picker offers only the team's shops, so the request is re-pointed at B1 on its way out — the
  // server is the guard, and its sentence is what the person reads.
  await page.goto("/expenses");
  await expect(page.getByTestId("expenses-empty")).toBeVisible();

  await page.route("**/warehouse.expense.v1.ExpenseService/ExpenseCreate", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
    body.shopId = state.shopB1;
    await route.continue({ postData: JSON.stringify(body) });
  });

  await page.getByTestId("open-record-cost").click();
  const dialog = page.getByRole("dialog");
  await page.getByTestId("expense-type-select").click();
  await page.getByTestId("expense-type-select-adsMarketplace").click(); // Iklan › Iklan marketplace — the one type that names a shop (#99)
  await page.getByTestId("expense-amount").fill("150000");
  await openShops(dialog);
  // The team's own shops only — B1 is never offered.
  await expect(dialog.getByTestId(`shop-select-option-${state.shopB1}`)).toHaveCount(0);
  await dialog.getByTestId(`shop-select-option-${state.shopA1}`).click();
  await expect(page.getByTestId("expense-paid-from")).toContainText(`E2E Ask BCA ${SUFFIX}`);
  await page.getByTestId("expense-note").fill(`e2e ask refused ${SUFFIX}`);
  await expect(page.getByTestId("submit-cost")).toBeEnabled();
  await page.getByTestId("submit-cost").click();

  await expect(page.getByTestId("expense-form-error")).toHaveText(notTheTeams(state.shopB1));
  await page.unroute("**/warehouse.expense.v1.ExpenseService/ExpenseCreate");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();

  // Nothing stored — the list and the total read as before.
  await page.reload();
  await expect(page.getByTestId("expenses-empty")).toBeVisible();
  await expect(page.getByTestId("expenses-total")).toHaveText("Rp 0");
});

test("Expense: an ad on the team's CLOSED shop is taken — recorded through the form", async ({ page }) => {
  await signIn(page, A_OWNER, PASSWORD);
  await useTeam(page, state.teamA);

  const note = `e2e ask closed shop ${SUFFIX}`;
  await page.goto("/expenses");
  await page.getByTestId("open-record-cost").click();
  const dialog = page.getByRole("dialog");
  await page.getByTestId("expense-type-select").click();
  await page.getByTestId("expense-type-select-adsMarketplace").click(); // Iklan › Iklan marketplace — the one type that names a shop (#99)
  await page.getByTestId("expense-amount").fill("90000");
  await openShops(dialog);
  // The form offers the closed shop, badged (withClosed) — an ad is money still running on it.
  await expect(dialog.getByTestId(`shop-select-closed-${state.shopA2}`)).toBeAttached();
  await dialog.getByTestId(`shop-select-option-${state.shopA2}`).click();
  await expect(page.getByTestId("expense-paid-from")).toContainText(`E2E Ask BCA ${SUFFIX}`);
  await page.getByTestId("expense-note").fill(note);
  await page.getByTestId("submit-cost").click();

  await expect(dialog).toBeHidden();
  const row = page.locator('[data-testid^="expense-row-"]').filter({ hasText: note });
  await expect(row).toHaveCount(1);
  await expect(row.locator('[data-testid^="expense-shop-"]')).toContainText(SHOP_A2);
  await expect(page.getByTestId("expenses-total")).toHaveText("Rp 90.000");
});
