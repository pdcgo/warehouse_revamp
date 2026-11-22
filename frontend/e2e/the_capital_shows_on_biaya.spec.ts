import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";

// ── #99 P2 — THE ACCOUNT PAGE'S SETOR / TARIK MODAL IS THE ONE RECORD ON BIAYA ─────────────────────────────────────────
//
// Regression for docs/business/financial_account/context_decision.md:
// - prive-and-deposit-on-pengeluaran-are-the-accounts-capital (its ✅ Built P2 line) — one act, one record, two doors: a
//   SELLING team's Setor / Tarik Modal on the account page still posts its one `capital` row by hand, and (through an
//   event, FinancialAccountCapitalRecorded) Biaya records it as Lainnya › Setoran modal (in) / Prive (out), origin the
//   account page (*Dicatat di halaman akun*). Biaya posts nothing back: one capital row per act, never two. A WAREHOUSE
//   team's stays on the account page alone. The dialog says so on a selling team's account only
//   (`capital-on-expenses-hint`).
// - the-expense-types-prototype-is-accepted (*corrections*): every typed row, Modal ones too, keeps Adjust and Batalkan.
//
// Root, the owner of both teams this file makes (TeamCreate, ownerUserId root):
//   a SELLING team — account A (BCA, opens Rp 1.000.000) and account L (opens Rp 0, only for the warehouse test's
//   "later selling event");
//   a WAREHOUSE team — account W (BCA, opens Rp 500.000).
// Every note carries this file's SUFFIX, so a row is found by its note alone.

const SUFFIX = Date.now().toString().slice(-6);

const OPEN_A = 1_000_000;
const OPEN_W = 500_000;
const SETOR = 250_000;
const TARIK = 100_000;
const SETOR_W = 333_000;
const LATER = 50_000;

const NOTE_SETOR = `e2e setor ${SUFFIX}`;
const NOTE_TARIK = `e2e tarik ${SUFFIX}`;
const NOTE_W = `e2e warehouse setor ${SUFFIX}`;
const NOTE_LATER = `e2e later setor ${SUFFIX}`;

const rp = (n: number) => `Rp ${new Intl.NumberFormat("id-ID").format(n)}`;
/** Today in the business's month — Jakarta's. */
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

const ground = { seller: "", a: "", l: "", warehouse: "", w: "" };

test.describe.configure({ timeout: 180_000 });

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

interface ExpenseRow {
  id: string;
  note?: string;
  amount?: number;
  type?: string;
  origin?: string;
  kind?: string;
  financeAccountId?: string;
  adjustsExpenseId?: string;
}

// The team's expenses recorded today, as ExpenseList answers them (proto3 JSON leaves a zero out).
async function expensesOf(page: Page, teamId: string): Promise<ExpenseRow[]> {
  const res = await rpc<{ items?: { expense?: { mapData?: Record<string, ExpenseRow> } }[] }>(
    page,
    "expense.v1.ExpenseService/ExpenseList",
    { teamId, filter: { from: today(), to: today() }, page: { page: 1, limit: 200 } },
  );
  const rows: ExpenseRow[] = [];
  for (const item of res.items ?? []) for (const row of Object.values(item.expense?.mapData ?? {})) rows.push(row);

  return rows;
}

interface LogRow {
  id: string;
  changeType?: string;
  change?: number;
  expenseId?: string;
}

// Every row of the account's history (any change type).
async function historyOf(page: Page, teamId: string, accountId: string): Promise<LogRow[]> {
  const res = await rpc<{ items?: { log?: { mapData?: Record<string, LogRow> } }[] }>(
    page,
    "financial_account.v1.FinancialAccountService/FinancialAccountLogList",
    {
      teamId,
      filter: { accountId },
      dataRequest: ["FINANCIAL_ACCOUNT_LOG_LIST_DATA_TYPE_LOG"],
      page: { page: 1, limit: 200 },
    },
  );
  const rows: LogRow[] = [];
  for (const item of res.items ?? []) for (const row of Object.values(item.log?.mapData ?? {})) rows.push(row);

  return rows;
}

const capitalRows = (rows: LogRow[]) => rows.filter((r) => r.changeType === "FINANCIAL_ACCOUNT_CHANGE_TYPE_CAPITAL");

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await browser.newPage();
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string) =>
    (await rpc<{ team: { id: string } }>(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team
      .id;
  const account = async (teamId: string, tag: string, openingBalance: number) =>
    (
      await rpc<{ account: { id: string } }>(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name: `E2E Capital ${tag} ${SUFFIX}`,
        holderName: "E2E",
        accountNumber: `CBY${tag}${SUFFIX}`,
        openingBalance,
        openingOn: today(),
      })
    ).account.id;

  ground.seller = await team(`E2E Capital Seller ${SUFFIX}`, `CBS${SUFFIX}`, "TEAM_TYPE_SELLING");
  ground.a = await account(ground.seller, "A", OPEN_A);
  ground.l = await account(ground.seller, "L", 0);
  ground.warehouse = await team(`E2E Capital Warehouse ${SUFFIX}`, `CBW${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  ground.w = await account(ground.warehouse, "W", OPEN_W);

  await page.close();
});

// Root, working in `teamId` (the active team is per tab, in sessionStorage — TeamContext).
async function rootIn(page: Page, teamId: string) {
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

// The account's own page, re-read until its balance reads `text`.
async function balanceIs(page: Page, accountId: string, text: string) {
  await expect(async () => {
    await page.goto(`/financial-accounts/${accountId}`);
    await expect(page.getByTestId("account-detail-balance")).toHaveText(text, { timeout: 3_000 });
  }).toPass({ timeout: 45_000 });
}

// The account page's ⋯ → Add / Withdraw Capital: the dialog, open, nothing typed yet.
async function openCapital(page: Page, accountId: string): Promise<Locator> {
  await page.goto(`/financial-accounts/${accountId}`);
  await expect(page.getByTestId("financial-account-page")).toBeVisible();
  await page.getByTestId(`account-actions-${accountId}`).click();
  await page.getByTestId(`account-capital-${accountId}`).click();
  const dialog = page.getByTestId("capital");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("capital-amount")).toBeVisible();

  return dialog;
}

async function saveCapital(dialog: Locator, direction: "in" | "out", amount: number, note: string) {
  await dialog.getByTestId(`capital-${direction}`).click();
  await dialog.getByTestId("capital-amount").fill(String(amount));
  await dialog.getByTestId("capital-note").fill(note);
  await dialog.getByTestId("capital-save").click();
  await expect(dialog).toBeHidden();
}

// Biaya (/expenses), re-read until the row noted `note` has come through the event: its id.
async function biayaRowOf(page: Page, note: string): Promise<string> {
  const rows = () => page.getByTestId("expenses-table").locator('[data-testid^="expense-row-"]').filter({ hasText: note });
  await expect(async () => {
    await page.goto("/expenses");
    await expect(rows()).toHaveCount(1, { timeout: 3_000 });
  }).toPass({ timeout: 60_000 });

  return ((await rows().getAttribute("data-testid")) ?? "").replace("expense-row-", "");
}

test.describe("#99 P2 — the account page's Setor / Tarik Modal is the one record on Biaya", () => {
  test("a selling team's Setor and Tarik Modal: one Biaya row each, one capital row each", async ({ page }) => {
    await rootIn(page, ground.seller);
    await balanceIs(page, ground.a, rp(OPEN_A));

    let setorId = "";

    await test.step("regression: the Setor Modal dialog says it shows on Biaya, before saving", async () => {
      const dialog = await openCapital(page, ground.a);
      await expect.soft(dialog.getByTestId("capital-on-expenses-hint")).toBeVisible();
      await expect.soft(dialog.getByTestId("capital-on-expenses-hint")).toHaveText(
        "Also shown on Expenses — Withdraw as Prive, Add as Deposit. One record.",
      );
      await saveCapital(dialog, "in", SETOR, NOTE_SETOR);
    });

    await test.step("regression: Biaya gains ONE row, Other › Deposit, recorded on the account page", async () => {
      setorId = await biayaRowOf(page, NOTE_SETOR);
      await expect.soft(page.getByTestId(`expense-type-${setorId}`)).toHaveText("Other › Deposit · owner adds capital");
      await expect.soft(page.getByTestId(`expense-mark-${setorId}-capital`)).toBeVisible();
      await expect.soft(page.getByTestId(`expense-mark-${setorId}-in`)).toBeVisible();
      await expect.soft(page.getByTestId(`expense-origin-${setorId}`)).toHaveText("Recorded on the account page");
      await expect.soft(page.getByTestId(`expense-amount-${setorId}`)).toHaveText(rp(SETOR));
      await expect.soft(page.getByTestId(`expense-account-${setorId}`)).toHaveAttribute("data-account-id", ground.a);
      // The read the screen draws from: one row for the act, typed and linked as the door says.
      const rows = (await expensesOf(page, ground.seller)).filter((r) => r.note === NOTE_SETOR);
      expect.soft(rows).toHaveLength(1);
      expect.soft(rows[0]).toMatchObject({
        id: setorId,
        kind: "EXPENSE_KIND_OTHER",
        type: "EXPENSE_TYPE_CAPITAL_DEPOSIT",
        origin: "EXPENSE_ORIGIN_ACCOUNT_PAGE",
        financeAccountId: ground.a,
        amount: SETOR,
      });
    });

    await test.step("regression: the account history holds ONE capital row for the act, the balance moved once", async () => {
      const history = await historyOf(page, ground.seller, ground.a);
      // The opening and the one capital row — nothing posted back from Biaya.
      expect.soft(history).toHaveLength(2);
      expect.soft(capitalRows(history).map((r) => r.change)).toEqual([SETOR]);
      await balanceIs(page, ground.a, rp(OPEN_A + SETOR));
      const top = page.getByTestId("account-log-table").getByRole("row").nth(1);
      await expect.soft(top).toContainText("Capital");
      await expect.soft(top).toContainText("250.000");
    });

    await test.step("regression: Tarik Modal → ONE Prive row on Biaya, from the account page; the balance down once", async () => {
      const dialog = await openCapital(page, ground.a);
      await expect.soft(dialog.getByTestId("capital-on-expenses-hint")).toBeVisible();
      await saveCapital(dialog, "out", TARIK, NOTE_TARIK);

      const tarikId = await biayaRowOf(page, NOTE_TARIK);
      await expect.soft(page.getByTestId(`expense-type-${tarikId}`)).toHaveText("Other › Prive · owner takes capital");
      await expect.soft(page.getByTestId(`expense-mark-${tarikId}-capital`)).toBeVisible();
      await expect.soft(page.getByTestId(`expense-mark-${tarikId}-in`)).toHaveCount(0);
      await expect.soft(page.getByTestId(`expense-origin-${tarikId}`)).toHaveText("Recorded on the account page");
      await expect.soft(page.getByTestId(`expense-amount-${tarikId}`)).toHaveText(rp(TARIK));
      const rows = (await expensesOf(page, ground.seller)).filter((r) => r.note === NOTE_TARIK);
      expect.soft(rows).toHaveLength(1);
      expect.soft(rows[0]).toMatchObject({ id: tarikId, type: "EXPENSE_TYPE_PRIVE", origin: "EXPENSE_ORIGIN_ACCOUNT_PAGE", amount: TARIK });

      // Both acts' Biaya rows have landed — any capital row Biaya posted back for the Setor would be here by now.
      const history = await historyOf(page, ground.seller, ground.a);
      expect.soft(history).toHaveLength(3);
      expect.soft(capitalRows(history).map((r) => r.change).sort((x, y) => (x ?? 0) - (y ?? 0))).toEqual([-TARIK, SETOR]);
      await balanceIs(page, ground.a, rp(OPEN_A + SETOR - TARIK));
    });

    await test.step("regression: a Biaya row from the account page keeps Adjust and Batalkan", async () => {
      await page.goto("/expenses");
      await page.getByTestId(`expense-actions-${setorId}`).click();
      await expect.soft(page.getByTestId(`expense-adjust-${setorId}`)).toBeVisible();
      await expect.soft(page.getByTestId(`expense-cancel-${setorId}`)).toBeVisible();
      await page.keyboard.press("Escape");
    });
  });

  test("a warehouse team's Setor Modal stays on the account page — no line, nothing on Biaya", async ({ page }) => {
    await rootIn(page, ground.warehouse);
    await balanceIs(page, ground.w, rp(OPEN_W));

    await test.step("regression: the warehouse's Setor Modal dialog has no Biaya line", async () => {
      const dialog = await openCapital(page, ground.w);
      await expect.soft(dialog.getByTestId("capital-on-expenses-hint")).toHaveCount(0);
      await saveCapital(dialog, "in", SETOR_W, NOTE_W);
      // Its one capital row, by hand, at once.
      await balanceIs(page, ground.w, rp(OPEN_W + SETOR_W));
      expect.soft(capitalRows(await historyOf(page, ground.warehouse, ground.w)).map((r) => r.change)).toEqual([SETOR_W]);
    });

    await test.step("regression: nothing of it reaches Biaya", async () => {
      // A LATER selling-team act on the same event path: once its Biaya row has landed, the warehouse's event (published
      // before it) has been heard too.
      await rpc(page, "financial_account.v1.FinancialAccountService/FinancialAccountCapital", {
        teamId: ground.seller,
        accountId: ground.l,
        direction: "CAPITAL_DIRECTION_IN",
        amount: LATER,
        occurredOn: today(),
        note: NOTE_LATER,
      });
      await expect
        .poll(async () => (await expensesOf(page, ground.seller)).filter((r) => r.note === NOTE_LATER).length, { timeout: 60_000 })
        .toBe(1);

      // …and, for good measure, the warehouse's Biaya read stays empty of it for ~10 s more.
      for (let i = 0; i < 5; i++) {
        const rows = await expensesOf(page, ground.warehouse);
        expect.soft(rows.filter((r) => r.note === NOTE_W || r.amount === SETOR_W)).toEqual([]);
        await page.waitForTimeout(2_000);
      }
      // And the seller's Biaya never gained it either.
      expect.soft((await expensesOf(page, ground.seller)).filter((r) => r.note === NOTE_W)).toEqual([]);
    });
  });
});
