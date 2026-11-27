import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { API_URL } from "./env";
import { SUFFIX, api, login } from "./restock_helpers";

// selling:all · warehouse:all wants to read an account's rows — the check behind
// docs/acceptances/financial_account/account.md, section *accounts*, when *open account* (given 20). One test per role
// of each team type (selling owner/admin/cs, warehouse owner/admin/staff), each signed in as a person of that role,
// opening the account from its row on the Akun list (/financial-accounts → /financial-accounts/<id>).
//
//   20 (bank BCA · opening Rp 500.000 · expense Rp 100.000 · withdrawal Rp 1.000.000)
//      then: each row with its type, amount and balance after: Rp 500.000, Rp 400.000, Rp 1.400.000 — the statement
//            (account-log-table) holds exactly those three rows, newest first (the-log-says-balance-after):
//            Withdrawal +Rp 1.000.000 → Rp 1.400.000 · Expense −Rp 100.000 → Rp 400.000 · Opening balance
//            +Rp 500.000 → Rp 500.000; the page's balance reads Rp 1.400.000
//   21 (bank BCA · opening, 2 expenses, 1 withdrawal · type: expense) — when *filter account rows*: on the account's
//      page, Expense picked in the statement's type filter (account-log-type-filter → account-log-type-option-1)
//      then: only the 2 expense rows — the statement narrows from four rows to the two Expense rows, newest first
//            (−Rp 50.000, −Rp 100.000); the read that answers carries the filter (`changeTypes` = [EXPENSE]), so the
//            server narrowed, not the screen. The account's withdrawal sits BETWEEN the two expenses, so the filter
//            drops a row in the middle of the statement as well as at its foot (the opening).
//
// The selling team's rows come through their real doors: the opening from FinancialAccountCreate, the expense from
// ExpenseCreate paid from the account (made operational first — an-expense-must-name-the-account-that-paid), the
// withdrawal from settlement's withdrawal row for a shop that names the account (FinancialAccountShopSet), pushed to the
// listener's route as Pub/Sub would deliver it.
//
// ⚠ A WAREHOUSE team records no expense (Pengeluaran is the selling team's — capital-joins-the-types; ExpenseCreate is
// selling owner/admin only) and owns no shop, so no withdrawal can land in its accounts. As in
// account_wants_to_open_accounts.spec.ts (given 3), the warehouse's case is seeded at the listeners, so the screen those
// roles would read is the one checked:
//   - the expense: expense_service's ExpenseCreated pushed to the expense listener's route, naming the account (the
//     listener posts by the account it names; no expense record is made);
//   - the withdrawal: from a shop id no shop has, pointed at BCA through Set Account's *Move balance* (the one door a
//     warehouse has to name where a shop withdraws — FinancialAccountShopSet refuses a shop id it cannot find). The
//     unknown account the first withdrawal makes is brought back to Rp 0 by its reversal BEFORE the move, so the move
//     posts no Transfer into BCA and BCA keeps exactly the given's three rows.
// Named in the report for the owner.
//
// The ground (root, once): one team per side (reading changes nothing, so the side's three roles share it), a person
// of every role in it, and the team's bank BCA with its three rows, each landed before the next is sent.

const PASSWORD = "e2e-acct-rows-pass-1";
type Side = "selling" | "warehouse";
const SIDES: Side[] = ["selling", "warehouse"];
const ROLES: Record<Side, { given: string; role: string; key: string }[]> = {
  selling: [
    { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "sown" },
    { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "sadm" },
    { given: "selling:cs", role: "ROLE_SELLING_CS", key: "scs" },
  ],
  warehouse: [
    { given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", key: "wown" },
    { given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", key: "wadm" },
    { given: "warehouse:staff", role: "ROLE_WAREHOUSE_STAFF", key: "wstf" },
  ],
};

// The given's case text, verbatim from account.md — the marking script finds the tests by it.
const C20 = "bank BCA · opening Rp 500.000 · expense Rp 100.000 · withdrawal Rp 1.000.000";

const C21 = "bank BCA · opening, 2 expenses, 1 withdrawal · type: expense";

const OPENING = 500_000;
const EXPENSE = 100_000;
const WITHDRAWAL = 1_000_000;

// Given 21's account, in the order its rows land: the opening, an expense, the withdrawal, the second expense.
const OPENING21 = 500_000;
const EXPENSES21 = [100_000, 50_000];
const WITHDRAWAL21 = 1_000_000;
// FINANCIAL_ACCOUNT_CHANGE_TYPE_EXPENSE — the type filter's option id is the enum's number.
const EXPENSE_TYPE = 1;

// A username is lowercase letters and digits only.
const username = (key: string) => `e2eacrows${key}${SUFFIX}`;
const teamName = (s: Side) => `E2E Akun Baris ${s} ${SUFFIX}`;
// At most 10 characters: "FR", the side's letter, the 6-digit SUFFIX.
const tag = (s: Side) => (s === "selling" ? "S" : "W");
const teamCode = (s: Side) => `FR${tag(s)}${SUFFIX}`;
const bcaName = (s: Side) => `E2E BCA Baris ${tag(s)} ${SUFFIX}`;
const MELATI = `E2E Melati Baris ${SUFFIX}`;
// The warehouse's shop: a shop id no shop has (the ⚠ above).
const ORPHAN_SHOP = String(40_000_000 + Number(SUFFIX.slice(-5)) * 10 + 1);
// The warehouse's expense: an expense id no expense has.
const ORPHAN_EXPENSE = String(40_000_000 + Number(SUFFIX.slice(-5)) * 10 + 2);
// Given 21: its own account, its own shop (Mawar), and for the warehouse its own orphan shop and expense ids.
const bca21Name = (s: Side) => `E2E BCA Jenis ${tag(s)} ${SUFFIX}`;
const MAWAR = `E2E Mawar Jenis ${SUFFIX}`;
const ORPHAN_SHOP21 = String(40_000_000 + Number(SUFFIX.slice(-5)) * 10 + 3);
const ORPHAN_EXPENSES21 = [4, 5].map((k) => String(40_000_000 + Number(SUFFIX.slice(-5)) * 10 + k));

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

// Rupiah as the app prints it: "Rp 1.400.000", "−Rp 100.000".
const rp = (n: number) => `${n < 0 ? "−" : ""}Rp ${Math.abs(n).toLocaleString("id-ID")}`;

const ground = {
  team: {} as Record<Side, string>,
  bca: {} as Record<Side, string>,
  bca21: {} as Record<Side, string>,
};

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

// Settlement's withdrawal row (account_wants_to_open_accounts.spec.ts's withdrawal): negative there, money arriving here.
async function pushWithdrawal(page: Page, eventId: string, teamId: string, shopId: string, change: number) {
  const res = await page.request.post(`${API_URL}/event/financial-account-withdrawal/push`, {
    data: pushBody("SettlementLogPosted", "financial-account-withdrawal", {
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
  });
  expect(res.status(), `withdrawal push ${eventId}`).toBe(200);
}

// expense_service's ExpenseCreated, as the broker pushes it to financial_account's expense listener (the warehouse's
// expense — the ⚠ above).
async function pushExpense(
  page: Page,
  eventId: string,
  teamId: string,
  accountId: string,
  amount: number,
  expenseId = ORPHAN_EXPENSE,
) {
  const res = await page.request.post(`${API_URL}/event/financial-account-expense-created/push`, {
    data: pushBody("ExpenseCreated", "financial-account-expense-created", {
      eventId,
      occurredAt: new Date().toISOString(),
      aggregateId: `expense:${expenseId}`,
      expenseCreated: {
        expenseId,
        teamId,
        kind: "EXPENSE_KIND_PAYROLL",
        type: "EXPENSE_TYPE_BASIC_SALARY",
        financeAccountId: accountId,
        amount,
        occurredOn: today(),
        actorId: String(ROOT_USER_ID),
      },
    }),
  });
  expect(res.status(), `expense push ${eventId}`).toBe(200);
}

type LogRow = { id: string; changeType?: string; change?: number; balanceAfter?: number };

// Every row of an account's statement, newest first, asked with the signed-in user's token.
async function rowsOf(page: Page, teamId: string, accountId: string): Promise<LogRow[]> {
  const res = (await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountLogList", {
    teamId,
    filter: { accountId },
    dataRequest: ["FINANCIAL_ACCOUNT_LOG_LIST_DATA_TYPE_LOG"],
    page: { page: 1, limit: 50 },
  })) as { ids?: string[]; items?: { log?: { mapData?: Record<string, LogRow> } }[] };
  // The rows come keyed by id (a JS object orders integer keys ascending): put them back in the statement's order,
  // newest entry first (the ids run with entry order).
  const rows: LogRow[] = [];
  for (const item of res.items ?? []) rows.push(...Object.values(item.log?.mapData ?? {}));

  return rows.sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : BigInt(b.id) < BigInt(a.id) ? -1 : 0));
}

// Waits until the account's statement holds `n` rows — each seed lands before the next is sent, so the rows keep the
// given's order.
async function rowsLanded(page: Page, teamId: string, accountId: string, n: number) {
  await expect.poll(async () => (await rowsOf(page, teamId, accountId)).length, { timeout: 30_000 }).toBe(n);
}

// The warehouse's one door to a withdrawal into `accountId` (the ⚠ above): Rp 1 from the orphan shop id makes its
// unknown account, its reversal brings that account back to Rp 0, and Set Account's Move balance then points the shop
// at `accountId` with nothing to move. `moved` holds the unknown accounts an earlier call already moved, so a second
// call never picks one of them.
async function pointOrphanShop(page: Page, teamId: string, shop: string, accountId: string, key: string, moved: Set<string>) {
  await pushWithdrawal(page, `e2e-acct-rows-w-first-${key}-${SUFFIX}`, teamId, shop, -1);
  let unknown = "";
  await expect
    .poll(
      async () => {
        const list = (await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountList", {
          teamId,
          filter: { types: ["FINANCIAL_ACCOUNT_TYPE_UNKNOWN"] },
          dataRequest: ["FINANCIAL_ACCOUNT_LIST_DATA_TYPE_ACCOUNT"],
          page: { page: 1, limit: 10 },
        })) as { ids?: string[] };
        unknown = (list.ids ?? []).map(String).find((id) => !moved.has(id)) ?? "";

        return unknown;
      },
      { timeout: 30_000 },
    )
    .not.toBe("");
  moved.add(unknown);
  await pushWithdrawal(page, `e2e-acct-rows-w-reversal-${key}-${SUFFIX}`, teamId, shop, 1);
  await rowsLanded(page, teamId, unknown, 2);
  await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountIdentify", {
    teamId,
    accountId: unknown,
    moveIntoAccountId: accountId,
  });
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  const page = await browser.newPage();
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  for (const s of SIDES) {
    // The unknown accounts this side's orphan shops made and moved (the warehouse only).
    const moved = new Set<string>();
    const team = await api(page, "team.v1.TeamService/TeamCreate", {
      name: teamName(s),
      teamCode: teamCode(s),
      type: s === "selling" ? "TEAM_TYPE_SELLING" : "TEAM_TYPE_WAREHOUSE",
      ownerUserId: ROOT_USER_ID,
    });
    const teamId = String(team.team.id);
    ground.team[s] = teamId;

    for (const r of ROLES[s]) {
      await api(page, "user.v1.UserService/CreateUser", {
        teamId,
        username: username(r.key),
        password: PASSWORD,
        name: `Akun Baris ${r.given} ${SUFFIX}`,
        role: r.role,
      });
    }

    // The opening: Rp 500.000.
    const bca = String(
      (
        await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
          teamId,
          type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
          provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
          name: bcaName(s),
          accountNumber: `E2E-AROWS-${tag(s)}-${SUFFIX}`,
          holderName: "E2E",
          openingBalance: OPENING,
          openingOn: today(),
        })
      ).account.id,
    );
    ground.bca[s] = bca;
    await rowsLanded(page, teamId, bca, 1);

    // The expense: Rp 100.000 out of BCA.
    if (s === "selling") {
      await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
        teamId,
        accountId: bca,
        operational: true,
      });
      await api(page, "expense.v1.ExpenseService/ExpenseCreate", {
        teamId,
        kind: "EXPENSE_KIND_PAYROLL",
        type: "EXPENSE_TYPE_BASIC_SALARY",
        amount: EXPENSE,
        note: `e2e account rows ${SUFFIX}`,
        financeAccountId: bca,
        occurredAt: today(),
      });
    } else {
      await pushExpense(page, `e2e-acct-rows-expense-${SUFFIX}`, teamId, bca, EXPENSE);
    }
    await rowsLanded(page, teamId, bca, 2);

    // The withdrawal: Rp 1.000.000 into BCA, from a shop that withdraws there.
    let shop = "";
    if (s === "selling") {
      shop = String(
        (
          await api(page, "selling.v1.ShopService/ShopCreate", {
            teamId,
            name: MELATI,
            shopCode: `FRM${SUFFIX}`,
            marketplace: "MARKETPLACE_SHOPEE",
          })
        ).shop.id,
      );
      await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountShopSet", {
        teamId,
        accountId: bca,
        shopId: shop,
      });
    } else {
      // The ⚠ above: the orphan shop id, pointed at BCA through Set Account's Move balance.
      shop = ORPHAN_SHOP;
      await pointOrphanShop(page, teamId, shop, bca, "20", moved);
    }
    await pushWithdrawal(page, `e2e-acct-rows-w-${tag(s)}-${SUFFIX}`, teamId, shop, -WITHDRAWAL);
    await rowsLanded(page, teamId, bca, 3);

    // The ground, as the given has it: exactly three rows — no Transfer slipped in.
    const rows = await rowsOf(page, teamId, bca);
    expect(rows.map((r) => r.changeType)).toEqual([
      "FINANCIAL_ACCOUNT_CHANGE_TYPE_WITHDRAWAL",
      "FINANCIAL_ACCOUNT_CHANGE_TYPE_EXPENSE",
      "FINANCIAL_ACCOUNT_CHANGE_TYPE_OPENING_BALANCE",
    ]);

    // Given 21's account: its opening, an expense, the withdrawal, the second expense — each landed before the next.
    const bca21 = String(
      (
        await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
          teamId,
          type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
          provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
          name: bca21Name(s),
          accountNumber: `E2E-AROWS21-${tag(s)}-${SUFFIX}`,
          holderName: "E2E",
          openingBalance: OPENING21,
          openingOn: today(),
        })
      ).account.id,
    );
    ground.bca21[s] = bca21;
    await rowsLanded(page, teamId, bca21, 1);
    if (s === "selling") {
      await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
        teamId,
        accountId: bca21,
        operational: true,
      });
    }
    const expense21 = async (i: number) => {
      if (s === "selling") {
        await api(page, "expense.v1.ExpenseService/ExpenseCreate", {
          teamId,
          kind: "EXPENSE_KIND_PAYROLL",
          type: "EXPENSE_TYPE_BASIC_SALARY",
          amount: EXPENSES21[i],
          note: `e2e account rows filter ${i + 1} ${SUFFIX}`,
          financeAccountId: bca21,
          occurredAt: today(),
        });
      } else {
        await pushExpense(page, `e2e-acct-rows21-expense-${i}-${SUFFIX}`, teamId, bca21, EXPENSES21[i], ORPHAN_EXPENSES21[i]);
      }
    };
    await expense21(0);
    await rowsLanded(page, teamId, bca21, 2);

    let shop21 = "";
    if (s === "selling") {
      shop21 = String(
        (
          await api(page, "selling.v1.ShopService/ShopCreate", {
            teamId,
            name: MAWAR,
            shopCode: `FRN${SUFFIX}`,
            marketplace: "MARKETPLACE_SHOPEE",
          })
        ).shop.id,
      );
      await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountShopSet", {
        teamId,
        accountId: bca21,
        shopId: shop21,
      });
    } else {
      shop21 = ORPHAN_SHOP21;
      await pointOrphanShop(page, teamId, shop21, bca21, "21", moved);
    }
    await pushWithdrawal(page, `e2e-acct-rows21-w-${tag(s)}-${SUFFIX}`, teamId, shop21, -WITHDRAWAL21);
    await rowsLanded(page, teamId, bca21, 3);

    await expense21(1);
    await rowsLanded(page, teamId, bca21, 4);

    // The ground, as the given has it: opening, 2 expenses, 1 withdrawal — and nothing else.
    const rows21 = await rowsOf(page, teamId, bca21);
    expect(rows21.map((r) => r.changeType)).toEqual([
      "FINANCIAL_ACCOUNT_CHANGE_TYPE_EXPENSE",
      "FINANCIAL_ACCOUNT_CHANGE_TYPE_WITHDRAWAL",
      "FINANCIAL_ACCOUNT_CHANGE_TYPE_EXPENSE",
      "FINANCIAL_ACCOUNT_CHANGE_TYPE_OPENING_BALANCE",
    ]);
  }

  await page.close();
});

// The statement's rows, as the desktop table draws them: Date · Type · Description · Change · Balance.
const logRows = (page: Page) => page.getByTestId("account-log-table").locator('[data-testid^="account-log-row-"]');

// The three rows the given names, newest first: [type, change, balance after].
const EXPECTED: [string, string, string][] = [
  ["Withdrawal", `+${rp(WITHDRAWAL)}`, rp(OPENING - EXPENSE + WITHDRAWAL)],
  ["Expense", rp(-EXPENSE), rp(OPENING - EXPENSE)],
  ["Opening balance", `+${rp(OPENING)}`, rp(OPENING)],
];

test.describe(`acct wants to read an account's rows (${C20})`, () => {
  for (const s of SIDES) {
    for (const r of ROLES[s]) {
      test(`${r.given} open account (${C20})`, async ({ page }) => {
        const bca = ground.bca[s];

        // The role signs in and works in its side's team (the active team is per tab, in sessionStorage).
        await login(page, username(r.key), PASSWORD);
        await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), ground.team[s]);
        await page.goto("/financial-accounts");
        await expect(page.getByTestId("financial-accounts-page")).toBeVisible();
        await expect(page.getByTestId("team-switcher")).toContainText(teamName(s));

        // The given on the list: bank BCA at Rp 1.400.000.
        await expect(page.getByTestId(`account-row-${bca}`)).toContainText(bcaName(s));
        await expect(page.getByTestId(`account-balance-${bca}`)).toHaveText(rp(OPENING - EXPENSE + WITHDRAWAL));

        // The WHEN: open the account from its row.
        await page.getByTestId(`account-row-${bca}`).click();
        await expect(page).toHaveURL(new RegExp(`/financial-accounts/${bca}$`));
        await expect(page.getByTestId("account-name-heading")).toHaveText(bcaName(s));

        await test.step("then: each row with its type, amount and balance after: Rp 500.000, Rp 400.000, Rp 1.400.000", async () => {
          await expect(page.getByTestId("account-detail-balance")).toHaveText(rp(OPENING - EXPENSE + WITHDRAWAL));
          await expect(logRows(page)).toHaveCount(EXPECTED.length);
          for (const [i, [type, change, balance]] of EXPECTED.entries()) {
            const cells = logRows(page).nth(i).locator("td");
            await expect(cells.nth(1), `row ${i + 1}'s type`).toHaveText(type);
            await expect(cells.nth(3), `row ${i + 1}'s amount`).toHaveText(change);
            await expect(cells.nth(4), `row ${i + 1}'s balance after`).toHaveText(balance);
          }
        });
      });
    }
  }
});

// Given 21's two expense rows as the filtered statement draws them, newest first: [type, change].
const EXPECTED21: [string, string][] = [...EXPENSES21].reverse().map((amount) => ["Expense", rp(-amount)]);

test.describe(`acct wants to read an account's rows (${C21})`, () => {
  for (const s of SIDES) {
    for (const r of ROLES[s]) {
      test(`${r.given} filter account rows (${C21})`, async ({ page }) => {
        const bca = ground.bca21[s];

        await login(page, username(r.key), PASSWORD);
        await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), ground.team[s]);
        await page.goto("/financial-accounts");
        await expect(page.getByTestId("financial-accounts-page")).toBeVisible();
        await expect(page.getByTestId("team-switcher")).toContainText(teamName(s));

        // The given on the account's page: bank BCA, its four rows (opening, 2 expenses, 1 withdrawal), every type.
        await page.getByTestId(`account-row-${bca}`).click();
        await expect(page).toHaveURL(new RegExp(`/financial-accounts/${bca}$`));
        await expect(page.getByTestId("account-name-heading")).toHaveText(bca21Name(s));
        await expect(logRows(page)).toHaveCount(4);
        await expect(logRows(page).nth(1).locator("td").nth(1)).toHaveText("Withdrawal");

        // The WHEN: Expense picked in the statement's type filter. The read that answers must carry the filter.
        const narrowed = page.waitForResponse(
          (res) =>
            res.url().endsWith("FinancialAccountService/FinancialAccountLogList") &&
            (res.request().postData() ?? "").includes(`"changeTypes":["FINANCIAL_ACCOUNT_CHANGE_TYPE_EXPENSE"]`),
        );
        await page.getByTestId("account-log-type-filter").click();
        await page.getByTestId(`account-log-type-option-${EXPENSE_TYPE}`).click();
        await page.keyboard.press("Escape");
        expect((await narrowed).status()).toBe(200);
        await expect(page.getByTestId(`account-log-type-chip-${EXPENSE_TYPE}`)).toHaveText("Expense");

        await test.step("then: only the 2 expense rows", async () => {
          await expect(logRows(page)).toHaveCount(EXPECTED21.length);
          for (const [i, [type, change]] of EXPECTED21.entries()) {
            const cells = logRows(page).nth(i).locator("td");
            await expect(cells.nth(1), `row ${i + 1}'s type`).toHaveText(type);
            await expect(cells.nth(3), `row ${i + 1}'s amount`).toHaveText(change);
          }
        });
      });
    }
  }
});
