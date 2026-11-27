import { expect, test } from "@playwright/test";
import type { Page, Response } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { API_URL } from "./env";
import { SUFFIX, api, login } from "./restock_helpers";

// An owner or an admin of either team type wants to name where a withdrawal landed — the check behind
// docs/acceptances/financial_account/account.md, section *accounts*, when *set account* (givens 16–17). Both givens
// name selling:owner · selling:admin · warehouse:owner · warehouse:admin: one test per role and given, each signed in
// as a person of that role, in a team of its OWN (a name is unique in a team, and given 16 fills in the very name
// given 17 has registered already).
//
// The unknown account is the listener's (a-shop-with-no-account-gets-an-unknown-one): settlement's withdrawal row
// for a shop that names no account, pushed to the listener's route as Pub/Sub would deliver it. It becomes the real
// one through one action, Set Account (an-unknown-account-is-filled-in-or-moved-in):
//
//   16 (unknown account Rp 300.000 from Melati · Melati's bank not registered · details filled as BCA TikTok)
//      The row's Account actions → Set Account → *Complete details*: bank, BCA, a number, PT Melati, "BCA TikTok".
//      then: it becomes BCA TikTok, its Rp 300.000 row kept — the SAME account (same id) reads BCA TikTok on the list,
//            the *No account set yet* warning gone, still Rp 300.000 and still the team's one account, counted under
//            Bank accounts; its own page is headed BCA TikTok with no unknown notice, and its one row is still the
//            Withdrawal of +Rp 300.000
//   17 (unknown account Rp 300.000 from Melati · BCA TikTok already registered · moved into it)
//      BCA TikTok registered at Rp 0. The row's Account actions → Set Account → *Move balance* → BCA TikTok.
//      then: Rp 300.000 moves into BCA TikTok — BCA TikTok at Rp 300.000 on the list and its page, with a Transfer
//            row of +Rp 300.000; the team's total unchanged
//      then: the shop withdraws there from now on — Melati's badge on BCA TikTok's row and in its Linked shops; a
//            NEXT withdrawal from Melati (Rp 100.000, pushed after the move) lands in BCA TikTok (Rp 400.000, a
//            Withdrawal row of +Rp 100.000), no new unknown account is made, and the old one stays at Rp 0
//      then: the unknown account archived — gone from the list, in the Archived view with its badge; its page says
//            Archived at Rp 0 and keeps both its rows (the Withdrawal in, the Transfer out)
//
// ⚠ A WAREHOUSE team owns no shop (ShopCreate is the selling team's), so no withdrawal can land in its accounts — as
// in account_wants_to_open_accounts.spec.ts, the warehouse roles' case is seeded by a withdrawal for the warehouse
// team from a shop id no shop has (the listener does not need the shop to exist), and the screen those roles would
// read is the one checked; "Melati" is that shop id there (named `shop #<id>` / `#<id>`). Named in the report.
//
// The ground (root, once): per role and given a team, the role's person (made in the given-16 team, added to the
// given-17 one), Melati (selling) or a shop id (warehouse), its Rp 300.000 withdrawal, and — given 17 — BCA TikTok.

const PASSWORD = "e2e-acct-set-pass-1";
type Side = "selling" | "warehouse";
type Role = { given: string; role: string; key: string; side: Side; n: number };
// n: the role's digit in its team code, shop code, shop id and account numbers.
const MANAGERS: Role[] = [
  { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "sown", side: "selling", n: 1 },
  { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "sadm", side: "selling", n: 2 },
  { given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", key: "wown", side: "warehouse", n: 3 },
  { given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", key: "wadm", side: "warehouse", n: 4 },
];

// The givens' case texts, verbatim from account.md — the marking script finds the tests by them.
const C16 = "unknown account Rp 300.000 from Melati · Melati's bank not registered · details filled as BCA TikTok";
const C17 = "unknown account Rp 300.000 from Melati · BCA TikTok already registered · moved into it";
const GIVENS = [16, 17] as const;
type Given = (typeof GIVENS)[number];

const TIKTOK = "BCA TikTok";

// A username is lowercase letters and digits only.
const username = (r: Role) => `e2eacset${r.key}${SUFFIX}`;
const teamName = (g: Given, r: Role) => `E2E Akun Tentukan ${g} ${r.key} ${SUFFIX}`;
// At most 10 characters: "NB", the given's digit (1 or 2), the role's digit, the 6-digit SUFFIX.
const teamCode = (g: Given, r: Role) => `NB${g - 15}${r.n}${SUFFIX}`;
const melatiName = (g: Given, r: Role) => `E2E Melati ${g}${r.key} ${SUFFIX}`;
// Ten digits, like a BCA number: "36", the SUFFIX, the given's digit, the role's digit. Unique app-wide
// (a-real-account-is-recorded-once) — no other spec's numbers start "36".
const number = (g: Given, r: Role) => `36${SUFFIX}${g - 15}${r.n}`;
// The warehouse's "Melati": a shop id no shop has (the ⚠ above).
const orphanShop = (g: Given, r: Role) => String(20_000_000 + Number(SUFFIX.slice(-5)) * 100 + (g - 15) * 10 + r.n);

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

// Rupiah as the app prints it: "Rp 300.000".
const rp = (n: number) => `${n < 0 ? "−" : ""}Rp ${Math.abs(n).toLocaleString("id-ID")}`;

// FinancialAccountType on the cards' test ids: WALLET 1 · BANK_ACCOUNT 2 · CASH 3 · UNKNOWN 4.
const TYPE = { bank: 2, unknown: 4 } as const;

type Ground = { team: string; shop: string; unknown: string; tiktok: string };
const ground: Record<string, Ground> = {};
const at = (g: Given, r: Role) => ground[`${g}${r.key}`];

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

async function pushWithdrawal(page: Page, eventId: string, teamId: string, shopId: string, change: number) {
  const res = await page.request.post(`${API_URL}/event/financial-account-withdrawal/push`, {
    data: withdrawal(eventId, teamId, shopId, change),
  });
  expect(res.status(), `withdrawal push ${eventId}`).toBe(200);
}

// The team's ACTIVE unknown accounts, asked with the signed-in user's own token.
async function unknownIds(page: Page, teamId: string): Promise<string[]> {
  const list = (await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountList", {
    teamId,
    filter: { types: ["FINANCIAL_ACCOUNT_TYPE_UNKNOWN"] },
    dataRequest: ["FINANCIAL_ACCOUNT_LIST_DATA_TYPE_ACCOUNT"],
    page: { page: 1, limit: 10 },
  })) as { ids?: string[] };

  return (list.ids ?? []).map(String);
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  const page = await browser.newPage();
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  for (const r of MANAGERS) {
    let userId = "";
    for (const g of GIVENS) {
      const team = await api(page, "team.v1.TeamService/TeamCreate", {
        name: teamName(g, r),
        teamCode: teamCode(g, r),
        type: r.side === "selling" ? "TEAM_TYPE_SELLING" : "TEAM_TYPE_WAREHOUSE",
        ownerUserId: ROOT_USER_ID,
      });
      const teamId = String(team.team.id);

      // The role's one person: made in its given-16 team, added to the given-17 one with the same role.
      if (!userId) {
        const made = await api(page, "user.v1.UserService/CreateUser", {
          teamId,
          username: username(r),
          password: PASSWORD,
          name: `Akun Tentukan ${r.given} ${SUFFIX}`,
          role: r.role,
        });
        userId = String(made.user.id);
      } else {
        await api(page, "user.v1.UserService/TeamUserUpdate", { teamId, add: { userId, role: r.role } });
      }

      // Melati, naming no account: the selling team's own shop; for a warehouse, a shop id no shop has.
      const shop =
        r.side === "selling"
          ? String(
              (
                await api(page, "selling.v1.ShopService/ShopCreate", {
                  teamId,
                  name: melatiName(g, r),
                  shopCode: `NB${g - 15}${r.n}${SUFFIX}`,
                  marketplace: "MARKETPLACE_TIKTOK",
                })
              ).shop.id,
            )
          : orphanShop(g, r);

      // Given 17: BCA TikTok, the real account, registered already (at Rp 0).
      let tiktok = "";
      if (g === 17) {
        tiktok = String(
          (
            await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
              teamId,
              type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
              provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
              name: TIKTOK,
              accountNumber: number(g, r),
              holderName: "PT Melati",
              openingBalance: 0,
              openingOn: today(),
            })
          ).account.id,
        );
      }

      // Rp 300.000 withdrawn by Melati: the listener makes the unknown account and posts it there.
      await pushWithdrawal(page, `e2e-acct-set-${g}-${r.key}-${SUFFIX}`, teamId, shop, -300_000);
      let unknown = "";
      await expect
        .poll(
          async () => {
            unknown = (await unknownIds(page, teamId))[0] ?? "";

            return unknown;
          },
          { timeout: 30_000 },
        )
        .not.toBe("");

      ground[`${g}${r.key}`] = { team: teamId, shop, unknown, tiktok };
    }
  }

  await page.close();
});

// The role signs in, works in the given's team (the active team is per tab, in sessionStorage — TeamContext), and
// opens the Akun list.
async function openAccounts(page: Page, g: Given, r: Role) {
  await login(page, username(r), PASSWORD);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), at(g, r).team);
  await gotoAccounts(page, g, r);
}

async function gotoAccounts(page: Page, g: Given, r: Role) {
  await page.goto("/financial-accounts");
  await expect(page.getByTestId("financial-accounts-page")).toBeVisible();
  await expect(page.getByTestId("team-switcher")).toContainText(teamName(g, r));
  await expect(page.getByTestId("financial-accounts-table")).toBeVisible();
}

// How the list names the unknown account (the-unknown-account-reads-lainnya): by the shop whose withdrawal it holds —
// for the warehouse's shop id, the stored name with its prefix dropped.
const shownUnknown = (g: Given, r: Role) => (r.side === "selling" ? melatiName(g, r) : `shop #${orphanShop(g, r)}`);
// The shop's badge on an account's row: its name, or `#<id>` for a shop id the team does not have.
const shopBadge = (g: Given, r: Role) => (r.side === "selling" ? melatiName(g, r) : `#${orphanShop(g, r)}`);

// The given on screen: the unknown account, Rp 300.000, *No account set yet*. Then the WHEN's first half — its row's
// Account actions → Set Account opens the dialog.
async function openSetAccount(page: Page, g: Given, r: Role) {
  const u = at(g, r).unknown;
  const row = page.getByTestId(`account-row-${u}`);
  await expect(row).toContainText(shownUnknown(g, r));
  await expect(page.getByTestId(`account-balance-${u}`)).toHaveText(rp(300_000));
  await expect(page.getByTestId(`account-not-set-${u}`)).toHaveText("No account set yet");

  await page.getByTestId(`account-actions-${u}`).click();
  await page.getByTestId(`account-identify-${u}`).click();
  const dialog = page.getByTestId("identify");
  await expect(dialog).toBeVisible();
  await expect.soft(dialog).toContainText("Set Account");
  await expect.soft(dialog).toContainText("Rp 300.000");

  return dialog;
}

async function save(page: Page) {
  const answered = page.waitForResponse((res: Response) =>
    res.url().endsWith("FinancialAccountService/FinancialAccountIdentify"),
  );
  await page.getByTestId("identify-save").click();
  expect((await answered).status()).toBe(200);
  await expect(page.getByTestId("identify")).toBeHidden();
}

const logRows = (page: Page) => page.getByTestId("account-log-table").locator('[data-testid^="account-log-row-"]');

test.describe(`acct wants to name where a withdrawal landed (${C16})`, () => {
  for (const r of MANAGERS) {
    test(`${r.given} set account (${C16})`, async ({ page }) => {
      const a = at(16, r);
      await openAccounts(page, 16, r);

      // The WHEN: Set Account → Complete details, as the given fills it.
      const dialog = await openSetAccount(page, 16, r);
      await page.getByTestId("identify-fill").click();
      await dialog.getByTestId("identify-type-2").click(); // Bank account
      await dialog.getByTestId("identify-provider").click();
      await dialog.getByRole("option", { name: "BCA", exact: true }).click();
      await dialog.getByTestId("identify-number").fill(number(16, r));
      await dialog.getByTestId("identify-holder").fill("PT Melati");
      await dialog.getByTestId("identify-name").fill(TIKTOK);
      await expect(page.getByTestId("identify-save")).toBeEnabled();
      await save(page);
      await expect.soft(page.getByText(`It is ${TIKTOK} now`)).toBeVisible();

      await test.step("then: it becomes BCA TikTok, its Rp 300.000 row kept", async () => {
        // The list, read afresh: the SAME account, now BCA TikTok, and still the team's only one.
        await gotoAccounts(page, 16, r);
        const rows = page.getByTestId("financial-accounts-table").locator('[data-testid^="account-row-"]');
        await expect(rows).toHaveCount(1);
        const row = page.getByTestId(`account-row-${a.unknown}`);
        await expect(row).toContainText(TIKTOK);
        await expect(page.getByTestId(`account-not-set-${a.unknown}`)).toHaveCount(0);
        await expect(page.getByTestId(`account-balance-${a.unknown}`)).toHaveText(rp(300_000));
        await expect.soft(page.getByTestId(`account-number-${a.unknown}`)).toContainText(number(16, r));
        // Counted as a bank account now, and no Other card left.
        await expect.soft(page.getByTestId(`account-total-${TYPE.bank}-value`)).toHaveText(rp(300_000));
        await expect.soft(page.getByTestId(`account-total-${TYPE.unknown}`)).toHaveCount(0);
        // Melati still withdraws into it.
        await expect.soft(row.getByTestId(`account-shop-${a.unknown}-${a.shop}`)).toHaveText(shopBadge(16, r));

        // Its own page: BCA TikTok, no unknown notice, and its one row still the Rp 300.000 withdrawal.
        await page.goto(`/financial-accounts/${a.unknown}`);
        await expect(page.getByTestId("account-name-heading")).toHaveText(TIKTOK);
        await expect(page.getByTestId("account-unknown-explained")).toHaveCount(0);
        await expect(page.getByTestId("account-detail-balance")).toHaveText(rp(300_000));
        await expect(logRows(page)).toHaveCount(1);
        const kept = logRows(page).filter({ hasText: "Withdrawal" });
        await expect(kept).toHaveCount(1);
        await expect(kept).toContainText(`+${rp(300_000)}`);
      });
    });
  }
});

test.describe(`acct wants to name where a withdrawal landed (${C17})`, () => {
  for (const r of MANAGERS) {
    test(`${r.given} set account (${C17})`, async ({ page }) => {
      const a = at(17, r);
      await openAccounts(page, 17, r);

      // The given: BCA TikTok registered, at Rp 0, beside the unknown account; the team holds Rp 300.000.
      await expect(page.getByTestId(`account-row-${a.tiktok}`)).toContainText(TIKTOK);
      await expect(page.getByTestId(`account-balance-${a.tiktok}`)).toHaveText(rp(0));
      await expect.soft(page.getByTestId("account-total-team-value")).toHaveText(rp(300_000));

      // The WHEN: Set Account → Move balance → BCA TikTok.
      const dialog = await openSetAccount(page, 17, r);
      await page.getByTestId("identify-move").click();
      await dialog.getByTestId("identify-into").click();
      await dialog.getByTestId(`identify-into-option-${a.tiktok}`).click();
      await expect.soft(dialog.getByTestId("identify-move-summary")).toContainText("Rp 300.000");
      await expect(page.getByTestId("identify-save")).toBeEnabled();
      await save(page);
      await expect.soft(page.getByText(`Moved into ${TIKTOK}`)).toBeVisible();

      await test.step("then: Rp 300.000 moves into BCA TikTok", async () => {
        await gotoAccounts(page, 17, r);
        await expect(page.getByTestId(`account-balance-${a.tiktok}`)).toHaveText(rp(300_000));
        // Moved, not made: the team's money is the same Rp 300.000.
        await expect.soft(page.getByTestId("account-total-team-value")).toHaveText(rp(300_000));

        await page.goto(`/financial-accounts/${a.tiktok}`);
        await expect(page.getByTestId("account-name-heading")).toHaveText(TIKTOK);
        await expect(page.getByTestId("account-detail-balance")).toHaveText(rp(300_000));
        const moved = logRows(page).filter({ hasText: "Transfer" });
        await expect(moved).toHaveCount(1);
        await expect(moved).toContainText(`+${rp(300_000)}`);
      });

      await test.step("then: the shop withdraws there from now on", async () => {
        // Melati is BCA TikTok's shop now — on its row and in its Linked shops.
        await gotoAccounts(page, 17, r);
        await expect(page.getByTestId(`account-shop-${a.tiktok}-${a.shop}`)).toHaveText(shopBadge(17, r));
        await page.goto(`/financial-accounts/${a.tiktok}`);
        await expect(page.getByTestId("account-shops")).toContainText(shopBadge(17, r));

        // Melati's NEXT withdrawal lands in BCA TikTok.
        await pushWithdrawal(page, `e2e-acct-set-17-${r.key}-next-${SUFFIX}`, a.team, a.shop, -100_000);
        await expect(async () => {
          await page.reload();
          await expect(page.getByTestId("account-detail-balance")).toHaveText(rp(400_000), { timeout: 3_000 });
        }).toPass({ timeout: 30_000 });
        const next = logRows(page).filter({ hasText: "Withdrawal" });
        await expect(next).toHaveCount(1);
        await expect(next).toContainText(`+${rp(100_000)}`);

        // …and nowhere else: no new unknown account, and the old one still at Rp 0.
        expect(await unknownIds(page, a.team)).toEqual([]);
        await page.goto(`/financial-accounts/${a.unknown}`);
        await expect(page.getByTestId("account-detail-balance")).toHaveText(rp(0));
      });

      await test.step("then: the unknown account archived", async () => {
        // Gone from the list…
        await gotoAccounts(page, 17, r);
        await expect(page.getByTestId(`account-row-${a.tiktok}`)).toBeVisible();
        await expect(page.getByTestId(`account-row-${a.unknown}`)).toHaveCount(0);
        await expect.soft(page.getByTestId(`account-total-${TYPE.unknown}`)).toHaveCount(0);
        // …in the Archived view, badged.
        await page.getByTestId("open-archived-accounts").click();
        await expect(page.getByTestId("financial-accounts-heading")).toHaveText("Archived Accounts");
        await expect(page.getByTestId(`account-row-${a.unknown}`)).toBeVisible();
        await expect(page.getByTestId(`account-archived-${a.unknown}`)).toBeVisible();

        // Its own page: Archived at Rp 0, both rows kept — the withdrawal in, the transfer out.
        await page.goto(`/financial-accounts/${a.unknown}`);
        await expect.soft(page.getByTestId("financial-account-page")).toContainText("Archived");
        await expect(page.getByTestId("account-detail-balance")).toHaveText(rp(0));
        await expect(logRows(page)).toHaveCount(2);
        await expect(logRows(page).filter({ hasText: "Withdrawal" })).toContainText(`+${rp(300_000)}`);
        await expect(logRows(page).filter({ hasText: "Transfer" })).toContainText(`−${rp(300_000)}`);
      });
    });
  }
});
