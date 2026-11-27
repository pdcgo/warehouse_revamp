import { expect, test } from "@playwright/test";
import type { Page, Response } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { API_URL } from "./env";
import { SUFFIX, api, login } from "./restock_helpers";

// An owner or an admin of either team type wants a shop's withdrawals to land in an account — the check behind
// docs/acceptances/financial_account/account.md, section *accounts*, when *point a shop here* (given 18). The given
// names selling:owner · selling:admin · warehouse:owner · warehouse:admin: one test per role, each signed in as a
// person of that role, in a team of its OWN (the withdrawals and the balance are the team's).
//
//   18 (active bank BCA · Melati names no account yet · Melati pointed here)
//      BCA Penarikan, a bank BCA account opened at Rp 0; Melati, the team's shop, has no `shop_accounts` row yet
//      (no withdrawal has come, so not even an unknown account holds it). On the account's page, Linked shops →
//      Point a Shop → Melati (the dialog says Melati names no account yet) → Save.
//      then: Melati's withdrawals land in this account — Melati on the page's Linked shops and on the account's row;
//            two withdrawals from Melati (Rp 250.000, then Rp 150.000) land in BCA Penarikan: Rp 400.000, two
//            Withdrawal rows; no unknown account is made for Melati (a-shop-names-the-account-it-withdraws-into,
//            a-shop-with-no-account-gets-an-unknown-one)
//
// ⚠ CONFLICT — a WAREHOUSE team has no shop to point. Shops are the selling team's (docs/business/shop/context.md:
// *Manage Shop for Selling Team*; ShopCreate and ShopList are selling roles only), a warehouse's account page draws no
// Linked shops card and so no Point a Shop (linked-shops-sit-beside-the-cards: "a warehouse | no card — its team has no
// shops"), and FinancialAccountShopSet asks the shop of its own service under the caller's token — which a warehouse
// role cannot read — so it refuses any shop id for a warehouse team. The warehouse roles therefore keep the then as
// their own `test.fail(true, "conflict: …")` test: the WHEN on the warehouse's own screen (the Point a Shop door),
// then the same point through the contract for a shop id, then that shop's withdrawal read where the then says it
// lands. Named in the report for the owner.
//
// The ground (root, once): per role a team, the role's person, BCA Penarikan, and Melati (selling) or a shop id no
// shop has (warehouse).

const PASSWORD = "e2e-acct-point-pass-1";
type Side = "selling" | "warehouse";
type Role = { given: string; role: string; key: string; side: Side; n: number };
// n: the role's digit in its team code, shop code, shop id and account number.
const MANAGERS: Role[] = [
  { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "sown", side: "selling", n: 1 },
  { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "sadm", side: "selling", n: 2 },
  { given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", key: "wown", side: "warehouse", n: 3 },
  { given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", key: "wadm", side: "warehouse", n: 4 },
];

// The given's case text, verbatim from account.md — the marking script finds the tests by it.
const C18 = "active bank BCA · Melati names no account yet · Melati pointed here";

const BCA = "BCA Penarikan";

// A username is lowercase letters and digits only.
const username = (r: Role) => `e2eacpoint${r.key}${SUFFIX}`;
const teamName = (r: Role) => `E2E Akun Arahkan ${r.key} ${SUFFIX}`;
// At most 10 characters: "AP", the role's digit, the 6-digit SUFFIX.
const teamCode = (r: Role) => `AP${r.n}${SUFFIX}`;
const melatiName = (r: Role) => `E2E Melati Arah ${r.key} ${SUFFIX}`;
// Ten digits, like a BCA number: "37", the SUFFIX, "1", the role's digit. Unique app-wide
// (a-real-account-is-recorded-once) — no other spec's numbers start "37".
const number = (r: Role) => `37${SUFFIX}1${r.n}`;
// The warehouse's "Melati": a shop id no shop has (the ⚠ above). Its own range — set account's ids are 20–29 million,
// open accounts' under 900 000.
const orphanShop = (r: Role) => String(30_000_000 + Number(SUFFIX.slice(-5)) * 10 + r.n);

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

// Rupiah as the app prints it: "Rp 250.000".
const rp = (n: number) => `${n < 0 ? "−" : ""}Rp ${Math.abs(n).toLocaleString("id-ID")}`;

type Ground = { team: string; shop: string; bca: string };
const ground: Record<string, Ground> = {};

// Settlement's withdrawal row, as the broker pushes it to financial_account's listener route
// (account_wants_to_set_account.spec.ts's withdrawal).
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

// The account a shop withdraws into, as the Point a Shop dialog asks it (useAccountOfShop) — with the signed-in
// user's own token. Empty: the shop names no account.
async function accountOfShop(page: Page, teamId: string, shopId: string): Promise<string[]> {
  const list = (await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountList", {
    teamId,
    filter: { shopId, includeArchived: true },
    dataRequest: ["FINANCIAL_ACCOUNT_LIST_DATA_TYPE_ACCOUNT"],
    page: { page: 1, limit: 10 },
  })) as { ids?: string[] };

  return (list.ids ?? []).map(String);
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
  test.setTimeout(240_000);
  const page = await browser.newPage();
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  for (const r of MANAGERS) {
    const team = await api(page, "team.v1.TeamService/TeamCreate", {
      name: teamName(r),
      teamCode: teamCode(r),
      type: r.side === "selling" ? "TEAM_TYPE_SELLING" : "TEAM_TYPE_WAREHOUSE",
      ownerUserId: ROOT_USER_ID,
    });
    const teamId = String(team.team.id);

    await api(page, "user.v1.UserService/CreateUser", {
      teamId,
      username: username(r),
      password: PASSWORD,
      name: `Akun Arahkan ${r.given} ${SUFFIX}`,
      role: r.role,
    });

    // Melati, naming no account (no withdrawal yet): the selling team's own shop; for a warehouse, a shop id no shop has.
    const shop =
      r.side === "selling"
        ? String(
            (
              await api(page, "selling.v1.ShopService/ShopCreate", {
                teamId,
                name: melatiName(r),
                shopCode: `AP${r.n}${SUFFIX}`,
                marketplace: "MARKETPLACE_SHOPEE",
              })
            ).shop.id,
          )
        : orphanShop(r);

    // The active bank BCA the shop is pointed at, opened at Rp 0.
    const bca = String(
      (
        await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
          teamId,
          type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
          provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
          name: BCA,
          accountNumber: number(r),
          holderName: "PT Melati",
          openingBalance: 0,
          openingOn: today(),
        })
      ).account.id,
    );

    ground[r.key] = { team: teamId, shop, bca };
  }

  await page.close();
});

// The role signs in, works in its own team (the active team is per tab, in sessionStorage — TeamContext), and opens
// BCA Penarikan's page.
async function openAccount(page: Page, r: Role) {
  await login(page, username(r), PASSWORD);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), ground[r.key].team);
  await gotoAccount(page, r);
}

async function gotoAccount(page: Page, r: Role) {
  await page.goto(`/financial-accounts/${ground[r.key].bca}`);
  await expect(page.getByTestId("account-name-heading")).toHaveText(BCA);
  await expect(page.getByTestId("team-switcher")).toContainText(teamName(r));
}

const logRows = (page: Page) => page.getByTestId("account-log-table").locator('[data-testid^="account-log-row-"]');

// The given on screen and in the contract: BCA Penarikan active at Rp 0, no shop withdrawing into it, and Melati
// naming no account at all. A warehouse's page draws no Linked shops card at all — its team has no shops
// (linked-shops-sit-beside-the-cards: "a warehouse | no card").
async function provenGiven(page: Page, r: Role) {
  const g = ground[r.key];
  await expect(page.getByTestId("account-detail-balance")).toHaveText(rp(0));
  if (r.side === "selling") {
    await expect(page.getByTestId("account-shops-none")).toBeVisible();
  } else {
    await expect(page.getByTestId("account-shops")).toHaveCount(0);
  }
  expect(await accountOfShop(page, g.team, g.shop)).toEqual([]);
}

test.describe(`acct wants to a shop's withdrawals to land in an account (${C18})`, () => {
  for (const r of MANAGERS.filter((m) => m.side === "selling")) {
    test(`${r.given} point a shop here (${C18})`, async ({ page }) => {
      const g = ground[r.key];
      await openAccount(page, r);
      await provenGiven(page, r);

      // The WHEN: Linked shops → Point a Shop → Melati → Save.
      await page.getByTestId("open-shop-set").click();
      const dialog = page.getByTestId("shop-set");
      await expect(dialog).toBeVisible();
      await expect.soft(dialog).toContainText(`Point a Shop at ${BCA}`);
      await dialog.getByTestId("shop-select").click();
      await dialog.getByTestId(`shop-select-option-${g.shop}`).click();
      // The dialog says what pointing does: Melati names no account yet, so its withdrawals start landing here.
      await expect(dialog.getByTestId("shop-set-current")).toHaveText(
        `${melatiName(r)} names no account yet — its withdrawals start landing here.`,
      );
      await expect(page.getByTestId("shop-set-save")).toBeEnabled();
      const answered = page.waitForResponse((res: Response) =>
        res.url().endsWith("FinancialAccountService/FinancialAccountShopSet"),
      );
      await page.getByTestId("shop-set-save").click();
      expect((await answered).status()).toBe(200);
      await expect(dialog).toBeHidden();
      await expect.soft(page.getByText(`${melatiName(r)} withdraws into ${BCA} now`)).toBeVisible();

      await test.step("then: Melati's withdrawals land in this account", async () => {
        // Melati is BCA Penarikan's shop now — on its page's Linked shops, and in the contract the dialog reads.
        await gotoAccount(page, r);
        await expect(page.getByTestId("account-shops-none")).toHaveCount(0);
        await expect(page.getByTestId("account-shops")).toContainText(melatiName(r));
        await expect.soft(page.getByTestId("account-shops-count")).toHaveText("1 shop");
        expect(await accountOfShop(page, g.team, g.shop)).toEqual([g.bca]);

        // Two withdrawals from Melati, one after the other, both land in BCA Penarikan.
        await pushWithdrawal(page, `e2e-acct-point-${r.key}-1-${SUFFIX}`, g.team, g.shop, -250_000);
        await expect(async () => {
          await page.reload();
          await expect(page.getByTestId("account-detail-balance")).toHaveText(rp(250_000), { timeout: 3_000 });
        }).toPass({ timeout: 30_000 });
        await pushWithdrawal(page, `e2e-acct-point-${r.key}-2-${SUFFIX}`, g.team, g.shop, -150_000);
        await expect(async () => {
          await page.reload();
          await expect(page.getByTestId("account-detail-balance")).toHaveText(rp(400_000), { timeout: 3_000 });
        }).toPass({ timeout: 30_000 });
        const rows = logRows(page).filter({ hasText: "Withdrawal" });
        await expect(rows).toHaveCount(2);
        await expect(rows.filter({ hasText: `+${rp(250_000)}` })).toHaveCount(1);
        await expect(rows.filter({ hasText: `+${rp(150_000)}` })).toHaveCount(1);

        // …and nowhere else: no unknown account was made for Melati, and the team's money is these Rp 400.000.
        expect(await unknownIds(page, g.team)).toEqual([]);
        await page.goto("/financial-accounts");
        await expect(page.getByTestId("financial-accounts-table")).toBeVisible();
        const list = page.getByTestId("financial-accounts-table").locator('[data-testid^="account-row-"]');
        await expect(list).toHaveCount(1);
        await expect(page.getByTestId(`account-balance-${g.bca}`)).toHaveText(rp(400_000));
        await expect.soft(page.getByTestId(`account-shop-${g.bca}-${g.shop}`)).toHaveText(melatiName(r));
        await expect.soft(page.getByTestId("account-total-team-value")).toHaveText(rp(400_000));
      });
    });
  }

  // The warehouse half — see the CONFLICT note at the top.
  for (const r of MANAGERS.filter((m) => m.side === "warehouse")) {
    test(`${r.given} point a shop here (${C18}) — a warehouse's shop`, async ({ page }) => {
      test.fail(
        true,
        "conflict: a warehouse team has no shop — shops are the selling team's (docs/business/shop/context.md: " +
          "*Manage Shop for Selling Team*; ShopCreate and ShopList are selling roles only), its account page draws no " +
          "Linked shops card (linked-shops-sit-beside-the-cards) — so a warehouse has no Melati to point here, and " +
          "FinancialAccountShopSet refuses any shop id for it",
      );
      const g = ground[r.key];
      await openAccount(page, r);
      await provenGiven(page, r);

      await test.step("then: Melati's withdrawals land in this account", async () => {
        // The WHEN on the warehouse's own screen: Point a Shop, on a Linked shops card the page does not draw for a
        // team with no shops, and a shop for its picker to offer.
        const door = page.getByTestId("open-shop-set");
        await expect.soft(door).toBeVisible({ timeout: 5_000 });
        if ((await door.count()) > 0) {
          await door.click();
          const dialog = page.getByTestId("shop-set");
          await expect(dialog).toBeVisible();
          await dialog.getByTestId("shop-select").click();
          await expect.soft(dialog.locator('[data-testid^="shop-select-option-"]').first()).toBeVisible({ timeout: 5_000 });
          await page.keyboard.press("Escape");
        }

        // The same point through the contract, for the warehouse's "Melati" (a shop id no shop has).
        const set = await send(page, "financial_account.v1.FinancialAccountService/FinancialAccountShopSet", {
          teamId: g.team,
          shopId: g.shop,
          accountId: g.bca,
        });
        expect.soft(set.status, `FinancialAccountShopSet answered ${set.json.code ?? set.status}`).toBe(200);

        // Then its withdrawal would land in BCA Penarikan.
        await pushWithdrawal(page, `e2e-acct-point-${r.key}-1-${SUFFIX}`, g.team, g.shop, -250_000);
        await expect(async () => {
          await page.reload();
          await expect(page.getByTestId("account-detail-balance")).toHaveText(rp(250_000), { timeout: 3_000 });
        }).toPass({ timeout: 20_000 });
      });
    });
  }
});
