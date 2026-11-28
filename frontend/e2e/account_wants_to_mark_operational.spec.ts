import { expect, test } from "@playwright/test";
import type { Page, Request, Response } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { API_URL } from "./env";
import { SUFFIX, api, login } from "./restock_helpers";

// An owner or an admin of either team type wants to choose which accounts pay — the check behind
// docs/acceptances/financial_account/account.md, section *accounts*, when *mark operational* (given 21).
// (Numbered 15 until hfrada's renumbering, aa6e65f6, 11-24.)
// The given names selling:owner · selling:admin · warehouse:owner · warehouse:admin: one test per role, each signed
// in as a person of that role, in a team of its OWN (marking an account is admin and up —
// seeing-is-team-wide-moving-is-admin-and-up; operational-accounts-pay-for-operations).
//
//   21 (active bank BCA · not operational) — BCA Belanja, active, never marked, beside BCA Tabungan (never marked
//      either, so "offered" can be told from "every account"). The row menu's Mark Operational.
//      then: asks first — the Mark … as Operational confirm opens and nothing is sent while it stands; its Cancel
//            leaves the account unmarked (no FinancialAccountOperationalSet, the Paid from feed still lacks it, no
//            Operational badge); Mark Operational on it marks the account (200, the toast, the badge on the row and
//            on the account's page)
//      then: offered as Paid from on a restock and an expense — SELLING roles: before the mark the restock form's
//            Paid from says there is no operational account and the expense dialog's Paid from is held by its notice;
//            after it, both pickers offer BCA Belanja and not BCA Tabungan.
//
// ⚠ CONFLICT for the WAREHOUSE roles' second then: a warehouse team raises no restock and records no expense —
// RestockRequestCreate is the selling team's (a restock is raised by the team that buys), and Pengeluaran is the
// selling team's (capital-joins-the-types: "Warehouse teams keep the account action as today (Pengeluaran is the
// selling team's)"). So no screen of a warehouse team has a restock's or an expense's Paid from. Each warehouse role
// keeps that then as its own `test.fail` test asserting the row's words on the warehouse's own screens, and its main
// test proves what IS built (`regression:` steps): the mark reaches the Paid from feed, and both creates refuse the
// warehouse role. The report names it for the owner.
//
// The ground (root, once): a team per role, a person of that role made in it, and in it BCA Belanja and BCA Tabungan
// (both opened at Rp 0, never operational); a warehouse team also gets BCA Gudang for its conflict test.

const PASSWORD = "e2e-acct-oper-pass-1";
type Side = "selling" | "warehouse";
type Role = { given: string; role: string; key: string; side: Side; n: number };
// n: the role's digit in its team code and account numbers.
const MANAGERS: Role[] = [
  { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "sown", side: "selling", n: 1 },
  { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "sadm", side: "selling", n: 2 },
  { given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", key: "wown", side: "warehouse", n: 3 },
  { given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", key: "wadm", side: "warehouse", n: 4 },
];

// The given's case text, verbatim from account.md — the marking script finds the tests by it.
const C15 = "active bank BCA · not operational";

// A username is lowercase letters and digits only.
const username = (r: Role) => `e2eacoper${r.key}${SUFFIX}`;
const teamName = (r: Role) => `E2E Akun Operasional ${r.key} ${SUFFIX}`;
// At most 10 characters: "AY", the role's digit, the 6-digit SUFFIX.
const teamCode = (r: Role) => `AY${r.n}${SUFFIX}`;
// Ten digits, like a BCA number: "35", the SUFFIX, the account's digit, the role's digit. Unique app-wide
// (a-real-account-is-recorded-once) — no other spec's numbers start "35".
const number = (tag: number, r: Role) => `35${SUFFIX}${tag}${r.n}`;

const PAYING = "BCA Belanja";
const OTHER = "BCA Tabungan";
const DEPOT = "BCA Gudang";

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

type Accounts = { paying: string; other: string; depot: string };
const ground = {
  team: {} as Record<string, string>,
  account: {} as Record<string, Accounts>,
};

const OPERATIONAL_SET = "FinancialAccountService/FinancialAccountOperationalSet";

// The accounts a Paid from picker is offered — the operational-only feed (useFinancialAccountOptions with
// operationalOnly, as the restock form and the expense dialog ask it), with the signed-in user's own token.
async function paidFromFeed(page: Page, teamId: string): Promise<string[]> {
  const res = (await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountList", {
    teamId,
    filter: { operationalOnly: true },
    dataRequest: ["FINANCIAL_ACCOUNT_LIST_DATA_TYPE_ACCOUNT"],
    page: { page: 1, limit: 200 },
  })) as { ids?: string[] };

  return (res.ids ?? []).map(String);
}

// The real contract with the signed-in user's token, answering instead of throwing — for a refusal.
async function send(page: Page, method: string, body: unknown): Promise<{ status: number; json: { code?: string } }> {
  return page.evaluate(
    async ([m, b, apiUrl]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ??
        window.localStorage.getItem("warehouse_revamp.token");
      const res = await fetch(`${apiUrl}/warehouse.${m as string}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(b),
      });

      return { status: res.status, json: await res.json().catch(() => ({})) };
    },
    [method, body, API_URL] as const,
  );
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  const page = await browser.newPage();
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const open = async (teamId: string, name: string, accountNumber: string) =>
    String(
      (
        await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
          teamId,
          type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
          provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
          name,
          accountNumber,
          holderName: "PT Melati",
          openingBalance: 0,
          openingOn: today(),
        })
      ).account.id,
    );

  for (const r of MANAGERS) {
    const team = await api(page, "team.v1.TeamService/TeamCreate", {
      name: teamName(r),
      teamCode: teamCode(r),
      type: r.side === "selling" ? "TEAM_TYPE_SELLING" : "TEAM_TYPE_WAREHOUSE",
      ownerUserId: ROOT_USER_ID,
    });
    const teamId = String(team.team.id);
    ground.team[r.key] = teamId;

    await api(page, "user.v1.UserService/CreateUser", {
      teamId,
      username: username(r),
      password: PASSWORD,
      name: `Akun Operasional ${r.given} ${SUFFIX}`,
      role: r.role,
    });

    // Given 21: BCA Belanja, active, not operational — beside BCA Tabungan, not operational either.
    const paying = await open(teamId, PAYING, number(1, r));
    const other = await open(teamId, OTHER, number(2, r));
    const depot = r.side === "warehouse" ? await open(teamId, DEPOT, number(3, r)) : "";
    ground.account[r.key] = { paying, other, depot };
  }

  await page.close();
});

// The role signs in and works in its own team (the active team is per tab, in sessionStorage — TeamContext).
async function signIn(page: Page, r: Role) {
  await login(page, username(r), PASSWORD);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), ground.team[r.key]);
}

async function gotoAccounts(page: Page, r: Role) {
  await page.goto("/financial-accounts");
  await expect(page.getByTestId("financial-accounts-page")).toBeVisible();
  await expect(page.getByTestId("team-switcher")).toContainText(teamName(r));
  await expect(page.getByTestId("financial-accounts-table")).toBeVisible();
}

// The restock form, opened from the Restock page's own door; its Paid from picker.
async function openRestockForm(page: Page) {
  await page.goto("/inventories/restock");
  await page.getByTestId("open-create-restock").or(page.getByTestId("open-create-restock-empty")).first().click();
  await expect(page).toHaveURL(/\/inventories\/restock\/new$/);
  await expect(page.getByTestId("restock-finance-account")).toBeVisible();
}

// The Biaya dialog with an operational-paid type (Gaji › Gaji pokok) chosen; its Paid from picker.
async function openExpenseDialog(page: Page) {
  await page.goto("/expenses");
  await page.getByTestId("open-record-cost").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByTestId("expense-type-select").click();
  await page.getByTestId("expense-type-select-basicSalary").click();
  await expect(page.getByTestId("expense-paid-from")).toBeVisible();
}

test.describe(`acct wants to choose which accounts pay (${C15})`, () => {
  for (const r of MANAGERS) {
    test(`${r.given} mark operational (${C15})`, async ({ page }) => {
      const a = ground.account[r.key];
      const teamId = ground.team[r.key];
      await signIn(page, r);

      const sets: Request[] = [];
      page.on("request", (req) => {
        if (req.url().endsWith(OPERATIONAL_SET)) sets.push(req);
      });

      // The given: BCA Belanja is active and not operational — the Paid from feed lacks it, its row has no badge…
      expect(await paidFromFeed(page, teamId)).not.toContain(a.paying);
      if (r.side === "selling") {
        // …and the two Paid from pickers have nothing to offer yet. The restock form's box says so short, and under it
        // what is missing — for the owner and admin, accounts but none marked, with the link to Financial Accounts
        // (#144, the-account-box-points-to-the-accounts-page).
        await openRestockForm(page);
        await expect(page.getByTestId("restock-finance-account")).toContainText("No operational account");
        await expect(page.getByTestId("restock-finance-account-missing")).toHaveAttribute("data-case", "unmarked");
        await expect(page.getByTestId("restock-finance-account-missing-text")).toHaveText(
          "No account marked operational — mark one.",
        );
        await expect(page.getByTestId("restock-finance-account-open")).toHaveAttribute("href", "/financial-accounts");
        await openExpenseDialog(page);
        await expect(page.getByTestId("expense-no-operational")).toBeVisible();
        await expect(page.getByTestId("expense-paid-from")).toBeDisabled();
      }
      await gotoAccounts(page, r);
      const row = page.getByTestId(`account-row-${a.paying}`);
      await expect(row).toBeVisible();
      await expect(row).toContainText(PAYING);
      await expect(page.getByTestId(`account-operational-${a.paying}`)).toHaveCount(0);

      // The WHEN: the row menu's Mark Operational.
      await page.getByTestId(`account-actions-${a.paying}`).click();
      await page.getByTestId(`account-mark-operational-${a.paying}`).click();

      await test.step("then: asks first", async () => {
        const confirm = page.getByRole("alertdialog", { name: `Mark ${PAYING} as Operational` });
        await expect(confirm).toBeVisible();
        await expect(confirm).toContainText(`${PAYING} can then be picked to pay restocks and expenses.`);
        // Nothing is sent while it asks.
        expect(sets).toHaveLength(0);

        // Its Cancel changes nothing.
        await confirm.getByTestId("confirm-dismiss").click();
        await expect(page.getByRole("alertdialog")).toHaveCount(0);
        expect(sets).toHaveLength(0);
        expect(await paidFromFeed(page, teamId)).not.toContain(a.paying);
        await expect(page.getByTestId(`account-operational-${a.paying}`)).toHaveCount(0);

        // Asked again and confirmed: the account is marked.
        await page.getByTestId(`account-actions-${a.paying}`).click();
        await page.getByTestId(`account-mark-operational-${a.paying}`).click();
        await expect(confirm).toBeVisible();
        const answered = page.waitForResponse((res: Response) => res.url().endsWith(OPERATIONAL_SET));
        await confirm.getByTestId("confirm-action").click();
        expect((await answered).status()).toBe(200);
        expect(sets).toHaveLength(1);
        await expect(page.getByText(`${PAYING} pays for operations now`)).toBeVisible();
        await expect(page.getByRole("alertdialog")).toHaveCount(0);
        await expect(page.getByTestId(`account-operational-${a.paying}`)).toBeVisible();
        await expect(page.getByTestId(`account-operational-${a.other}`)).toHaveCount(0);

        // The menu now offers the way back; the account's page carries the mark.
        await page.getByTestId(`account-actions-${a.paying}`).click();
        await expect(page.getByTestId(`account-unmark-operational-${a.paying}`)).toBeVisible();
        await page.keyboard.press("Escape");
        await page.goto(`/financial-accounts/${a.paying}`);
        await expect(page.getByTestId("account-name-heading")).toHaveText(PAYING);
        await expect(page.getByTestId("financial-account-page")).toContainText("Operational");
      });

      if (r.side === "selling") {
        await test.step("then: offered as Paid from on a restock and an expense", async () => {
          // The restock form's Paid from — the one operational account, pre-picked and offered; BCA Tabungan not.
          await openRestockForm(page);
          await expect(page.getByTestId("restock-finance-account")).toContainText(PAYING);
          await page.getByTestId("restock-finance-account").click();
          await expect(page.getByTestId(`restock-finance-account-option-${a.paying}`)).toBeVisible();
          await expect(page.getByTestId(`restock-finance-account-option-${a.other}`)).toHaveCount(0);

          // The expense dialog's Paid from — its notice gone, the same one account offered.
          await openExpenseDialog(page);
          await expect(page.getByTestId("expense-no-operational")).toHaveCount(0);
          await expect(page.getByTestId("expense-paid-from")).toBeEnabled();
          await expect(page.getByTestId("expense-paid-from")).toContainText(PAYING);
          await page.getByTestId("expense-paid-from").click();
          await expect(page.getByTestId(`expense-paid-from-option-${a.paying}`)).toBeVisible();
          await expect(page.getByTestId(`expense-paid-from-option-${a.other}`)).toHaveCount(0);
        });
      } else {
        await test.step("regression: the mark reaches the Paid from feed (operational only)", async () => {
          const feed = await paidFromFeed(page, teamId);
          expect(feed).toContain(a.paying);
          expect(feed).not.toContain(a.other);
        });

        await test.step("regression: a warehouse raises no restock and records no expense", async () => {
          const restock = await send(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
            teamId,
            warehouseId: teamId,
            items: [{ productId: "1", productCode: "E2E-OPER", name: "E2E operational", count: 1, total: 1000 }],
            financeAccountId: a.paying,
          });
          expect.soft(restock.status).not.toBe(200);
          expect.soft(restock.json.code).toBe("permission_denied");

          const expense = await send(page, "expense.v1.ExpenseService/ExpenseCreate", {
            teamId,
            kind: "EXPENSE_KIND_PAYROLL",
            type: "EXPENSE_TYPE_BASIC_SALARY",
            amount: 1000,
            occurredAt: today(),
            note: `E2E operational ${r.key} ${SUFFIX}`,
            financeAccountId: a.paying,
          });
          expect.soft(expense.status).not.toBe(200);
          expect.soft(expense.json.code).toBe("permission_denied");
        });
      }
    });
  }

  // The warehouse half of the second then — see the CONFLICT note at the top.
  for (const r of MANAGERS.filter((m) => m.side === "warehouse")) {
    test(`${r.given} mark operational (${C15}) — Paid from on a warehouse's restock and expense`, async ({ page }) => {
      test.fail(
        true,
        "conflict: a warehouse team raises no restock and records no expense — RestockRequestCreate is the selling " +
          "team's, and Pengeluaran is the selling team's (capital-joins-the-types) — so a warehouse's operational " +
          "account is never offered as a restock's or an expense's Paid from",
      );
      const a = ground.account[r.key];
      const teamId = ground.team[r.key];
      await signIn(page, r);

      // The given + WHEN through the contract (the screen's ask is the other test's): BCA Gudang marked by the role.
      await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
        teamId,
        accountId: a.depot,
        operational: true,
      });
      await gotoAccounts(page, r);
      await expect(page.getByTestId(`account-operational-${a.depot}`)).toBeVisible();

      await test.step("then: offered as Paid from on a restock and an expense", async () => {
        // A restock's Paid from: the warehouse's Restock page would need a door to a restock form.
        await page.goto("/inventories/restock");
        const create = page.getByTestId("open-create-restock").or(page.getByTestId("open-create-restock-empty"));
        await expect.soft(create.first()).toBeVisible({ timeout: 5_000 });
        if ((await create.count()) > 0) {
          await create.first().click();
          await page.getByTestId("restock-finance-account").click();
          await expect.soft(page.getByTestId(`restock-finance-account-option-${a.depot}`)).toBeVisible();
        }

        // An expense's Paid from: the warehouse's menu would need Expenses.
        const expenses = page.getByTestId("sidebar").locator('a[href="/expenses"]');
        await expect.soft(expenses).toHaveCount(1, { timeout: 5_000 });
        if ((await expenses.count()) > 0) {
          await openExpenseDialog(page);
          await page.getByTestId("expense-paid-from").click();
          await expect.soft(page.getByTestId(`expense-paid-from-option-${a.depot}`)).toBeVisible();
        }
      });
    });
  }
});
