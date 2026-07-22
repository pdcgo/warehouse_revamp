import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";

// Switching team, and the membership list the switcher reads.
//
// This exists because of a bug found while MEASURING something else (#178): a team you had just
// created was missing from the switcher until you reloaded the page. Two different caches — the team
// LIST is a query, the caller's MEMBERSHIPS are TeamContext — and creating a team refreshed only the
// first. It bit precisely where it was least wanted, because TeamCreate makes the caller the new
// team's OWNER, so switching into it is the obvious next thing to do.

const SUFFIX = Date.now().toString().slice(-6);
const WH_NAME = `Switch WH ${SUFFIX}`;
const WH_CODE = `SW${SUFFIX}`;

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

test("a team you just created is switchable WITHOUT a reload", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  await page.getByRole("navigation").first().getByRole("link", { name: "Teams", exact: true }).click();
  await page.getByTestId("teams-tab-warehouse").click();
  await page.getByTestId("open-create-warehouse").click();
  await page.getByTestId("new-team-name").fill(WH_NAME);
  await page.getByTestId("new-team-code").fill(WH_CODE);
  await page.getByTestId("submit-create-team").click();
  await expect(page.getByTestId(`team-row-${WH_CODE}`)).toBeVisible();

  // NO reload. The switcher reads TeamContext's memberships, which the create must have refreshed —
  // remove that refresh and this fails here, with the new team absent from the list.
  await page.getByTestId("team-switcher").click();
  await page.getByTestId("team-search").fill(WH_NAME);
  await page.getByTestId(/^team-option-/).first().click();

  // The switch is a full reload by design (#178): nothing from the previous scope can survive,
  // because nothing survives. So the assertion is that the app comes back, in the new team.
  await expect(page.getByTestId("team-switcher")).toContainText(WH_NAME);
  await expect(page.getByTestId("current-user")).toHaveText(ROOT_USERNAME);
});
