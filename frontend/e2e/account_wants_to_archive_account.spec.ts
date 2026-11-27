import { expect, test } from "@playwright/test";
import type { Page, Response } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { API_URL } from "./env";
import { SUFFIX, api, login } from "./restock_helpers";

// An owner or an admin of either team type wants to close an account — the check behind
// docs/acceptances/financial_account/account.md, section *accounts*, when *archive account* (givens 12–13).
// Both givens name selling:owner · selling:admin · warehouse:owner · warehouse:admin: one test per role and given,
// each signed in as a person of that role, in a team of its OWN (an-account-is-archived-only-at-zero: an account
// is archived only when its balance is zero — the money is moved out, or found missing, first).
//
//   12 (active bank BCA · balance Rp 0) — BCA Tutup, opened at Rp 100.000 and emptied by a transfer to BCA Utama,
//      so it has a history to keep. The row's Account actions → Archive, the confirm, Archive.
//      then: gone from the list and every account picker, its history kept —
//            · the list: no row after a reload; the Archived view lists it, badged
//            · the pickers: every FinancialAccountSelect reads ONE feed (useFinancialAccountOptions →
//              FinancialAccountList, all accounts or operational only — a restock's and an expense's Paid from).
//              BCA Tutup was marked operational, so BOTH feeds offered it before the archive, asked with the
//              role's own token; after it neither does. On screen: the Transfer dialog's To (the roles that move
//              money — not the warehouse Admin, the-warehouse-admin-equals-the-owner-except-money) and the
//              unknown account's "Which account is this?" → Move into picker (every one of the four roles) offer
//              the team's other accounts and not BCA Tutup
//            · its history: the account's own page still opens, Archived, Rp 0, both rows — the opening balance
//              and the transfer to BCA Utama
//   13 (active bank BCA · balance Rp 100.000) — BCA Simpanan, opened at Rp 100.000. The row's Account actions.
//      then: not offered, says only at zero — the Archive item is there, disabled, reading "only at zero", and a
//            click on it opens no confirm; the same on the account's own page. A `regression:` step: the server
//            refuses the archive under the role's token (failed_precondition) and the account stays active.
//
// The ground (root, once): a team per role, a person of that role made in it, and in it BCA Tutup (Rp 100.000 →
// transferred to BCA Utama, both marked operational), BCA Simpanan (Rp 100.000), and an unknown account made by a
// withdrawal pushed for a shop that names no account.

const PASSWORD = "e2e-acct-archive-pass-1";
type Side = "selling" | "warehouse";
type Role = { given: string; role: string; key: string; side: Side; n: number; transfers: boolean };
// n: the role's digit in its team code and account numbers. transfers: offered Transfer (canTransferMoney).
const MANAGERS: Role[] = [
  { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "sown", side: "selling", n: 1, transfers: true },
  { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "sadm", side: "selling", n: 2, transfers: true },
  { given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", key: "wown", side: "warehouse", n: 3, transfers: true },
  { given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", key: "wadm", side: "warehouse", n: 4, transfers: false },
];

// The givens' case texts, verbatim from account.md — the marking script finds the tests by them.
const C12 = "active bank BCA · balance Rp 0";
const C13 = "active bank BCA · balance Rp 100.000";

// A username is lowercase letters and digits only.
const username = (r: Role) => `e2eacarch${r.key}${SUFFIX}`;
const teamName = (r: Role) => `E2E Akun Arsip ${r.key} ${SUFFIX}`;
// At most 10 characters: "AV", the role's digit, the 6-digit SUFFIX.
const teamCode = (r: Role) => `AV${r.n}${SUFFIX}`;
// Ten digits, like a BCA number: "33", the SUFFIX, the account's digit, the role's digit. Unique app-wide
// (a-real-account-is-recorded-once) — no other spec's numbers start "33".
const number = (tag: number, r: Role) => `33${SUFFIX}${tag}${r.n}`;
// A shop id no shop has: its withdrawal makes the team an unknown account (a-shop-with-no-account-gets-an-unknown-one).
const orphanShop = (r: Role) => String(9_000_000 + Number(SUFFIX.slice(-5)) * 10 + r.n);

const CLOSING = "BCA Tutup";
const MAIN = "BCA Utama";
const SAVINGS = "BCA Simpanan";

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

type Accounts = { closing: string; main: string; savings: string; unknown: string };
const ground = {
  team: {} as Record<string, string>,
  account: {} as Record<string, Accounts>,
};

// Settlement's withdrawal row, as the broker pushes it to financial_account's listener route
// (account_wants_to_open_accounts.spec.ts's withdrawal).
function withdrawal(eventId: string, teamId: string, shopId: string, change: number) {
  const event = {
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
  };

  return {
    message: {
      data: Buffer.from(JSON.stringify(event)).toString("base64"),
      attributes: { event_type: "warehouse.events.v1.SettlementLogPosted" },
      messageId: `${eventId}-${Date.now()}`,
    },
    subscription: "projects/warehouse-dev/subscriptions/financial-account-withdrawal",
  };
}

// The accounts a FinancialAccountSelect is offered — the one feed every picker reads (useFinancialAccountOptions),
// asked with the signed-in user's own token.
async function pickerFeed(page: Page, teamId: string, operationalOnly: boolean): Promise<string[]> {
  const res = (await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountList", {
    teamId,
    filter: { operationalOnly },
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

  const open = async (teamId: string, name: string, accountNumber: string, openingBalance: number) =>
    String(
      (
        await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
          teamId,
          type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
          provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
          name,
          accountNumber,
          holderName: "PT Melati",
          openingBalance,
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
      name: `Akun Arsip ${r.given} ${SUFFIX}`,
      role: r.role,
    });

    // Given 12: BCA Tutup, Rp 100.000 moved out to BCA Utama — at zero, with a history. Both marked operational,
    // so the Paid from feed offers BCA Tutup before the archive and still has BCA Utama after it.
    const closing = await open(teamId, CLOSING, number(1, r), 100_000);
    const main = await open(teamId, MAIN, number(2, r), 0);
    await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountTransfer", {
      teamId,
      fromAccountId: closing,
      toAccountId: main,
      amount: 100_000,
      occurredOn: today(),
      note: `E2E closing ${SUFFIX}`,
    });
    for (const accountId of [closing, main]) {
      await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
        teamId,
        accountId,
        operational: true,
      });
    }

    // Given 13: BCA Simpanan, still holding Rp 100.000.
    const savings = await open(teamId, SAVINGS, number(3, r), 100_000);

    // An unknown account — a shop's withdrawal with no account named — whose "Move into" picker is the one every
    // role reaches.
    const res = await page.request.post(`${API_URL}/event/financial-account-withdrawal/push`, {
      data: withdrawal(`e2e-acct-archive-${r.key}-${SUFFIX}`, teamId, orphanShop(r), -50_000),
    });
    expect(res.status(), `withdrawal push for ${r.given}`).toBe(200);
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
          unknown = String(list.ids?.[0] ?? "");

          return unknown;
        },
        { timeout: 30_000 },
      )
      .not.toBe("");

    ground.account[r.key] = { closing, main, savings, unknown };
  }

  await page.close();
});

// The role signs in, works in its own team (the active team is per tab, in sessionStorage — TeamContext), and opens
// the Akun list.
async function openAccounts(page: Page, r: Role) {
  await login(page, username(r), PASSWORD);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), ground.team[r.key]);
  await gotoAccounts(page, r);
}

async function gotoAccounts(page: Page, r: Role) {
  await page.goto("/financial-accounts");
  await expect(page.getByTestId("financial-accounts-page")).toBeVisible();
  await expect(page.getByTestId("team-switcher")).toContainText(teamName(r));
  await expect(page.getByTestId("financial-accounts-table")).toBeVisible();
}

// An open picker's options: `shown` are offered, `gone` is not — read once the offered ones have drawn, so an
// absence is never read off a list still loading.
async function pickerOffers(page: Page, testId: string, shown: string[], gone: string) {
  await page.getByTestId(testId).click();
  for (const id of shown) {
    await expect(page.getByTestId(`${testId}-option-${id}`)).toBeVisible();
  }
  await expect(page.getByTestId(`${testId}-option-${gone}`)).toHaveCount(0);
}

test.describe(`acct wants to close an account (${C12})`, () => {
  for (const r of MANAGERS) {
    test(`${r.given} archive account (${C12})`, async ({ page }) => {
      const a = ground.account[r.key];
      const teamId = ground.team[r.key];
      await openAccounts(page, r);

      // Before: both picker feeds offer BCA Tutup to this role — so its absence afterwards means something.
      expect(await pickerFeed(page, teamId, false)).toContain(a.closing);
      expect(await pickerFeed(page, teamId, true)).toContain(a.closing);

      // The given on screen: BCA Tutup active, at Rp 0.
      const row = page.getByTestId(`account-row-${a.closing}`);
      await expect(row).toContainText(CLOSING);
      await expect(page.getByTestId(`account-balance-${a.closing}`)).toHaveText("Rp 0");
      await expect(page.getByTestId(`account-archived-${a.closing}`)).toHaveCount(0);

      // The WHEN: Account actions → Archive, then the confirm.
      await page.getByTestId(`account-actions-${a.closing}`).click();
      const item = page.getByTestId(`account-archive-${a.closing}`);
      await expect(item).toBeVisible();
      await item.click();
      const confirm = page.getByRole("alertdialog", { name: `Archive ${CLOSING}` });
      await expect(confirm).toBeVisible();
      const answered = page.waitForResponse((res: Response) =>
        res.url().endsWith("FinancialAccountService/FinancialAccountArchive"),
      );
      await confirm.getByTestId("confirm-action").click();
      expect((await answered).status()).toBe(200);
      await expect(confirm).toBeHidden();

      await test.step("then: gone from the list and every account picker, its history kept", async () => {
        // The list — read afresh: BCA Utama still there, BCA Tutup gone.
        await page.reload();
        await expect(page.getByTestId("financial-accounts-table")).toBeVisible();
        await expect(page.getByTestId(`account-row-${a.main}`)).toBeVisible();
        await expect(page.getByTestId(`account-row-${a.closing}`)).toHaveCount(0);
        // …and the Archived view holds it, badged.
        await page.getByTestId("open-archived-accounts").click();
        await expect(page.getByTestId("financial-accounts-heading")).toHaveText("Archived Accounts");
        await expect(page.getByTestId(`account-row-${a.closing}`)).toBeVisible();
        await expect.soft(page.getByTestId(`account-archived-${a.closing}`)).toBeVisible();

        // Every picker's feed, with the role's token: neither the whole list nor the Paid from one offers it.
        const all = await pickerFeed(page, teamId, false);
        expect(all).not.toContain(a.closing);
        expect(all).toEqual(expect.arrayContaining([a.main, a.savings]));
        const paidFrom = await pickerFeed(page, teamId, true);
        expect(paidFrom).not.toContain(a.closing);
        expect(paidFrom).toContain(a.main);

        // On screen — the Transfer dialog's To, from BCA Utama (the roles that move money).
        if (r.transfers) {
          await gotoAccounts(page, r);
          await page.getByTestId(`account-transfer-button-${a.main}`).click();
          await expect(page.getByTestId("transfer")).toBeVisible();
          await pickerOffers(page, "transfer-to", [a.savings], a.closing);
        }

        // On screen — the unknown account's "Which account is this?" → Move into (every role).
        await gotoAccounts(page, r);
        await page.getByTestId(`account-actions-${a.unknown}`).click();
        await page.getByTestId(`account-identify-${a.unknown}`).click();
        await expect(page.getByTestId("identify")).toBeVisible();
        await page.getByTestId("identify-move").click();
        await pickerOffers(page, "identify-into", [a.main, a.savings], a.closing);

        // Its history kept: the account's own page still opens, archived at Rp 0, with both its rows.
        await page.goto(`/financial-accounts/${a.closing}`);
        await expect(page.getByTestId("account-name-heading")).toHaveText(CLOSING);
        await expect.soft(page.getByTestId("financial-account-page")).toContainText("Archived");
        await expect(page.getByTestId("account-detail-balance")).toHaveText("Rp 0");
        const logs = page.getByTestId("account-log-table").locator('[data-testid^="account-log-row-"]');
        await expect(logs).toHaveCount(2);
        await expect(logs.filter({ hasText: "Opening balance" })).toHaveCount(1);
        await expect(logs.filter({ hasText: `To ${MAIN}` })).toHaveCount(1);
      });
    });
  }
});

test.describe(`acct wants to close an account (${C13})`, () => {
  for (const r of MANAGERS) {
    test(`${r.given} archive account (${C13})`, async ({ page }) => {
      const a = ground.account[r.key];
      const teamId = ground.team[r.key];
      await openAccounts(page, r);

      // The given on screen: BCA Simpanan active, holding Rp 100.000.
      await expect(page.getByTestId(`account-row-${a.savings}`)).toContainText(SAVINGS);
      await expect(page.getByTestId(`account-balance-${a.savings}`)).toHaveText("Rp 100.000");

      // The WHEN: the row's Account actions.
      await page.getByTestId(`account-actions-${a.savings}`).click();

      await test.step("then: not offered, says only at zero", async () => {
        // On the list's row: the item is there, disabled, and says why; a click asks nothing.
        const item = page.getByTestId(`account-archive-${a.savings}`);
        await expect(item).toBeVisible();
        await expect(item).toHaveAttribute("aria-disabled", "true");
        await expect(item).toContainText("only at zero");
        await item.click({ force: true });
        await expect(page.getByRole("alertdialog")).toHaveCount(0);

        // The same on the account's own page.
        await page.goto(`/financial-accounts/${a.savings}`);
        await expect(page.getByTestId("account-name-heading")).toHaveText(SAVINGS);
        await page.getByTestId(`account-actions-${a.savings}`).click();
        const onPage = page.getByTestId(`account-archive-${a.savings}`);
        await expect(onPage).toBeVisible();
        await expect(onPage).toHaveAttribute("aria-disabled", "true");
        await expect(onPage).toContainText("only at zero");
        await onPage.click({ force: true });
        await expect(page.getByRole("alertdialog")).toHaveCount(0);
      });

      await test.step("regression: the server refuses an archive above zero, and the account stays active", async () => {
        const refused = await send(page, "financial_account.v1.FinancialAccountService/FinancialAccountArchive", {
          teamId,
          accountId: a.savings,
        });
        expect(refused.status).toBe(400);
        expect(refused.json.code).toBe("failed_precondition");
        expect(await pickerFeed(page, teamId, false)).toContain(a.savings);
      });
    });
  }
});
