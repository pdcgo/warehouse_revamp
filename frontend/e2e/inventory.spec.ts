import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";

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

// The full receive/adjust flow is covered by the inventory_service Go unit tests (it needs a
// warehouse team + a product, which the e2e DB does not seed). Here we prove the screen is wired:
// reachable from the nav (root/admin), and it prompts for a warehouse before loading anything.
test("Inventory: the stock screen is reachable and prompts for a warehouse", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  await page.getByRole("link", { name: "Inventory" }).click();
  await expect(page).toHaveURL(/\/inventory$/);
  await expect(page.getByTestId("inventory-pick-warehouse")).toBeVisible();
});

// #95 — the Inventories sub-menu. The group shows for selling/warehouse teams (root reaches the
// routes directly). Restock reuses the stock screen under its own title; Placements is a stub.
test("Inventories: Restock reuses the stock screen", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  await page.goto("/inventories/restock");
  await expect(page.getByRole("heading", { name: "Restock" })).toBeVisible();
  await expect(page.getByTestId("inventory-pick-warehouse")).toBeVisible();
});

test("Inventories: Placements is a stub until warehouse locations exist", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  await page.goto("/inventories/placements");
  await expect(page.getByTestId("placements-page")).toBeVisible();
  await expect(page.getByText("Placements are coming soon")).toBeVisible();
});
