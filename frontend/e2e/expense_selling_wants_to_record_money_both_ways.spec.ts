import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";

// ── record expense, money both ways — the checks behind docs/acceptances/financial_account/expense.md givens 17–22 ─────
//
// record expense's regression spec for the types of the Lainnya group that move money BOTH WAYS: outside debt paid,
// prive, deposit, other money out / in, outside receivable received. An acceptance has no test file of its own
// (docs/acceptances/guide.md): one test.describe per given + when, per role a test, one test.step("then: …") per then. A
// step that is not a then is named `regression: …`. The rows' statuses are the owner's, set by hand — never by this file.
//
// Business rules (docs/business/financial_account/context_decision.md):
// - expense-types-sit-under-groups — the six types sit under Lainnya (ExpenseKind OTHER = 4); the amount stays positive
//   and the TYPE says which way the money goes.
// - prive-and-deposit-on-pengeluaran-are-the-accounts-capital — Prive (out) and Setoran modal (in) are the account's
//   `capital` row, never an expense in the profit: Biaya (spending) never counts them; the history marks the row
//   *from Expenses #N*. They may use ANY active account of the team (a non-operational one is offered).
// - money-in-on-biaya-is-its-own-change-type — Piutang luar diterima and Uang masuk lain post the NEW change type
//   `money_in` (*Money in*) INTO an operational account — not an expense with a plus sign.
// - the-expense-types-prototype-is-accepted (*as drawn*) — Total bulan ini moves as givens 17–22: prive raises it,
//   setoran and money in lower it; Biaya is every money-out type but Prive (an outside debt paid counts); every other
//   type than Prive / Setoran pays from (or goes into) an operational account.
// - an-expense-must-name-the-account-that-paid — the account named moves, through the expense event (POLLED).
// - Analytic (ExpensesMetric, metrics/expenses) — the-expense-prototype-is-accepted 🔄 2026-11-20 (backlog #107) and
//   the-expense-metric-shows-each-type-not-the-three-summaries (docs/business/analytic/rpc_provide_decision.md): each
//   type is its OWN field, signed as the month card shows it (money in and Setoran modal minus); `total` is Biaya's
//   *Total bulan ini* (spending − money in + Prive − Setoran modal); the group field (`other`) stays SPENDING; the #99
//   summaries `money_in`, `capital_out`, `capital_in` stay in the answer (positive) but are not offered on the screen.
//
// The WHEN, as the person does it: Biaya (/expenses) → Record cost → the type under Lainnya → amount → the account →
// note → Save — through the DIALOG, signed in as the role.
//
// GROUND (per test, as root, through the API) — every (given, role) its own selling team, so the month's totals read
// exactly what this test recorded: the role user in it; an OPERATIONAL account opening at Rp 1.000.000 (every given's
// words say "operational account") and an active NON-operational account (Prive / Setoran may use it, the rest may not).
// Both seeded BEFORE Biaya opens (its account picker reads them once, as reference data — expenses.spec.ts says why).

const DIGITS = Date.now().toString().slice(-6);
// This spec's own letter: names, usernames and account numbers carry it, so no other spec collides on the one database.
const SUFFIX = `${DIGITS}w`;
const PASSWORD = "e2e-both-ways-pass-1";
const OPENING = 1_000_000;
const OTHER = 4; // ExpenseKind.OTHER — Lainnya
const METRIC = "metrics/expenses";

const ROLES = [
  { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "own", code: "O" },
  { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "adm", code: "A" },
] as const;
type Role = (typeof ROLES)[number];

// The six givens, in the file's order. `word` is the then's own word for the type's total; `field` the type's own
// ExpensesMetric field (its proto name — the Analytic cell's; the MetricData answer names it `key`, its JSON name).
const GIVENS = [
  {
    id: 17,
    describe: "wants to record an outside debt (outside debt paid)",
    key: "outsideDebtPaid",
    label: "Outside debt paid",
    word: "outside debt",
    // The thens, verbatim (acceptance_coverage.py matches literal text).
    thenAccount: "then: operational account decreases by the amount",
    thenTotal: "then: outside debt and month total increase by the amount",
    way: "out",
    capital: false,
    field: "outside_debt_paid",
    amount: 300_000,
  },
  {
    id: 18,
    describe: "wants to record the owner's capital (prive · owner takes capital)",
    key: "prive",
    label: "Prive · owner takes capital",
    word: "prive",
    // The thens, verbatim (acceptance_coverage.py matches literal text).
    thenAccount: "then: operational account decreases by the amount",
    thenTotal: "then: prive and month total increase by the amount",
    way: "out",
    capital: true,
    field: "prive",
    amount: 400_000,
  },
  {
    id: 19,
    describe: "wants to record the owner's capital (deposit · owner adds capital)",
    key: "capitalDeposit",
    label: "Deposit · owner adds capital",
    word: "deposit",
    // The thens, verbatim (acceptance_coverage.py matches literal text).
    thenAccount: "then: operational account increases by the amount",
    thenTotal: "then: deposit and month total decrease by the amount",
    way: "in",
    capital: true,
    field: "capital_deposit",
    amount: 500_000,
  },
  {
    id: 20,
    describe: "wants to record other money (other · money out)",
    key: "otherOut",
    label: "Other money out",
    word: "other",
    // The thens, verbatim (acceptance_coverage.py matches literal text).
    thenAccount: "then: operational account decreases by the amount",
    thenTotal: "then: other and month total increase by the amount",
    way: "out",
    capital: false,
    field: "other_out",
    amount: 150_000,
  },
  {
    id: 21,
    describe: "wants to record other money (other · money in)",
    key: "otherIn",
    label: "Other money in",
    word: "other",
    // The thens, verbatim (acceptance_coverage.py matches literal text).
    thenAccount: "then: operational account increases by the amount",
    thenTotal: "then: other and month total decrease by the amount",
    way: "in",
    capital: false,
    field: "other_in",
    amount: 250_000,
  },
  {
    id: 22,
    describe: "wants to record an outside debt (outside receivable received)",
    key: "outsideReceivableReceived",
    label: "Outside receivable received",
    word: "outside receivable",
    // The thens, verbatim (acceptance_coverage.py matches literal text).
    thenAccount: "then: operational account increases by the amount",
    thenTotal: "then: outside receivable and month total decrease by the amount",
    way: "in",
    capital: false,
    field: "outside_receivable_received",
    amount: 350_000,
  },
] as const;
type Given = (typeof GIVENS)[number];

const rp = (n: number) => `Rp ${Math.abs(n).toLocaleString("id-ID")}`;
// A figure as the screen writes it: a negative carries the typographic minus before Rp.
const money = (n: number) => new RegExp(`^${n < 0 ? "[-−]" : ""}Rp ${Math.abs(n).toLocaleString("id-ID").replace(/\./g, "\\.")}$`);
/** Today, the business's day (Jakarta). */
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
// proto3 JSON leaves a zero out — read it as 0.
const n = (v: number | undefined) => v ?? 0;

const username = (g: Given, r: Role) => `e2ebw${g.id}${r.key}${SUFFIX}`;
const personName = (g: Given, r: Role) => `Both Ways ${g.id} ${r.key} ${SUFFIX}`;

// The real contract under the signed-in token; a refusal fails here, by name.
async function rpc<T = Record<string, unknown>>(page: Page, method: string, body: unknown): Promise<T> {
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
      if (!res.ok) throw new Error(`${m as string}: ${res.status} ${await res.text()}`);

      return res.json();
    },
    [method, body, API_URL] as const,
  ) as Promise<T>;
}

interface Ground {
  team: string;
  user: string;
  account: string; // operational, opening Rp 1.000.000
  spare: string; // active, NOT operational
}

// GROUND — as root, on a page of its own: the team, its role user, its two accounts.
async function ground(browser: Browser, g: Given, r: Role): Promise<Ground> {
  const root = await browser.newPage();
  await signIn(root, ROOT_USERNAME, ROOT_PASSWORD);

  const tag = `${g.id}${r.code}`;
  const team = (
    await rpc<{ team: { id: string } }>(root, "team.v1.TeamService/TeamCreate", {
      type: "TEAM_TYPE_SELLING",
      name: `E2E Both Ways ${tag} ${SUFFIX}`,
      teamCode: `W${tag}${DIGITS}`, // 10 characters, the most a team code takes
      ownerUserId: ROOT_USER_ID,
    })
  ).team.id;

  const user = (
    await rpc<{ user: { id: string } }>(root, "user.v1.UserService/CreateUser", {
      teamId: team,
      username: username(g, r),
      password: PASSWORD,
      name: personName(g, r),
      role: r.role,
    })
  ).user.id;

  const account = async (what: string, openingBalance: number) =>
    (
      await rpc<{ account: { id: string } }>(root, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId: team,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name: `E2E BW ${what} ${tag} ${SUFFIX}`,
        holderName: "E2E",
        accountNumber: `E2E-BW-${what}-${tag}-${SUFFIX}`,
        openingBalance,
        openingOn: today(),
      })
    ).account.id;

  const operational = await account("OPS", OPENING);
  await rpc(root, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: team,
    accountId: operational,
    operational: true,
  });
  const spare = await account("SPARE", 0);

  await root.close();

  return { team, user, account: operational, spare };
}

async function signInAs(page: Page, g: Given, r: Role, team: string) {
  await signIn(page, username(g, r), PASSWORD);
  // Work in the given's team: the active team is per tab, in sessionStorage (TeamContext).
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), team);
}

// The account's own page, re-read until the listener's post has landed (posting is event-driven).
async function balanceIs(page: Page, accountId: string, expected: number) {
  await expect
    .soft(async () => {
      await page.goto(`/financial-accounts/${accountId}`);
      await expect(page.getByTestId("account-detail-balance")).toHaveText(money(expected), { timeout: 3_000 });
    })
    .toPass({ timeout: 45_000 });
}

interface MetricDataAnswer {
  metricDatas: { expensesSummary?: Record<string, number | undefined> }[];
}

for (const g of GIVENS) {
  const inward = g.way === "in";
  // The figure the type, its group and the month carry: money in lowers them.
  const signed = inward ? -g.amount : g.amount;
  // Biaya counts every money-out type but Prive; Modal is Prive − Setoran; Uang masuk the other money-in types.
  const spending = !inward && !g.capital ? g.amount : 0;
  const capital = g.capital ? signed : 0;
  const moneyIn = inward && !g.capital ? g.amount : 0;
  const after = OPENING + (inward ? g.amount : -g.amount);

  test.describe(`selling:owner · selling:admin ${g.describe}`, () => {
    test.describe.configure({ timeout: 120_000 });

    for (const r of ROLES) {
      test(`${r.given} record expense`, async ({ page, browser }) => {
        const gr = await ground(browser, g, r);
        const note = `E2E both ways ${g.key} ${r.key} ${SUFFIX}`;

        await signInAs(page, g, r, gr.team);

        // GIVEN — the account at its opening, the month empty (the team is this test's own).
        await test.step(`regression: before the WHEN the account reads ${rp(OPENING)} and the month ${rp(0)}`, async () => {
          await balanceIs(page, gr.account, OPENING);
          await page.goto("/expenses");
          await expect(page.getByTestId("expenses-empty")).toBeVisible();
          await expect(page.getByTestId("expenses-total")).toHaveText("Rp 0");
          await expect(page.getByTestId(`expenses-total-type-${g.key}`)).toHaveCount(0);
        });

        // WHEN — record expense, through the dialog, as the role.
        await page.getByTestId("open-record-cost").click();
        await page.getByTestId("expense-type-select").click();
        await expect(page.getByTestId(`expense-type-select-group-${OTHER}`)).toContainText(g.label);
        await page.getByTestId(`expense-type-select-${g.key}`).click();
        await expect(page.getByTestId("expense-type-select")).toContainText(`Other › ${g.label}`);

        await test.step(`regression: the dialog says the money goes ${g.way}${g.capital ? ", as the account's capital" : ""}`, async () => {
          await expect.soft(page.getByTestId("expense-direction")).toHaveAttribute("data-direction", g.way);
          await expect.soft(page.getByTestId("expense-capital-line")).toHaveCount(g.capital ? 1 : 0);
        });

        await page.getByTestId("expense-amount").fill(String(g.amount));
        await page.getByTestId("expense-note").fill(note);
        await page.getByTestId("expense-paid-from").click();
        const operational = page.getByTestId(`expense-paid-from-option-${gr.account}`);
        await expect(operational).toBeVisible();

        // Prive / Setoran modal may use ANY active account; every other type an operational one only.
        await test.step(
          g.capital
            ? "regression: a non-operational active account is offered (capital may use any of the team's accounts)"
            : "regression: only operational accounts are offered",
          async () => {
            await expect.soft(page.getByTestId(`expense-paid-from-option-${gr.spare}`)).toHaveCount(g.capital ? 1 : 0);
          },
        );

        await operational.click();
        await page.getByTestId("submit-cost").click();

        const row = page.getByTestId("expenses-table").locator('[data-testid^="expense-row-"]').filter({ hasText: note });
        await expect(row).toHaveCount(1);
        const id = (await row.getAttribute("data-testid"))!.replace("expense-row-", "");

        await test.step(g.thenAccount, async () => {
          await balanceIs(page, gr.account, after);
        });

        // The history's newest row: a capital (Modal) row marked *from Expenses #N* for Prive / Setoran, the NEW Money in
        // row for the other money-in types, an Expense row for money out — signed by the way the money went.
        const kind = g.capital ? "Capital" : inward ? "Money in" : "Expense";
        await test.step(`regression: the account history's row is ${kind} (${inward ? "+" : "−"}${rp(g.amount)})${g.capital ? `, from Expenses #${id}` : ""}`, async () => {
          const top = page.getByTestId("account-log-table").locator('[data-testid^="account-log-row-"]').first();
          await expect.soft(top.getByRole("cell").nth(1)).toHaveText(kind);
          await expect.soft(top).toContainText(`${inward ? "+" : "−"}${rp(g.amount)}`);
          if (g.capital) {
            const logId = (await top.getAttribute("data-testid"))!.replace("account-log-row-", "");
            const via = page.getByTestId(`account-log-via-expenses-${logId}`);
            await expect.soft(via).toContainText(`from Expenses #${id}`);
            await expect.soft(via).toContainText(personName(g, r));
          }
        });

        await test.step(g.thenTotal, async () => {
          await page.goto("/expenses");
          // The type's line under Lainnya: its words, then its figure (the line's own last text).
          const line = page.getByTestId(`expenses-total-type-${g.key}`);
          await expect.soft(line).toContainText(g.label);
          await expect.soft(line.locator(":scope > p")).toHaveText(money(signed));
          await expect.soft(page.getByTestId("expenses-total")).toHaveText(money(signed));
          await expect.soft(page.getByTestId(`expenses-total-kind-${OTHER}`)).toHaveText(money(signed));
        });

        await test.step(`regression: Spending ${rp(spending)}, Money in ${moneyIn ? "−" : ""}${rp(moneyIn)}, Capital ${capital < 0 ? "−" : ""}${rp(capital)}`, async () => {
          await expect.soft(page.getByTestId("expenses-total-spending")).toHaveText(money(spending));
          await expect.soft(page.getByTestId("expenses-total-money-in")).toHaveText(money(-moneyIn));
          await expect.soft(page.getByTestId("expenses-total-capital")).toHaveText(money(capital));
        });

        await test.step(`regression: the row reads Other › ${g.label}, its marks, who recorded it`, async () => {
          await expect.soft(page.getByTestId(`expense-type-${id}`)).toHaveText(`Other › ${g.label}`);
          await expect.soft(page.getByTestId(`expense-mark-${id}-capital`)).toHaveCount(g.capital ? 1 : 0);
          await expect.soft(page.getByTestId(`expense-mark-${id}-in`)).toHaveCount(inward ? 1 : 0);
          await expect.soft(page.getByTestId(`expense-amount-${id}`)).toHaveText(rp(g.amount));
          await expect.soft(page.getByTestId(`expense-by-${id}`)).toContainText(personName(g, r));
        });

        // ExpensesMetric (the-expense-prototype-is-accepted 🔄 2026-11-20): the type's own field reads the amount signed
        // as the month card shows it, and `total` is the month total — Prive raises it, Setoran modal and money in lower
        // it; `other` stays the group's spending; the #99 summaries keep their positive figures in the answer.
        await test.step("then: recorded in expense analytic metric", async () => {
          await expect
            .soft(async () => {
              const answer = await rpc<MetricDataAnswer>(page, "expense.v1.ExpenseAnalyticService/MetricData", {
                teamId: gr.team,
                groupBy: "GROUP_TYPE_SUMMARY",
                filters: [{ dateRangeFilter: { dateMin: today(), dateMax: today() } }],
                metricIds: [METRIC],
              });
              const head = answer.metricDatas[0]!.expensesSummary ?? {};
              expect({
                [g.key]: n(head[g.key]),
                other: n(head.other),
                total: n(head.total),
                moneyIn: n(head.moneyIn),
                capitalOut: n(head.capitalOut),
                capitalIn: n(head.capitalIn),
              }).toEqual({
                [g.key]: signed,
                other: spending,
                total: signed,
                moneyIn,
                capitalOut: g.key === "prive" ? g.amount : 0,
                capitalIn: g.key === "capitalDeposit" ? g.amount : 0,
              });
            })
            .toPass({ timeout: 30_000 });

          // …and on the Analytic screen: Expenses by day, today's row — the type's own column and the total, signed; the
          // three summaries are not offered (the-expense-metric-shows-each-type-not-the-three-summaries).
          await expect
            .soft(async () => {
              await page.goto(`/analytic?g=daily&m=${METRIC}&r=7d`);
              await expect(page.getByTestId(`analytic-cell-${today()}-${g.field}`)).toHaveText(money(signed), { timeout: 5_000 });
              await expect(page.getByTestId(`analytic-cell-${today()}-total`)).toHaveText(money(signed), { timeout: 5_000 });
              for (const summary of ["money_in", "capital_out", "capital_in"]) {
                await expect(page.getByTestId(`analytic-cell-${today()}-${summary}`)).toHaveCount(0);
              }
            })
            .toPass({ timeout: 30_000 });
        });
      });
    }
  });
}
