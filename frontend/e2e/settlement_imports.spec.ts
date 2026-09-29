import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";

// The settlement importer, end to end (docs/business/settlement/settlement_importer.md): a Shopee statement
// uploaded through the Import File dialog, streamed through the REAL importer — the shop check, the
// document store, the order lookup, settlement — and read back on the file's own page.
//
// Root in the root team, as the other selling specs are: root holds ROLE_ROOT, so every scoped RPC is
// authorised there, and the page is reached by its route. The shop is this spec's own.
//
// The statement is SYNTHETIC (e2e/fixtures/shopee_statement.xlsx) — five rows, no real seller:
//
//   1  Penghasilan dari Pesanan  E2EREF0001   185.000   no such order → POSTED to the shop
//   2  Penghasilan dari Pesanan  E2EREF0002    92.000   no such order → POSTED to the shop
//   3  Penarikan Dana, Transaksi Selesai      −150.000   → POSTED, withdrawal
//   4  Penarikan Dana, Gagal                   −50.000   → SKIPPED (only-a-successful-withdrawal-is-recorded)
//   5  Biaya Program Baru                      −15.000   a type nobody mapped → HELD

const SUFFIX = Date.now().toString().slice(-6);
const SHOP_CODE = `IMP${SUFFIX}`;
const SHOP_NAME = `E2E Import Shop ${SUFFIX}`;
const STATEMENT = readFileSync(new URL("./fixtures/shopee_statement.xlsx", import.meta.url));

async function login(page: Page, username: string, password: string) {
  await page.goto("/");
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toHaveText(username);
}

// Opens the Import File dialog, picks this spec's shop, attaches the statement and starts the import.
async function importStatement(page: Page) {
  await page.goto("/settlement/imports");
  await page.getByTestId("open-import-file").click();

  const dialog = page.getByTestId("import-dialog");
  await expect(dialog).toBeVisible();

  await dialog.getByTestId("shop-select").click();
  await dialog.getByRole("option").filter({ hasText: SHOP_NAME }).click();

  await dialog.getByTestId("import-file-input").setInputFiles({
    name: "statement.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: STATEMENT,
  });
  await expect(dialog.getByTestId("import-file-name")).toContainText("statement.xlsx");

  await dialog.getByTestId("start-import").click();

  return dialog;
}

test.describe.configure({ mode: "serial" });

test("Setup: a Shopee shop of its own", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.goto("/shops");
  await page.getByTestId("open-create-shop").click();
  await page.getByTestId("shop-name").fill(SHOP_NAME);
  await page.getByTestId("shop-code").fill(SHOP_CODE);
  await page.getByTestId("marketplace-select").click();
  await page.getByRole("option", { name: "Shopee" }).click();
  await page.getByTestId("submit-shop").click();

  await expect(page.getByTestId(`shop-row-${SHOP_CODE}`)).toBeVisible();
  await expect(page.getByTestId(`shop-no-primary-${SHOP_CODE}`)).toBeVisible();
});

// a-shop-with-no-primary-cs-cannot-import: refused at the shop check, before anything is stored.
test("A shop with no primary CS cannot import — nothing is stored", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const dialog = await importStatement(page);

  await expect(dialog.getByTestId("import-failed-reason")).toContainText("choose a primary CS first", { timeout: 15_000 });
  await expect(dialog.getByTestId("open-imported-file")).toHaveCount(0);

  await dialog.getByTestId("import-close").click();

  // No row: the file was never stored.
  await expect(page.getByRole("row").filter({ hasText: SHOP_NAME })).toHaveCount(0);
});

// the-import-is-one-streamed-call: the bar reaches the end, the tallies are the file's, and the closing
// summary names what did not simply post — then the file's own page lists them.
test("A Shopee statement streams to its end, and its page shows what did not post", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  // The first user granted becomes the shop's primary CS (the-primary-cs-is-a-flag-on-a-grant).
  await page.goto("/shops");
  await page.getByTestId(`open-shop-${SHOP_CODE}`).click();
  await page.getByTestId("user-select").locator("input").fill(ROOT_USERNAME);
  await page.getByTestId(`user-select-option-${ROOT_USERNAME}`).click();
  await page.getByTestId("shop-add-user").click();
  await expect(page.getByTestId(`shop-user-primary-${ROOT_USERNAME}`)).toBeVisible();

  const dialog = await importStatement(page);

  await expect(dialog.getByTestId("import-progress-text")).toHaveText("5 of 5 rows", { timeout: 30_000 });
  await expect(dialog.getByTestId("import-summary")).toContainText("4 lines need a look", { timeout: 15_000 });
  await expect(dialog.getByTestId("import-problem")).toHaveCount(4);
  await expect(dialog.getByTestId("tally-posted-value")).toHaveText("3");
  await expect(dialog.getByTestId("tally-held-value")).toHaveText("1");
  await expect(dialog.getByTestId("tally-skipped-value")).toHaveText("1");

  // The file's own page, one click away.
  await dialog.getByTestId("open-imported-file").click();
  await expect(page.getByTestId("import-detail-shop")).toContainText(SHOP_NAME);
  await expect(page.getByTestId("import-detail-period")).toContainText("2026-09-01");

  // HELD first — the type nobody has mapped.
  await expect(page.getByTestId("lines-note")).toContainText("upload the same file again");
  await expect(page.locator('[data-testid^="line-row-"]')).toHaveCount(1);
  await expect(page.locator('[data-testid^="line-reason-"]').first()).toContainText("nobody has mapped");

  // SKIPPED — the withdrawal that failed.
  await page.getByTestId("lines-tab-skipped").click();
  await expect(page.locator('[data-testid^="line-reason-"]').first()).toContainText("did not succeed");

  // POSTED TO THE SHOP — two refs no order carries.
  await page.getByTestId("lines-tab-toShop").click();
  await expect(page.locator('[data-testid^="line-row-"]')).toHaveCount(2);
  await expect(page.locator('[data-testid^="line-reason-"]').first()).toContainText("No order with this ref");
});

// the-row-key-is-the-only-dedupe: the same file again is a second upload whose lines read already there.
test("The same statement again posts nothing — every line is already there", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const dialog = await importStatement(page);

  await expect(dialog.getByTestId("import-progress-text")).toHaveText("5 of 5 rows", { timeout: 30_000 });
  await expect(dialog.getByTestId("tally-posted-value")).toHaveText("0", { timeout: 15_000 });
  await expect(dialog.getByTestId("tally-existing-value")).toHaveText("3");

  await dialog.getByTestId("import-close").click();

  // Two rows for one shop — the list keeps every upload.
  await expect(page.getByRole("row").filter({ hasText: SHOP_NAME })).toHaveCount(2);
});
