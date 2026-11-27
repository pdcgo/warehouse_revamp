import { expect, test } from "@playwright/test";
import type { Page, Response } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { API_URL } from "./env";
import { SUFFIX, api, login } from "./restock_helpers";

// An owner or an admin of either team type wants to add an account — the check behind
// docs/acceptances/financial_account/account.md, section *accounts*, when *create account* (givens 7–10 and 19).
// Givens 7–10 name selling:owner · selling:admin · warehouse:owner · warehouse:admin: one test per role, each signed in
// as a person of that role, in a team of its OWN for each given (the list is the whole team's, and a name is the
// team's — an-account-has-a-name-and-a-holder). Given 19 names the roles that are refused (selling:cs ·
// warehouse:staff): one test each, on a team holding two accounts.
//
//   7 (type bank · provider BCA · name "BCA Operasional" · number · holder PT Melati · opening Rp 500.000) — the New
//     Account dialog filled as the given says; the number is the run's own (a number is recorded once app-wide,
//     a-real-account-is-recorded-once), ten digits like the given's 1234567890
//     then: account listed with Rp 500.000 — its row, its name and holder, its balance
//     then: its first row: opening balance Rp 500.000 — the account's page, one row, Opening balance, +Rp 500.000
//           (an-account-opens-with-a-log-row)
//   8 (type bank · provider BCA · number already in another team) — root records the BCA number in a team of its own
//     first; the role types the same number
//     then: cannot create, message says one real account is recorded once — the dialog stays with the server's
//           refusal (409), and the team still has no account
//   9 (name "BCA Operasional" already used in this team) — root records "BCA Operasional" in the role's team; the role
//     types the same name with a fresh number
//     then: cannot create — the refusal names the name, and the team still has the one account
//   10 (type other · provider other · no number · opening Rp 0) — type Other sets its provider by itself
//     (kas-and-lainnya-ask-no-provider): no provider field, no number typed
//     then: account created with provider other — its row's provider badge reads Other, no number, Rp 0
//   19 (team with 2 active accounts) — selling:cs and warehouse:staff
//     then: cannot add, New Account not offered — no New Account beside the Archive button, and the server refuses
//           the create under the role's own token (403)
//     then: the 2 accounts still shown with their balances, with no actions — both rows, both balances, no Actions
//           column, no Transfer and no Account actions
//
// The ground (root, once): a team per (given, role) — 16 for givens 7–10, two for given 19, and the "another team" of
// given 8 — and a person of every role, made in its given-7 team (given 19's in its own) and added to the others.

const PASSWORD = "e2e-acct-create-pass-1";
type Side = "selling" | "warehouse";
type Role = { given: string; role: string; key: string; side: Side; n: number };
// n: the role's digit in its team codes and its account numbers.
const MANAGERS: Role[] = [
  { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "sown", side: "selling", n: 1 },
  { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "sadm", side: "selling", n: 2 },
  { given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", key: "wown", side: "warehouse", n: 3 },
  { given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", key: "wadm", side: "warehouse", n: 4 },
];
const REFUSED: Role[] = [
  { given: "selling:cs", role: "ROLE_SELLING_CS", key: "scs", side: "selling", n: 5 },
  { given: "warehouse:staff", role: "ROLE_WAREHOUSE_STAFF", key: "wstf", side: "warehouse", n: 6 },
];

// The givens' case texts, verbatim from account.md — the marking script finds the tests by them.
const C7 = 'type bank · provider BCA · name "BCA Operasional" · number 1234567890 · holder PT Melati · opening Rp 500.000';
const C8 = "type bank · provider BCA · number 1234567890 already in another team";
const C9 = 'name "BCA Operasional" already used in this team';
const C10 = "type other · provider other · no number · opening Rp 0";
const C19 = "team with 2 active accounts";

type Given = 7 | 8 | 9 | 10 | 19;
const LETTER: Record<Given, string> = { 7: "A", 8: "B", 9: "C", 10: "D", 19: "E" };

// A username is lowercase letters and digits only.
const username = (key: string) => `e2eacnew${key}${SUFFIX}`;
const teamName = (g: Given, r: Role) => `E2E Akun Baru ${g} ${r.key} ${SUFFIX}`;
// At most 10 characters: "AN", the given's letter, the role's digit, the 6-digit SUFFIX.
const teamCode = (g: Given, r: Role) => `AN${LETTER[g]}${r.n}${SUFFIX}`;
const OTHER_TEAM = `E2E Akun Baru Lain ${SUFFIX}`;
const OTHER_CODE = `ANX0${SUFFIX}`;
// Ten digits, like the given's 1234567890: "31", the SUFFIX, the given's digit, the role's digit. Unique app-wide.
const number = (tag: number, r: Role) => `31${SUFFIX}${tag}${r.n}`;

const NAME = "BCA Operasional";
const HOLDER = "PT Melati";

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

const ground = {
  team: {} as Record<string, string>,
  // given 9: the "BCA Operasional" root recorded in the role's team
  taken: {} as Record<string, string>,
  // given 19: the two accounts of each refused role's team
  pair: {} as Record<string, { bank: string; cash: string }>,
};
const teamOf = (g: Given, r: Role) => ground.team[`${g}${r.key}`];

const BANK_NAME = `E2E BCA Tim ${SUFFIX}`;
const CASH_NAME = `E2E Kas Tim ${SUFFIX}`;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  const page = await browser.newPage();
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const teamType = (s: Side) => (s === "selling" ? "TEAM_TYPE_SELLING" : "TEAM_TYPE_WAREHOUSE");
  const makeTeam = async (name: string, teamCode: string, s: Side) =>
    String(
      (await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type: teamType(s), ownerUserId: ROOT_USER_ID }))
        .team.id,
    );
  const account = async (teamId: string, body: Record<string, unknown>) =>
    String(
      (
        await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
          teamId,
          holderName: "E2E",
          openingOn: today(),
          ...body,
        })
      ).account.id,
    );

  // Givens 7–10: a team per given and role, the person made in the given-7 one and added to the other three.
  for (const r of MANAGERS) {
    for (const g of [7, 8, 9, 10] as const) {
      ground.team[`${g}${r.key}`] = await makeTeam(teamName(g, r), teamCode(g, r), r.side);
    }
    const made = await api(page, "user.v1.UserService/CreateUser", {
      teamId: teamOf(7, r),
      username: username(r.key),
      password: PASSWORD,
      name: `Akun Baru ${r.given} ${SUFFIX}`,
      role: r.role,
    });
    for (const g of [8, 9, 10] as const) {
      await api(page, "user.v1.UserService/TeamUserUpdate", {
        teamId: teamOf(g, r),
        add: { userId: String(made.user.id), role: r.role },
      });
    }
  }

  // Given 8 — "already in another team": each role's BCA number, recorded first in a selling team of root's.
  const other = await makeTeam(OTHER_TEAM, OTHER_CODE, "selling");
  for (const r of MANAGERS) {
    await account(other, {
      type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
      name: `E2E BCA Lain ${r.key} ${SUFFIX}`,
      accountNumber: number(8, r),
      openingBalance: 0,
    });
  }

  // Given 9 — "BCA Operasional already used in this team": recorded in the role's own given-9 team.
  for (const r of MANAGERS) {
    ground.taken[r.key] = await account(teamOf(9, r), {
      type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
      name: NAME,
      accountNumber: number(9, r),
      openingBalance: 0,
    });
  }

  // Given 19 — a team with 2 active accounts, per refused role.
  for (const r of REFUSED) {
    ground.team[`19${r.key}`] = await makeTeam(teamName(19, r), teamCode(19, r), r.side);
    await api(page, "user.v1.UserService/CreateUser", {
      teamId: teamOf(19, r),
      username: username(r.key),
      password: PASSWORD,
      name: `Akun Baru ${r.given} ${SUFFIX}`,
      role: r.role,
    });
    ground.pair[r.key] = {
      bank: await account(teamOf(19, r), {
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name: BANK_NAME,
        accountNumber: number(19, r),
        openingBalance: 250_000,
      }),
      cash: await account(teamOf(19, r), {
        type: "FINANCIAL_ACCOUNT_TYPE_CASH",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_CASH",
        name: CASH_NAME,
        openingBalance: 75_000,
      }),
    };
  }

  await page.close();
});

// The role signs in, works in the given's team (the active team is per tab, in sessionStorage — TeamContext), and
// opens the Akun list — the ground before the WHEN.
async function openAccounts(page: Page, r: Role, g: Given) {
  await login(page, username(r.key), PASSWORD);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamOf(g, r));
  await page.goto("/financial-accounts");
  await expect(page.getByTestId("financial-accounts-page")).toBeVisible();
  await expect(page.getByTestId("team-switcher")).toContainText(teamName(g, r));
  // The list has answered: its rows, or its empty hint.
  await expect(page.getByTestId("financial-accounts-table").or(page.getByTestId("financial-accounts-empty")).first()).toBeVisible();
}

const rowsOf = (page: Page) =>
  page.getByTestId("financial-accounts-table").locator('[data-testid^="account-row-"]');

// The create's answer — waited for before the click that sends it.
const createAnswer = (page: Page) =>
  page.waitForResponse((r: Response) => r.url().endsWith("FinancialAccountService/FinancialAccountCreate"));

// New Account, bank BCA, as the givens fill it.
async function fillBank(page: Page, args: { name: string; number: string; holder?: string; opening: string }) {
  await page.getByTestId("open-create-account").click();
  const form = page.getByTestId("account-form");
  await expect(form).toBeVisible();

  await form.getByTestId("account-type-2").click(); // Bank account (the default, picked as the given says)
  await form.getByTestId("account-provider").click();
  await form.getByRole("option", { name: "BCA", exact: true }).click();
  await form.getByTestId("account-name").fill(args.name);
  await form.getByTestId("account-number").fill(args.number);
  if (args.holder) await form.getByTestId("account-holder").fill(args.holder);
  await form.getByTestId("account-opening").fill(args.opening);

  return form;
}

type Answer = { status: number; json: Record<string, unknown> };

// A call that may be refused — the status and the answer, never a throw. Under the signed-in role's own token.
async function send(page: Page, method: string, body: unknown): Promise<Answer> {
  return page.evaluate(
    async ([m, b, apiUrl]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ?? window.localStorage.getItem("warehouse_revamp.token");
      const res = await fetch(`${apiUrl}/warehouse.${m as string}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify(b),
      });
      return { status: res.status, json: (await res.json()) as Record<string, unknown> };
    },
    [method, body, API_URL] as const,
  );
}

test.describe(`acct wants to add an account (${C7})`, () => {
  for (const r of MANAGERS) {
    test(`${r.given} create account (${C7})`, async ({ page }) => {
      await openAccounts(page, r, 7);
      await expect(rowsOf(page)).toHaveCount(0);

      const form = await fillBank(page, { name: NAME, number: number(7, r), holder: HOLDER, opening: "500000" });
      const answered = createAnswer(page);
      await form.getByTestId("account-form-save").click();
      const answer = await answered;
      expect(answer.status()).toBe(200);
      const id = String(((await answer.json()) as { account: { id: string } }).account.id);
      await expect(form).toBeHidden();

      await test.step("then: account listed with Rp 500.000", async () => {
        const row = page.getByTestId(`account-row-${id}`);
        await expect(row).toBeVisible();
        await expect(row).toContainText(NAME);
        await expect(page.getByTestId(`account-balance-${id}`)).toHaveText("Rp 500.000");
        await expect.soft(row).toContainText(HOLDER);
        await expect.soft(page.getByTestId(`account-number-${id}`)).toHaveText(number(7, r));
        await expect(rowsOf(page)).toHaveCount(1);
      });

      await test.step("then: its first row: opening balance Rp 500.000", async () => {
        await page.getByTestId(`account-row-${id}`).click();
        await expect(page).toHaveURL(new RegExp(`/financial-accounts/${id}(\\?|$)`));
        const logs = page.getByTestId("account-log-table").locator('[data-testid^="account-log-row-"]');
        await expect(logs).toHaveCount(1);
        const first = logs.first();
        await expect(first).toContainText("Opening balance");
        await expect(first.locator("td").nth(3)).toContainText("Rp 500.000");
        await expect.soft(first.locator("td").nth(4)).toHaveText("Rp 500.000");
        await expect.soft(page.getByTestId("account-detail-balance")).toHaveText("Rp 500.000");
      });
    });
  }
});

test.describe(`acct wants to add an account (${C8})`, () => {
  for (const r of MANAGERS) {
    test(`${r.given} create account (${C8})`, async ({ page }) => {
      await openAccounts(page, r, 8);
      await expect(rowsOf(page)).toHaveCount(0);

      const form = await fillBank(page, { name: `${NAME} ${r.key}`, number: number(8, r), opening: "0" });
      const answered = createAnswer(page);
      await form.getByTestId("account-form-save").click();
      const answer = await answered;

      await test.step("then: cannot create, message says one real account is recorded once", async () => {
        expect(answer.status()).toBe(409); // already_exists
        await expect(form).toBeVisible();
        const error = form.getByTestId("account-form-error");
        await expect(error).toContainText("already recorded");
        await expect(error).toContainText("one real account");

        // Nothing was recorded: the team's list, read afresh, still holds no account.
        await page.reload();
        await expect(page.getByTestId("financial-accounts-empty")).toBeVisible();
        await expect(rowsOf(page)).toHaveCount(0);
      });
    });
  }
});

test.describe(`acct wants to add an account (${C9})`, () => {
  for (const r of MANAGERS) {
    test(`${r.given} create account (${C9})`, async ({ page }) => {
      await openAccounts(page, r, 9);
      const taken = ground.taken[r.key];
      await expect(rowsOf(page)).toHaveCount(1);
      await expect(page.getByTestId(`account-row-${taken}`)).toContainText(NAME);

      // The same name, a number nobody has — so only the name can refuse it.
      const form = await fillBank(page, { name: NAME, number: number(5, r), opening: "0" });
      const answered = createAnswer(page);
      await form.getByTestId("account-form-save").click();
      const answer = await answered;

      await test.step("then: cannot create", async () => {
        expect(answer.status()).toBe(409); // already_exists
        await expect(form).toBeVisible();
        await expect(form.getByTestId("account-form-error")).toContainText(`already has an account named ${NAME}`);

        // The team still has the one account it had.
        await page.reload();
        await expect(page.getByTestId(`account-row-${taken}`)).toBeVisible();
        await expect(rowsOf(page)).toHaveCount(1);
      });
    });
  }
});

test.describe(`acct wants to add an account (${C10})`, () => {
  for (const r of MANAGERS) {
    test(`${r.given} create account (${C10})`, async ({ page }) => {
      await openAccounts(page, r, 10);
      await expect(rowsOf(page)).toHaveCount(0);

      const name = `E2E Lainnya ${r.key} ${SUFFIX}`;
      await page.getByTestId("open-create-account").click();
      const form = page.getByTestId("account-form");
      await expect(form).toBeVisible();
      await form.getByTestId("account-type-4").click(); // Other
      // Type Other sets its provider: there is nothing to pick (kas-and-lainnya-ask-no-provider).
      await expect(form.getByTestId("account-provider")).toHaveCount(0);
      await form.getByTestId("account-name").fill(name);
      await expect(form.getByTestId("account-number")).toHaveValue("");
      await form.getByTestId("account-opening").fill("0");

      const answered = createAnswer(page);
      await form.getByTestId("account-form-save").click();
      const answer = await answered;
      expect(answer.status()).toBe(200);
      const made = ((await answer.json()) as { account: { id: string; provider?: string; type?: string } }).account;
      const id = String(made.id);
      await expect(form).toBeHidden();

      await test.step("then: account created with provider other", async () => {
        expect(made.provider).toBe("FINANCIAL_ACCOUNT_PROVIDER_UNKNOWN");
        expect.soft(made.type).toBe("FINANCIAL_ACCOUNT_TYPE_UNKNOWN");
        const row = page.getByTestId(`account-row-${id}`);
        await expect(row).toBeVisible();
        await expect(row).toContainText(name);
        // The provider cell: its badge alone, Other — no number under it.
        await expect(row.locator("td").nth(1)).toHaveText("Other");
        await expect(page.getByTestId(`account-number-${id}`)).toHaveCount(0);
        await expect(page.getByTestId(`account-balance-${id}`)).toHaveText("Rp 0");
      });
    });
  }
});

test.describe(`acct wants to add an account (${C19})`, () => {
  for (const r of REFUSED) {
    test(`${r.given} create account (${C19})`, async ({ page }) => {
      await openAccounts(page, r, 19);
      const pair = ground.pair[r.key];

      await test.step("then: cannot add, New Account not offered", async () => {
        // The header's actions drew — the Archive button is there — and New Account is not among them.
        await expect(page.getByTestId("open-archived-accounts")).toBeVisible();
        await expect(page.getByTestId("open-create-account")).toHaveCount(0);
        await expect(page.getByRole("button", { name: "New Account" })).toHaveCount(0);

        // Hiding a button hides nothing: the server refuses the create under the role's own token.
        const refused = await send(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
          teamId: teamOf(19, r),
          type: "FINANCIAL_ACCOUNT_TYPE_CASH",
          provider: "FINANCIAL_ACCOUNT_PROVIDER_CASH",
          name: `E2E Kas Tolak ${r.key} ${SUFFIX}`,
          holderName: "E2E",
          openingBalance: 0,
          openingOn: today(),
        });
        expect(refused.status).toBe(403);
        expect(refused.json.code).toBe("permission_denied");
      });

      await test.step("then: the 2 accounts still shown with their balances, with no actions", async () => {
        await page.reload();
        const table = page.getByTestId("financial-accounts-table");
        await expect(rowsOf(page)).toHaveCount(2);
        await expect(page.getByTestId(`account-row-${pair.bank}`)).toContainText(BANK_NAME);
        await expect(page.getByTestId(`account-balance-${pair.bank}`)).toHaveText("Rp 250.000");
        await expect(page.getByTestId(`account-row-${pair.cash}`)).toContainText(CASH_NAME);
        await expect(page.getByTestId(`account-balance-${pair.cash}`)).toHaveText("Rp 75.000");

        // No actions: no Actions column, and nothing to press on a row.
        await expect(table.getByRole("columnheader", { name: "Actions" })).toHaveCount(0);
        await expect(table.getByRole("button", { name: "Account actions" })).toHaveCount(0);
        await expect(table.getByRole("button", { name: "Transfer", exact: true })).toHaveCount(0);
        await expect(rowsOf(page).getByRole("button")).toHaveCount(0);
      });
    });
  }
});
