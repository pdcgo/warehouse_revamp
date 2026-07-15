import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";

// #34 — the curated shared-components showcase: a navigable gallery, plus the two new shared
// pickers it must include (ShippingSelect and the nested CategorySelect).

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

test("the showcase loads, is navigable, and includes the shipping and nested-category pickers", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  // It is a dev page — reached by URL, not the main menu.
  await page.goto("/components");
  await expect(page.getByTestId("components-page")).toBeVisible();

  // The navigation requirement: a sidebar links to every component, including the two this
  // issue adds.
  const nav = page.getByRole("navigation");
  await expect(nav.getByRole("link", { name: "ShippingSelect" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "CategorySelect" })).toBeVisible();

  // Both required pickers render in the gallery (their triggers exist regardless of whether the
  // backing catalogue has data yet).
  await expect(page.getByTestId("shipping-select")).toBeVisible();
  await expect(page.getByTestId("category-select")).toBeVisible();

  // The nav anchor jumps to the component's card.
  await nav.getByRole("link", { name: "CategorySelect" }).click();
  await expect(page).toHaveURL(/#category-select$/);
});
