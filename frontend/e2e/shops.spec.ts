import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";

// #66 — Shop management (a selling team's marketplace storefronts): create / edit / delete.
//
// The Shops menu is intentionally shown only for a SELLING team, but root holds ROLE_ROOT so the
// shop RPCs are authorised in the root team. We reach the page by its route directly — the menu
// gate is UX only.

const SUFFIX = Date.now().toString().slice(-6);
const CODE = `SH${SUFFIX}`;
const NAME = `E2E Shop ${SUFFIX}`;

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

// rpc calls the API with the page's own token, so a seed runs as the person the UI is signed in as.
async function rpc<T = Record<string, unknown>>(page: Page, method: string, body: unknown): Promise<T> {
  return page.evaluate(
    async ([m, b]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ??
        window.localStorage.getItem("warehouse_revamp.token");

      const res = await fetch(`http://localhost:8081/warehouse.${m}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(b),
      });

      if (!res.ok) throw new Error(`${m}: ${res.status} ${await res.text()}`);

      return res.json();
    },
    [method, body] as const,
  ) as Promise<T>;
}

async function rpcError(page: Page, method: string, body: unknown): Promise<string> {
  try {
    await rpc(page, method, body);
  } catch (err) {
    return String(err);
  }

  return "";
}

// The list, or — before the first shop — its hint (an-empty-list-shows-a-hint).
async function gotoShops(page: Page) {
  await page.goto("/shops");
  await expect(page.getByTestId("shops-table").or(page.getByTestId("shops-empty"))).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("Create: a new shop appears; marketplace is required", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoShops(page);

  await page.getByTestId("open-create-shop").click();

  await page.getByTestId("shop-name").fill(NAME);
  await page.getByTestId("shop-code").fill(CODE);
  await page.getByTestId("shop-description").fill("created by e2e");

  // Marketplace is required — Create stays disabled until one is chosen.
  await expect(page.getByTestId("submit-shop")).toBeDisabled();

  await page.getByTestId("marketplace-select").click();
  await page.getByRole("option", { name: "Shopee" }).click();

  await expect(page.getByTestId("submit-shop")).toBeEnabled();
  await page.getByTestId("submit-shop").click();

  await expect(page.getByTestId(`shop-row-${CODE}`)).toBeVisible();
  await expect(page.getByTestId(`shop-row-${CODE}`)).toContainText(NAME);
  await expect(page.getByTestId(`shop-row-${CODE}`)).toContainText("Shopee");
});

test("Read: the shop detail page opens from the row (#85)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoShops(page);

  await page.getByTestId(`open-shop-${CODE}`).click();

  await expect(page.getByTestId("shop-detail-page")).toBeVisible();
  await expect(page.getByTestId("shop-detail-name")).toHaveText(NAME);
  await expect(page.getByTestId("shop-detail-page")).toContainText(CODE);
  await expect(page.getByTestId("shop-detail-page")).toContainText("Shopee");

  await page.getByTestId("shop-detail-back").click();
  await expect(page.getByTestId("shops-table")).toBeVisible();
});

test("Users: grant and revoke a user's access to the shop (#86) — the first grant is the primary CS", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoShops(page);

  // the-primary-cs-is-a-flag-on-a-grant: a shop nobody is granted has no primary — and says so.
  await expect(page.getByTestId(`shop-no-primary-${CODE}`)).toBeVisible();

  await page.getByTestId(`open-shop-${CODE}`).click();
  await expect(page.getByTestId("shop-users-section")).toBeVisible();
  await expect(page.getByTestId("shop-users-empty")).toBeVisible();
  await expect(page.getByTestId("shop-no-primary")).toBeVisible();

  // Grant root access via the shared user picker.
  await page.getByTestId("user-select").locator("input").fill(ROOT_USERNAME);
  await page.getByTestId(`user-select-option-${ROOT_USERNAME}`).click();
  await page.getByTestId("shop-add-user").click();

  await expect(page.getByTestId(`shop-user-row-${ROOT_USERNAME}`)).toBeVisible();

  // The first user granted becomes the primary CS — the badge, and the warning gone.
  await expect(page.getByTestId(`shop-user-primary-${ROOT_USERNAME}`)).toBeVisible();
  await expect(page.getByTestId("shop-no-primary")).toBeHidden();

  // Revoke it again — and the shop is left with none.
  await page.getByTestId(`remove-shop-user-${ROOT_USERNAME}`).click();
  await page.getByTestId("confirm-action").click();
  await expect(page.getByTestId(`shop-user-row-${ROOT_USERNAME}`)).toBeHidden();
  await expect(page.getByTestId("shop-no-primary")).toBeVisible();
});

// a-grant-goes-only-to-a-team-member: the picker offers only the team's members, and the SERVER refuses anyone else —
// here a teamless account, granted by id past the picker. Nothing is written.
test("Users: a person outside the shop's team is refused a grant", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const outsider = await rpc<{ user: { id: string } }>(page, "user.v1.UserService/CreateUser", {
    teamId: 0,
    username: `e2eoutsider${SUFFIX}`,
    password: "e2epassword1",
    name: `Outsider ${SUFFIX}`,
  });

  await gotoShops(page);
  await page.getByTestId(`open-shop-${CODE}`).click();
  await expect(page.getByTestId("shop-users-section")).toBeVisible();
  const shopId = new URL(page.url()).pathname.split("/").pop();

  // The shop is in the team the page works in: the one this tab picked, else the root team Root starts in.
  const teamId = (await page.evaluate(() => window.sessionStorage.getItem("warehouse_revamp.team"))) ?? "1";

  const refused = await rpcError(page, "selling.v1.ShopService/ShopUserAdd", { teamId, shopId, userId: outsider.user.id });
  expect(refused).toContain("failed_precondition");
  expect(refused).toContain("not a member");

  // The picker never offered them either.
  await page.getByTestId("user-select").locator("input").fill(`e2eoutsider${SUFFIX}`);
  await expect(page.getByTestId(`user-select-option-e2eoutsider${SUFFIX}`)).toHaveCount(0);
  await expect(page.getByTestId(`shop-user-row-e2eoutsider${SUFFIX}`)).toHaveCount(0);
});

test("Edit: rename and change marketplace; both persist", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoShops(page);

  await page.getByTestId(`edit-${CODE}`).click();

  // Pre-filled from the row.
  await expect(page.getByTestId("shop-name")).toHaveValue(NAME);

  await page.getByTestId("shop-name").fill(`${NAME} renamed`);
  await page.getByTestId("marketplace-select").click();
  await page.getByRole("option", { name: "Tokopedia" }).click();
  await page.getByTestId("submit-shop").click();

  await expect(page.getByTestId(`shop-row-${CODE}`)).toContainText(`${NAME} renamed`);
  await expect(page.getByTestId(`shop-row-${CODE}`)).toContainText("Tokopedia");
});

// #16 — the marketplace, the primary CS and "no primary CS" narrow the list ON THE SERVER (ShopListFilter), so a pick
// is no longer kept and thrown away. Two more shops beside CODE (Tokopedia since the edit, no primary since the revoke):
// a Lazada one whose primary is root, and a Lazada one with nobody. The search pins the run's own shops.
test("Filters: marketplace, primary CS and no primary CS narrow the list (#16)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const withCs = `SL${SUFFIX}`;
  const without = `SN${SUFFIX}`;
  const created = await rpc<{ shop: { id: string } }>(page, "selling.v1.ShopService/ShopCreate", {
    teamId: "1",
    name: `E2E Shop CS ${SUFFIX}`,
    shopCode: withCs,
    marketplace: "MARKETPLACE_LAZADA",
  });
  await rpc(page, "selling.v1.ShopService/ShopUserAdd", { teamId: "1", shopId: created.shop.id, userId: ROOT_USER_ID });
  await rpc(page, "selling.v1.ShopService/ShopCreate", {
    teamId: "1",
    name: `E2E Shop NoCS ${SUFFIX}`,
    shopCode: without,
    marketplace: "MARKETPLACE_LAZADA",
  });

  // THE MARKETPLACE, picked on the screen.
  await page.goto(`/shops?q=${SUFFIX}`);
  await expect(page.getByTestId(`shop-row-${CODE}`)).toBeVisible();
  await page.getByTestId("shops-marketplace-select").click();
  await page.getByRole("option", { name: "Lazada" }).click();
  await expect(page.getByTestId(`shop-row-${CODE}`)).toBeHidden();
  await expect(page.getByTestId(`shop-row-${withCs}`)).toBeVisible();
  await expect(page.getByTestId(`shop-row-${without}`)).toBeVisible();
  await expect(page.locator('[data-testid^="not-implemented-"]')).toHaveCount(0);

  // THE PRIMARY CS — root is the first (so the primary) grant on one shop only.
  await page.goto(`/shops?q=${SUFFIX}&cs=${ROOT_USER_ID}`);
  await expect(page.getByTestId(`shop-row-${withCs}`)).toBeVisible();
  await expect(page.getByTestId(`shop-row-${without}`)).toBeHidden();
  await expect(page.getByTestId(`shop-row-${CODE}`)).toBeHidden();

  // NO PRIMARY CS — the two nobody holds.
  await page.goto(`/shops?q=${SUFFIX}&nocs=1`);
  await expect(page.getByTestId(`shop-row-${without}`)).toBeVisible();
  await expect(page.getByTestId(`shop-row-${CODE}`)).toBeVisible();
  await expect(page.getByTestId(`shop-row-${withCs}`)).toBeHidden();

  // A person and nobody at once is refused by the server, not answered with an empty list.
  const refused = await rpcError(page, "selling.v1.ShopService/ShopList", {
    teamId: "1",
    filter: { primaryUserId: ROOT_USER_ID, noPrimary: true },
    page: { page: 1, limit: 20 },
  });
  expect(refused).toContain("invalid_argument");
});

test("Delete: the shop is gone", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoShops(page);

  await page.getByTestId(`delete-${CODE}`).click();
  await page.getByTestId("confirm-action").click();

  await expect(page.getByTestId(`shop-row-${CODE}`)).toBeHidden();
});
