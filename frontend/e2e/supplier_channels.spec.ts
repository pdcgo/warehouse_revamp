import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";

// #120 — Supplier detail page + channels: open a supplier's detail PAGE (reached by clicking its
// row), then add / delete the ONLINE (marketplace store) and OFFLINE (physical shop) ways the team
// reaches that vendor.
//
// Root holds ROLE_ROOT, so the supplier + channel RPCs are authorised in the root team. We reach the
// suppliers page by its route directly — the menu gate is UX only.

const SUFFIX = Date.now().toString().slice(-6);
const CODE = `SCH${SUFFIX}`;
const NAME = `E2E Channel Supplier ${SUFFIX}`;
const CHANNEL_NAME = `E2E Shopee Store ${SUFFIX}`;

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

async function gotoSuppliers(page: Page) {
  await page.goto("/inventories/suppliers");
  await expect(page.getByTestId("suppliers-table")).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("Detail + channel: create a supplier, open it, add an online channel, then delete it", async ({
  page,
}) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoSuppliers(page);

  // A supplier to hang the channel off.
  await page.getByTestId("open-create-supplier").click();
  await page.getByTestId("supplier-code").fill(CODE);
  await page.getByTestId("supplier-name").fill(NAME);
  await page.getByTestId("submit-supplier").click();
  await expect(page.getByTestId(`supplier-row-${CODE}`)).toBeVisible();

  // Clicking the row opens the detail PAGE.
  await page.getByTestId(`supplier-row-${CODE}`).click();
  await expect(page.getByTestId("supplier-detail-page")).toBeVisible();
  await expect(page.getByTestId("supplier-detail-name")).toHaveText(NAME);

  // No channels yet.
  await expect(page.getByTestId("channels-empty")).toBeVisible();

  // Add an ONLINE channel: a marketplace (required) + a name.
  await page.getByTestId("add-channel").click();

  // Submit stays disabled until a marketplace is chosen and a name is filled.
  await expect(page.getByTestId("submit-channel")).toBeDisabled();

  await page.getByTestId("marketplace-select").click();
  await page.getByRole("option", { name: "Shopee" }).click();
  await page.getByTestId("channel-name").fill(CHANNEL_NAME);
  await page.getByTestId("channel-url").fill("https://shopee.co.id/e2estore");

  await expect(page.getByTestId("submit-channel")).toBeEnabled();
  await page.getByTestId("submit-channel").click();

  // The channel appears in the list, tagged Online.
  const channelsTable = page.getByTestId("channels-table");
  await expect(channelsTable).toBeVisible();
  await expect(channelsTable).toContainText(CHANNEL_NAME);
  await expect(channelsTable).toContainText("Online");
  await expect(channelsTable).toContainText("Shopee");

  // Delete it through the confirm dialog — the list goes back to empty.
  await page.locator('[data-testid^="delete-channel-"]').first().click();
  await page.getByTestId("confirm-action").click();

  await expect(page.getByTestId("channels-empty")).toBeVisible();
  // Gone from the channels section specifically — scoped so the lingering success toasts (which echo
  // the channel name) don't count as a match.
  await expect(page.getByTestId("channels-section")).not.toContainText(CHANNEL_NAME);
});
