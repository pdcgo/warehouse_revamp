import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";

// Supplier management — the CRUD pass of docs/business/supplier (manage-and-discover-are-two-pages: this is
// the MANAGE page). Create / edit / delete, in the decided shape: a name, a contact, an address and a
// description, with no code (the-supplier-has-no-code) and no city or province
// (no-province-city-or-soft-delete). The server still wants a code; the translation step in
// features/suppliers/adapt.ts makes one up, and passing here proves it against the real server.
//
// Only a selling team has suppliers (only-a-selling-team-has-suppliers), so the spec makes one — Root as
// its Owner — and works from it. The root team gets no New Supplier.

const SUFFIX = Date.now().toString().slice(-6);
const TEAM_NAME = `E2E Supplier Team ${SUFFIX}`;
const TEAM_CODE = `ST${SUFFIX}`.slice(0, 10);
const NAME = `E2E Supplier ${SUFFIX}`;

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

// A row is keyed by the supplier's id, which the spec does not know — so it is found by its name.
const row = (page: Page, name: string) => page.locator('[data-testid^="supplier-row-"]', { hasText: name });

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

test("Create: a new supplier appears; only the name is required, and there is no code", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await useSellingTeam(page);
  await gotoSuppliers(page);

  await page.getByTestId("open-create-supplier").click();

  // Name is the one required field — Create stays disabled until it is filled.
  await expect(page.getByTestId("submit-supplier")).toBeDisabled();
  await expect(page.getByTestId("supplier-code")).toHaveCount(0);
  await expect(page.getByTestId("supplier-city")).toHaveCount(0);

  await page.getByTestId("supplier-name").fill(NAME);
  await page.getByTestId("supplier-contact").fill("0812-3456-7890");
  await page.getByTestId("supplier-address").fill("Jl. Merdeka 1, Bandung");
  await page.getByTestId("supplier-description").fill("created by e2e");

  await expect(page.getByTestId("submit-supplier")).toBeEnabled();
  await page.getByTestId("submit-supplier").click();

  await expect(row(page, NAME)).toBeVisible();
  await expect(row(page, NAME)).toContainText("Jl. Merdeka 1, Bandung");
});

test("Edit: rename and change the address; both persist", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await useSellingTeam(page);
  await gotoSuppliers(page);

  await row(page, NAME).getByTestId(/^edit-supplier-/).click();

  // Pre-filled from the row.
  await expect(page.getByTestId("supplier-name")).toHaveValue(NAME);

  await page.getByTestId("supplier-name").fill(`${NAME} renamed`);
  await page.getByTestId("supplier-address").fill("Jl. Sudirman 5, Jakarta");
  await page.getByTestId("submit-supplier").click();

  await expect(row(page, `${NAME} renamed`)).toContainText("Jl. Sudirman 5, Jakarta");
});

test("Delete: the supplier is gone", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await useSellingTeam(page);
  await gotoSuppliers(page);

  await row(page, NAME).getByTestId(/^delete-supplier-/).click();
  await page.getByTestId("confirm-action").click();

  await expect(row(page, NAME)).toHaveCount(0);
});
