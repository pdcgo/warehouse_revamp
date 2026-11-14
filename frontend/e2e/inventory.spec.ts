import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";
import { signIn } from "./session";

async function login(page: Page, username: string, password: string) {
  await signIn(page, username, password);
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

// The old Inventories ▸ Stock address FORWARDS (a-warehouses-products-is-what-it-holds): what a warehouse holds is its
// Products now, and root and the admin team read it on Inventory — so root, opening the old address, lands there. (A
// warehouse lands on its Products: found_requests.spec.ts.)
test("Inventories: the old Stock address forwards root to Inventory", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  await page.goto("/inventories/stock");
  await expect(page).toHaveURL(/\/inventory$/);
  await expect(page.getByRole("heading", { name: "Inventory" })).toBeVisible();
  await expect(page.getByTestId("inventory-pick-warehouse")).toBeVisible();
});
