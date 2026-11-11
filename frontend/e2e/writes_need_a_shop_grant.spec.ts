import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";

// The shop write gate, end to end (docs/business/shop/context_decision.md):
//
//   a-write-needs-a-grant-or-a-manager     a CS writes only on the shops granted her — the order form offers only
//                                          those, and an order sent straight to the API for another shop is refused
//                                          PermissionDenied, naming the shop
//   a-closed-shop-refuses-only-new-selling a closed shop takes no new order, even from the team's owner
//
// It makes its own selling team (Root as Owner), two shops and a CS granted the first only. It places NO order — every
// create here is refused at the gate, or fails after it for want of a warehouse — so it may run anywhere in the
// suite; it sorts after orders.spec.ts and statement.spec.ts anyway, which assert an empty start.

const SUFFIX = Date.now().toString().slice(-6);
const TEAM_NAME = `E2E Gate Team ${SUFFIX}`;
const TEAM_CODE = `GT${SUFFIX}`.slice(0, 10);
const SHOP_A = `E2E Gate Shop A ${SUFFIX}`;
const SHOP_B = `E2E Gate Shop B ${SUFFIX}`;
const SHOP_CLOSED = `E2E Gate Closed ${SUFFIX}`;
const CS_USERNAME = `gatecs${SUFFIX}`;
const CS_PASSWORD = "cs-password-e2e";

// Made in the setup, read by the tests after it — the file runs serially, in one worker.
let teamId = "";
let shopA = "";
let shopB = "";
let shopClosed = "";

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

// An RPC as the signed-in person, or — given a token — as somebody else. Answers the status and the JSON body, so a
// refusal can be asserted as well as a success.
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

async function useGateTeam(page: Page) {
  // A person in one team starts in it; only Root, in many, has to pick.
  try {
    await expect(page.getByTestId("team-switcher")).toContainText(TEAM_NAME, { timeout: 5000 });
    return;
  } catch {
    // not there yet — pick it
  }

  await page.getByTestId("team-switcher").click();
  await page.getByTestId("team-search-mine").click();
  await page.getByTestId("team-search").fill(TEAM_NAME);
  await page.getByTestId(/^team-option-/).first().click();
  await expect(page.getByTestId("team-switcher")).toContainText(TEAM_NAME);
}

// The smallest order the validation interceptor lets through to the handler. The warehouse does not exist, so a
// create that PASSES the gate still fails after it — never with PermissionDenied.
function orderOn(shopId: string, ref: string) {
  return {
    idempotencyKey: `e2e-gate-${ref}-${SUFFIX}`,
    // Every order names its courier (no-order-without-a-courier) — a shipment channel id, opaque to the order.
    shipmentChannelId: "1",
    teamId,
    shopId,
    warehouseId: "999999",
    customerName: "E2E Gate Buyer",
    platformTotal: 15000,
    platformCreatedAtUnix: Math.floor(Date.now() / 1000),
    orderExternalRefId: `GATE${ref}${SUFFIX}`,
    items: [{ productId: "999999", productCode: "GATE-1", name: "Gate", quantity: 1 }],
  };
}

test.describe.configure({ mode: "serial" });

test("setup: a selling team, shops A and B and a closed one, and a CS granted A only", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = await call(page, "team.v1.TeamService/TeamCreate", {
    name: TEAM_NAME,
    teamCode: TEAM_CODE,
    type: "TEAM_TYPE_SELLING",
    ownerUserId: ROOT_USER_ID,
  });
  expect(team.status).toBe(200);
  teamId = team.body.team.id;

  for (const [name, code] of [
    [SHOP_A, `GA${SUFFIX}`],
    [SHOP_B, `GB${SUFFIX}`],
    [SHOP_CLOSED, `GC${SUFFIX}`],
  ] as const) {
    const shop = await call(page, "selling.v1.ShopService/ShopCreate", {
      teamId,
      name,
      shopCode: code,
      marketplace: "MARKETPLACE_SHOPEE",
    });
    expect(shop.status).toBe(200);
    if (name === SHOP_A) shopA = shop.body.shop.id;
    else if (name === SHOP_B) shopB = shop.body.shop.id;
    else shopClosed = shop.body.shop.id;
  }

  const cs = await call(page, "user.v1.UserService/CreateUser", {
    teamId,
    username: CS_USERNAME,
    password: CS_PASSWORD,
    name: `CS Gate ${SUFFIX}`,
    role: "ROLE_SELLING_CS",
  });
  expect(cs.status).toBe(200);

  const granted = await call(page, "selling.v1.ShopService/ShopUserAdd", { teamId, shopId: shopA, userId: cs.body.user.id });
  expect(granted.status).toBe(200);

  const closed = await call(page, "selling.v1.ShopService/ShopClose", { teamId, shopId: shopClosed });
  expect(closed.status).toBe(200);
  expect(closed.body.shop.status).toBe("SHOP_STATUS_CLOSED");
});

test("Order form: a CS granted shop A sees A, and never B", async ({ page }) => {
  await login(page, CS_USERNAME, CS_PASSWORD);
  await useGateTeam(page);

  await page.goto("/orders/new");
  await expect(page.getByTestId("order-create-page")).toBeVisible();

  await page.getByTestId("shop-select").click();
  await expect(page.getByTestId(`shop-select-option-${shopA}`)).toBeVisible();
  await expect(page.getByTestId(`shop-select-option-${shopA}`)).toContainText(SHOP_A);
  await expect(page.getByTestId(`shop-select-option-${shopB}`)).toHaveCount(0);
  await expect(page.getByRole("option").filter({ hasText: SHOP_B })).toHaveCount(0);
});

test("API: an order for shop B is refused PermissionDenied, naming it — shop A passes the gate", async ({ page }) => {
  await login(page, CS_USERNAME, CS_PASSWORD);

  const refused = await call(page, "selling.v1.OrderService/OrderCreate", orderOn(shopB, "B"));
  expect(refused.status).toBe(403);
  expect(refused.body.code).toBe("permission_denied");
  expect(refused.body.message).toContain(`You have no access to ${SHOP_B}`);

  // Shop A gets past the gate: it fails later — for the team's missing return warehouse
  // (create-refuses-a-team-with-no-return-warehouse) or the warehouse that does not exist — never for the shop.
  const passed = await call(page, "selling.v1.OrderService/OrderCreate", orderOn(shopA, "A"));
  expect(passed.body.code).not.toBe("permission_denied");
  expect(passed.body.message ?? "").not.toContain("no access");

  // The list still reads team-wide: B is there for a filter, only the WRITE is gated.
  const everyShop = await call(page, "selling.v1.ShopService/ShopList", { teamId, page: { page: 1, limit: 50 } });
  expect(everyShop.status).toBe(200);
  expect(everyShop.body.ids).toEqual(expect.arrayContaining([shopA, shopB]));

  const writable = await call(page, "selling.v1.ShopService/ShopList", {
    teamId,
    filter: { writable: true },
    page: { page: 1, limit: 50 },
  });
  expect(writable.status).toBe(200);
  expect(writable.body.ids).toEqual([shopA]);
});

test("API: a closed shop takes no new order, even from the team's owner", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const refused = await call(page, "selling.v1.OrderService/OrderCreate", orderOn(shopClosed, "C"));
  expect(refused.body.code).toBe("failed_precondition");
  expect(refused.body.message).toContain(SHOP_CLOSED);
  expect(refused.body.message).toContain("the shop is closed");
});
