import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";

// ── open expenses — the checks behind docs/acceptances/financial_account/expense.md, givens 27 and 28 ─────────────────
//
// open expenses' regression spec. An acceptance has no test file of its own (docs/acceptances/guide.md): the checks for
// its thens live here, one test.describe per given + when, one test.step("then: …") per then. The rows' statuses are the
// owner's, set by hand — never by this file.
//
// Business rules (docs/business/financial_account/context_decision.md):
// - expense-types-sit-under-groups / the-expense-types-prototype-is-accepted (*as drawn*): Biaya's month card reads each
//   group (Iklan / Ads, Gaji / Payroll, Operasional / Operational, Lainnya / Other) with its types under it, and the
//   month's total; every figure is the server's (ExpenseList.totals).
// - every-correction-is-a-signed-adjustment: the expense keeps the amount typed and says what it counts for now; the
//   correction is a row of its own, muted, with no actions (a mistaken one is fixed by correcting the expense again).
//
// The WHEN, as the person does it: the role opens Biaya (/expenses) on this month.
//
// GROUND (beforeAll, as root, through the API) — every (given, role) its OWN selling team (the month's totals are the
// whole team's), owned by root, the role's user added to it with the role, one operational account:
//   27 (ads and payroll · payroll Rp 500.000 reduced to Rp 400.000): a shop; Iklan › Iklan marketplace Rp 300.000 on
//      that shop; Gaji › Gaji pokok Rp 500.000; ExpenseAdjust −Rp 100.000 on the payroll — all today (Jakarta).
//   28 (electricity and internet): Operasional › Listrik Rp 250.000 and Operasional › Internet Rp 150.000, today.
//
// How each then is read:
// - `totals shown per kind and for the month` — the month card: Ads Rp 300.000, Payroll Rp 400.000 (the net after the
//   correction), Operational and Other Rp 0 (`expenses-total-kind-<kind>`), Total bulan ini Rp 700.000 (`expenses-total`).
// - `corrected expense shows Rp 500.000 and now Rp 400.000` — the payroll row: `expense-amount-<id>` Rp 500.000,
//   `expense-net-<id>` "now Rp 400.000".
// - `adjustment shown muted with no actions` — the adjustment's own row carries the Adjustment badge
//   (`expense-adjustment-<id>`) and its signed −Rp 100.000; it has no ⋯ (`expense-actions-<id>`) while the expense it
//   corrects has one; MUTED as the screen renders it: the row's computed text colour is the theme's `fg.muted` token
//   (`--chakra-colors-fg-muted`), and the expense's own row is not.
// - `each type's total shown` — under Operational (`expenses-group-3`) exactly two type lines, Listrik
//   (`expenses-total-type-electricity`) Rp 250.000 and Internet (`expenses-total-type-internet`) Rp 150.000, each its own
//   figure; the group's total (`expenses-total-kind-3`) is their sum, Rp 400.000.

const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-acceptance-pass-1";

const ROLES = [
  { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "o" },
  { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "a" },
] as const;
type RoleKey = (typeof ROLES)[number]["key"];

const ADS = 300_000;
const PAYROLL = 500_000;
const PAYROLL_CUT = 100_000; // 500.000 → 400.000
const ELECTRICITY = 250_000;
const INTERNET = 150_000;

const rp = (n: number) => `Rp ${new Intl.NumberFormat("id-ID").format(n)}`;
/** Today in the business's month — Jakarta's. */
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

// A username is lowercase letters and digits only.
const username = (given: string, key: RoleKey) => `e2eop${given}${key}${SUFFIX}`;

interface Ground27 {
  team: string;
  ads: string;
  payroll: string;
  adjustment: string;
}
interface Ground28 {
  team: string;
}
const ground = {
  g27: {} as Record<RoleKey, Ground27>,
  g28: {} as Record<RoleKey, Ground28>,
};

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

// A selling team of its own (root its owner), the role's user in it, and one operational account to pay from.
async function teamFor(page: Page, given: string, r: (typeof ROLES)[number]) {
  const team = (
    await rpc<{ team: { id: string } }>(page, "team.v1.TeamService/TeamCreate", {
      name: `E2E Open ${given}${r.key.toUpperCase()} ${SUFFIX}`,
      teamCode: `OP${given}${r.key.toUpperCase()}${SUFFIX}`,
      type: "TEAM_TYPE_SELLING",
      ownerUserId: ROOT_USER_ID,
    })
  ).team.id;
  await rpc(page, "user.v1.UserService/CreateUser", {
    teamId: team,
    username: username(given, r.key),
    password: PASSWORD,
    name: `Open ${given} ${r.key} ${SUFFIX}`,
    role: r.role,
  });
  const account = (
    await rpc<{ account: { id: string } }>(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
      teamId: team,
      type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
      name: `E2E Open BCA ${given}${r.key} ${SUFFIX}`,
      holderName: "E2E",
      accountNumber: `OPN${given}${r.key}${SUFFIX}`,
      openingBalance: 10_000_000,
      openingOn: today(),
    })
  ).account.id;
  await rpc(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: team,
    accountId: account,
    operational: true,
  });

  return { team, account };
}

async function expense(page: Page, body: Record<string, unknown>): Promise<string> {
  return (await rpc<{ expense: { id: string } }>(page, "expense.v1.ExpenseService/ExpenseCreate", { occurredAt: today(), ...body }))
    .expense.id;
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await browser.newPage();
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  for (const r of ROLES) {
    // 27 — ads and payroll · payroll Rp 500.000 reduced to Rp 400.000.
    const t27 = await teamFor(page, "7", r);
    const shop = (
      await rpc<{ shop: { id: string } }>(page, "selling.v1.ShopService/ShopCreate", {
        teamId: t27.team,
        name: `E2E Open Shop ${r.key} ${SUFFIX}`,
        shopCode: `OS7${r.key.toUpperCase()}${SUFFIX}`,
        marketplace: "MARKETPLACE_SHOPEE",
      })
    ).shop.id;
    const ads = await expense(page, {
      teamId: t27.team,
      kind: "EXPENSE_KIND_ADS",
      type: "EXPENSE_TYPE_ADS_MARKETPLACE",
      amount: ADS,
      shopId: shop,
      note: `e2e open ads ${SUFFIX}`,
      financeAccountId: t27.account,
    });
    const payroll = await expense(page, {
      teamId: t27.team,
      kind: "EXPENSE_KIND_PAYROLL",
      type: "EXPENSE_TYPE_BASIC_SALARY",
      amount: PAYROLL,
      note: `e2e open payroll ${SUFFIX}`,
      financeAccountId: t27.account,
    });
    const adjusted = await rpc<{ adjustment: { id: string } }>(page, "expense.v1.ExpenseService/ExpenseAdjust", {
      teamId: t27.team,
      expenseId: payroll,
      amount: -PAYROLL_CUT,
      note: `e2e open payroll cut ${SUFFIX}`,
    });
    ground.g27[r.key] = { team: t27.team, ads, payroll, adjustment: adjusted.adjustment.id };

    // 28 — electricity and internet.
    const t28 = await teamFor(page, "8", r);
    for (const [type, amount] of [
      ["EXPENSE_TYPE_ELECTRICITY", ELECTRICITY],
      ["EXPENSE_TYPE_INTERNET", INTERNET],
    ] as const) {
      await expense(page, {
        teamId: t28.team,
        kind: "EXPENSE_KIND_OPERATIONAL",
        type,
        amount,
        note: `e2e open ${type} ${SUFFIX}`,
        financeAccountId: t28.account,
      });
    }
    ground.g28[r.key] = { team: t28.team };
  }

  await page.close();
});

// The role signs in and works in its team (the active team is per tab, in sessionStorage — TeamContext).
async function signInAs(page: Page, user: string, teamId: string) {
  await signIn(page, user, PASSWORD);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

// WHEN — open expenses: Biaya, on this month (its default).
async function openExpenses(page: Page) {
  await page.goto("/expenses");
  await expect(page.getByTestId("expenses-table")).toBeVisible();
  await expect(page.getByTestId("expenses-totals")).toBeVisible();
}

/** The computed text colour of an element. */
const colourOf = (loc: Locator) => loc.evaluate((el) => getComputedStyle(el).color);

/** The theme's `fg.muted` token, resolved to a colour by the browser — what `color="fg.muted"` renders. */
async function mutedColour(page: Page): Promise<string> {
  return page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--chakra-colors-fg-muted)";
    document.body.appendChild(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();

    return colour;
  });
}

test.describe("selling:owner · selling:admin wants to see what was spent in a month (ads and payroll · payroll Rp 500.000 reduced to Rp 400.000)", () => {
  for (const r of ROLES) {
    test(`${r.given} open expenses`, async ({ page }) => {
      const g = ground.g27[r.key];
      await signInAs(page, username("7", r.key), g.team);

      // WHEN — open expenses.
      await openExpenses(page);

      await test.step("then: totals shown per kind and for the month", async () => {
        await expect.soft(page.getByTestId("expenses-total-kind-1")).toHaveText(rp(ADS));
        await expect.soft(page.getByTestId("expenses-total-kind-2")).toHaveText(rp(PAYROLL - PAYROLL_CUT));
        await expect.soft(page.getByTestId("expenses-total-kind-3")).toHaveText(rp(0));
        await expect.soft(page.getByTestId("expenses-total-kind-4")).toHaveText(rp(0));
        await expect.soft(page.getByTestId("expenses-group-1")).toContainText("Ads");
        await expect.soft(page.getByTestId("expenses-group-2")).toContainText("Payroll");
        await expect.soft(page.getByTestId("expenses-total")).toHaveText(rp(ADS + PAYROLL - PAYROLL_CUT));
      });

      await test.step("then: corrected expense shows Rp 500.000 and now Rp 400.000", async () => {
        const row = page.getByTestId(`expense-row-${g.payroll}`);
        await expect.soft(row.getByTestId(`expense-amount-${g.payroll}`)).toHaveText(rp(PAYROLL));
        await expect.soft(row.getByTestId(`expense-net-${g.payroll}`)).toHaveText(`now ${rp(PAYROLL - PAYROLL_CUT)}`);
        // The untouched ad stays one line: no "now".
        await expect.soft(page.getByTestId(`expense-net-${g.ads}`)).toHaveCount(0);
      });

      await test.step("then: adjustment shown muted with no actions", async () => {
        const adjustment = page.getByTestId(`expense-row-${g.adjustment}`);
        await expect.soft(adjustment.getByTestId(`expense-adjustment-${g.adjustment}`)).toHaveText("Adjustment");
        await expect.soft(adjustment.getByTestId(`expense-amount-${g.adjustment}`)).toHaveText(/^[-−]Rp 100\.000$/);
        // No ⋯ on the correction — while the expense it corrects keeps its own (so the role IS offered actions).
        await expect.soft(page.getByTestId(`expense-actions-${g.adjustment}`)).toHaveCount(0);
        await expect.soft(adjustment.getByLabel("Actions")).toHaveCount(0);
        await expect.soft(page.getByTestId(`expense-actions-${g.payroll}`)).toBeVisible();
        // Muted: the row reads in the theme's fg.muted colour; the expense's own row does not.
        const muted = await mutedColour(page);
        expect.soft(await colourOf(adjustment)).toBe(muted);
        expect.soft(await colourOf(adjustment.getByTestId(`expense-date-${g.adjustment}`))).toBe(muted);
        expect.soft(await colourOf(page.getByTestId(`expense-row-${g.payroll}`))).not.toBe(muted);
      });
    });
  }
});

test.describe("selling:owner · selling:admin wants to see what was spent in a month (electricity and internet)", () => {
  for (const r of ROLES) {
    test(`${r.given} open expenses`, async ({ page }) => {
      const g = ground.g28[r.key];
      await signInAs(page, username("8", r.key), g.team);

      // WHEN — open expenses.
      await openExpenses(page);

      await test.step("then: each type's total shown", async () => {
        const operational = page.getByTestId("expenses-group-3");
        const lines = operational.locator('[data-testid^="expenses-total-type-"]');
        await expect.soft(lines).toHaveCount(2);
        const electricity = operational.getByTestId("expenses-total-type-electricity");
        const internet = operational.getByTestId("expenses-total-type-internet");
        await expect.soft(electricity).toContainText("Electricity");
        // The line's own figure — the amount is the line's direct text child, its words sit in the row beside it.
        await expect.soft(electricity.locator("xpath=./p")).toHaveText(rp(ELECTRICITY));
        await expect.soft(internet).toContainText("Internet");
        await expect.soft(internet.locator("xpath=./p")).toHaveText(rp(INTERNET));
        // The group reads their sum, and so does the month.
        await expect.soft(page.getByTestId("expenses-total-kind-3")).toHaveText(rp(ELECTRICITY + INTERNET));
        await expect.soft(page.getByTestId("expenses-total")).toHaveText(rp(ELECTRICITY + INTERNET));
      });
    });
  }
});
