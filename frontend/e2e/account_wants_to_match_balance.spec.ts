import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { ROOT_USER_ID } from "./global-setup";
import { API_URL } from "./env";
import { asRoot, call, root, login as tokenOf, signInAs, today } from "./metric_ground";

// selling owner · admin · warehouse owner · admin want the books to match the bank — the checks behind
// docs/acceptances/financial_account/reconcile.md, when *match balance* (Cocokkan Saldo, givens 1–9). An acceptance has
// no test file of its own (docs/acceptances/guide.md): one test.describe per given (its case in parentheses VERBATIM),
// per role a test, one test.step("then: …") per then, stored verbatim (acceptance_mark.py matches the literal text). A
// step that is no then is named `regression: …`.
//
// Business rules (docs/business/financial_account/context_decision.md):
// - adjustment-is-for-reconciling-only — the person types what the bank app SHOWS (or what the cash box COUNTS); the
//   difference posts as an `adjustment`, the only way one is ever made. Agreeing books post nothing and still mark the
//   account checked (`reconciled_at`); a difference needs a reason (the server: "say why the books and the bank differ").
// - an unknown account has no statement to read — no Match Balance (the server: "an unknown account has no statement to
//   read"); it offers Set Account, Transfer Out and Archive (the-unknown-row-warns-and-sets-from-the-menu).
// - below-zero-is-warned-never-refused — a balance under zero is marked on its row (`account-balance-<id>-below-zero`).
// - the-warehouse-admin-equals-the-owner-except-money — a warehouse Admin reconciles but moves no money, so an unknown
//   account offers it no Transfer Out: given 8's then names Transfer Out for every role, so the warehouse admin's half
//   is a CONFLICT, kept as a test.fail of its own (plus a regression test for what IS built) and named for the owner.
// - seeing-is-team-wide-moving-is-admin-and-up — selling CS and warehouse Staff only read: no Match Balance.
// - financial-accounts-serve-their-changes-and-their-types (analytic) — Account changes carries an `adjustment` column
//   per account.
//
// THE WHEN, as the person does it: on the account's page (/financial-accounts/<id>) — given 6 on its row of the Akun
// list, since its then reads the row — Match Balance (account-reconcile-button-<id>) → the dialog (`reconcile`): the
// books (`reconcile-books`), what the bank app shows / the box counts (`reconcile-actual`), the live difference
// (`reconcile-difference`), the day it was read (`reconcile-as-of`, today by default), why (`reconcile-note`), Match
// (`reconcile-save`).
//
// GROUND (beforeAll, as root, through the API from the test runner): one selling team and one warehouse team, a person
// of every role in each. Per matching role and given an account of its own (names carry the given and the role), so
// each figure is exactly its given's: BCA at Rp 1.000.000 (givens 1–4), a cash box at Rp 500.000 (5), a BCA opened at
// Rp 0 and taken Rp 50.000 below zero by a transfer into the side's sink account (6), a BCA opened on 1 Nov at
// Rp 1.000.000 (7). Given 8's unknown account is the side's: the selling team's from a withdrawal of its shop Melati,
// which names no account (pushed to the withdrawal listener's route as Pub/Sub would deliver it). ⚠ A WAREHOUSE owns no
// shop: its unknown account comes from a withdrawal of a shop id no shop has, pushed the same way
// (account_wants_to_transfer.spec.ts's door) — named in the report for the owner. Given 9: a BCA per refused role.

const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-acct-match-pass-1";

type Side = "selling" | "warehouse";
type Role = { given: string; role: string; key: string; side: Side };

const MATCHERS: Role[] = [
  { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "sown", side: "selling" },
  { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "sadm", side: "selling" },
  { given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", key: "wown", side: "warehouse" },
  { given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", key: "wadm", side: "warehouse" },
];
const WADMIN = MATCHERS[3]!;
// The roles that may move money — Transfer Out is theirs (the-warehouse-admin-equals-the-owner-except-money).
const MOVERS = MATCHERS.filter((r) => r !== WADMIN);
const LOOKERS: Role[] = [
  { given: "selling:cs", role: "ROLE_SELLING_CS", key: "scs", side: "selling" },
  { given: "warehouse:staff", role: "ROLE_WAREHOUSE_STAFF", key: "wstf", side: "warehouse" },
];
const EVERYONE: Role[] = [...MATCHERS, ...LOOKERS];
const SIDES: Side[] = ["selling", "warehouse"];

// The givens' cases, verbatim from reconcile.md — the marking script finds the tests by them.
const C1 = "active bank BCA · books Rp 1.000.000 · bank app shows Rp 1.000.000";
const C2 = `active bank BCA · books Rp 1.000.000 · bank app shows Rp 990.000 · reason "bank fee"`;
const C3 = `active bank BCA · books Rp 1.000.000 · bank app shows Rp 1.050.000 · reason "transfer in not recorded"`;
const C4 = "active bank BCA · books Rp 1.000.000 · bank app shows Rp 990.000 · no reason";
const C5 = `active cash · books Rp 500.000 · box counts Rp 480.000 · reason "change given out"`;
const C6 = `active bank BCA below zero · books −Rp 50.000 · bank app shows Rp 0 · reason "top-up recorded late"`;
const C7 = "active bank BCA · bank app read on 3 Nov · a difference";
const C8 = "unknown account holding Rp 300.000 withdrawn by shop Melati · its bank not named yet";
const C9 = "active bank BCA";

const BOOKS = 1_000_000;
const CASH_BOOKS = 500_000;
const BELOW = 50_000; // given 6's books: −Rp 50.000
const MELATI_WITHDRAWAL = 300_000;

const RECONCILE_RPC = "financial_account.v1.FinancialAccountService/FinancialAccountReconcile";
const TRANSFER_RPC = "financial_account.v1.FinancialAccountService/FinancialAccountTransfer";
const CHANGES = "metrics/financial_accounts";
const ADJUSTMENT = "FINANCIAL_ACCOUNT_CHANGE_TYPE_ADJUSTMENT";

const BANK_LABEL = "What does the bank app show? (Rp)";
const BOX_LABEL = "What does the box count? (Rp)";

// A username is lowercase letters and digits only.
const username = (key: string) => `e2emb${key}${SUFFIX}`;
const teamName = (s: Side) => `E2E Match Balance ${s} ${SUFFIX}`;
// At most 10 characters: "MB", the side's letter, the 6-digit SUFFIX.
const tag = (s: Side) => (s === "selling" ? "S" : "W");
const bcaName = (g: number, key: string) => `E2E BCA ${g} ${key} ${SUFFIX}`;
const cashName = (key: string) => `E2E Kas 5 ${key} ${SUFFIX}`;
const numberOf = (g: number, key: string) => `E2E-MBAL-${g}-${key}-${SUFFIX}`;
const MELATI = `E2E Melati Match ${SUFFIX}`;
// The warehouse's shop: a shop id no shop has (the ⚠ above). Its own base, clear of the other account specs' ids.
const ORPHAN_SHOP = String(44_000_000 + Number(SUFFIX.slice(-5)) * 10 + 1);
// How the page heads an unknown account (the-unknown-account-reads-lainnya): by its shop's name, or — for a shop id the
// team does not have — its stored name with the prefix dropped.
const shownUnknown = (s: Side) => (s === "selling" ? MELATI : `shop #${ORPHAN_SHOP}`);

// Given 7's "3 Nov": the latest 3 November before today (Jakarta), and the 1st of that month for the account's opening.
const [TODAY_Y, TODAY_M, TODAY_D] = today().split("-").map(Number) as [number, number, number];
const NOV_YEAR = TODAY_M === 12 || (TODAY_M === 11 && TODAY_D > 3) ? TODAY_Y : TODAY_Y - 1;
const NOV3 = `${NOV_YEAR}-11-03`;
const NOV1 = `${NOV_YEAR}-11-01`;
// How many times the calendar pages back from today's month to November.
const MONTHS_BACK = (TODAY_Y - NOV_YEAR) * 12 + (TODAY_M - 11);

// Rupiah as the app prints it: "Rp 1.000.000", "−Rp 10.000".
const rp = (n: number) => `${n < 0 ? "−" : ""}Rp ${Math.abs(n).toLocaleString("id-ID")}`;
const jakartaDay = (stamp?: string) => (stamp ? new Date(stamp).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }) : "");

const ground = {
  team: {} as Record<Side, string>,
  // `${given}-${key}` → the given's account for that role
  acct: {} as Record<string, string>,
  sink: {} as Record<Side, string>,
  unknown: {} as Record<Side, string>,
};
const slot = (g: number, r: Role) => `${g}-${r.key}`;

// ── the API ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** An RPC that may be refused: its HTTP status and body, never a throw. */
async function send(token: string, method: string, body: unknown): Promise<{ status: number; text: string }> {
  const res = await fetch(`${API_URL}/warehouse.${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

  return { status: res.status, text: await res.text() };
}

type LogRow = { id: string; changeType?: string; change?: number; balanceAfter?: number; description?: string; occurredAt?: string };

/** Every row of an account's statement, newest entry first, asked as `token`. */
async function rowsOf(token: string, teamId: string, accountId: string): Promise<LogRow[]> {
  const res = await call<{ items?: { log?: { mapData?: Record<string, LogRow> } }[] }>(
    token,
    "financial_account.v1.FinancialAccountService/FinancialAccountLogList",
    { teamId, filter: { accountId }, dataRequest: ["FINANCIAL_ACCOUNT_LOG_LIST_DATA_TYPE_LOG"], page: { page: 1, limit: 50 } },
  );
  const rows: LogRow[] = [];
  for (const item of res.items ?? []) rows.push(...Object.values(item.log?.mapData ?? {}));

  return rows.sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : BigInt(b.id) < BigInt(a.id) ? -1 : 0));
}

const adjustmentsOf = async (token: string, teamId: string, accountId: string) =>
  (await rowsOf(token, teamId, accountId)).filter((r) => r.changeType === ADJUSTMENT);

/** The account ids of the team's list, filtered as `filter`, asked as `token`. */
async function listIds(token: string, teamId: string, filter: Record<string, unknown>): Promise<string[]> {
  const res = await call<{ ids?: string[] }>(token, "financial_account.v1.FinancialAccountService/FinancialAccountList", {
    teamId,
    filter,
    dataRequest: ["FINANCIAL_ACCOUNT_LIST_DATA_TYPE_ACCOUNT"],
    page: { page: 1, limit: 200 },
  });

  return (res.ids ?? []).map(String);
}

const KIND = {
  bank: { type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT", provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA" },
  cash: { type: "FINANCIAL_ACCOUNT_TYPE_CASH", provider: "FINANCIAL_ACCOUNT_PROVIDER_CASH" },
} as const;

/** An account of the team's, opened on `on` (today by default) at `opening`. */
async function account(teamId: string, name: string, number: string, opening: number, kind: keyof typeof KIND, on = today()) {
  const res = await asRoot<{ account: { id: string } }>("financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
    teamId,
    ...KIND[kind],
    name,
    holderName: "E2E",
    ...(number ? { accountNumber: number } : {}),
    openingBalance: opening,
    openingOn: on,
  });

  return String(res.account.id);
}

// A Pub/Sub push as the broker delivers it to a listener's route.
function pushBody(eventType: string, subscription: string, event: Record<string, unknown>) {
  return {
    message: {
      data: Buffer.from(JSON.stringify(event)).toString("base64"),
      attributes: { event_type: `warehouse.events.v1.${eventType}` },
      messageId: `${String(event.eventId)}-${Date.now()}`,
    },
    subscription: `projects/warehouse-dev/subscriptions/${subscription}`,
  };
}

// Settlement's withdrawal row for `shopId` (negative there: money arriving at the account the shop withdraws into —
// here none, so an unknown one is made).
async function pushWithdrawal(eventId: string, teamId: string, shopId: string, change: number) {
  const res = await fetch(`${API_URL}/event/financial-account-withdrawal/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      pushBody("SettlementLogPosted", "financial-account-withdrawal", {
        eventId,
        occurredAt: new Date().toISOString(),
        aggregateId: `settlement-log:${eventId}`,
        settlementLogPosted: {
          teamId,
          shopId,
          settlementType: "SETTLEMENT_TYPE_WITHDRAWAL",
          sourceType: "SOURCE_TYPE_IMPORTER",
          change: String(change),
          postedOn: today(),
          occurredOn: today(),
        },
      }),
    ),
  });
  expect(res.status, `withdrawal push ${eventId}`).toBe(200);
}

// ── the ground ───────────────────────────────────────────────────────────────────────────────────────────────────────

test.describe.configure({ timeout: 120_000 });

test.beforeAll(async () => {
  test.setTimeout(300_000);

  for (const s of SIDES) {
    const team = await asRoot<{ team: { id: string } }>("team.v1.TeamService/TeamCreate", {
      name: teamName(s),
      teamCode: `MB${tag(s)}${SUFFIX}`,
      type: s === "selling" ? "TEAM_TYPE_SELLING" : "TEAM_TYPE_WAREHOUSE",
      ownerUserId: ROOT_USER_ID,
    });
    const teamId = String(team.team.id);
    ground.team[s] = teamId;

    for (const r of EVERYONE.filter((x) => x.side === s)) {
      await asRoot("user.v1.UserService/CreateUser", {
        teamId,
        username: username(r.key),
        password: PASSWORD,
        name: `Match ${r.given} ${SUFFIX}`,
        role: r.role,
      });
    }

    // Given 6's transfers go here — nobody reads it.
    ground.sink[s] = await account(teamId, `E2E Sink ${s} ${SUFFIX}`, `E2E-MBAL-SINK-${tag(s)}-${SUFFIX}`, 0, "bank");

    // Given 8's unknown account: a withdrawal of a shop that names no account (the ⚠ above for the warehouse).
    let shop = ORPHAN_SHOP;
    if (s === "selling") {
      shop = String(
        (
          await asRoot<{ shop: { id: string } }>("selling.v1.ShopService/ShopCreate", {
            teamId,
            name: MELATI,
            shopCode: `MBM${SUFFIX}`,
            marketplace: "MARKETPLACE_SHOPEE",
          })
        ).shop.id,
      );
    }
    await pushWithdrawal(`e2e-mbal-melati-${tag(s)}-${SUFFIX}`, teamId, shop, -MELATI_WITHDRAWAL);
    await expect
      .poll(async () => (await listIds(await root(), teamId, { types: ["FINANCIAL_ACCOUNT_TYPE_UNKNOWN"] }))[0] ?? "", {
        timeout: 30_000,
        message: `${s}'s unknown account`,
      })
      .not.toBe("");
    ground.unknown[s] = (await listIds(await root(), teamId, { types: ["FINANCIAL_ACCOUNT_TYPE_UNKNOWN"] }))[0]!;
  }

  // Per matching role, each given's own account.
  for (const r of MATCHERS) {
    const teamId = ground.team[r.side];
    for (const g of [1, 2, 3, 4]) {
      ground.acct[slot(g, r)] = await account(teamId, bcaName(g, r.key), numberOf(g, r.key), BOOKS, "bank");
    }
    ground.acct[slot(5, r)] = await account(teamId, cashName(r.key), "", CASH_BOOKS, "cash");
    // Given 6: opened at Rp 0, then Rp 50.000 out — a top-up not recorded yet leaves the books at −Rp 50.000.
    ground.acct[slot(6, r)] = await account(teamId, bcaName(6, r.key), numberOf(6, r.key), 0, "bank");
    await asRoot(TRANSFER_RPC, {
      teamId,
      fromAccountId: ground.acct[slot(6, r)],
      toAccountId: ground.sink[r.side],
      amount: BELOW,
      occurredOn: today(),
      note: "E2E — paid before the top-up was recorded",
    });
    // Given 7: open since the 1st of the month the bank app is read in.
    ground.acct[slot(7, r)] = await account(teamId, bcaName(7, r.key), numberOf(7, r.key), BOOKS, "bank", NOV1);
  }

  // Given 9: a BCA per refused role.
  for (const r of LOOKERS) {
    ground.acct[slot(9, r)] = await account(ground.team[r.side], bcaName(9, r.key), numberOf(9, r.key), BOOKS, "bank");
  }
});

// ── the screen ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Signed in as the role, in its side's team, on the account's page. */
async function openAccount(page: Page, r: Role, accountId: string, name: string) {
  await signInAs(page, username(r.key), PASSWORD, ground.team[r.side]);
  await page.goto(`/financial-accounts/${accountId}`);
  await expect(page.getByTestId("team-switcher")).toContainText(teamName(r.side));
  await expect(page.getByTestId("account-name-heading")).toHaveText(name);
}

/** THE WHEN's door: Match Balance on the account, the dialog open with the books loaded. */
async function openMatch(page: Page, accountId: string, books: number): Promise<Locator> {
  await page.getByTestId(`account-reconcile-button-${accountId}`).click();
  const dialog = page.getByTestId("reconcile");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("reconcile-books")).toHaveText(rp(books));

  return dialog;
}

type Answer = { difference?: number; log?: LogRow; reconciledAt?: string };

/** Match pressed — the answer awaited (200), the dialog closed. */
async function save(page: Page): Promise<Answer> {
  const answered = page.waitForResponse((res) => res.url().endsWith(`/warehouse.${RECONCILE_RPC}`));
  await page.getByTestId("reconcile-save").click();
  const res = await answered;
  expect(res.status()).toBe(200);
  await expect(page.getByTestId("reconcile")).toBeHidden();

  return (await res.json()) as Answer;
}

/** The page's Last checked card reads today (as the app prints a date) — and the answer stamped today. */
async function checkedToday(page: Page, answer: Answer) {
  expect(jakartaDay(answer.reconciledAt), "the reconcile's stamp").toBe(today());
  await expect(page.getByTestId("account-detail-checked")).not.toHaveText("Never checked");
  const todayLabel = await page.evaluate(() =>
    new Date().toLocaleDateString(document.documentElement.lang || undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "Asia/Jakarta",
    }),
  );
  await expect(page.getByTestId("account-detail-checked-card")).toContainText(todayLabel);
}

/** A statement row's cells: Date · Type · Description · Change · Balance. */
const cellsOf = (page: Page, logId: string) => page.getByTestId(`account-log-row-${logId}`).locator("td");

const statementRows = (page: Page) => page.locator('[data-testid^="account-log-row-"]');

const toast = (page: Page, text: string) =>
  page.locator('[data-scope="toast"][data-part="root"]').filter({ hasText: text });

/** The one adjustment the reconcile posted, read back under the role's own token and on the page. */
async function oneAdjustment(page: Page, token: string, teamId: string, accountId: string, change: number, why: string) {
  const adjustments = await adjustmentsOf(token, teamId, accountId);
  expect(adjustments).toHaveLength(1);
  const row = adjustments[0]!;
  expect(row.change).toBe(change);
  expect(row.description ?? "").toContain(why);
  const cells = cellsOf(page, row.id);
  await expect(cells.nth(1)).toHaveText("Adjustment");
  await expect(cells.nth(2)).toContainText(why);
  await expect(cells.nth(3)).toHaveText(change > 0 ? `+${rp(change)}` : rp(change));

  return row;
}

// ── 1 · the books agree ──────────────────────────────────────────────────────────────────────────────────────────────

test.describe(`selling owner · admin · warehouse owner · admin wants the books to match the bank (${C1})`, () => {
  for (const r of MATCHERS) {
    test(`${r.given} match balance (${C1})`, async ({ page }) => {
      const id = ground.acct[slot(1, r)]!;
      const name = bcaName(1, r.key);
      const teamId = ground.team[r.side];
      const token = await tokenOf(username(r.key), PASSWORD);

      // The given: BCA's books at Rp 1.000.000, never checked.
      await openAccount(page, r, id, name);
      await expect(page.getByTestId("account-detail-balance")).toHaveText(rp(BOOKS));
      await expect(page.getByTestId("account-detail-checked")).toHaveText("Never checked");
      const before = await rowsOf(token, teamId, id);
      await expect(statementRows(page)).toHaveCount(before.length);

      // The WHEN: Match Balance, the bank app's Rp 1.000.000 typed.
      const dialog = await openMatch(page, id, BOOKS);
      await test.step("regression: a bank account asks what the bank app shows", async () => {
        await expect(dialog.getByText(BANK_LABEL)).toBeVisible();
      });
      await dialog.getByTestId("reconcile-actual").fill(String(BOOKS));

      let answer: Answer = {};
      await test.step("then: says the books agree", async () => {
        await expect(dialog.getByTestId("reconcile-difference")).toHaveText(
          "The books agree — nothing is posted, the account is marked checked.",
        );
        // No reason is asked for when they agree: Match is offered with the note empty.
        await expect(dialog.getByTestId("reconcile-save")).toBeEnabled();
        answer = await save(page);
        await expect(toast(page, `${name} checked — the books agree`)).toBeVisible();
      });

      await test.step("then: nothing posted", async () => {
        expect(answer.difference ?? 0).toBe(0);
        expect(answer.log).toBeUndefined();
        const after = await rowsOf(token, teamId, id);
        expect(after.map((x) => x.id)).toEqual(before.map((x) => x.id));
        await expect(page.getByTestId("account-detail-balance")).toHaveText(rp(BOOKS));
        await expect(statementRows(page)).toHaveCount(before.length);
      });

      await test.step("then: last checked today", async () => {
        await checkedToday(page, answer);
      });
    });
  }
});

// ── 2 · the bank shows Rp 10.000 less — "bank fee" ───────────────────────────────────────────────────────────────────

test.describe(`selling owner · admin · warehouse owner · admin wants the books to match the bank (${C2})`, () => {
  for (const r of MATCHERS) {
    test(`${r.given} match balance (${C2})`, async ({ page }) => {
      const id = ground.acct[slot(2, r)]!;
      const name = bcaName(2, r.key);
      const teamId = ground.team[r.side];
      const token = await tokenOf(username(r.key), PASSWORD);

      await openAccount(page, r, id, name);
      await expect(page.getByTestId("account-detail-balance")).toHaveText(rp(BOOKS));

      // The WHEN: Match Balance, Rp 990.000 typed, the reason "bank fee".
      const dialog = await openMatch(page, id, BOOKS);
      await dialog.getByTestId("reconcile-actual").fill("990000");

      await test.step("then: difference −Rp 10.000 shown before saving", async () => {
        await expect(dialog.getByTestId("reconcile-difference")).toHaveText(`Difference ${rp(-10_000)} — posted as an adjustment.`);
        // Shown, not posted: nothing is in the statement until Match is pressed.
        expect(await adjustmentsOf(token, teamId, id)).toHaveLength(0);
      });

      await dialog.getByTestId("reconcile-note").fill("bank fee");
      const answer = await save(page);

      await test.step("then: adjustment −Rp 10.000 posted with the reason", async () => {
        expect(answer.difference).toBe(-10_000);
        const row = await oneAdjustment(page, token, teamId, id, -10_000, "bank fee");
        expect(row.balanceAfter).toBe(990_000);
        expect(answer.log?.id).toBe(row.id);
      });

      await test.step("then: BCA Rp 990.000, last checked today", async () => {
        await expect(page.getByTestId("account-detail-balance")).toHaveText(rp(990_000));
        await checkedToday(page, answer);
      });

      await test.step("then: recorded in finance analytic metric", async () => {
        // Analytic › Account changes by account over the last 7 days, narrowed to this BCA: its adjustment column
        // (re-read until the figure lands).
        await expect(async () => {
          await page.goto(`/analytic?g=account&m=${CHANGES}&r=7d&acc=${id}`);
          await expect(page.getByTestId(`analytic-cell-${id}-adjustment`)).toHaveText(rp(-10_000), { timeout: 3_000 });
        }).toPass({ timeout: 40_000 });
        await expect(page.getByTestId(`analytic-row-${id}`)).toContainText(name);
      });
    });
  }
});

// ── 3 · the bank shows Rp 50.000 more — "transfer in not recorded" ───────────────────────────────────────────────────

test.describe(`selling owner · admin · warehouse owner · admin wants the books to match the bank (${C3})`, () => {
  for (const r of MATCHERS) {
    test(`${r.given} match balance (${C3})`, async ({ page }) => {
      const id = ground.acct[slot(3, r)]!;
      const teamId = ground.team[r.side];
      const token = await tokenOf(username(r.key), PASSWORD);

      await openAccount(page, r, id, bcaName(3, r.key));

      // The WHEN: Match Balance, Rp 1.050.000 typed, the reason "transfer in not recorded".
      const dialog = await openMatch(page, id, BOOKS);
      await dialog.getByTestId("reconcile-actual").fill("1050000");
      await expect(dialog.getByTestId("reconcile-difference")).toHaveText(`Difference +${rp(50_000)} — posted as an adjustment.`);
      await dialog.getByTestId("reconcile-note").fill("transfer in not recorded");
      const answer = await save(page);

      await test.step("then: adjustment +Rp 50.000, BCA Rp 1.050.000", async () => {
        expect(answer.difference).toBe(50_000);
        const row = await oneAdjustment(page, token, teamId, id, 50_000, "transfer in not recorded");
        expect(row.balanceAfter).toBe(1_050_000);
        await expect(page.getByTestId("account-detail-balance")).toHaveText(rp(1_050_000));
      });
    });
  }
});

// ── 4 · a difference with no reason ──────────────────────────────────────────────────────────────────────────────────

test.describe(`selling owner · admin · warehouse owner · admin wants the books to match the bank (${C4})`, () => {
  for (const r of MATCHERS) {
    test(`${r.given} match balance (${C4})`, async ({ page }) => {
      const id = ground.acct[slot(4, r)]!;
      const teamId = ground.team[r.side];
      const token = await tokenOf(username(r.key), PASSWORD);

      await openAccount(page, r, id, bcaName(4, r.key));

      // The WHEN: Match Balance, Rp 990.000 typed, no reason.
      const dialog = await openMatch(page, id, BOOKS);
      await dialog.getByTestId("reconcile-actual").fill("990000");
      await expect(dialog.getByTestId("reconcile-difference")).toHaveText(`Difference ${rp(-10_000)} — posted as an adjustment.`);

      await test.step("then: cannot match, says a reason is needed", async () => {
        const note = dialog.getByTestId("reconcile-note");
        await expect(dialog.getByTestId("reconcile-save")).toBeDisabled();
        // The reason field is required now, and says why.
        await expect
          .poll(() => note.evaluate((el) => (el as HTMLTextAreaElement).required || el.getAttribute("aria-required") === "true"))
          .toBe(true);
        await expect(dialog.getByText("Needed when there is a difference — it is the one row that can hide missing cash.")).toBeVisible();
        // Blank space is no reason either; a reason typed is what opens Match.
        await note.fill("   ");
        await expect(dialog.getByTestId("reconcile-save")).toBeDisabled();
        await note.fill("bank fee");
        await expect(dialog.getByTestId("reconcile-save")).toBeEnabled();
        await note.fill("");
        await expect(dialog.getByTestId("reconcile-save")).toBeDisabled();
        // Sent anyway, under the role's own token, the server refuses it — and nothing is posted.
        const refused = await send(token, RECONCILE_RPC, { teamId, accountId: id, actualBalance: 990_000, asOf: today(), note: "" });
        expect(refused.status, refused.text).toBe(400);
        expect(refused.text).toContain("say why the books and the bank differ");
        expect(await adjustmentsOf(token, teamId, id)).toHaveLength(0);
      });

      await test.step("regression: the books and the last check stay as they were", async () => {
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        await expect(page.getByTestId("account-detail-balance")).toHaveText(rp(BOOKS));
        await expect(page.getByTestId("account-detail-checked")).toHaveText("Never checked");
      });
    });
  }
});

// ── 5 · a cash box ───────────────────────────────────────────────────────────────────────────────────────────────────

test.describe(`selling owner · admin · warehouse owner · admin wants the books to match the bank (${C5})`, () => {
  for (const r of MATCHERS) {
    test(`${r.given} match balance (${C5})`, async ({ page }) => {
      const id = ground.acct[slot(5, r)]!;
      const teamId = ground.team[r.side];
      const token = await tokenOf(username(r.key), PASSWORD);

      await openAccount(page, r, id, cashName(r.key));
      await expect(page.getByTestId("account-detail-balance")).toHaveText(rp(CASH_BOOKS));

      // The WHEN: Match Balance on the cash box.
      const dialog = await openMatch(page, id, CASH_BOOKS);

      await test.step("then: asks what the box counts, not the bank", async () => {
        await expect(dialog.getByText(BOX_LABEL)).toBeVisible();
        await expect(dialog.getByText(BANK_LABEL)).toHaveCount(0);
      });

      // Rp 480.000 counted, the reason "change given out".
      await dialog.getByTestId("reconcile-actual").fill("480000");
      await dialog.getByTestId("reconcile-note").fill("change given out");
      const answer = await save(page);

      await test.step("then: adjustment −Rp 20.000", async () => {
        expect(answer.difference).toBe(-20_000);
        const row = await oneAdjustment(page, token, teamId, id, -20_000, "change given out");
        expect(row.description ?? "").toContain("the box counted");
        expect(row.balanceAfter).toBe(480_000);
        await expect(page.getByTestId("account-detail-balance")).toHaveText(rp(480_000));
      });
    });
  }
});

// ── 6 · below zero, matched from its row ─────────────────────────────────────────────────────────────────────────────

test.describe(`selling owner · admin · warehouse owner · admin wants the books to match the bank (${C6})`, () => {
  for (const r of MATCHERS) {
    test(`${r.given} match balance (${C6})`, async ({ page }) => {
      const id = ground.acct[slot(6, r)]!;
      const name = bcaName(6, r.key);
      const teamId = ground.team[r.side];
      const token = await tokenOf(username(r.key), PASSWORD);

      // The given: on the Akun list (narrowed to this BCA), its row reads −Rp 50.000, marked below zero.
      await signInAs(page, username(r.key), PASSWORD, teamId);
      await page.goto(`/financial-accounts?q=${encodeURIComponent(name)}`);
      await expect(page.getByTestId("team-switcher")).toContainText(teamName(r.side));
      const row = page.getByTestId(`account-row-${id}`);
      await expect(row).toBeVisible();
      const balance = page.getByTestId(`account-balance-${id}`);
      await expect(balance).toContainText(rp(-BELOW));
      await expect(balance).toHaveAttribute("data-below-zero");
      await expect(page.getByTestId(`account-balance-${id}-below-zero`)).toBeVisible();

      // The WHEN: Match Balance on its row, the bank app's Rp 0, the reason "top-up recorded late".
      await row.getByTestId(`account-reconcile-button-${id}`).click();
      const dialog = page.getByTestId("reconcile");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByTestId("reconcile-books")).toHaveText(rp(-BELOW));
      await dialog.getByTestId("reconcile-actual").fill("0");
      await expect(dialog.getByTestId("reconcile-difference")).toHaveText(`Difference +${rp(BELOW)} — posted as an adjustment.`);
      await dialog.getByTestId("reconcile-note").fill("top-up recorded late");
      const answer = await save(page);

      await test.step("then: adjustment +Rp 50.000", async () => {
        expect(answer.difference).toBe(BELOW);
        const adjustments = await adjustmentsOf(token, teamId, id);
        expect(adjustments).toHaveLength(1);
        expect(adjustments[0]!.change).toBe(BELOW);
        expect(adjustments[0]!.balanceAfter ?? 0).toBe(0); // proto3 JSON drops a zero
        expect(adjustments[0]!.description ?? "").toContain("top-up recorded late");
      });

      await test.step('then: "below zero" gone from its row', async () => {
        await expect(balance).toHaveText(rp(0));
        await expect(balance).not.toHaveAttribute("data-below-zero");
        await expect(page.getByTestId(`account-balance-${id}-below-zero`)).toHaveCount(0);
      });
    });
  }
});

// ── 7 · the bank app read on 3 Nov ───────────────────────────────────────────────────────────────────────────────────

test.describe(`selling owner · admin · warehouse owner · admin wants the books to match the bank (${C7})`, () => {
  for (const r of MATCHERS) {
    test(`${r.given} match balance (${C7})`, async ({ page }) => {
      const id = ground.acct[slot(7, r)]!;
      const teamId = ground.team[r.side];
      const token = await tokenOf(username(r.key), PASSWORD);

      await openAccount(page, r, id, bcaName(7, r.key));

      // The WHEN: Match Balance, a difference (Rp 980.000 against Rp 1.000.000, "bank fee"), read on 3 Nov — picked on
      // the calendar.
      const dialog = await openMatch(page, id, BOOKS);
      await dialog.getByTestId("reconcile-actual").fill("980000");
      await dialog.getByTestId("reconcile-note").fill("bank fee");
      const trigger = dialog.getByTestId("reconcile-as-of");
      const todayLabel = (await trigger.innerText()).trim();
      await trigger.click();
      const content = page.getByTestId("reconcile-as-of-content");
      await expect(content).toBeVisible();
      for (let i = 0; i < MONTHS_BACK; i++) {
        await content.locator('[data-part="prev-trigger"]').filter({ visible: true }).click();
      }
      await content.locator(`[data-part="table-cell-trigger"][data-value="${NOV3}"]:not([data-outside-range])`).filter({ visible: true }).click();
      await expect(content).toBeHidden();
      await expect(trigger).not.toHaveText(todayLabel);
      const nov3Label = (await trigger.innerText()).trim();
      const answer = await save(page);

      await test.step("then: the adjustment row on 3 Nov", async () => {
        const adjustments = await adjustmentsOf(token, teamId, id);
        expect(adjustments).toHaveLength(1);
        expect(adjustments[0]!.change).toBe(-20_000);
        expect(jakartaDay(adjustments[0]!.occurredAt), "the adjustment's day").toBe(NOV3);
        expect(answer.log?.id).toBe(adjustments[0]!.id);
        // On the page the row's date is 3 Nov, as the picker wrote it.
        const cells = cellsOf(page, adjustments[0]!.id);
        await expect(cells.nth(0).locator("p").first()).toHaveText(nov3Label);
        await expect(cells.nth(1)).toHaveText("Adjustment");
        await expect(cells.nth(3)).toHaveText(rp(-20_000));
      });
    });
  }
});

// ── 8 · an unknown account (Melati's withdrawal) ─────────────────────────────────────────────────────────────────────

const THEN8 = "then: no Match Balance on the unknown account, only Set Account, Transfer Out and Archive";

/** The given: the side's unknown account, made by Melati's withdrawal (Rp 300.000 in it), its page open. */
async function openUnknown(page: Page, r: Role, token: string) {
  const unknown = ground.unknown[r.side];
  expect(await listIds(token, ground.team[r.side], { types: ["FINANCIAL_ACCOUNT_TYPE_UNKNOWN"] })).toContain(unknown);
  await openAccount(page, r, unknown, shownUnknown(r.side));
  await expect(page.getByTestId("account-unknown-explained")).toBeVisible();
  await expect(page.getByTestId("account-detail-balance")).toHaveText(rp(MELATI_WITHDRAWAL));

  return unknown;
}

/** No Match Balance — not on the page, not in its menu — and the server refuses one under the role's own token. */
async function noMatchBalance(page: Page, r: Role, token: string, unknown: string) {
  await expect(page.getByTestId(`account-reconcile-button-${unknown}`)).toHaveCount(0);
  const refused = await send(token, RECONCILE_RPC, {
    teamId: ground.team[r.side],
    accountId: unknown,
    actualBalance: MELATI_WITHDRAWAL,
    asOf: today(),
    note: "",
  });
  expect(refused.status, refused.text).toBe(400);
  expect(refused.text).toContain("an unknown account has no statement to read");
}

/** The account's menu: exactly Set Account and Archive (Archive offered, disabled above zero). */
async function menuSetAccountAndArchive(page: Page, unknown: string) {
  await page.getByTestId(`account-actions-${unknown}`).click();
  await expect(page.getByTestId(`account-identify-${unknown}`)).toBeVisible();
  await expect(page.getByTestId(`account-identify-${unknown}`)).toContainText("Set Account");
  await expect(page.getByTestId(`account-archive-${unknown}`)).toBeVisible();
  await expect(page.getByTestId(`account-archive-${unknown}`)).toContainText("Archive");
  await expect(page.getByTestId(`account-reconcile-${unknown}`)).toHaveCount(0);
  await expect(page.locator(`[role="menuitem"][data-testid$="-${unknown}"]`)).toHaveCount(2);
  await page.keyboard.press("Escape");
}

test.describe(`selling owner · admin · warehouse owner · admin wants the books to match the bank (${C8})`, () => {
  for (const r of MOVERS) {
    test(`${r.given} match balance (${C8})`, async ({ page }) => {
      const token = await tokenOf(username(r.key), PASSWORD);
      const unknown = await openUnknown(page, r, token);

      // The WHEN: looking for Match Balance on the unknown account.
      await test.step(THEN8, async () => {
        await noMatchBalance(page, r, token, unknown);
        await expect(page.getByTestId(`account-transfer-button-${unknown}`)).toBeVisible();
        await expect(page.getByTestId(`account-transfer-button-${unknown}`)).toHaveText(/Transfer Out/);
        await menuSetAccountAndArchive(page, unknown);
      });
    });
  }

  // What IS built for the warehouse Admin: no Match Balance, Set Account and Archive — and no Transfer Out, since it moves
  // no money (the-warehouse-admin-equals-the-owner-except-money).
  test(`${WADMIN.given} match balance, what the warehouse admin is offered (${C8})`, async ({ page }) => {
    const token = await tokenOf(username(WADMIN.key), PASSWORD);
    const unknown = await openUnknown(page, WADMIN, token);

    await test.step("regression: no Match Balance on the unknown account, Set Account and Archive in its menu, no Transfer Out", async () => {
      await noMatchBalance(page, WADMIN, token, unknown);
      await expect(page.getByTestId(`account-transfer-button-${unknown}`)).toHaveCount(0);
      await menuSetAccountAndArchive(page, unknown);
    });
  });

  // The then read literally for the warehouse Admin: Transfer Out is not there.
  test(`${WADMIN.given} match balance (${C8})`, async ({ page }) => {
    test.fail(
      true,
      "conflict: the-warehouse-admin-equals-the-owner-except-money — a warehouse Admin moves no money, so an unknown account " +
        "offers it no Transfer Out (transfer.md given 9: no Transfer); the then names Transfer Out for every role — asked of the owner",
    );
    const token = await tokenOf(username(WADMIN.key), PASSWORD);
    const unknown = await openUnknown(page, WADMIN, token);

    await test.step(THEN8, async () => {
      await noMatchBalance(page, WADMIN, token, unknown);
      await expect(page.getByTestId(`account-transfer-button-${unknown}`)).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId(`account-transfer-button-${unknown}`)).toHaveText(/Transfer Out/);
      await menuSetAccountAndArchive(page, unknown);
    });
  });
});

// ── 9 · selling CS and warehouse Staff only read ─────────────────────────────────────────────────────────────────────

test.describe(`selling cs · warehouse staff wants the books to match the bank (${C9})`, () => {
  for (const r of LOOKERS) {
    test(`${r.given} match balance (${C9})`, async ({ page }) => {
      const id = ground.acct[slot(9, r)]!;
      const name = bcaName(9, r.key);
      const teamId = ground.team[r.side];
      const token = await tokenOf(username(r.key), PASSWORD);

      // The given: the account's page, BCA at Rp 1.000.000.
      await openAccount(page, r, id, name);
      await expect(page.getByTestId("account-detail-balance")).toHaveText(rp(BOOKS));

      await test.step("then: no Match Balance button on the account", async () => {
        await expect(page.getByTestId(`account-reconcile-button-${id}`)).toHaveCount(0);
        // No actions at all — not behind a menu either.
        await expect(page.getByTestId(`account-actions-${id}`)).toHaveCount(0);
        // Nor on its row of the Akun list.
        await page.goto(`/financial-accounts?q=${encodeURIComponent(name)}`);
        await expect(page.getByTestId(`account-row-${id}`)).toBeVisible();
        await expect(page.getByTestId(`account-balance-${id}`)).toContainText(rp(BOOKS));
        await expect(page.getByTestId(`account-reconcile-button-${id}`)).toHaveCount(0);
        await expect(page.getByTestId(`account-actions-${id}`)).toHaveCount(0);
      });

      await test.step(`regression: the server refuses the ${r.given.replace(":", " ")}'s match balance`, async () => {
        const refused = await send(token, RECONCILE_RPC, { teamId, accountId: id, actualBalance: 990_000, asOf: today(), note: "bank fee" });
        expect(refused.status, refused.text).toBe(403);
        expect(await adjustmentsOf(token, teamId, id)).toHaveLength(0);
      });
    });
  }
});
