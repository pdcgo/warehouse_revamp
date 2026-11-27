import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { API_URL, UI_URL, signInStatePath } from "./env";

// ── add analytic metric, each expense type — the checks behind docs/acceptances/analytic/expense_metric.md givens 6–22 ──
//
// add analytic metric's checks for the EXPENSE TYPES on Analytic › Expenses (metrics/expenses, ExpensesMetric). An
// acceptance has no test file of its own (docs/acceptances/guide.md): one test.describe per given + when (named as the
// given, its case in parentheses verbatim), per role a test — selling:all = owner, admin, cs — and one
// test.step("then: …") per then, each then stored VERBATIM in the data table below (acceptance_mark.py matches the
// literal text). A step that is no then is named `regression: …`.
//
// Business rules (docs/business/analytic/rpc_provide_decision.md):
// - the-expense-prototype-is-accepted 🔄 2026-11-20 (backlog #107) — every expense type is its own figure of Expenses
//   (fields 9–26, labelled with Biaya's own words, expenses.types.type.*), each the type's net SIGNED as Biaya's month
//   card shows it: money out plus; money in (Piutang luar diterima, Uang masuk lain) and Setoran modal minus. `total` is
//   Biaya's *Total bulan ini* — spending − money in + Prive − Setoran modal — so Prive raises it, Setoran modal and money
//   in lower it. Each group's field (ads, payroll, operational, other) stays the group's SPENDING: every money-out type
//   but Prive.
// - the-expense-metric-shows-each-type-not-the-three-summaries — the screen offers the four groups, the 18 types and the
//   total (23 figures); the #99 summaries money_in, capital_out, capital_in are NOT offered.
// - every-member-reads-every-metric-of-their-team — a CS reads its team's expense figures (it may not record one).
// Types and their groups: frontend/src/features/expense/expenseTypes.ts (EXPENSE_TYPES); the field is the type's key in
// snake case (catalogue.ts, typeFieldOf). Given 6's *adjustment* is EXPENSE_TYPE_DISCREPANCY (*Selisih · transaksi tak
// tercatat* — expense.proto: "the checklist's adjustment · uncovered transaction"); 19 *deposit* is CAPITAL_DEPOSIT
// (Setoran modal); 20 *other money out* OTHER_OUT; 21 *other money in* OTHER_IN.
//
// GROUND (per test, as root, through the API from the test runner): every (given, role) its OWN selling team — so the
// day's figures read exactly this test's expense and no role's total mixes with another's: the role user in it, one
// operational account. The WHEN, as the person does it: Analytic with Expenses added, grouped daily over 7 days
// (`?g=daily&m=metrics/expenses&r=7d`), signed in as the role. Today's row is read BEFORE the expense (the team is new:
// its total reads nothing), root records the given's expense today (ExpenseCreate — a CS may not record), and the same
// row is read again:
// - `<type> shown` — the type's own column, headed by Biaya's words for it, and today's cell reads the amount with the
//   sign the screen shows (a minus for money in and the deposit).
// - `total up / down by Rp <n>` — today's `total` cell moved from its before-reading by exactly the signed amount.

const DIGITS = Date.now().toString().slice(-6);
// This spec's own letter: usernames, names, team codes and account numbers carry it, so no other spec collides.
const SUFFIX = `${DIGITS}y`;
const PASSWORD = "e2e-expense-metric-pass-1";
const OPENING = 10_000_000;
const METRIC = "metrics/expenses";
const TOKEN_KEY = "warehouse_revamp.token";

const ROLES = [
  { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "own", code: "O" },
  { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "adm", code: "A" },
  { given: "selling:cs", role: "ROLE_SELLING_CS", key: "cs", code: "C" },
] as const;
type Role = (typeof ROLES)[number];

// The seventeen givens, in the file's order. `case` is the given's parentheses VERBATIM (· is U+00B7); `type` the
// ExpenseType recorded; `field` its Expenses field (the Analytic cell's); `label` the column's words (Biaya's);
// `group` the group's field, whose figure is the group's spending; `way` which way the money goes; `capital` Prive /
// Setoran modal (never in a group's spending). The thens, verbatim.
const GIVENS = [
  {
    id: 6,
    case: "group: daily · add type: expenses · adjustment Rp 50.000 today",
    type: "EXPENSE_TYPE_DISCREPANCY",
    field: "discrepancy",
    label: "Discrepancy · unrecorded transaction",
    group: "operational",
    way: "out",
    capital: false,
    amount: 50_000,
    thenShown: "then: adjustment shown",
    thenTotal: "then: total up by Rp 50.000",
  },
  {
    id: 7,
    case: "group: daily · add type: expenses · bank fee Rp 6.500 today",
    type: "EXPENSE_TYPE_BANK_FEE",
    field: "bank_fee",
    label: "Bank fee",
    group: "operational",
    way: "out",
    capital: false,
    amount: 6_500,
    thenShown: "then: bank fee shown",
    thenTotal: "then: total up by Rp 6.500",
  },
  {
    id: 8,
    case: "group: daily · add type: expenses · content Rp 500.000 today",
    type: "EXPENSE_TYPE_CONTENT_ENDORSE",
    field: "content_endorse",
    label: "Content · endorsement",
    group: "ads",
    way: "out",
    capital: false,
    amount: 500_000,
    thenShown: "then: content shown",
    thenTotal: "then: total up by Rp 500.000",
  },
  {
    id: 9,
    case: "group: daily · add type: expenses · tools Rp 2.000.000 today",
    type: "EXPENSE_TYPE_TOOLS",
    field: "tools",
    label: "Tools",
    group: "operational",
    way: "out",
    capital: false,
    amount: 2_000_000,
    thenShown: "then: tools shown",
    thenTotal: "then: total up by Rp 2.000.000",
  },
  {
    id: 10,
    case: "group: daily · add type: expenses · equipment Rp 1.500.000 today",
    type: "EXPENSE_TYPE_EQUIPMENT",
    field: "equipment",
    label: "Equipment",
    group: "operational",
    way: "out",
    capital: false,
    amount: 1_500_000,
    thenShown: "then: equipment shown",
    thenTotal: "then: total up by Rp 1.500.000",
  },
  {
    id: 11,
    case: "group: daily · add type: expenses · electricity Rp 300.000 today",
    type: "EXPENSE_TYPE_ELECTRICITY",
    field: "electricity",
    label: "Electricity",
    group: "operational",
    way: "out",
    capital: false,
    amount: 300_000,
    thenShown: "then: electricity shown",
    thenTotal: "then: total up by Rp 300.000",
  },
  {
    id: 12,
    case: "group: daily · add type: expenses · kitchen Rp 200.000 today",
    type: "EXPENSE_TYPE_KITCHEN",
    field: "kitchen",
    label: "Kitchen · team meals",
    group: "operational",
    way: "out",
    capital: false,
    amount: 200_000,
    thenShown: "then: kitchen shown",
    thenTotal: "then: total up by Rp 200.000",
  },
  {
    id: 13,
    case: "group: daily · add type: expenses · internet Rp 350.000 today",
    type: "EXPENSE_TYPE_INTERNET",
    field: "internet",
    label: "Internet · data package",
    group: "operational",
    way: "out",
    capital: false,
    amount: 350_000,
    thenShown: "then: internet shown",
    thenTotal: "then: total up by Rp 350.000",
  },
  {
    id: 14,
    case: "group: daily · add type: expenses · basic salary Rp 4.000.000 today",
    type: "EXPENSE_TYPE_BASIC_SALARY",
    field: "basic_salary",
    label: "Basic salary",
    group: "payroll",
    way: "out",
    capital: false,
    amount: 4_000_000,
    thenShown: "then: basic salary shown",
    thenTotal: "then: total up by Rp 4.000.000",
  },
  {
    id: 15,
    case: "group: daily · add type: expenses · bonus Rp 1.000.000 today",
    type: "EXPENSE_TYPE_BONUS",
    field: "bonus",
    label: "Bonus",
    group: "payroll",
    way: "out",
    capital: false,
    amount: 1_000_000,
    thenShown: "then: bonus shown",
    thenTotal: "then: total up by Rp 1.000.000",
  },
  {
    id: 16,
    case: "group: daily · add type: expenses · contributions Rp 150.000 today",
    type: "EXPENSE_TYPE_CONTRIBUTIONS",
    field: "contributions",
    label: "Contributions (BPJS)",
    group: "payroll",
    way: "out",
    capital: false,
    amount: 150_000,
    thenShown: "then: contributions shown",
    thenTotal: "then: total up by Rp 150.000",
  },
  {
    id: 17,
    case: "group: daily · add type: expenses · outside debt paid Rp 1.000.000 today",
    type: "EXPENSE_TYPE_OUTSIDE_DEBT_PAID",
    field: "outside_debt_paid",
    label: "Outside debt paid",
    group: "other",
    way: "out",
    capital: false,
    amount: 1_000_000,
    thenShown: "then: outside debt shown",
    thenTotal: "then: total up by Rp 1.000.000",
  },
  {
    id: 18,
    case: "group: daily · add type: expenses · prive Rp 2.000.000 today",
    type: "EXPENSE_TYPE_PRIVE",
    field: "prive",
    label: "Prive · owner takes capital",
    group: "other",
    way: "out",
    capital: true,
    amount: 2_000_000,
    thenShown: "then: prive shown",
    thenTotal: "then: total up by Rp 2.000.000",
  },
  {
    id: 19,
    case: "group: daily · add type: expenses · deposit Rp 1.000.000 today",
    type: "EXPENSE_TYPE_CAPITAL_DEPOSIT",
    field: "capital_deposit",
    label: "Deposit · owner adds capital",
    group: "other",
    way: "in",
    capital: true,
    amount: 1_000_000,
    thenShown: "then: deposit shown",
    thenTotal: "then: total down by Rp 1.000.000",
  },
  {
    id: 20,
    case: "group: daily · add type: expenses · other money out Rp 100.000 today",
    type: "EXPENSE_TYPE_OTHER_OUT",
    field: "other_out",
    label: "Other money out",
    group: "other",
    way: "out",
    capital: false,
    amount: 100_000,
    thenShown: "then: other shown",
    thenTotal: "then: total up by Rp 100.000",
  },
  {
    id: 21,
    case: "group: daily · add type: expenses · other money in Rp 100.000 today",
    type: "EXPENSE_TYPE_OTHER_IN",
    field: "other_in",
    label: "Other money in",
    group: "other",
    way: "in",
    capital: false,
    amount: 100_000,
    thenShown: "then: other shown",
    thenTotal: "then: total down by Rp 100.000",
  },
  {
    id: 22,
    case: "group: daily · add type: expenses · outside receivable received Rp 500.000 today",
    type: "EXPENSE_TYPE_OUTSIDE_RECEIVABLE_RECEIVED",
    field: "outside_receivable_received",
    label: "Outside receivable received",
    group: "other",
    way: "in",
    capital: false,
    amount: 500_000,
    thenShown: "then: outside receivable shown",
    thenTotal: "then: total down by Rp 500.000",
  },
] as const;
type Given = (typeof GIVENS)[number];

// The three #99 summaries the screen does not offer (the-expense-metric-shows-each-type-not-the-three-summaries).
const NOT_OFFERED = ["money_in", "capital_out", "capital_in"] as const;

const rp = (n: number) => `Rp ${Math.abs(n).toLocaleString("id-ID")}`;
// A figure as the screen writes it: a negative carries the typographic minus before Rp.
const money = (n: number) =>
  new RegExp(`^${n < 0 ? "[-−]" : ""}Rp ${Math.abs(n).toLocaleString("id-ID").replace(/\./g, "\\.")}$`);
// A cell read back as a number: "—" (nothing that day) is 0, "−Rp 1.000.000" is −1.000.000.
function figure(text: string | null): number {
  const t = (text ?? "").trim();
  if (t === "" || t === "—") return 0;
  const m = /^([-−]?)Rp ([\d.]+)$/.exec(t);
  if (!m) throw new Error(`not a rupiah figure: "${t}"`);

  return (m[1] ? -1 : 1) * Number(m[2]!.replace(/\./g, ""));
}
/** Today, the business's day (Jakarta) — the daily row's key. */
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

const tag = (g: Given, r: Role) => `${g.id}${r.code}`;
const username = (g: Given, r: Role) => `e2exm${g.id}${r.key}${SUFFIX}`;

// ── the API from the test runner (no page): root's token is the one the setup saved (e2e/session.ts) ────────────────

async function call<T>(token: string | null, method: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}/warehouse.${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method}: ${res.status} ${await res.text()}`);

  return (await res.json()) as T;
}

const login = async (who: string, password: string) =>
  (await call<{ token: string }>(null, "user.v1.AuthService/Login", { username: who, password })).token;

let rootToken: Promise<string> | undefined;
function root(): Promise<string> {
  rootToken ??= (async () => {
    const saved = signInStatePath(ROOT_USERNAME);
    if (existsSync(saved)) {
      const state = JSON.parse(readFileSync(saved, "utf8")) as { origins: { localStorage: { name: string; value: string }[] }[] };
      const token = state.origins.flatMap((o) => o.localStorage).find((i) => i.name === TOKEN_KEY)?.value;
      if (token) return token;
    }

    return login(ROOT_USERNAME, ROOT_PASSWORD);
  })();

  return rootToken;
}
const asRoot = async <T = Record<string, unknown>>(method: string, body: unknown) => call<T>(await root(), method, body);

interface Ground {
  team: string;
  account: string;
}

// GROUND — the team, its role user, its operational account.
async function ground(g: Given, r: Role): Promise<Ground> {
  const t = tag(g, r);
  const team = (
    await asRoot<{ team: { id: string } }>("team.v1.TeamService/TeamCreate", {
      type: "TEAM_TYPE_SELLING",
      name: `E2E Expense Metric ${t} ${SUFFIX}`,
      teamCode: `Y${t}${DIGITS}`, // at most 10 characters, the most a team code takes
      ownerUserId: ROOT_USER_ID,
    })
  ).team.id;

  await asRoot("user.v1.UserService/CreateUser", {
    teamId: team,
    username: username(g, r),
    password: PASSWORD,
    name: `Expense Metric ${t} ${SUFFIX}`,
    role: r.role,
  });

  const account = (
    await asRoot<{ account: { id: string } }>("financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
      teamId: team,
      type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
      name: `E2E XM ${t} ${SUFFIX}`,
      holderName: "E2E",
      accountNumber: `E2E-XM-${t}-${SUFFIX}`,
      openingBalance: OPENING,
      openingOn: today(),
    })
  ).account.id;
  // Every type but Prive / Setoran modal is paid from (or goes into) an operational account; capital may use it too.
  await asRoot("financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: team,
    accountId: account,
    operational: true,
  });

  return { team, account };
}

// Signed in as the role: its own token, in the fresh page's storage — as e2e/session.ts reuses a saved sign-in.
async function signInAs(page: Page, g: Given, r: Role, team: string) {
  const token = await login(username(g, r), PASSWORD);
  await page.context().setStorageState({
    cookies: [],
    origins: [{ origin: UI_URL, localStorage: [{ name: TOKEN_KEY, value: token }] }],
  });
  // The team is the role user's only one; it is also planted as the tab's active team (TeamContext).
  await page.addInitScript(
    ([key, id]) => {
      try {
        window.sessionStorage.setItem(key, id);
      } catch {
        // a document with no storage of its own (about:blank): nothing to plant there
      }
    },
    ["warehouse_revamp.team", team] as const,
  );
}

const ANALYTIC = `/analytic?g=daily&m=${METRIC}&r=7d`;

for (const g of GIVENS) {
  // The figure the type and the month carry: money in and the deposit lower them.
  const signed = g.way === "in" ? -g.amount : g.amount;
  // The group's field is its spending: every money-out type but Prive.
  const spending = g.way === "out" && !g.capital ? g.amount : 0;

  test.describe(`selling:all wants to see statistics (${g.case})`, () => {
    for (const r of ROLES) {
      test(`${r.given} add analytic metric`, async ({ page }) => {
        const gr = await ground(g, r);
        const day = today();
        const total = page.getByTestId(`analytic-cell-${day}-total`);
        const cell = page.getByTestId(`analytic-cell-${day}-${g.field}`);

        await signInAs(page, g, r, gr.team);

        // BEFORE — Expenses by day, as the role: today's row is there, its total whatever the day holds so far.
        await page.goto(ANALYTIC);
        await expect(page.getByTestId("current-user")).toHaveText(username(g, r));
        await expect(total).toBeVisible();
        const before = figure(await total.textContent());

        // The given's expense, today — recorded by root (a CS may not record one).
        await asRoot("expense.v1.ExpenseService/ExpenseCreate", {
          teamId: gr.team,
          kind: `EXPENSE_KIND_${g.group.toUpperCase()}`,
          type: g.type,
          amount: g.amount,
          occurredAt: day,
          note: `E2E expense metric ${tag(g, r)} ${SUFFIX}`,
          financeAccountId: gr.account,
        });

        await test.step(g.thenShown, async () => {
          // The figure is written in the expense's own transaction; the page is reloaded until it reads it.
          await expect(async () => {
            await page.reload();
            await expect(cell).toHaveText(money(signed), { timeout: 3_000 });
          }).toPass({ timeout: 30_000 });
          // Its own column, headed by Biaya's words for the type.
          await expect(page.getByTestId(`analytic-sort-${g.field}`)).toHaveText(g.label);
        });

        await test.step(g.thenTotal, async () => {
          await expect(total).toHaveText(money(before + signed));
          expect(figure(await total.textContent()) - before).toBe(signed);
        });

        await test.step(
          `regression: the group's ${g.group} reads its spending ${rp(spending)}; money in, Prive and Setoran modal are not offered`,
          async () => {
            await expect.soft(page.getByTestId(`analytic-cell-${day}-${g.group}`)).toHaveText(money(spending));
            for (const f of NOT_OFFERED) {
              await expect.soft(page.getByTestId(`analytic-cell-${day}-${f}`)).toHaveCount(0);
            }
          },
        );
      });
    }
  });
}
