import { expect, test } from "@playwright/test";
import type { Page, Response } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, api, login } from "./restock_helpers";

// selling:all · warehouse:all wants to know where the money is — the check behind
// docs/acceptances/financial_account/account.md, section *accounts*, when *filter accounts* (givens 4–6). One test per
// role of each team type (selling owner/admin/cs, warehouse owner/admin/staff), each signed in as a person of that
// role, narrowing the Akun list (/financial-accounts) of a team of the given's own: the list is the WHOLE team's, so
// no other spec's account may sit in it.
//
//   4 (active bank BCA and wallet ShopeePay · search "BCA") — the search box (`account-search`); the server matches
//     the name, the holder and the number (FinancialAccountList's `q`)
//     then: only matching accounts listed — the BCA row alone, ShopeePay gone, both listed before the search
//   5 (active bank BCA, wallet ShopeePay and cash · type: digital wallet) — the type is a TAB row over the table
//     (the-accounts-type-is-a-tab-row), the wallet tab `account-type-tab-1`
//     then: only wallets listed — the ShopeePay row alone, BCA and the cash box gone, all three listed before
//   6 (1 active and 1 archived account · archive opened) — the Archive button turns the same screen into the archived
//     list (the-archive-is-its-own-view), the server listing the archived alone (`archivedOnly`)
//     then: only archived accounts listed — the archived account alone, badged Archived, the active one gone; on the
//           active list before, the other way round
//
// Each then also waits for the list's answer to the narrowed question (the request body carrying the filter), so the
// rows read are the server's narrowing, not the old page's.
//
// The ground (root, once): six teams — given 4, 5 and 6 × selling and warehouse — and a person of every role of each
// type, made in the given-4 team and added to the other two with the same role.

const PASSWORD = "e2e-acct-filter-pass-1";
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

// The givens' case texts, verbatim from account.md — the marking script finds the tests by them.
const C4 = 'active bank BCA and wallet ShopeePay · search "BCA"';
const C5 = "active bank BCA, wallet ShopeePay and cash · type: digital wallet";
const C6 = "1 active and 1 archived account · archive opened";
const GIVENS = [4, 5, 6] as const;
type Given = (typeof GIVENS)[number];

// A username is lowercase letters and digits only.
const username = (key: string) => `e2eacfilt${key}${SUFFIX}`;
const teamName = (g: Given, s: Side) => `E2E Akun Saring ${g} ${s} ${SUFFIX}`;
// At most 10 characters: 2 letters, the given, the side's letter, the 6-digit SUFFIX.
const teamCode = (g: Given, s: Side) => `FF${g}${s === "selling" ? "S" : "W"}${SUFFIX}`;

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

type Accounts = { bca: string; spay: string; cash: string; active: string; archived: string };
const ground = {
  team: {} as Record<string, string>,
  acct: { selling: {} as Accounts, warehouse: {} as Accounts } as Record<Side, Accounts>,
  name: { selling: {} as Accounts, warehouse: {} as Accounts } as Record<Side, Accounts>,
  // given 5's three, in its own team
  g5: {} as Record<Side, { bca: string; spay: string; cash: string }>,
};
const teamOf = (g: Given, s: Side) => ground.team[`${g}${s}`];

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  const page = await browser.newPage();
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  for (const g of GIVENS) {
    for (const s of SIDES) {
      const type = s === "selling" ? "TEAM_TYPE_SELLING" : "TEAM_TYPE_WAREHOUSE";
      const res = await api(page, "team.v1.TeamService/TeamCreate", {
        name: teamName(g, s),
        teamCode: teamCode(g, s),
        type,
        ownerUserId: ROOT_USER_ID,
      });
      ground.team[`${g}${s}`] = String(res.team.id);
    }
  }

  // A person of every role, in all three of the side's teams with that role.
  for (const s of SIDES) {
    for (const r of ROLES[s]) {
      const made = await api(page, "user.v1.UserService/CreateUser", {
        teamId: teamOf(4, s),
        username: username(r.key),
        password: PASSWORD,
        name: `Akun Saring ${r.given} ${SUFFIX}`,
        role: r.role,
      });
      for (const g of [5, 6] as const) {
        await api(page, "user.v1.UserService/TeamUserUpdate", {
          teamId: teamOf(g, s),
          add: { userId: String(made.user.id), role: r.role },
        });
      }
    }
  }

  const account = async (teamId: string, body: Record<string, unknown>) =>
    String(
      (
        await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
          teamId,
          holderName: "E2E",
          openingOn: today(),
          ...body,
        })
      ).account.id,
    );

  for (const s of SIDES) {
    const tag = s === "selling" ? "S" : "W";
    const n = ground.name[s];
    const a = ground.acct[s];
    n.bca = `E2E BCA Saring ${tag} ${SUFFIX}`;
    n.spay = `E2E ShopeePay Saring ${tag} ${SUFFIX}`;
    n.cash = `E2E Kas Saring ${tag} ${SUFFIX}`;
    n.active = `E2E BCA Aktif ${tag} ${SUFFIX}`;
    n.archived = `E2E Kas Arsip ${tag} ${SUFFIX}`;

    // given 4 — bank BCA and wallet ShopeePay. Only the BCA's name says "BCA": the wallet's name, holder and number
    // do not, so the search can only find the bank.
    a.bca = await account(teamOf(4, s), {
      type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
      name: n.bca,
      accountNumber: `E2E-FFILT-4${tag}-B-${SUFFIX}`,
      openingBalance: 400_000,
    });
    a.spay = await account(teamOf(4, s), {
      type: "FINANCIAL_ACCOUNT_TYPE_WALLET",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_SHOPEEPAY",
      name: n.spay,
      accountNumber: `E2E-FFILT-4${tag}-W-${SUFFIX}`,
      openingBalance: 150_000,
    });

    // given 5 — bank BCA, wallet ShopeePay and cash, in a team of its own (the ids differ from given 4's; the names are
    // the same, each team's list holding only its own).
    const g5 = {
      bca: await account(teamOf(5, s), {
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name: n.bca,
        accountNumber: `E2E-FFILT-5${tag}-B-${SUFFIX}`,
        openingBalance: 400_000,
      }),
      spay: await account(teamOf(5, s), {
        type: "FINANCIAL_ACCOUNT_TYPE_WALLET",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_SHOPEEPAY",
        name: n.spay,
        accountNumber: `E2E-FFILT-5${tag}-W-${SUFFIX}`,
        openingBalance: 150_000,
      }),
      cash: await account(teamOf(5, s), {
        type: "FINANCIAL_ACCOUNT_TYPE_CASH",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_CASH",
        name: n.cash,
        openingBalance: 25_000,
      }),
    };
    ground.g5[s] = g5;

    // given 6 — one active bank, and a cash box opened at zero and archived (archived only at zero —
    // an-account-is-archived-only-at-zero).
    a.active = await account(teamOf(6, s), {
      type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
      name: n.active,
      accountNumber: `E2E-FFILT-6${tag}-B-${SUFFIX}`,
      openingBalance: 100_000,
    });
    a.archived = await account(teamOf(6, s), {
      type: "FINANCIAL_ACCOUNT_TYPE_CASH",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_CASH",
      name: n.archived,
      openingBalance: 0,
    });
    await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountArchive", {
      teamId: teamOf(6, s),
      accountId: a.archived,
    });
  }

  await page.close();
});

// The role signs in, works in the given's team (the active team is per tab, in sessionStorage — TeamContext), and
// opens the Akun list — the ground before the WHEN.
async function openAccounts(page: Page, key: string, g: Given, s: Side) {
  await login(page, username(key), PASSWORD);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamOf(g, s));
  await page.goto("/financial-accounts");
  await expect(page.getByTestId("financial-accounts-page")).toBeVisible();
  await expect(page.getByTestId("team-switcher")).toContainText(teamName(g, s));
}

const rowsOf = (page: Page) =>
  page.getByTestId("financial-accounts-table").locator('[data-testid^="account-row-"]');

// The list's answer to the narrowed question: FinancialAccountList whose request carries the filter.
const listAnswer = (page: Page, has: string) =>
  page.waitForResponse(
    (r: Response) =>
      r.url().endsWith("FinancialAccountService/FinancialAccountList") &&
      (r.request().postData() ?? "").includes(has) &&
      r.ok(),
  );

test.describe(`acct wants to know where the money is (${C4})`, () => {
  for (const s of SIDES) {
    for (const r of ROLES[s]) {
      test(`${r.given} filter accounts (${C4})`, async ({ page }) => {
        await openAccounts(page, r.key, 4, s);
        const a = ground.acct[s];

        // Before: both accounts listed.
        await expect(rowsOf(page)).toHaveCount(2);
        await expect(page.getByTestId(`account-row-${a.bca}`)).toBeVisible();
        await expect(page.getByTestId(`account-row-${a.spay}`)).toBeVisible();

        const answered = listAnswer(page, '"q":"BCA"');
        await page.getByTestId("account-search").fill("BCA");
        await answered;

        await test.step("then: only matching accounts listed", async () => {
          await expect(rowsOf(page)).toHaveCount(1);
          await expect(page.getByTestId(`account-row-${a.bca}`)).toBeVisible();
          await expect(page.getByTestId(`account-row-${a.bca}`)).toContainText(ground.name[s].bca);
          await expect(page.getByTestId(`account-row-${a.spay}`)).toHaveCount(0);
          // The search lives in the address (a-lists-filters-live-in-the-url).
          await expect.soft(page).toHaveURL(/[?&]q=BCA(&|$)/);
        });
      });
    }
  }
});

test.describe(`acct wants to know where the money is (${C5})`, () => {
  for (const s of SIDES) {
    for (const r of ROLES[s]) {
      test(`${r.given} filter accounts (${C5})`, async ({ page }) => {
        await openAccounts(page, r.key, 5, s);
        const a = ground.g5[s];

        // Before: all three listed, every type.
        await expect(rowsOf(page)).toHaveCount(3);
        for (const id of [a.bca, a.spay, a.cash]) await expect(page.getByTestId(`account-row-${id}`)).toBeVisible();

        // FinancialAccountType WALLET = 1.
        const answered = listAnswer(page, '"types":["FINANCIAL_ACCOUNT_TYPE_WALLET"]');
        await page.getByTestId("account-type-tab-1").click();
        await answered;

        await test.step("then: only wallets listed", async () => {
          await expect(rowsOf(page)).toHaveCount(1);
          await expect(page.getByTestId(`account-row-${a.spay}`)).toBeVisible();
          await expect(page.getByTestId(`account-row-${a.spay}`)).toContainText(ground.name[s].spay);
          await expect(page.getByTestId(`account-row-${a.bca}`)).toHaveCount(0);
          await expect(page.getByTestId(`account-row-${a.cash}`)).toHaveCount(0);
          await expect.soft(page.getByTestId("account-type-tab-1")).toHaveAttribute("aria-selected", "true");
        });
      });
    }
  }
});

test.describe(`acct wants to know where the money is (${C6})`, () => {
  for (const s of SIDES) {
    for (const r of ROLES[s]) {
      test(`${r.given} filter accounts (${C6})`, async ({ page }) => {
        await openAccounts(page, r.key, 6, s);
        const a = ground.acct[s];

        // Before, on the active list: the active account alone.
        await expect(page.getByTestId(`account-row-${a.active}`)).toBeVisible();
        await expect(rowsOf(page)).toHaveCount(1);
        await expect(page.getByTestId(`account-row-${a.archived}`)).toHaveCount(0);

        const answered = listAnswer(page, '"archivedOnly":true');
        await page.getByTestId("open-archived-accounts").click();
        await answered;

        await test.step("then: only archived accounts listed", async () => {
          await expect(page.getByTestId("financial-accounts-heading")).toHaveText("Archived Accounts");
          await expect(rowsOf(page)).toHaveCount(1);
          const row = page.getByTestId(`account-row-${a.archived}`);
          await expect(row).toBeVisible();
          await expect(row).toContainText(ground.name[s].archived);
          await expect.soft(row.getByTestId(`account-archived-${a.archived}`)).toBeVisible();
          await expect(page.getByTestId(`account-row-${a.active}`)).toHaveCount(0);
          await expect.soft(page).toHaveURL(/[?&]view=archived(&|$)/);
        });
      });
    }
  }
});
