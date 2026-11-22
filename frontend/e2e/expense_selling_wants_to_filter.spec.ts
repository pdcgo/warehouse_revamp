import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";

// ── filter expenses — the checks behind docs/acceptances/financial_account/expense.md, given 29 ────────────────────────
//
// filter expenses' regression spec. An acceptance has no test file of its own (docs/acceptances/guide.md): the checks
// for its thens live here, one test.describe per given + when, one test.step("then: …") per then. The rows' statuses
// are the owner's, set by hand — never by this file.
//
// Business rules (docs/business/financial_account/context_decision.md):
// - expense-types-sit-under-groups / the-expense-types-prototype-is-accepted (*the filter*): one group or one type,
//   kept in the page link (`?kind=` the group, `?type=` the one type) — a-lists-filters-live-in-the-url.
//
// The WHEN, as the person does it: on Biaya (/expenses), the month picked (`expenses-month`), then the filter
// (`expenses-kind-filter`) → a group's *All <group>* (`expenses-kind-filter-<kind>` — ⚠ not `-group-<kind>`, which is
// the group's heading block, not a pickable option) or one type (`expenses-kind-filter-type-<key>`).
//
// GROUND (beforeAll, as root, through the API) — every role its OWN selling team (root its owner, the role's user in
// it), one operational account opened on the 1st of LAST month, and:
//   last month (the 10th) — Operasional › Listrik Rp 200.000, Operasional › Internet Rp 100.000, Gaji › Bonus
//   Rp 300.000 (rows of two groups);
//   this month (today)    — Operasional › Listrik Rp 70.000 (same group, another month: the month must hold too).
//
// How each then is read:
// - `only that kind shown` — last month + All Operational: exactly its two rows (Listrik, Internet), each typed
//   *Operational › …*, the Bonus row and this month's row gone, the URL carrying `kind=3` and the month; then one type,
//   Internet: its row alone, the URL carrying `type=7`.
// - `filter kept after reload` — page.reload() on the type filter: the trigger still reads it, the same one row, the
//   month input still last month, the URL unchanged; the same for the group filter.

const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-acceptance-pass-1";

const ROLES = [
  { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "o" },
  { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "a" },
] as const;
type RoleKey = (typeof ROLES)[number]["key"];

/** Today in the business's month — Jakarta's. */
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
/** Last month, Jakarta's — `YYYY-MM`. */
function lastMonth(): string {
  const [y, m] = today().split("-").map(Number) as [number, number];

  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}
const MONTH = lastMonth();

// The URL's enum values (expense.proto): ExpenseKind OPERATIONAL = 3, ExpenseType INTERNET = 7.
const OPERATIONAL = 3;
const INTERNET_TYPE = 7;

const username = (key: RoleKey) => `e2efl${key}${SUFFIX}`;

interface Ground {
  team: string;
  electricity: string;
  internet: string;
  bonus: string;
  thisMonth: string;
}
const ground = {} as Record<RoleKey, Ground>;

test.describe.configure({ timeout: 120_000 });

// The real contract under the page's signed-in token; a refusal fails here, by name.
async function rpc<T = Record<string, unknown>>(page: Page, method: string, body: unknown): Promise<T> {
  return page.evaluate(
    async ([m, b, apiUrl]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ?? window.localStorage.getItem("warehouse_revamp.token");
      const res = await fetch(`${apiUrl}/warehouse.${m as string}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(b),
      });
      if (!res.ok) throw new Error(`${m as string}: ${res.status} ${await res.text()}`);

      return res.json();
    },
    [method, body, API_URL] as const,
  ) as Promise<T>;
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await browser.newPage();
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  for (const r of ROLES) {
    const team = (
      await rpc<{ team: { id: string } }>(page, "team.v1.TeamService/TeamCreate", {
        name: `E2E Filter ${r.key.toUpperCase()} ${SUFFIX}`,
        teamCode: `FL9${r.key.toUpperCase()}${SUFFIX}`,
        type: "TEAM_TYPE_SELLING",
        ownerUserId: ROOT_USER_ID,
      })
    ).team.id;
    await rpc(page, "user.v1.UserService/CreateUser", {
      teamId: team,
      username: username(r.key),
      password: PASSWORD,
      name: `Filter ${r.key} ${SUFFIX}`,
      role: r.role,
    });
    const account = (
      await rpc<{ account: { id: string } }>(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId: team,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name: `E2E Filter BCA ${r.key} ${SUFFIX}`,
        holderName: "E2E",
        accountNumber: `FLT${r.key}${SUFFIX}`,
        openingBalance: 10_000_000,
        openingOn: `${MONTH}-01`,
      })
    ).account.id;
    await rpc(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
      teamId: team,
      accountId: account,
      operational: true,
    });

    const expense = async (kind: string, type: string, amount: number, occurredAt: string, note: string) =>
      (
        await rpc<{ expense: { id: string } }>(page, "expense.v1.ExpenseService/ExpenseCreate", {
          teamId: team,
          kind,
          type,
          amount,
          occurredAt,
          note: `${note} ${SUFFIX}`,
          financeAccountId: account,
        })
      ).expense.id;

    ground[r.key] = {
      team,
      electricity: await expense("EXPENSE_KIND_OPERATIONAL", "EXPENSE_TYPE_ELECTRICITY", 200_000, `${MONTH}-10`, "e2e filter electricity"),
      internet: await expense("EXPENSE_KIND_OPERATIONAL", "EXPENSE_TYPE_INTERNET", 100_000, `${MONTH}-10`, "e2e filter internet"),
      bonus: await expense("EXPENSE_KIND_PAYROLL", "EXPENSE_TYPE_BONUS", 300_000, `${MONTH}-10`, "e2e filter bonus"),
      thisMonth: await expense("EXPENSE_KIND_OPERATIONAL", "EXPENSE_TYPE_ELECTRICITY", 70_000, today(), "e2e filter this month"),
    };
  }

  await page.close();
});

// The role signs in and works in its team (the active team is per tab, in sessionStorage — TeamContext).
async function signInAs(page: Page, user: string, teamId: string) {
  await signIn(page, user, PASSWORD);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

const rowsOf = (page: Page) => page.getByTestId("expenses-table").locator('[data-testid^="expense-row-"]');

/** Exactly these expenses on the list, nothing else. */
async function onlyRows(page: Page, ids: string[]) {
  const rows = rowsOf(page);
  await expect.soft(rows).toHaveCount(ids.length);
  for (const id of ids) await expect.soft(page.getByTestId(`expense-row-${id}`)).toBeVisible();
}

async function pick(page: Page, option: string) {
  await page.getByTestId("expenses-kind-filter").click();
  await page.getByTestId(option).click();
}

test.describe("selling:owner · selling:admin wants to find a kind of cost (month and kind chosen)", () => {
  for (const r of ROLES) {
    test(`${r.given} filter expenses`, async ({ page }) => {
      const g = ground[r.key];
      await signInAs(page, username(r.key), g.team);

      // GIVEN — the month chosen: last month, which holds rows of two groups.
      await page.goto("/expenses");
      await expect(page.getByTestId("expenses-table")).toBeVisible();
      await page.getByTestId("expenses-month").fill(MONTH);
      await onlyRows(page, [g.electricity, g.internet, g.bonus]);
      await expect(page).toHaveURL(new RegExp(`[?&]month=${MONTH}(&|$)`));

      await test.step("then: only that kind shown", async () => {
        // WHEN — filter by a group: All Operational.
        await pick(page, `expenses-kind-filter-${OPERATIONAL}`);
        await expect.soft(page.getByTestId("expenses-kind-filter")).toHaveText("All Operational");
        await onlyRows(page, [g.electricity, g.internet]);
        await expect.soft(page.getByTestId(`expense-row-${g.bonus}`)).toHaveCount(0);
        await expect.soft(page.getByTestId(`expense-row-${g.thisMonth}`)).toHaveCount(0);
        await expect.soft(page.getByTestId(`expense-type-${g.electricity}`)).toHaveText(/^Operational › /);
        await expect.soft(page.getByTestId(`expense-type-${g.internet}`)).toHaveText(/^Operational › /);
        await expect.soft(page).toHaveURL(new RegExp(`[?&]kind=${OPERATIONAL}(&|$)`));
        await expect.soft(page).toHaveURL(new RegExp(`[?&]month=${MONTH}(&|$)`));

        // WHEN — filter by one type of it: Internet.
        await pick(page, "expenses-kind-filter-type-internet");
        await expect.soft(page.getByTestId("expenses-kind-filter")).toHaveText("Operational › Internet · data package");
        await onlyRows(page, [g.internet]);
        await expect.soft(page.getByTestId(`expense-type-${g.internet}`)).toHaveText("Operational › Internet · data package");
        await expect.soft(page).toHaveURL(new RegExp(`[?&]type=${INTERNET_TYPE}(&|$)`));
        await expect.soft(page).toHaveURL(new RegExp(`[?&]month=${MONTH}(&|$)`));
      });

      await test.step("then: filter kept after reload", async () => {
        // The one type, reloaded.
        let url = page.url();
        await page.reload();
        await expect.soft(page.getByTestId("expenses-table")).toBeVisible();
        expect.soft(page.url()).toBe(url);
        await expect.soft(page.getByTestId("expenses-month")).toHaveValue(MONTH);
        await expect.soft(page.getByTestId("expenses-kind-filter")).toHaveText("Operational › Internet · data package");
        await onlyRows(page, [g.internet]);

        // The group, reloaded.
        await pick(page, `expenses-kind-filter-${OPERATIONAL}`);
        await onlyRows(page, [g.electricity, g.internet]);
        await expect.soft(page).not.toHaveURL(/[?&]type=/);
        url = page.url();
        await page.reload();
        await expect.soft(page.getByTestId("expenses-table")).toBeVisible();
        expect.soft(page.url()).toBe(url);
        await expect.soft(page).toHaveURL(new RegExp(`[?&]kind=${OPERATIONAL}(&|$)`));
        await expect.soft(page.getByTestId("expenses-month")).toHaveValue(MONTH);
        await expect.soft(page.getByTestId("expenses-kind-filter")).toHaveText("All Operational");
        await onlyRows(page, [g.electricity, g.internet]);
        await expect.soft(page.getByTestId(`expense-row-${g.thisMonth}`)).toHaveCount(0);
      });
    });
  }
});
