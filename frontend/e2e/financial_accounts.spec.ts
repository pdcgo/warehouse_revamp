import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";

// The team's financial accounts, end to end — docs/business/financial_account/context_decision.md.
//
// Root in the root team, as the other money specs are: root holds ROLE_ROOT, so every scoped RPC is
// authorised there, and the pages are reached by their routes. One serial journey through the decisions,
// against the real server and Postgres:
//
//   a new account opens with its balance · a recorded number is refused · a transfer moves both ·
//   a reconcile posts the difference · a shop is pointed at an account · archived only at zero ·
//   a withdrawal from a shop with no account makes an unknown one — posted ONCE however often it arrives ·
//   the unknown one is moved into the real one · the report agrees with the accounts page.
//
// The withdrawal is POSTED to the listener's push route as Pub/Sub would deliver it: the e2e broker has no
// push subscriptions, so the route, the decode, the claim and the post are what is exercised here.

const SUFFIX = Date.now().toString().slice(-6);
const BCA_NAME = `E2E BCA ${SUFFIX}`;
const BCA_NUMBER = `88${SUFFIX}01`;
const KAS_NAME = `E2E Kas ${SUFFIX}`;
const SHOP_CODE = `FA${SUFFIX}`;
const SHOP_NAME = `E2E Account Shop ${SUFFIX}`;
// A shop id no shop has — the listener does not need the shop to exist to hold its money.
const ORPHAN_SHOP = 900_000 + Number(SUFFIX.slice(-5));
const ROOT_TEAM = 1;

const rp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

async function login(page: Page) {
  await page.goto("/");
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto("/login");
  await page.getByLabel("Username").fill(ROOT_USERNAME);
  await page.getByLabel("Password", { exact: true }).fill(ROOT_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toHaveText(ROOT_USERNAME);
}

async function gotoAccounts(page: Page) {
  await page.goto("/financial-accounts");
  await expect(page.getByTestId("financial-accounts-page")).toBeVisible();
}

const accountRow = (page: Page, name: string) =>
  page.getByTestId("financial-accounts-table").getByRole("row").filter({ hasText: name });

const balanceOf = (row: Locator) => row.locator('[data-testid^="account-balance-"]').first();

async function openMenu(page: Page, name: string) {
  await accountRow(page, name).getByRole("button", { name: "Account actions" }).click();
}

async function createAccount(page: Page, args: { name: string; cash?: boolean; provider: string; number?: string; opening: string }) {
  await page.getByTestId("open-create-account").click();

  const form = page.getByTestId("account-form");
  await expect(form).toBeVisible();

  await form.getByTestId("account-name").fill(args.name);
  if (args.cash) await form.getByTestId("account-type-3").click();
  await form.getByTestId("account-provider").click();
  await form.getByRole("option", { name: args.provider, exact: true }).click();
  if (args.number) await form.getByTestId("account-number").fill(args.number);
  await form.getByTestId("account-opening").fill(args.opening);
  await form.getByTestId("account-form-save").click();

  return form;
}

async function transfer(page: Page, from: string, to: string, amount: string) {
  await openMenu(page, from);
  await page.getByRole("menuitem", { name: "Transfer" }).click();

  const dialog = page.getByTestId("transfer");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("transfer-to").click();
  await dialog.getByRole("option").filter({ hasText: to }).click();
  await dialog.getByTestId("transfer-amount").fill(amount);
  await dialog.getByTestId("transfer-save").click();
  await expect(dialog).toBeHidden();
}

// Settlement's withdrawal row, as the broker pushes it to the listener's route.
function pushWithdrawal(eventId: string, shopId: number, change: number) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
  const event = {
    eventId,
    occurredAt: new Date().toISOString(),
    aggregateId: `settlement-log:${eventId}`,
    settlementLogPosted: {
      teamId: String(ROOT_TEAM),
      shopId: String(shopId),
      settlementType: "SETTLEMENT_TYPE_WITHDRAWAL",
      sourceType: "SOURCE_TYPE_IMPORTER",
      change: String(change),
      postedOn: today,
      occurredOn: today,
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

test.describe.configure({ mode: "serial" });

test("Setup: a shop of its own", async ({ page }) => {
  await login(page);
  await page.goto("/shops");
  await page.getByTestId("open-create-shop").click();
  await page.getByTestId("shop-name").fill(SHOP_NAME);
  await page.getByTestId("shop-code").fill(SHOP_CODE);
  await page.getByTestId("marketplace-select").click();
  await page.getByRole("option", { name: "Shopee" }).click();
  await page.getByTestId("submit-shop").click();

  await expect(page.getByTestId(`shop-row-${SHOP_CODE}`)).toBeVisible();
});

// an-account-opens-with-a-log-row — and every account says when it was last checked.
test("A new account opens with its balance", async ({ page }) => {
  await login(page);
  await gotoAccounts(page);

  await createAccount(page, { name: BCA_NAME, provider: "BCA", number: BCA_NUMBER, opening: "1000000" });

  const row = accountRow(page, BCA_NAME);
  await expect(row).toBeVisible();
  await expect(balanceOf(row)).toHaveText(rp(1_000_000));
  await expect(row).toContainText("Never checked");
});

// a-real-account-is-recorded-once.
test("A recorded number is refused", async ({ page }) => {
  await login(page);
  await gotoAccounts(page);

  const form = await createAccount(page, { name: `${BCA_NAME} again`, provider: "BCA", number: BCA_NUMBER, opening: "0" });

  await expect(form.getByTestId("account-form-error")).toContainText("already recorded");
});

// Two legs, one act — both balances move.
test("A transfer moves both balances", async ({ page }) => {
  await login(page);
  await gotoAccounts(page);

  await createAccount(page, { name: KAS_NAME, cash: true, provider: "Cash", opening: "0" });
  await expect(accountRow(page, KAS_NAME)).toBeVisible();

  await transfer(page, BCA_NAME, KAS_NAME, "250000");

  await expect(balanceOf(accountRow(page, BCA_NAME))).toHaveText(rp(750_000));
  await expect(balanceOf(accountRow(page, KAS_NAME))).toHaveText(rp(250_000));
});

// adjustment-is-for-reconciling-only — on the account's own page, the statement explains the balance.
test("A reconcile posts the difference", async ({ page }) => {
  await login(page);
  await gotoAccounts(page);

  await accountRow(page, BCA_NAME).getByText(BCA_NAME).click();
  await expect(page.getByTestId("financial-account-page")).toBeVisible();

  await page.locator('[data-testid^="account-reconcile-button-"]').click();
  const dialog = page.getByTestId("reconcile");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("reconcile-actual").fill("740000");
  await expect(dialog.getByTestId("reconcile-difference")).toContainText(rp(10_000));
  await expect(dialog.getByTestId("reconcile-save")).toBeDisabled();
  await dialog.getByTestId("reconcile-note").fill("bank fee");
  await dialog.getByTestId("reconcile-save").click();
  await expect(dialog).toBeHidden();

  await expect(page.getByTestId("account-detail-balance")).toHaveText(rp(740_000));
  await expect(page.getByTestId("account-detail-checked")).not.toHaveText("Never checked");

  const top = page.getByTestId("account-log-table").getByRole("row").nth(1);
  await expect(top).toContainText("Adjustment");
  await expect(top).toContainText("bank fee");
});

// a-shop-names-the-account-it-withdraws-into — asked of the shop first, then linked.
test("A shop is pointed at an account", async ({ page }) => {
  await login(page);
  await gotoAccounts(page);
  await accountRow(page, BCA_NAME).getByText(BCA_NAME).click();

  await page.getByTestId("open-shop-set").click();
  const dialog = page.getByTestId("shop-set");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("shop-select").click();
  await dialog.getByRole("option").filter({ hasText: SHOP_NAME }).click();
  await expect(dialog.getByTestId("shop-set-current")).toContainText("names no account yet");
  await dialog.getByTestId("shop-set-save").click();
  await expect(dialog).toBeHidden();

  await expect(page.getByTestId("account-shops")).toContainText(SHOP_NAME);
});

// an-account-is-archived-only-at-zero.
test("An account is archived only at zero", async ({ page }) => {
  await login(page);
  await gotoAccounts(page);

  await openMenu(page, KAS_NAME);
  const archive = page.getByRole("menuitem", { name: /Archive/ });
  await expect(archive).toHaveAttribute("aria-disabled", "true");
  await expect(archive).toContainText("only at zero");
  await page.keyboard.press("Escape");

  await transfer(page, KAS_NAME, BCA_NAME, "250000");
  await expect(balanceOf(accountRow(page, KAS_NAME))).toHaveText(rp(0));

  await openMenu(page, KAS_NAME);
  await page.getByRole("menuitem", { name: /Archive/ }).click();
  await page.getByTestId("confirm-action").click();

  await expect(accountRow(page, KAS_NAME)).toHaveCount(0);
});

// a-shop-with-no-account-gets-an-unknown-one — and one-contract-for-both-handler-types: the same event twice
// posts once.
test("A withdrawal from a shop with no account makes an unknown one, once", async ({ page, request }) => {
  const route = "http://localhost:8081/event/financial-account-withdrawal/push";
  const eventId = `e2e-withdrawal-${SUFFIX}`;

  for (let i = 0; i < 2; i++) {
    const res = await request.post(route, { data: pushWithdrawal(eventId, ORPHAN_SHOP, -150_000) });
    expect(res.status()).toBe(200);
  }

  await login(page);
  await gotoAccounts(page);

  const row = accountRow(page, `shop #${ORPHAN_SHOP}`);
  await expect(row).toContainText("Bank not named");
  await expect(balanceOf(row)).toHaveText(rp(150_000));
  // Its own totals card says it — the banner is gone (the-accounts-page-has-no-banners). 4 = UNKNOWN.
  await expect(page.getByTestId("account-total-4")).toBeVisible();
});

// an-unknown-account-is-filled-in-or-moved-in — MOVE IN: the money crosses, the unknown one is archived.
test("The unknown account is moved into the real one", async ({ page }) => {
  await login(page);
  await gotoAccounts(page);

  await accountRow(page, `shop #${ORPHAN_SHOP}`).getByText(`shop #${ORPHAN_SHOP}`).click();
  await expect(page.getByTestId("account-unknown-explained")).toBeVisible();

  await page.locator('[data-testid^="account-identify-button-"]').click();
  const dialog = page.getByTestId("identify");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("identify-move").click();
  await dialog.getByTestId("identify-into").click();
  await dialog.getByRole("option").filter({ hasText: BCA_NAME }).click();
  await dialog.getByTestId("identify-save").click();
  await expect(dialog).toBeHidden();

  await expect(page.getByTestId("account-detail-balance")).toHaveText(rp(0));
  await expect(page.getByText("Archived")).toBeVisible();

  await gotoAccounts(page);
  // 740.000 after the reconcile + 250.000 back from the cash box + the 150.000 withdrawal.
  await expect(balanceOf(accountRow(page, BCA_NAME))).toHaveText(rp(1_140_000));
  await expect(accountRow(page, `shop #${ORPHAN_SHOP}`)).toHaveCount(0);
});

// the-daily-row-is-written-with-the-log-row — the report never lags the balances.
test("The report agrees with the accounts page", async ({ page }) => {
  await login(page);
  await gotoAccounts(page);

  const total = await page.getByTestId("account-total-team-value").textContent();
  expect(total).toContain(rp(1_140_000));

  await page.getByTestId("open-account-report").click();
  await expect(page.getByTestId("account-report-page")).toBeVisible();
  await expect(page.getByTestId("account-report-close-value")).toHaveText(rp(1_140_000));
  await expect(page.getByTestId("account-report-series")).toBeVisible();
});
