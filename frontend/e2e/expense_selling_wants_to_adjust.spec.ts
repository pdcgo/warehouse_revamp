import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";

// ── adjust expense — the checks behind docs/acceptances/financial_account/expense.md, givens 23–25 ─────────────────────
//
// adjust expense's regression spec. An acceptance has no test file of its own (docs/acceptances/guide.md): the checks for
// its thens live here, one test.describe per given + when, one test per role, one test.step("then: …") per then.
//
// Business rules:
// - every-correction-is-a-signed-adjustment (docs/business/analytic/context_decision.md): an expense is never edited —
//   a correction is a row of its own, signed, naming the expense it fixes; the expense keeps the amount typed and says
//   what it counts for now. An expense and its corrections never sum below 0 (the server refuses it, failed_precondition;
//   the Adjust dialog refuses it first).
// - an-adjustment-counts-on-the-day-it-fixes (same file): on the Expenses page the correction sits on the EXPENSE's day,
//   so the month that holds the mistake becomes correct.
// - an-expense-correction-counts-on-the-day-it-is-made (docs/business/analytic/rpc_provide_decision.md): in Analytic the
//   correction counts on the day it is MADE — the expense's day keeps its figure, past days never change.
// - a-correction-follows-the-expenses-account (docs/business/financial_account/context_decision.md): the correction posts
//   to the account the original named in Paid from, by the signed difference; the dialog shows it read-only.
//
// The WHEN, as the person does it: Biaya (/expenses, on the expense's month) → the row's ⋯ (`expense-actions-<id>`) →
// Adjust (`expense-adjust-<id>`) → Reduce / Add (`adjust-direction-*`) → the correction's amount (`adjust-amount`, the
// correction, never the new total) → Save (`submit-adjust`). Done THROUGH THE DIALOG by the role user.
//
// GROUND (beforeAll, as root, through the API) — one SELLING TEAM per (given, role), root its owner, the role user its
// member, one BCA account opened at Rp 10.000.000 five days ago and marked operational, and the given's expense, paid
// from that account (Operasional › Listrik), typed by root:
//   23 (expense Rp 500.000 · reduce Rp 100.000): Rp 500.000, THREE DAYS AGO (Jakarta) — so "the expense's day" and
//      "the day it was made" (today) are two different days.
//   24 (expense Rp 500.000 · add Rp 50.000): Rp 500.000, today.
//   25 (expense Rp 400.000 · reduce Rp 450.000): Rp 400.000, today.
// Before each WHEN the account's post of the expense is seen landed (its balance is polled — the post is event-driven:
// expense_service publishes, the Pub/Sub emulator pushes, financial_account's listener posts).
//
// How the thens are read:
// - `adjustment row added on the expense's day` — the ExpenseAdjust answer's correction is dated the expense's day
//   (three days ago, not today) and signed −100.000; the list gains exactly that row: the Adjustment badge
//   (`expense-adjustment-<id>`), −Rp 100.000, and the SAME date cell as the expense's own row.
// - `expense shows now Rp 400.000` — the expense row keeps Rp 500.000 (`expense-amount-<id>`) and reads
//   "now Rp 400.000" (`expense-net-<id>`); the month's Total reads Rp 400.000.
// - `paying account gets Rp 100.000 back` / `paying account decreases by Rp 50.000` — the account's own page, polled:
//   Rp 9.500.000 before the WHEN → Rp 9.600.000 / Rp 9.450.000.
// - `correction counted in expense analytic metric on the day it was made` — Analytic › Expenses by day (7 days), read
//   as the role: before the WHEN the expense's day reads Rp 500.000 and today has nothing; after it today reads
//   −Rp 100.000 (Total and Operational) and the expense's day still reads Rp 500.000.
// - `cannot reduce below Rp 0` — on BOTH layers: the dialog says why (`adjust-below-zero`, naming the Rp 400.000 it
//   counts for now) and Save stays disabled, so no ExpenseAdjust is sent; the same correction sent anyway with the ROLE's
//   token is refused `failed_precondition`; nothing changed — one row, no "now", Total Rp 400.000, the account unmoved.

const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-adjust-pass-1";
const OPENING = 10_000_000;
const EXPENSES_METRIC = "metrics/expenses";
const ADJUST = "expense.v1.ExpenseService/ExpenseAdjust";

const rp = (n: number) => `Rp ${new Intl.NumberFormat("id-ID").format(n)}`;
/** A signed figure as the screens write it — the typographic minus before "Rp" (or a plain hyphen). */
const minusRp = (n: number) => new RegExp(`^[-−]${rp(n).replace(/\./g, "\\.")}$`);

/** A Jakarta day `ago` days before today — the business's day. */
const day = (ago: number) =>
  new Date(Date.now() - ago * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
const TODAY = day(0);
// Given 23's expense day: three days back, so the correction's two days (the expense's, the one it is made on) differ.
const EARLIER = day(3);
const OPENING_ON = day(5);

const ROLES = [
  { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "O", word: "Owner" },
  { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "A", word: "Admin" },
] as const;
type Role = (typeof ROLES)[number];

// The givens' expenses — the amount, the day.
const GIVENS = {
  23: { amount: 500_000, on: EARLIER },
  24: { amount: 500_000, on: TODAY },
  25: { amount: 400_000, on: TODAY },
} as const;
type GivenId = keyof typeof GIVENS;

// One (given, role)'s ground.
interface Seat {
  tag: string;
  team: string;
  account: string;
  accountName: string;
  expense: string;
  username: string;
}
const seats = new Map<string, Seat>();
const seatOf = (given: GivenId, r: Role): Seat => {
  const s = seats.get(`${given}${r.key}`);
  if (!s) throw new Error(`no ground for given ${given} · ${r.given}`);

  return s;
};

test.describe.configure({ timeout: 150_000 });

// An RPC as the signed-in person — the status and the JSON, so a refusal is asserted as well as a success.
async function send(page: Page, method: string, body: unknown): Promise<{ status: number; json: Record<string, any> }> {
  return page.evaluate(
    async ([m, b, apiUrl]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ?? window.localStorage.getItem("warehouse_revamp.token");
      const res = await fetch(`${apiUrl}/warehouse.${m as string}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(b),
      });

      return { status: res.status, json: (await res.json()) as Record<string, any> };
    },
    [method, body, API_URL] as const,
  );
}

// The same, failing by name when refused.
async function rpc<T = Record<string, any>>(page: Page, method: string, body: unknown): Promise<T> {
  const res = await send(page, method, body);
  if (res.status !== 200) throw new Error(`${method}: ${res.status} ${JSON.stringify(res.json)}`);

  return res.json as T;
}

// GROUND for one (given, role): its selling team, its role user, its operational account, the given's expense.
async function makeSeat(page: Page, given: GivenId, r: Role): Promise<Seat> {
  const tag = `${given}${r.key}`;
  const team = (
    await rpc<{ team: { id: string } }>(page, "team.v1.TeamService/TeamCreate", {
      type: "TEAM_TYPE_SELLING",
      name: `E2E Adj ${tag} ${SUFFIX}`,
      // A team code is at most 10 characters: J + the tag (3) + the suffix (6).
      teamCode: `J${tag}${SUFFIX}`,
      ownerUserId: ROOT_USER_ID,
    })
  ).team.id;

  // A username is lowercase letters and digits only.
  const username = `e2eadj${tag}${SUFFIX}`.toLowerCase();
  await rpc(page, "user.v1.UserService/CreateUser", {
    teamId: team,
    username,
    password: PASSWORD,
    name: `Adj ${tag} ${r.word} ${SUFFIX}`,
    role: r.role,
  });

  const accountName = `E2E Adj BCA ${tag} ${SUFFIX}`;
  const account = (
    await rpc<{ account: { id: string } }>(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
      teamId: team,
      type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
      name: accountName,
      holderName: "E2E",
      accountNumber: `E2E-ADJ-${tag}-${SUFFIX}`,
      openingBalance: OPENING,
      openingOn: OPENING_ON,
    })
  ).account.id;
  await rpc(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: team,
    accountId: account,
    operational: true,
  });

  const g = GIVENS[given];
  const expense = (
    await rpc<{ expense: { id: string } }>(page, "expense.v1.ExpenseService/ExpenseCreate", {
      teamId: team,
      kind: "EXPENSE_KIND_OPERATIONAL",
      type: "EXPENSE_TYPE_ELECTRICITY",
      amount: g.amount,
      occurredAt: g.on,
      note: `e2e adjust electricity ${tag} ${SUFFIX}`,
      financeAccountId: account,
    })
  ).expense.id;

  return { tag, team, account, accountName, expense, username };
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  const page = await browser.newPage();
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  const jobs = ([23, 24, 25] as const).flatMap((g) => ROLES.map((r) => [g, r] as const));
  // A few at a time — each seat's own calls stay in order.
  for (let i = 0; i < jobs.length; i += 3) {
    await Promise.all(
      jobs.slice(i, i + 3).map(async ([g, r]) => {
        seats.set(`${g}${r.key}`, await makeSeat(page, g, r));
      }),
    );
  }

  await page.close();
});

// The role user, signed in, working in its seat's team (the active team is per tab, in sessionStorage — TeamContext).
async function signInAs(page: Page, s: Seat) {
  await signIn(page, s.username, PASSWORD);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), s.team);
}

// Biaya on the month that holds `on` (it opens on this month; the expense may sit in the last one).
async function openExpenses(page: Page, on: string) {
  await page.goto("/expenses");
  await expect(page.getByTestId("expenses-table")).toBeVisible();
  if (on.slice(0, 7) !== TODAY.slice(0, 7)) {
    await page.getByTestId("expenses-month").fill(on.slice(0, 7));
  }
}

// The account's own page, re-read until the listener's post has landed.
async function balanceIs(page: Page, account: string, text: string) {
  await expect(async () => {
    await page.goto(`/financial-accounts/${account}`);
    await expect(page.getByTestId("account-detail-balance")).toHaveText(text, { timeout: 3_000 });
  }).toPass({ timeout: 45_000 });
}

// The Adjust dialog of the seat's expense, opened from its row, the direction and the correction typed.
async function openAdjust(page: Page, s: Seat, direction: "reduce" | "add", amount: number) {
  await expect(page.getByTestId(`expense-row-${s.expense}`)).toBeVisible();
  await page.getByTestId(`expense-actions-${s.expense}`).click();
  await page.getByTestId(`expense-adjust-${s.expense}`).click();
  const dialog = page.getByTestId("adjust-expense-dialog");
  await expect(dialog).toBeVisible();
  // The original's account, read-only (a-correction-follows-the-expenses-account).
  await expect.soft(page.getByTestId("adjust-paid-from")).toContainText(s.accountName);
  await page.getByTestId(`adjust-direction-${direction}`).click();
  await page.getByTestId("adjust-amount").fill(String(amount));

  return dialog;
}

// WHEN — adjust expense: the dialog saved; the correction ExpenseAdjust answered with.
async function adjust(
  page: Page,
  s: Seat,
  direction: "reduce" | "add",
  amount: number,
  after: number,
): Promise<{ id: string; occurredAt: string; amount: number }> {
  const dialog = await openAdjust(page, s, direction, amount);
  await expect(page.getByTestId("adjust-after")).toContainText(rp(after));
  await expect(page.getByTestId("submit-adjust")).toBeEnabled();

  const [answer] = await Promise.all([
    page.waitForResponse((res) => res.url().endsWith(`/warehouse.${ADJUST}`)),
    page.getByTestId("submit-adjust").click(),
  ]);
  expect(answer.status(), "ExpenseAdjust").toBe(200);
  const body = (await answer.json()) as { adjustment: { id: string; occurredAt: string; amount: number } };
  await expect(dialog).toBeHidden();

  return body.adjustment;
}

// Analytic › Expenses by day, over 7 days, as the signed-in person; re-read until `check` holds (the fold is an event).
async function expensesByDay(page: Page, check: () => Promise<void>) {
  await expect(async () => {
    await page.goto(`/analytic?g=daily&m=${EXPENSES_METRIC}&r=7d`);
    await expect(page.getByTestId("analytic-table")).toBeVisible({ timeout: 5_000 });
    await check();
  }).toPass({ timeout: 45_000 });
}

/** Nothing on `d`: a zero-net key is dropped (no row), or its cell reads 0 / "—". */
async function nothingOn(page: Page, d: string, field: string) {
  const cell = page.getByTestId(`analytic-cell-${d}-${field}`);
  if ((await cell.count()) > 0) {
    await expect(cell).toHaveText(/^(Rp 0|—|0)$/, { timeout: 3_000 });
  }
}

test.describe("selling:owner · selling:admin wants to correct a cost (expense Rp 500.000 · reduce Rp 100.000)", () => {
  for (const r of ROLES) {
    test(`${r.given} adjust expense (expense Rp 500.000 · reduce Rp 100.000)`, async ({ page }) => {
      const s = seatOf(23, r);
      const g = GIVENS[23];
      await signInAs(page, s);

      // The given: the expense's post has landed on the account, and Analytic reads it on its own day, nothing today.
      await balanceIs(page, s.account, rp(OPENING - g.amount));
      await expensesByDay(page, async () => {
        await expect(page.getByTestId(`analytic-cell-${EARLIER}-total`)).toHaveText(rp(g.amount), { timeout: 3_000 });
        await nothingOn(page, TODAY, "total");
      });

      // WHEN — adjust expense: reduce by Rp 100.000.
      await openExpenses(page, g.on);
      const adjustment = await adjust(page, s, "reduce", 100_000, 400_000);

      await test.step("then: adjustment row added on the expense's day", async () => {
        // The correction itself: signed, dated the expense's day (three days ago), not the day it was made.
        expect.soft(adjustment.occurredAt).toBe(EARLIER);
        expect.soft(adjustment.occurredAt).not.toBe(TODAY);
        expect.soft(Number(adjustment.amount)).toBe(-100_000);
        // On the list: exactly the expense and this one row, badged, signed, on the same date cell as the expense.
        await expect.soft(page.locator('[data-testid^="expense-row-"]')).toHaveCount(2);
        const row = page.getByTestId(`expense-row-${adjustment.id}`);
        await expect.soft(row.getByTestId(`expense-adjustment-${adjustment.id}`)).toHaveText("Adjustment");
        await expect.soft(row.getByTestId(`expense-amount-${adjustment.id}`)).toHaveText(minusRp(100_000));
        const expenseDay = (await page.getByTestId(`expense-date-${s.expense}`).textContent())?.trim() ?? "";
        expect.soft(expenseDay).not.toBe("");
        await expect.soft(row.getByTestId(`expense-date-${adjustment.id}`)).toHaveText(expenseDay);
      });

      await test.step("then: expense shows now Rp 400.000", async () => {
        const row = page.getByTestId(`expense-row-${s.expense}`);
        await expect.soft(row.getByTestId(`expense-amount-${s.expense}`)).toHaveText(rp(500_000));
        await expect.soft(row.getByTestId(`expense-net-${s.expense}`)).toHaveText(`now ${rp(400_000)}`);
        await expect.soft(page.getByTestId("expenses-total")).toHaveText(rp(400_000));
      });

      await test.step("then: paying account gets Rp 100.000 back", async () => {
        await balanceIs(page, s.account, rp(OPENING - g.amount + 100_000));
      });

      await test.step("then: correction counted in expense analytic metric on the day it was made", async () => {
        await expensesByDay(page, async () => {
          await expect(page.getByTestId(`analytic-cell-${TODAY}-total`)).toHaveText(minusRp(100_000), { timeout: 3_000 });
          await expect(page.getByTestId(`analytic-cell-${TODAY}-operational`)).toHaveText(minusRp(100_000), { timeout: 3_000 });
          // The expense's day never changes.
          await expect(page.getByTestId(`analytic-cell-${EARLIER}-total`)).toHaveText(rp(g.amount), { timeout: 3_000 });
        });
      });
    });
  }
});

test.describe("selling:owner · selling:admin wants to correct a cost (expense Rp 500.000 · add Rp 50.000)", () => {
  for (const r of ROLES) {
    test(`${r.given} adjust expense (expense Rp 500.000 · add Rp 50.000)`, async ({ page }) => {
      const s = seatOf(24, r);
      const g = GIVENS[24];
      await signInAs(page, s);

      // The given: the expense's post has landed — Rp 9.500.000.
      await balanceIs(page, s.account, rp(OPENING - g.amount));

      // WHEN — adjust expense: add Rp 50.000.
      await openExpenses(page, g.on);
      const adjustment = await adjust(page, s, "add", 50_000, 550_000);

      await test.step("then: paying account decreases by Rp 50.000", async () => {
        await balanceIs(page, s.account, rp(OPENING - g.amount - 50_000));
      });

      await test.step("regression: the expense counts for Rp 550.000, the correction is its own row", async () => {
        await page.goto("/expenses");
        await expect.soft(page.getByTestId(`expense-net-${s.expense}`)).toHaveText(`now ${rp(550_000)}`);
        // The correction, signed (formatSignedRupiah: "+Rp 50.000").
        await expect.soft(page.getByTestId(`expense-amount-${adjustment.id}`)).toHaveText(/^\+?Rp 50\.000$/);
        await expect.soft(page.getByTestId("expenses-total")).toHaveText(rp(550_000));
      });
    });
  }
});

test.describe("selling:owner · selling:admin wants to correct a cost (expense Rp 400.000 · reduce Rp 450.000)", () => {
  for (const r of ROLES) {
    test(`${r.given} adjust expense (expense Rp 400.000 · reduce Rp 450.000)`, async ({ page }) => {
      const s = seatOf(25, r);
      const g = GIVENS[25];
      await signInAs(page, s);

      // The given: the expense's post has landed — Rp 9.600.000.
      await balanceIs(page, s.account, rp(OPENING - g.amount));

      // Every ExpenseAdjust the page sends from here on.
      let sent = 0;
      page.on("request", (req) => {
        if (req.url().endsWith(`/warehouse.${ADJUST}`)) sent++;
      });

      // WHEN — adjust expense: reduce by Rp 450.000, past the Rp 400.000 it counts for.
      await openExpenses(page, g.on);
      const dialog = await openAdjust(page, s, "reduce", 450_000);

      await test.step("then: cannot reduce below Rp 0", async () => {
        // The form holds: it says why, naming what the expense counts for now, and Save stays disabled.
        await expect.soft(page.getByTestId("adjust-below-zero")).toBeVisible();
        await expect.soft(page.getByTestId("adjust-below-zero")).toContainText(rp(400_000));
        await expect.soft(page.getByTestId("adjust-below-zero")).toContainText("below 0");
        await expect.soft(page.getByTestId("adjust-after")).toHaveCount(0);
        await expect.soft(page.getByTestId("submit-adjust")).toBeDisabled();
        // Enter in the amount box submits the form — still nothing is sent.
        await page.getByTestId("adjust-amount").press("Enter");
        await page.waitForTimeout(500);
        expect.soft(sent, "ExpenseAdjust requests sent by the dialog").toBe(0);
        await expect.soft(dialog).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();

        // The server refuses the same correction sent anyway, under the role's own token.
        const refused = await send(page, ADJUST, {
          teamId: s.team,
          expenseId: s.expense,
          amount: -450_000,
          note: `e2e adjust below zero ${s.tag} ${SUFFIX}`,
        });
        expect.soft(refused.status, "ExpenseAdjust below 0").not.toBe(200);
        expect.soft(refused.json.code).toBe("failed_precondition");

        // Nothing changed: the one expense, no correction, no "now", the month at Rp 400.000, the account unmoved.
        const listed = await rpc<{ ids?: string[] }>(page, "expense.v1.ExpenseService/ExpenseList", {
          teamId: s.team,
          filter: {},
          page: { page: 1, limit: 10 },
        });
        expect.soft(listed.ids ?? []).toEqual([s.expense]);
        await page.goto("/expenses");
        await expect(page.getByTestId(`expense-row-${s.expense}`)).toBeVisible();
        await expect.soft(page.locator('[data-testid^="expense-row-"]')).toHaveCount(1);
        await expect.soft(page.locator('[data-testid^="expense-adjustment-"]')).toHaveCount(0);
        await expect.soft(page.getByTestId(`expense-amount-${s.expense}`)).toHaveText(rp(400_000));
        await expect.soft(page.getByTestId(`expense-net-${s.expense}`)).toHaveCount(0);
        await expect.soft(page.getByTestId("expenses-total")).toHaveText(rp(400_000));
        await balanceIs(page, s.account, rp(OPENING - g.amount));
      });
    });
  }
});
