import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";

// ── report found — the checks behind docs/acceptances/inventory/order.md ───────────────────────────────────────────────
//
// a-found-lost-parcel-is-a-found-stock-in (docs/business/order/context_decision.md, backlog #82): a parcel of an order gone
// `lost` that turns up at the warehouse it shipped from is reported as a FOUND that NAMES THE ORDER. The order stays lost
// (lost-is-final) — the report only writes a note on its timeline naming the request. Approved by another Owner or Admin,
// the units come back on the rack the warehouse picked, under the order's team, at the cost the order took them at.
//
// The given `warehouse:all wants to put a found parcel back in stock (status: lost · parcel back at warehouse · 1 product
// · 1 rack)` / report found, run as EVERY warehouse role (status-is-per-then), each on a lost order of its own and through
// a door of the screen: the Owner from the order's page (/orders/<id>, Report Found), the Admin and the Staff from the
// pick page (/warehouse-orders/<id>). Each THEN is its own step, checked softly:
// - `found names the lost order` — the Found Stock list links the order (`found-request-order-<id>`, opening it), the
//   request carries the order's id, and the order's own notes name the request (*… — found request #N. The order stays
//   lost.*).
// - `order stays lost` — the order's page still reads Lost after the report, and on the server it is still LOST.
//
// Regression beside it: Report Found is offered on a lost order only, a live order's found is refused, more than the order
// took is refused (the waiting report counts), and an approval mints the units back on the picked rack at the order's
// cost while the order stays lost.
//
// GROUND: a selling team of its own (root owns it) with one shop and this warehouse as its return warehouse; Sabun Temuan,
// 10 units on Rak A at Rp 10.000 each; per role an order of 2 shipped and marked lost by the seller, and one live order of
// 1 left shipped. Found units go to Rak B.

const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-foundorder-pass-1";
const PRODUCT = "Sabun Temuan";

const ROLES = [
  { key: "owner", role: "ROLE_WAREHOUSE_OWNER", label: "warehouse:owner", door: "detail" },
  { key: "admin", role: "ROLE_WAREHOUSE_ADMIN", label: "warehouse:admin", door: "pick" },
  { key: "staff", role: "ROLE_WAREHOUSE_STAFF", label: "warehouse:staff", door: "pick" },
] as const;
type Key = (typeof ROLES)[number]["key"];

const userOf = (key: Key) => `e2erf${key}${SUFFIX}`;

// Made in the setup, read by the tests after it — the file runs serially, in one worker.
const state = {
  seller: "",
  warehouse: "",
  rackA: "",
  rackB: "",
  rackBCode: `rf-b-${SUFFIX}`,
  product: "",
  orders: {} as Record<Key | "live", string>,
  requests: {} as Record<Key, string>,
};

// An RPC as the signed-in person — the status and the JSON body, never thrown.
async function call(page: Page, method: string, body: unknown) {
  return page.evaluate(
    async ([m, b, apiUrl]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ?? window.localStorage.getItem("warehouse_revamp.token");

      const res = await fetch(`${apiUrl}/warehouse.${m as string}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(b),
      });

      return { status: res.status, body: await res.json() };
    },
    [method, body, API_URL] as const,
  );
}

// A call that must succeed — its JSON body.
async function ok<T = any>(page: Page, method: string, body: unknown): Promise<T> {
  const res = await call(page, method, body);
  expect(res.status, `${method}: ${JSON.stringify(res.body)}`).toBe(200);

  return res.body as T;
}

async function move(page: Page, teamId: string, orderId: string, to: string) {
  const res = await ok<{ results: { moved?: boolean; refusedReason?: string }[] }>(
    page,
    "selling.v1.OrderService/OrderStatusChange",
    { teamId, orderIds: [orderId], to },
  );
  expect(res.results[0]?.moved, `${orderId} → ${to}: ${res.results[0]?.refusedReason}`).toBe(true);
}

// Work in the given team: the active team is per tab, in sessionStorage (TeamContext).
async function useTeam(page: Page, teamId: string) {
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

// Every found request of this warehouse the signed-in person may read, in a status.
async function foundRequests(page: Page, status: string): Promise<Record<string, any>[]> {
  const res = await ok(page, "inventory.v1.FoundRequestService/FoundRequestList", {
    teamId: state.warehouse,
    filter: { status },
    page: { page: 1, limit: 50 },
  });
  const map = (res.items as { request?: { mapData: Record<string, Record<string, any>> } }[]).find((i) => i.request)?.request
    ?.mapData;

  return Object.values(map ?? {});
}

// The order's status, as the warehouse reads it on its pick page (OrderStatusBadge: `order-status-<enum>`).
async function openPickPage(page: Page, orderId: string) {
  await page.goto(`/warehouse-orders/${orderId}`);
  await expect(page.getByTestId("pick-list-table")).toBeVisible();
}

const LOST = "order-status-10";
const SHIPPED = "order-status-6";

test.describe.configure({ mode: "serial" });

test("Setup: a seller's lost orders from this warehouse, one per warehouse role, and one live order", async ({ page }) => {
  test.setTimeout(150_000);
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  state.seller = String(
    (
      await ok(page, "team.v1.TeamService/TeamCreate", {
        name: `E2E Found Order Seller ${SUFFIX}`,
        teamCode: `RFS${SUFFIX}`,
        type: "TEAM_TYPE_SELLING",
        ownerUserId: ROOT_USER_ID,
      })
    ).team.id,
  );
  const shop = (
    await ok(page, "selling.v1.ShopService/ShopCreate", {
      teamId: state.seller,
      name: `E2E Found Order Shop ${SUFFIX}`,
      shopCode: `RFH${SUFFIX}`,
      marketplace: "MARKETPLACE_SHOPEE",
    })
  ).shop.id;
  await ok(page, "selling.v1.ShopService/ShopUserAdd", { teamId: state.seller, shopId: shop, userId: ROOT_USER_ID });

  state.warehouse = String(
    (
      await ok(page, "team.v1.TeamService/TeamCreate", {
        name: `E2E Found Order WH ${SUFFIX}`,
        teamCode: `RFW${SUFFIX}`,
        type: "TEAM_TYPE_WAREHOUSE",
        ownerUserId: ROOT_USER_ID,
      })
    ).team.id,
  );
  await ok(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", {
    teamId: state.seller,
    warehouseId: state.warehouse,
  });
  for (const r of ROLES) {
    await ok(page, "user.v1.UserService/CreateUser", {
      teamId: state.warehouse,
      username: userOf(r.key),
      password: PASSWORD,
      name: `Found Order ${r.key} ${SUFFIX}`,
      role: r.role,
    });
  }

  // Sabun Temuan: 10 on Rak A at Rp 10.000 each, paid from the seller's own operational account. Rak B is empty.
  state.rackA = String((await ok(page, "inventory.v1.RackService/RackCreate", { teamId: state.warehouse, code: `rf-a-${SUFFIX}` })).rack.id);
  state.rackB = String((await ok(page, "inventory.v1.RackService/RackCreate", { teamId: state.warehouse, code: state.rackBCode })).rack.id);
  const category = (await ok(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Found Order ${SUFFIX}` })).category.id;
  const product = (
    await ok(page, "product.v1.ProductService/ProductCreate", {
      teamId: state.seller,
      productCodePart: `RFP${SUFFIX}`,
      name: PRODUCT,
      categoryId: category,
    })
  ).product;
  state.product = String(product.id);
  const account = (
    await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
      teamId: state.seller,
      type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
      name: `E2E found order ${SUFFIX}`,
      holderName: "E2E",
      accountNumber: `E2E-RFO-${SUFFIX}`,
      openingBalance: 0,
      openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
    })
  ).account.id;
  await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: state.seller,
    accountId: account,
    operational: true,
  });
  const restock = await ok(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
    teamId: state.seller,
    warehouseId: state.warehouse,
    financeAccountId: account,
    items: [{ productId: product.id, productCode: product.productCode, name: PRODUCT, count: 10, total: 100_000 }],
  });
  await ok(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: state.warehouse,
    requestId: restock.request.id,
    lines: [{ itemId: restock.request.items[0].id, receivedCount: 10, placements: [{ placementId: state.rackA, quantity: 10 }] }],
  });
  await ok(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: state.warehouse, feePercent: 1, minFee: 0 });

  // Per role an order of 2, walked to the courier and marked lost by the seller; one live order of 1 left shipped.
  for (const key of ["owner", "admin", "staff", "live"] as const) {
    const quantity = key === "live" ? 1 : 2;
    const placed = await ok(page, "selling.v1.OrderService/OrderCreate", {
      idempotencyKey: `e2e-found-order-${key}-${SUFFIX}`,
      shipmentChannelId: "1",
      teamId: state.seller,
      shopId: shop,
      warehouseId: state.warehouse,
      customerName: `E2E Found Buyer ${key} ${SUFFIX}`,
      platformTotal: 50_000,
      platformCreatedAtUnix: Math.floor(Date.now() / 1000),
      orderExternalRefId: `RFO${key}${SUFFIX}`,
      items: [{ productId: product.id, productCode: product.productCode, name: PRODUCT, quantity }],
    });
    const id = String(placed.order.id);
    for (const to of ["ORDER_STATUS_PROCESSED", "ORDER_STATUS_PICKED", "ORDER_STATUS_SHIPPING"]) {
      await move(page, state.warehouse, id, to);
    }
    if (key !== "live") {
      // Customer service sees it moving on the platform (shipped), then writes it off (shipped → lost).
      await move(page, state.seller, id, "ORDER_STATUS_SHIPPED");
      await move(page, state.seller, id, "ORDER_STATUS_LOST");
    }
    state.orders[key] = id;
  }
});

test.describe("warehouse:all wants to put a found parcel back in stock (status: lost · parcel back at warehouse · 1 product · 1 rack)", () => {
  for (const r of ROLES) {
    test(`${r.label} report found`, async ({ page }) => {
      test.setTimeout(120_000);
      const order = state.orders[r.key];
      await signIn(page, userOf(r.key), PASSWORD);
      await useTeam(page, state.warehouse);

      // THE DOOR: the order's page or its pick page — both offer Report Found on a lost order shipped from here.
      if (r.door === "detail") {
        await page.goto(`/orders/${order}`);
        await expect(page.getByTestId("order-detail-title")).toContainText(order);
        await page.getByTestId("order-report-found").click();
      } else {
        await openPickPage(page, order);
        await page.getByTestId("pick-order-report-found").click();
      }

      // Prefilled with the order: its one product, the 2 it took; the rack is picked.
      const dialog = page.getByTestId("report-found-order-dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByTestId("report-found-order-product")).toContainText(PRODUCT);
      await expect(dialog.getByTestId("report-found-order-amount")).toHaveValue("2");
      await expect(dialog.getByTestId("report-found-order-submit")).toBeDisabled();
      await dialog.getByTestId("report-found-order-rack").click();
      await dialog.getByTestId(`rack-select-option-${state.rackB}`).click();
      await dialog.getByTestId("report-found-order-note").fill("kurir kembalikan paket");
      await expect(dialog.getByTestId("report-found-order-submit")).toBeEnabled();
      await dialog.getByTestId("report-found-order-submit").click();
      await expect(dialog).toBeHidden();

      // The waiting request this report made.
      await expect
        .poll(async () => (await foundRequests(page, "FOUND_REQUEST_STATUS_WAITING")).some((f) => String(f.orderId) === order))
        .toBe(true);
      const request = (await foundRequests(page, "FOUND_REQUEST_STATUS_WAITING")).find((f) => String(f.orderId) === order)!;
      state.requests[r.key] = String(request.id);

      await test.step("then: found names the lost order", async () => {
        expect.soft(String(request.orderId)).toBe(order);
        expect.soft(String(request.productId)).toBe(state.product);
        expect.soft(String(request.rackId)).toBe(state.rackB);
        expect.soft(Number(request.stockCount)).toBe(2);

        // The Found Stock list names the order, and the name opens it.
        await page.goto("/inventories/found-stock");
        await expect(page.getByTestId("found-requests-page")).toBeVisible();
        const link = page.getByTestId(`found-request-order-${request.id}`);
        await expect.soft(link).toContainText(`#${order}`);
        await link.click();
        await expect.soft(page).toHaveURL(new RegExp(`/warehouse-orders/${order}$`));

        // …and the order's notes name the request.
        await openPickPage(page, order);
        const note = page.getByTestId("pick-order-note-text").filter({ hasText: `found request #${request.id}` });
        await expect.soft(note).toContainText(`2 × `);
        await expect.soft(note).toContainText(PRODUCT);
        await expect.soft(note).toContainText(`on rack ${state.rackBCode}`);
        await expect.soft(note).toContainText("The order stays lost.");
      });

      await test.step("then: order stays lost", async () => {
        await openPickPage(page, order);
        await expect.soft(page.getByTestId(LOST)).toBeVisible();
        await expect.soft(page.getByTestId("pick-order-advance")).toHaveCount(0);
        if (r.door === "detail") {
          await page.goto(`/orders/${order}`);
          await expect.soft(page.getByTestId("order-detail-page").getByTestId(LOST)).toBeVisible();
        }
      });
    });
  }
});

// A LIVE ORDER COMES BACK AS ITS RETURN, NOT A FOUND: the screens offer Report Found on a lost order only, and a found naming
// a live order is refused by name.
test("Report Found is offered on a lost order only — a live order's found is refused", async ({ page }) => {
  await signIn(page, userOf("owner"), PASSWORD);
  await useTeam(page, state.warehouse);

  await openPickPage(page, state.orders.live);
  await expect(page.getByTestId(SHIPPED)).toBeVisible();
  await expect(page.getByTestId("pick-order-report-found")).toHaveCount(0);
  await page.goto(`/orders/${state.orders.live}`);
  await expect(page.getByTestId("order-detail-page").getByTestId(SHIPPED)).toBeVisible();
  await expect(page.getByTestId("order-report-found")).toHaveCount(0);

  const refused = await call(page, "inventory.v1.FoundRequestService/FoundRequestCreate", {
    teamId: state.warehouse,
    productId: state.product,
    rackId: state.rackB,
    quantity: 1,
    note: "a live order's parcel",
    orderId: state.orders.live,
  });
  expect(refused.status).toBe(400);
  expect(refused.body.code).toBe("failed_precondition");
  expect(refused.body.message).toContain("not lost");
});

// THE TOTAL FOUND FOR AN ORDER NEVER PASSES WHAT IT TOOK: the Owner's order took 2 and 2 are reported (still waiting) —
// one more is refused.
test("More than the lost order took is refused — the waiting report counts", async ({ page }) => {
  await signIn(page, userOf("owner"), PASSWORD);
  await useTeam(page, state.warehouse);

  const refused = await call(page, "inventory.v1.FoundRequestService/FoundRequestCreate", {
    teamId: state.warehouse,
    productId: state.product,
    rackId: state.rackB,
    quantity: 1,
    note: "one more than it took",
    orderId: state.orders.owner,
  });
  expect(refused.status).toBe(400);
  expect(refused.body.code).toBe("failed_precondition");
});

// APPROVED BY ANOTHER (the Admin approves the Owner's report): no loss is claimed — the 2 units are minted back on Rak B at
// the Rp 10.000 the order took them at, and the order stays lost.
test("Approved, the units come back on the picked rack at the order's cost — and the order stays lost", async ({ page }) => {
  await signIn(page, userOf("admin"), PASSWORD);
  await useTeam(page, state.warehouse);
  const request = state.requests.owner;

  await page.goto("/inventories/found-stock");
  await expect(page.getByTestId(`found-request-minted-${request}`)).toContainText("Rp 20.000");
  await page.getByTestId(`found-request-approve-${request}`).click();
  await page.getByRole("alertdialog").getByTestId("confirm-action").click();
  await expect(page.getByTestId(`found-request-${request}`)).toHaveCount(0);

  const approved = (await foundRequests(page, "FOUND_REQUEST_STATUS_APPROVED")).find((f) => String(f.id) === request)!;
  expect(String(approved.orderId)).toBe(state.orders.owner);
  const lines = approved.lines as { type: string; stockCount: string; priceUnit: number; amount: number; batchId: string }[];
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) {
    expect(line.type).toBe("FOUND_REQUEST_POST_TYPE_ORDER_MINT");
    expect(Number(line.priceUnit)).toBe(10_000);
    expect(String(line.batchId)).not.toBe("0");
  }
  expect(lines.reduce((n, l) => n + Number(l.stockCount), 0)).toBe(2);

  // Rak B holds them.
  await page.goto(`/inventories/racks/${state.rackB}`);
  await expect(page.getByTestId("rack-detail-stock").getByTestId(`rack-stock-onhand-${state.product}`)).toHaveText("2");

  // The order is still lost.
  await openPickPage(page, state.orders.owner);
  await expect(page.getByTestId(LOST)).toBeVisible();
});
