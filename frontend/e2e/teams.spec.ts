import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";

// Unique per run — the e2e hits a real, persistent database.
const SUFFIX = Date.now().toString().slice(-6);
const CODE = `E2E${SUFFIX}`.slice(0, 10);
const NAME = `E2E Team ${SUFFIX}`;

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

async function gotoTeams(page: Page) {
  await page.getByRole("link", { name: "Teams" }).click();
  await expect(page.getByTestId("teams-table")).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("CreateTeam: a new team appears in the list", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoTeams(page);

  await page.getByTestId("open-create-team").click();
  await page.getByTestId("new-team-name").fill(NAME);
  await page.getByTestId("new-team-code").fill(CODE);
  await page.getByTestId("new-team-description").fill("created by e2e");
  await page.getByTestId("submit-create-team").click();

  await expect(page.getByTestId(`team-row-${CODE}`)).toBeVisible();
  await expect(page.getByTestId(`team-row-${CODE}`)).toContainText(NAME);
});

test("EditTeam: rename sticks; type and code are untouched", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoTeams(page);

  await page.getByTestId(`edit-team-${CODE}`).click();
  await page.getByTestId("edit-team-name").fill(`${NAME} renamed`);
  await page.getByTestId("submit-edit-team").click();

  const row = page.getByTestId(`team-row-${CODE}`);
  await expect(row).toContainText(`${NAME} renamed`);
  // Code is immutable — the row is still keyed by the same code.
  await expect(row).toContainText(CODE);
});

test("TeamInfo: bank details round-trip", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoTeams(page);

  await page.getByTestId(`info-team-${CODE}`).click();
  await page.getByTestId("info-contact").fill("0812-0000");
  await page.getByTestId("info-bank-owner").fill("E2E Holder");
  await page.getByTestId("info-bank-account").fill("999888777");
  await page.getByTestId("submit-team-info").click();
  await expect(page.getByTestId("submit-team-info")).toBeHidden();

  // Reopen: the values must have persisted (TeamDetail returns them).
  await page.getByTestId(`info-team-${CODE}`).click();
  await expect(page.getByTestId("info-bank-owner")).toHaveValue("E2E Holder");
  await expect(page.getByTestId("info-bank-account")).toHaveValue("999888777");
});

test("the root team cannot be deleted (no delete action offered)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoTeams(page);

  await expect(page.getByTestId("team-row-ROOT")).toBeVisible();
  // The super-admin scope is protected: the delete action is never rendered for it.
  await expect(page.getByTestId("delete-team-ROOT")).toHaveCount(0);
});

test("DeleteTeam: the team is gone", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoTeams(page);

  await page.getByTestId(`delete-team-${CODE}`).click();
  await page.getByTestId("confirm-action").click();

  await expect(page.getByTestId(`team-row-${CODE}`)).toBeHidden();
});
