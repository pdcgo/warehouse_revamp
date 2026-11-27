import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, api, login } from "./restock_helpers";
import { API_URL } from "./env";

// selling:all · warehouse:all wants to know where the money is — the check behind
// docs/acceptances/financial_account/account.md, section *accounts*, when *open accounts* (givens 1–3). One test per
// role of each team type (selling owner/admin/cs, warehouse owner/admin/staff), each signed in as a person of that
// role, opening the Akun list (/financial-accounts) of a team of the given's own: the totals and the rows are the
// WHOLE team's, so no other spec's money may sit in it.
//
//   1 (3 active accounts: bank BCA Rp 1.000.000 · wallet ShopeePay Rp 200.000 · cash Rp 50.000)
//     then: total balance Rp 1.250.000 — the Total balance card (the-total-saldo-comes-first)
//     then: bank, wallet and cash each with its own total — one card per type, asked of the server
//           (FinancialAccountOverview TYPE_TOTAL), never summed from the rows
//   2 (active bank BCA · balance −Rp 50.000) — opened at 0, then 50.000 transferred out to a cash box (below zero is
//     warned, never refused — below-zero-is-warned-never-refused)
//     then: "below zero" on its row, saying to check it against the bank — the red figure and the line under it,
//           ⚠ *Below zero · check it against the bank* (a-balance-below-zero-says-to-check-the-bank); the cash box
//           beside it, above zero, has no such line
//   3 (unknown account · Rp 300.000 withdrawn by shop Melati · Melati names no account) — settlement's withdrawal row
//     pushed to the listener's route as Pub/Sub would deliver it (a-shop-with-no-account-gets-an-unknown-one)
//     then: it says the withdrawal came before its bank was named — on the row, the account shown by the shop's name
//           with its Rp 300.000 and ⚠ *No account set yet* (the-unknown-row-warns-and-sets-from-the-menu); opened
//           from that row, its page says *A withdrawal from <shop> arrived before anyone named its bank*
//
// ⚠ Given 3 for a WAREHOUSE team: a warehouse owns no shop (ShopCreate is the selling team's), so no withdrawal can
// land in its accounts — the account page says so too ("a warehouse has none, so its accounts take no withdrawals").
// The warehouse roles' case is seeded by pushing the withdrawal for the warehouse team with a shop id no shop has (the
// listener does not need the shop to exist), so the screen those roles would read is the one checked. Named in the
// report for the owner.
//
// The ground (root, once): six teams — given 1, 2 and 3 × selling and warehouse — and a person of every role of each
// type, made in the given-1 team and added to the other two with the same role.

const PASSWORD = "e2e-acct-open-pass-1";
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
const C1 = "3 active accounts: bank BCA Rp 1.000.000 · wallet ShopeePay Rp 200.000 · cash Rp 50.000";
const C2 = "active bank BCA · balance −Rp 50.000";
const C3 = "unknown account · Rp 300.000 withdrawn by shop Melati · Melati names no account";
const GIVENS = [1, 2, 3] as const;
type Given = (typeof GIVENS)[number];

// A username is lowercase letters and digits only.
const username = (key: string) => `e2eacopen${key}${SUFFIX}`;
const teamName = (g: Given, s: Side) => `E2E Akun Buka ${g} ${s} ${SUFFIX}`;
// At most 10 characters: 2 letters, the given, the side's letter, the 6-digit SUFFIX.
const teamCode = (g: Given, s: Side) => `FO${g}${s === "selling" ? "S" : "W"}${SUFFIX}`;

const MELATI = `E2E Melati ${SUFFIX}`;
// A shop id no shop has, for the warehouse's case (see the ⚠ above).
const ORPHAN_SHOP = 800_000 + Number(SUFFIX.slice(-5));

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

// Rupiah as the app prints it: "Rp 1.250.000", "−Rp 50.000".
const rp = (n: number) => `${n < 0 ? "−" : ""}Rp ${Math.abs(n).toLocaleString("id-ID")}`;

// FinancialAccountType on the cards' test ids: WALLET 1 · BANK_ACCOUNT 2 · CASH 3 · UNKNOWN 4.
const TYPE = { wallet: 1, bank: 2, cash: 3, unknown: 4 } as const;

const ground = {
  team: {} as Record<string, string>,
  // given 2: the bank below zero and the cash box beside it, per side
  bca: {} as Record<Side, string>,
  cash: {} as Record<Side, string>,
};
const teamOf = (g: Given, s: Side) => ground.team[`${g}${s}`];

// Settlement's withdrawal row, as the broker pushes it to financial_account's listener route
// (financial_accounts.spec.ts's pushWithdrawal, the team a parameter).
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
        teamId: teamOf(1, s),
        username: username(r.key),
        password: PASSWORD,
        name: `Akun Buka ${r.given} ${SUFFIX}`,
        role: r.role,
      });
      for (const g of [2, 3] as const) {
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

    // given 1 — bank BCA Rp 1.000.000 · wallet ShopeePay Rp 200.000 · cash Rp 50.000.
    await account(teamOf(1, s), {
      type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
      name: `E2E BCA Buka ${tag} ${SUFFIX}`,
      accountNumber: `E2E-FOPEN-1${tag}-BCA-${SUFFIX}`,
      openingBalance: 1_000_000,
    });
    await account(teamOf(1, s), {
      type: "FINANCIAL_ACCOUNT_TYPE_WALLET",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_SHOPEEPAY",
      name: `E2E ShopeePay Buka ${tag} ${SUFFIX}`,
      accountNumber: `E2E-FOPEN-1${tag}-SPAY-${SUFFIX}`,
      openingBalance: 200_000,
    });
    await account(teamOf(1, s), {
      type: "FINANCIAL_ACCOUNT_TYPE_CASH",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_CASH",
      name: `E2E Kas Buka ${tag} ${SUFFIX}`,
      openingBalance: 50_000,
    });

    // given 2 — bank BCA at −Rp 50.000: opened at 0, then 50.000 moved out to a cash box.
    ground.bca[s] = await account(teamOf(2, s), {
      type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
      name: `E2E BCA Minus ${tag} ${SUFFIX}`,
      accountNumber: `E2E-FOPEN-2${tag}-BCA-${SUFFIX}`,
      openingBalance: 0,
    });
    ground.cash[s] = await account(teamOf(2, s), {
      type: "FINANCIAL_ACCOUNT_TYPE_CASH",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_CASH",
      name: `E2E Kas Minus ${tag} ${SUFFIX}`,
      openingBalance: 0,
    });
    await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountTransfer", {
      teamId: teamOf(2, s),
      fromAccountId: ground.bca[s],
      toAccountId: ground.cash[s],
      amount: 50_000,
      occurredOn: today(),
      note: `E2E below zero ${SUFFIX}`,
    });
  }

  // given 3 — Rp 300.000 withdrawn by a shop that names no account: the selling team's own shop Melati; for the
  // warehouse, a shop id no shop has (the ⚠ in the header).
  const melati = String(
    (
      await api(page, "selling.v1.ShopService/ShopCreate", {
        teamId: teamOf(3, "selling"),
        name: MELATI,
        shopCode: `FOM${SUFFIX}`,
        marketplace: "MARKETPLACE_SHOPEE",
      })
    ).shop.id,
  );
  const route = `${API_URL}/event/financial-account-withdrawal/push`;
  for (const [s, shop] of [
    ["selling", melati],
    ["warehouse", String(ORPHAN_SHOP)],
  ] as const) {
    const res = await page.request.post(route, {
      data: withdrawal(`e2e-acct-open-${s}-${SUFFIX}`, teamOf(3, s), shop, -300_000),
    });
    expect(res.status(), `withdrawal push for the ${s} team`).toBe(200);
  }

  await page.close();
});

// The role signs in, works in the given's team (the active team is per tab, in sessionStorage — TeamContext), and
// opens the Akun list: the WHEN.
async function openAccounts(page: Page, key: string, g: Given, s: Side) {
  await login(page, username(key), PASSWORD);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamOf(g, s));
  await page.goto("/financial-accounts");
  await expect(page.getByTestId("financial-accounts-page")).toBeVisible();
  await expect(page.getByTestId("team-switcher")).toContainText(teamName(g, s));
}

test.describe(`acct wants to know where the money is (${C1})`, () => {
  for (const s of SIDES) {
    for (const r of ROLES[s]) {
      test(`${r.given} open accounts (${C1})`, async ({ page }) => {
        await openAccounts(page, r.key, 1, s);

        await test.step("then: total balance Rp 1.250.000", async () => {
          await expect(page.getByTestId("account-total-team")).toContainText("Total balance");
          await expect(page.getByTestId("account-total-team-value")).toHaveText(rp(1_250_000));
          await expect.soft(page.getByTestId("account-total-team")).toContainText("3 accounts");
        });

        await test.step("then: bank, wallet and cash each with its own total", async () => {
          const cards = [
            { type: TYPE.bank, label: "Bank accounts", total: 1_000_000 },
            { type: TYPE.wallet, label: "Digital wallets", total: 200_000 },
            { type: TYPE.cash, label: "Cash", total: 50_000 },
          ];
          for (const c of cards) {
            const card = page.getByTestId(`account-total-${c.type}`);
            await expect.soft(card).toContainText(c.label);
            await expect.soft(card).toContainText("1 account");
            await expect.soft(page.getByTestId(`account-total-${c.type}-value`)).toHaveText(rp(c.total));
          }
          // No unknown account in this team, so no Other card.
          await expect.soft(page.getByTestId(`account-total-${TYPE.unknown}`)).toHaveCount(0);
          // The three rows below, one per account.
          await expect
            .soft(page.getByTestId("financial-accounts-table").locator('[data-testid^="account-row-"]'))
            .toHaveCount(3);
        });
      });
    }
  }
});

test.describe(`acct wants to know where the money is (${C2})`, () => {
  for (const s of SIDES) {
    for (const r of ROLES[s]) {
      test(`${r.given} open accounts (${C2})`, async ({ page }) => {
        await openAccounts(page, r.key, 2, s);

        await test.step('then: "below zero" on its row, saying to check it against the bank', async () => {
          const bca = ground.bca[s];
          const row = page.getByTestId(`account-row-${bca}`);
          await expect(row).toBeVisible();
          const balance = row.getByTestId(`account-balance-${bca}`);
          await expect(balance).toContainText(rp(-50_000));
          await expect.soft(balance).toHaveAttribute("data-below-zero", /.*/);
          await expect(row.getByTestId(`account-balance-${bca}-below-zero`)).toHaveText(
            "Below zero · check it against the bank",
          );

          // The cash box beside it holds +50.000: no warning on its row.
          const cash = ground.cash[s];
          await expect.soft(page.getByTestId(`account-balance-${cash}`)).toHaveText(rp(50_000));
          await expect.soft(page.getByTestId(`account-balance-${cash}-below-zero`)).toHaveCount(0);

          // The bank card counts it on its line, in red (the-accounts-page-has-no-banners).
          await expect.soft(page.getByTestId(`account-total-${TYPE.bank}-below-zero`)).toContainText("1 below zero");
        });
      });
    }
  }
});

test.describe(`acct wants to know where the money is (${C3})`, () => {
  for (const s of SIDES) {
    for (const r of ROLES[s]) {
      test(`${r.given} open accounts (${C3})`, async ({ page }) => {
        await openAccounts(page, r.key, 3, s);

        await test.step("then: it says the withdrawal came before its bank was named", async () => {
          // Shown by the shop whose withdrawal it holds (the-unknown-account-reads-lainnya). A warehouse holds no
          // shop to name it by, so its row keeps the stored name, prefix dropped.
          const shown = s === "selling" ? MELATI : `shop #${ORPHAN_SHOP}`;
          const rows = page.getByTestId("financial-accounts-table").locator('[data-testid^="account-row-"]');
          await expect(rows).toHaveCount(1);
          const row = rows.filter({ hasText: shown });
          await expect(row).toHaveCount(1);
          await expect.soft(row.locator('[data-testid^="account-balance-"]').first()).toHaveText(rp(300_000));
          await expect(row.locator('[data-testid^="account-not-set-"]')).toHaveText("No account set yet");
          await expect.soft(row).toContainText("Other");

          // Opened from its row (the name in its first cell — the shop's badge in the Shops cell reads the same), the
          // account's page says why it exists.
          await row.locator("td").first().getByText(shown, { exact: true }).click();
          await expect(page.getByTestId("financial-account-page")).toBeVisible();
          const from = s === "selling" ? MELATI : `#${ORPHAN_SHOP}`;
          await expect(page.getByTestId("account-unknown-explained")).toContainText(
            `A withdrawal from ${from} arrived before anyone named its bank`,
          );
        });
      });
    }
  }
});
