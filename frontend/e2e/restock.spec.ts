import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";

// #105 — Restock requests (a selling team asks a warehouse to restock a product; the warehouse
// fulfils). This is a MINIMAL render check: a full create flow needs a seeded warehouse + products
// that the e2e DB does not have, so we only prove the shared list page renders.
//
// The Restock Requests menu lives in the Inventories sub-menu (warehouse/selling teams), but root
// holds ROLE_ROOT so RestockRequestList is authorised in the root team. We reach the page by its
// route directly — the menu gate is UX only.

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

test("Restock requests page renders for root", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  await page.goto("/inventories/requests");

  // The list always renders its table once loaded (empty for a fresh e2e DB). That is enough to
  // prove the page mounts, the client is wired, and the list RPC is reachable for root.
  await expect(page.getByTestId("restock-requests-table")).toBeVisible();
});
