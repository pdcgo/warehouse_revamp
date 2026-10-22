import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";

// Bundles — a selling team's picking recipes (docs/business/product/product_bundle.md), end to end against the real
// BundleService: made on the form, found by a product in it, opened on its page, changed, deleted. And the two rules
// that only hold with the whole stack in place:
//
//   a-bundle-has-at-least-one-line            the validation interceptor refuses an empty bundle
//   the-creator-or-an-admin-edits-a-bundle    the access interceptor hands the handler the caller's role, and a CS is
//                                             narrowed to her own bundles
//
// Only a selling team has bundles, so the spec makes one — Root as its Owner — with two products in it.

const SUFFIX = Date.now().toString().slice(-6);
const TEAM_NAME = `E2E Bundle Team ${SUFFIX}`;
const TEAM_CODE = `BT${SUFFIX}`.slice(0, 10);
const BERAS = `Beras E2E ${SUFFIX}`;
const GULA = `Gula E2E ${SUFFIX}`;
const BUNDLE = `Paket E2E ${SUFFIX}`;
const RENAMED = `Paket E2E Baru ${SUFFIX}`;
const CS_USERNAME = `cs${SUFFIX}`;
const CS_PASSWORD = "cs-password-e2e";

// Ids made in the setup and read by the tests after it — the file runs serially, in one worker.
let teamId = "";
let berasId = "";
let gulaId = "";

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

// An RPC as the signed-in person, or — given a token — as somebody else.
async function call(page: Page, method: string, body: unknown, token?: string) {
  return page.evaluate(
    async ([m, b, tk]) => {
      const bearer =
        (tk as string | undefined) ??
        window.sessionStorage.getItem("warehouse_revamp.token") ??
        window.localStorage.getItem("warehouse_revamp.token");

      const res = await fetch(`http://localhost:8081/warehouse.${m as string}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
        body: JSON.stringify(b),
      });

      return { status: res.status, body: await res.json() };
    },
    [method, body, token] as const,
  );
}

async function useSellingTeam(page: Page) {
  await page.getByTestId("team-switcher").click();
  await page.getByTestId("team-search-mine").click();
  await page.getByTestId("team-search").fill(TEAM_NAME);
  await page.getByTestId(/^team-option-/).first().click();
  await expect(page.getByTestId("team-switcher")).toContainText(TEAM_NAME);
}

const row = (page: Page, name: string) => page.locator('[data-testid^="bundle-row-"]', { hasText: name }).first();

test.describe.configure({ mode: "serial" });

test("setup: a selling team with two products, and a CS in it", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = await call(page, "team.v1.TeamService/TeamCreate", {
    name: TEAM_NAME,
    teamCode: TEAM_CODE,
    type: "TEAM_TYPE_SELLING",
    ownerUserId: ROOT_USER_ID,
  });
  expect(team.status).toBe(200);
  teamId = team.body.team.id;

  const category = await call(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Bundle Cat ${SUFFIX}` });
  expect(category.status).toBe(200);

  for (const [name, sku] of [
    [BERAS, `BRS${SUFFIX}`],
    [GULA, `GLA${SUFFIX}`],
  ] as const) {
    const product = await call(page, "product.v1.ProductService/ProductCreate", {
      teamId,
      sku,
      name,
      categoryId: category.body.category.id,
    });
    expect(product.status).toBe(200);
    if (name === BERAS) berasId = product.body.product.id;
    else gulaId = product.body.product.id;
  }

  const cs = await call(page, "user.v1.UserService/CreateUser", {
    teamId,
    username: CS_USERNAME,
    password: CS_PASSWORD,
    name: `CS E2E ${SUFFIX}`,
    role: "ROLE_SELLING_CS",
  });
  expect(cs.status).toBe(200);
});

test("Create: the form makes a bundle, and it opens on its own page", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await useSellingTeam(page);

  await page.goto("/products/bundles");
  await expect(page.getByTestId("bundles-page")).toBeVisible();
  await page.getByTestId("open-create-bundle").click();
  await expect(page).toHaveURL(/\/products\/bundles\/new$/);

  // A name and a product are both required.
  await expect(page.getByTestId("bundle-save")).toBeDisabled();
  await page.getByTestId("bundle-name").fill(BUNDLE);

  await page.getByRole("button", { name: "Add Products" }).click();
  for (const id of [berasId, gulaId]) {
    const option = page.getByTestId(`product-picker-option-${id}`);
    await expect(option).toBeVisible();
    // The CONTROL, as orders.spec.ts explains: Chakra's hidden input listens there, not on the row's centre.
    await option.locator('[data-part="control"]').click();
  }
  await page.getByTestId("product-picker-confirm").click();

  // Two of the second product in one bundle.
  await expect(page.getByTestId("bundle-line-1")).toContainText(GULA);
  await page.getByTestId("bundle-line-1-quantity-plus").click();
  await expect(page.getByTestId("bundle-line-1-quantity")).toHaveValue("2");

  await page.getByTestId("bundle-save").click();

  await expect(page).toHaveURL(/\/products\/bundles\/\d+$/);
  await expect(page.getByTestId("bundle-detail-title")).toHaveText(BUNDLE);
  await expect(page.getByTestId("bundle-stock-1")).toContainText(GULA);
});

test("List: the bundle shows what is in it, and is found by a product inside it", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await useSellingTeam(page);
  await page.goto("/products/bundles");

  await expect(row(page, BUNDLE)).toContainText(`2 × ${GULA}`);

  await page.getByTestId("bundle-search").fill(`Gula E2E ${SUFFIX}`);
  await expect(row(page, BUNDLE)).toBeVisible();

  await page.getByTestId("bundle-search").fill(`nothing-${SUFFIX}`);
  await expect(page.getByTestId("bundles-none-match")).toBeVisible();
});

test("Edit: the form changes it, and Save returns to its page", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await useSellingTeam(page);
  await page.goto("/products/bundles");

  await row(page, BUNDLE).click();
  await page.getByTestId("bundle-detail-edit").click();
  await expect(page).toHaveURL(/\/products\/bundles\/\d+\/edit$/);

  await page.getByTestId("bundle-name").fill(RENAMED);
  await page.getByTestId("bundle-save").click();

  await expect(page.getByTestId("bundle-detail-title")).toHaveText(RENAMED);
});

test("Rules: an empty bundle is refused, and a CS changes only her own", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  // a-bundle-has-at-least-one-line — the validation interceptor, before any handler runs.
  const empty = await call(page, "product.v1.BundleService/BundleCreate", { teamId, name: "Kosong", lines: [] });
  expect(empty.status).toBe(400);

  const list = await call(page, "product.v1.BundleService/BundleList", { teamId, page: { page: 1, limit: 20 } });
  expect(list.status).toBe(200);
  const rootsBundle = list.body.ids[0];

  // The CS, signed in through the API.
  const signedIn = await call(page, "user.v1.AuthService/Login", { username: CS_USERNAME, password: CS_PASSWORD });
  expect(signedIn.status).toBe(200);
  const csToken = signedIn.body.token as string;

  const hers = await call(
    page,
    "product.v1.BundleService/BundleCreate",
    { teamId, name: `CS ${SUFFIX}`, lines: [{ productId: berasId, quantity: 3 }] },
    csToken,
  );
  expect(hers.status).toBe(200);

  const ownChange = await call(
    page,
    "product.v1.BundleService/BundleUpdate",
    { teamId, bundleId: hers.body.bundle.id, name: `CS ${SUFFIX} 2`, lines: [{ productId: berasId, quantity: 2 }] },
    csToken,
  );
  expect(ownChange.status).toBe(200);

  const othersChange = await call(
    page,
    "product.v1.BundleService/BundleDelete",
    { teamId, bundleId: rootsBundle },
    csToken,
  );
  expect(othersChange.status).toBe(403);
  expect(othersChange.body.code).toBe("permission_denied");
});

test("Delete: from its page, after a confirm — and it is gone from the list", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await useSellingTeam(page);
  await page.goto("/products/bundles");

  await row(page, RENAMED).click();
  await page.getByTestId("bundle-detail-delete").click();
  await page.getByTestId("confirm-action").click();

  await expect(page).toHaveURL(/\/products\/bundles$/);
  await expect(page.locator('[data-testid^="bundle-row-"]', { hasText: RENAMED })).toHaveCount(0);
});
