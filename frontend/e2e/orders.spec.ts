import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";

// #68 — Order list + detail (selling view). The list and the read-only detail are built on the #67
// OrderService RPCs. The Orders menu is a SELLING-team surface, but root holds ROLE_ROOT so OrderList
// is authorised in the root team; we reach the page by its route directly (menu gate is UX only).
//
// There is no order-CREATE UI yet (split into a sub-issue of #68), so the list starts empty; once a
// create flow exists it will populate the list + detail. The backend OrderCreate/List/Detail are
// unit-tested in selling_service.

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

test("Orders: the orders screen is reachable and starts empty", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  await page.goto("/orders");

  await expect(page.getByTestId("orders-table")).toBeVisible();
  await expect(page.getByTestId("orders-empty")).toBeVisible();
});
