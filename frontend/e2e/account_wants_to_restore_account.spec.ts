import { expect, test } from "@playwright/test";
import type { Page, Response } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { API_URL } from "./env";
import { SUFFIX, api, login } from "./restock_helpers";

// An owner or an admin of either team type wants to use a closed account again — the check behind
// docs/acceptances/financial_account/account.md, section *accounts*, when *restore account* (given 20).
// (Numbered 14 until hfrada's renumbering, aa6e65f6, 11-24.)
// The given names selling:owner · selling:admin · warehouse:owner · warehouse:admin: one test per role, each signed
// in as a person of that role, in a team of its OWN (open, archive, restore an account is admin and up —
// seeing-is-team-wide-moving-is-admin-and-up; archived --> active: restore, an-account-is-archived-only-at-zero).
//
//   20 (archived bank BCA · balance Rp 0) — BCA Lama, opened at Rp 100.000, emptied by a transfer to BCA Utama and
//      archived. The Archived view (`?view=archived`) lists it, badged; its row's Restore (no confirm — archiving it
//      again undoes it).
//      then: back in the list and the pickers —
//            · the list: the Archived view drops it at once; the active list, read afresh, holds it with no
//              Archived badge, at Rp 0; the Archived view asked again (its FinancialAccountList answer, archivedOnly)
//              no longer lists it
//            · the pickers: every FinancialAccountSelect reads ONE feed (useFinancialAccountOptions →
//              FinancialAccountList); asked with the role's own token it lacked BCA Lama before the restore and
//              offers it after. On screen: the Transfer dialog's To from BCA Utama (the roles that move money — not
//              the warehouse Admin, the-warehouse-admin-equals-the-owner-except-money) and the unknown account's
//              "Which account is this?" → Move into picker (every one of the four roles) offer BCA Lama again
//      A `regression:` step: the same account came back — its page, its number and both its rows (an archived
//      account keeps its number — restored, never registered again).
//
// Not pinned: the operational mark. The server's own comment says it does not come back by itself, and no
// acceptance row or business decision says either way — the account is seeded never-operational, so the Paid from
// feed (operational only) is not read here.
//
// The ground (root, once): a team per role, a person of that role made in it, and in it BCA Lama (Rp 100.000 →
// transferred to BCA Utama, then archived), BCA Utama, and an unknown account made by a withdrawal pushed for a shop
// that names no account.

const PASSWORD = "e2e-acct-restore-pass-1";
type Side = "selling" | "warehouse";
type Role = { given: string; role: string; key: string; side: Side; n: number; transfers: boolean };
// n: the role's digit in its team code and account numbers. transfers: offered Transfer (canTransferMoney).
const MANAGERS: Role[] = [
  { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "sown", side: "selling", n: 1, transfers: true },
  { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "sadm", side: "selling", n: 2, transfers: true },
  { given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", key: "wown", side: "warehouse", n: 3, transfers: true },
  { given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", key: "wadm", side: "warehouse", n: 4, transfers: false },
];

// The given's case text, verbatim from account.md — the marking script finds the tests by it.
const C14 = "archived bank BCA · balance Rp 0";

// A username is lowercase letters and digits only.
const username = (r: Role) => `e2eacrest${r.key}${SUFFIX}`;
const teamName = (r: Role) => `E2E Akun Pulih ${r.key} ${SUFFIX}`;
// At most 10 characters: "AX", the role's digit, the 6-digit SUFFIX.
const teamCode = (r: Role) => `AX${r.n}${SUFFIX}`;
// Ten digits, like a BCA number: "34", the SUFFIX, the account's digit, the role's digit. Unique app-wide
// (a-real-account-is-recorded-once) — no other spec's numbers start "34".
const number = (tag: number, r: Role) => `34${SUFFIX}${tag}${r.n}`;
// A shop id no shop has: its withdrawal makes the team an unknown account (a-shop-with-no-account-gets-an-unknown-one).
const orphanShop = (r: Role) => String(7_000_000 + Number(SUFFIX.slice(-5)) * 10 + r.n);

const OLD = "BCA Lama";
const MAIN = "BCA Utama";

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

type Accounts = { old: string; oldNumber: string; main: string; unknown: string };
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
async function pickerFeed(page: Page, teamId: string): Promise<string[]> {
  const res = (await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountList", {
    teamId,
    filter: { operationalOnly: false },
    dataRequest: ["FINANCIAL_ACCOUNT_LIST_DATA_TYPE_ACCOUNT"],
    page: { page: 1, limit: 200 },
  })) as { ids?: string[] };

  return (res.ids ?? []).map(String);
}

// The list's answer to one question: FinancialAccountList whose request carries `has`.
const listAnswer = (page: Page, has: string) =>
  page.waitForResponse(
    (r: Response) =>
      r.url().endsWith("FinancialAccountService/FinancialAccountList") &&
      (r.request().postData() ?? "").includes(has) &&
      r.ok(),
  );

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
      name: `Akun Pulih ${r.given} ${SUFFIX}`,
      role: r.role,
    });

    // Given 20: BCA Lama, Rp 100.000 moved out to BCA Utama — at zero, with a history — then archived.
    const oldNumber = number(1, r);
    const old = await open(teamId, OLD, oldNumber, 100_000);
    const main = await open(teamId, MAIN, number(2, r), 0);
    await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountTransfer", {
      teamId,
      fromAccountId: old,
      toAccountId: main,
      amount: 100_000,
      occurredOn: today(),
      note: `E2E restore ${SUFFIX}`,
    });
    await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountArchive", {
      teamId,
      accountId: old,
    });

    // An unknown account — a shop's withdrawal with no account named — whose "Move into" picker is the one every
    // role reaches.
    const res = await page.request.post(`${API_URL}/event/financial-account-withdrawal/push`, {
      data: withdrawal(`e2e-acct-restore-${r.key}-${SUFFIX}`, teamId, orphanShop(r), -50_000),
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

    ground.account[r.key] = { old, oldNumber, main, unknown };
  }

  await page.close();
});

// The role signs in and works in its own team (the active team is per tab, in sessionStorage — TeamContext).
async function signIn(page: Page, r: Role) {
  await login(page, username(r), PASSWORD);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), ground.team[r.key]);
}

async function gotoAccounts(page: Page, r: Role, view = "") {
  await page.goto(`/financial-accounts${view}`);
  await expect(page.getByTestId("financial-accounts-page")).toBeVisible();
  await expect(page.getByTestId("team-switcher")).toContainText(teamName(r));
}

// An open picker offers each of `shown` — read once they have drawn.
async function pickerShows(page: Page, testId: string, shown: string[]) {
  await page.getByTestId(testId).click();
  for (const id of shown) {
    await expect(page.getByTestId(`${testId}-option-${id}`)).toBeVisible();
  }
}

test.describe(`acct wants to use a closed account again (${C14})`, () => {
  for (const r of MANAGERS) {
    test(`${r.given} restore account (${C14})`, async ({ page }) => {
      const a = ground.account[r.key];
      const teamId = ground.team[r.key];
      await signIn(page, r);

      // The given: BCA Lama is archived — the picker feed lacks it, the active list does not show it…
      expect(await pickerFeed(page, teamId)).not.toContain(a.old);
      await gotoAccounts(page, r);
      await expect(page.getByTestId("financial-accounts-table")).toBeVisible();
      await expect(page.getByTestId(`account-row-${a.main}`)).toBeVisible();
      await expect(page.getByTestId(`account-row-${a.old}`)).toHaveCount(0);

      // …and the Archived view lists it, badged, at Rp 0.
      const archivedList = listAnswer(page, '"archivedOnly":true');
      await page.getByTestId("open-archived-accounts").click();
      await archivedList;
      await expect(page.getByTestId("financial-accounts-heading")).toHaveText("Archived Accounts");
      const row = page.getByTestId(`account-row-${a.old}`);
      await expect(row).toBeVisible();
      await expect(row).toContainText(OLD);
      await expect.soft(page.getByTestId(`account-archived-${a.old}`)).toBeVisible();
      await expect.soft(page.getByTestId(`account-balance-${a.old}`)).toHaveText("Rp 0");

      // The WHEN: the row's Restore — no confirm.
      const answered = page.waitForResponse((res: Response) =>
        res.url().endsWith("FinancialAccountService/FinancialAccountRestore"),
      );
      await page.getByTestId(`account-restore-button-${a.old}`).click();
      expect((await answered).status()).toBe(200);
      await expect(page.getByRole("alertdialog")).toHaveCount(0);

      await test.step("then: back in the list and the pickers", async () => {
        // The Archived view drops it at once (the restore re-reads the lists).
        await expect(page.getByTestId(`account-row-${a.old}`)).toHaveCount(0);

        // The active list, read afresh: BCA Lama back, not badged, at Rp 0.
        await gotoAccounts(page, r);
        await expect(page.getByTestId("financial-accounts-table")).toBeVisible();
        await expect(page.getByTestId(`account-row-${a.old}`)).toBeVisible();
        await expect(page.getByTestId(`account-row-${a.old}`)).toContainText(OLD);
        await expect(page.getByTestId(`account-archived-${a.old}`)).toHaveCount(0);
        await expect(page.getByTestId(`account-balance-${a.old}`)).toHaveText("Rp 0");
        await expect(page.getByTestId(`account-restore-button-${a.old}`)).toHaveCount(0);

        // The Archived view, asked again: the server no longer lists it there.
        const again = listAnswer(page, '"archivedOnly":true');
        await gotoAccounts(page, r, "?view=archived");
        const archivedIds = (((await (await again).json()) as { ids?: string[] }).ids ?? []).map(String);
        expect(archivedIds).not.toContain(a.old);
        await expect(page.getByTestId("financial-accounts-heading")).toHaveText("Archived Accounts");
        await expect(page.getByTestId(`account-row-${a.old}`)).toHaveCount(0);

        // Every picker's feed, with the role's token, offers it again.
        expect(await pickerFeed(page, teamId)).toEqual(expect.arrayContaining([a.old, a.main]));

        // On screen — the Transfer dialog's To, from BCA Utama (the roles that move money).
        if (r.transfers) {
          await gotoAccounts(page, r);
          await page.getByTestId(`account-transfer-button-${a.main}`).click();
          await expect(page.getByTestId("transfer")).toBeVisible();
          await pickerShows(page, "transfer-to", [a.old]);
        }

        // On screen — the unknown account's "Which account is this?" → Move into (every role).
        await gotoAccounts(page, r);
        await page.getByTestId(`account-actions-${a.unknown}`).click();
        await page.getByTestId(`account-identify-${a.unknown}`).click();
        await expect(page.getByTestId("identify")).toBeVisible();
        await page.getByTestId("identify-move").click();
        await pickerShows(page, "identify-into", [a.main, a.old]);
      });

      await test.step("regression: the same account came back — its number and its rows kept", async () => {
        await page.goto(`/financial-accounts/${a.old}`);
        await expect(page.getByTestId("account-name-heading")).toHaveText(OLD);
        await expect(page.getByTestId("financial-account-page")).toContainText(a.oldNumber);
        await expect(page.getByTestId("account-detail-balance")).toHaveText("Rp 0");
        await expect(page.getByTestId(`account-restore-button-${a.old}`)).toHaveCount(0);
        const logs = page.getByTestId("account-log-table").locator('[data-testid^="account-log-row-"]');
        await expect(logs).toHaveCount(2);
        await expect(logs.filter({ hasText: "Opening balance" })).toHaveCount(1);
        await expect(logs.filter({ hasText: `To ${MAIN}` })).toHaveCount(1);
      });
    });
  }
});
