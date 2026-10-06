import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";

// Supplier detail page + channels — the CRUD pass of docs/business/supplier. A channel is one store the
// supplier sells through: a channel type off the shared marketplace list, a name, a link
// (the-supplier-lists-only-its-online-stores, channel-type-is-the-marketplace-list). There is no
// online/offline switch; the server still wants one, and the translation step in features/suppliers/adapt.ts
// sends it.
//
// Only a selling team has suppliers (only-a-selling-team-has-suppliers), so the spec makes one — Root as its
// Owner — and works from it.

const SUFFIX = Date.now().toString().slice(-6);
const TEAM_NAME = `E2E Channel Team ${SUFFIX}`;
const TEAM_CODE = `CT${SUFFIX}`.slice(0, 10);
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

async function call(page: Page, method: string, body: unknown) {
  return page.evaluate(
    async ([m, b]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ??
        window.localStorage.getItem("warehouse_revamp.token");

      const res = await fetch(`http://localhost:8081/warehouse.${m as string}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(b),
      });

      return { status: res.status, body: await res.json() };
    },
    [method, body] as const,
  );
}

async function useSellingTeam(page: Page) {
  await page.getByTestId("team-switcher").click();
  await page.getByTestId("team-search").fill(TEAM_NAME);
  await page.getByTestId(/^team-option-/).first().click();
  await expect(page.getByTestId("team-switcher")).toContainText(TEAM_NAME);
}

async function gotoSuppliers(page: Page) {
  await page.goto("/inventories/suppliers");
  await expect(page.getByTestId("suppliers-table")).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("setup: a selling team to keep suppliers in", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = await call(page, "team.v1.TeamService/TeamCreate", {
    name: TEAM_NAME,
    teamCode: TEAM_CODE,
    type: "TEAM_TYPE_SELLING",
    ownerUserId: ROOT_USER_ID,
  });
  expect(team.status).toBe(200);
});

test("Detail + channel: create a supplier, open it, add a channel, then delete it", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await useSellingTeam(page);
  await gotoSuppliers(page);

  // A supplier to hang the channel off.
  await page.getByTestId("open-create-supplier").click();
  await page.getByTestId("supplier-name").fill(NAME);
  await page.getByTestId("submit-supplier").click();
  const row = page.locator('[data-testid^="supplier-row-"]', { hasText: NAME });
  await expect(row).toBeVisible();

  // Clicking the row opens the detail PAGE.
  await row.click();
  await expect(page.getByTestId("supplier-detail-page")).toBeVisible();
  await expect(page.getByTestId("supplier-detail-name")).toHaveText(NAME);

  // No channels yet.
  await expect(page.getByTestId("channels-empty")).toBeVisible();

  // Add a channel: a channel type (required) + a name. No online/offline switch.
  await page.getByTestId("add-channel").click();
  await expect(page.getByTestId("channel-location")).toHaveCount(0);

  // Submit stays disabled until a channel type is chosen and a name is filled.
  await expect(page.getByTestId("submit-channel")).toBeDisabled();

  await page.getByTestId("marketplace-select").click();
  await page.getByRole("option", { name: "Shopee" }).click();
  await page.getByTestId("channel-name").fill(CHANNEL_NAME);
  await page.getByTestId("channel-uri").fill("https://shopee.co.id/e2estore");

  await expect(page.getByTestId("submit-channel")).toBeEnabled();
  await page.getByTestId("submit-channel").click();

  // The channel appears in the list, wearing its marketplace.
  const channelsTable = page.getByTestId("channels-table");
  await expect(channelsTable).toBeVisible();
  await expect(channelsTable).toContainText(CHANNEL_NAME);
  await expect(channelsTable).toContainText("Shopee");
  await expect(channelsTable).toContainText("https://shopee.co.id/e2estore");

  // Delete it through the confirm dialog — the list goes back to empty.
  await page.locator('[data-testid^="delete-channel-"]').first().click();
  await page.getByTestId("confirm-action").click();

  await expect(page.getByTestId("channels-empty")).toBeVisible();
  // Gone from the channels section specifically — scoped so the lingering success toasts (which echo
  // the channel name) don't count as a match.
  await expect(page.getByTestId("channels-section")).not.toContainText(CHANNEL_NAME);
});
