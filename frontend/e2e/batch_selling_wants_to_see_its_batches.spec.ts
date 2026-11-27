import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, api, login } from "./restock_helpers";
import { API_URL } from "./env";

// selling:all wants to see its batches — the check behind docs/acceptances/inventory/batch.md, section *product*,
// when *open product* (given 17). One test per role of the selling team (owner, admin, cs), each signed in as a
// person of that role, reading the same product: the owning team reaches its batches on its product's page
// (/products/:id › Batch), which lists EVERY warehouse's batches and names the warehouse on each row
// (the-warehouse-picker-splits-the-page, docs/technical/frontend/products_decision.md — "batch datanya semua gudang,
// tidak perlu difilter").
//
//  17 (product stocked in 2 warehouses) — one product of S, restocked into warehouse A (6 at Rp 12.000, 2 of them since
//     shipped on an order, so 4 ready) and warehouse B (5 at Rp 15.000, all 5 ready)
//     then: each batch with its warehouse, ready and cost — exactly two batch rows, each naming its own warehouse and
//           delivery, with its ready count and its unit cost (and the value they make); the same two batches in
//           OwnerBatchList under the role's own token
//
// The ground (root, once): a selling team S with an operational account and a shop, two warehouses A and B (A ships the
// shop's orders and takes its returns), a person of every selling role, one product, one restock into each warehouse
// accepted onto a rack there, and one order of 2 from A walked to the courier.

const PASSWORD = "e2e-batch-see-pass-1";
const ROLES = [
  { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "own" },
  { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "adm" },
  { given: "selling:cs", role: "ROLE_SELLING_CS", key: "cs" },
] as const;

// The given's case text, verbatim from batch.md — the marking script finds the tests by it.
const C17 = "product stocked in 2 warehouses";

// A username is lowercase letters and digits only.
const username = (key: string) => `e2ebsee${key}${SUFFIX}`;

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

// What each warehouse's batch must read: arrived, shipped since, ready, unit cost, value — and its ids, filled in by
// beforeAll.
const STOCK = {
  a: { name: `E2E Batch Lihat Gudang A ${SUFFIX}`, code: `BOA${SUFFIX}`, arrived: 6, shipped: 2, ready: 4, cost: 12000 },
  b: { name: `E2E Batch Lihat Gudang B ${SUFFIX}`, code: `BOB${SUFFIX}`, arrived: 5, shipped: 0, ready: 5, cost: 15000 },
} as const;
type Side = keyof typeof STOCK;
const SIDES: Side[] = ["a", "b"];

const ground = {
  seller: "",
  product: "",
  warehouse: {} as Record<Side, string>,
  restock: {} as Record<Side, string>,
  batch: {} as Record<Side, string>,
};

// Rupiah as the app prints it: "Rp 12.000".
const rp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

type Answer = { status: number; json: Record<string, unknown> };

// A call under the signed-in person's token — the status and the answer, never a throw.
async function send(page: Page, method: string, body: unknown): Promise<Answer> {
  return page.evaluate(
    async ([m, b, apiUrl]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ?? window.localStorage.getItem("warehouse_revamp.token");
      const res = await fetch(`${apiUrl}/warehouse.${m as string}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify(b),
      });
      return { status: res.status, json: (await res.json()) as Record<string, unknown> };
    },
    [method, body, API_URL] as const,
  );
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  const page = await browser.newPage();
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string) =>
    String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
  ground.seller = await team(`E2E Batch Lihat Seller ${SUFFIX}`, `BOS${SUFFIX}`, "TEAM_TYPE_SELLING");
  for (const s of SIDES) ground.warehouse[s] = await team(STOCK[s].name, STOCK[s].code, "TEAM_TYPE_WAREHOUSE");

  for (const r of ROLES) {
    await api(page, "user.v1.UserService/CreateUser", {
      teamId: ground.seller,
      username: username(r.key),
      password: PASSWORD,
      name: `Batch Lihat ${r.given} ${SUFFIX}`,
      role: r.role,
    });
  }

  // The goods' owner pays from an operational account; A ships the shop's orders and takes its returns back.
  const category = (await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Batch Lihat ${SUFFIX}` })).category.id;
  const account = String(
    (
      await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId: ground.seller,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name: `E2E batch lihat restock ${SUFFIX}`,
        holderName: "E2E",
        accountNumber: `E2E-BSEE-${SUFFIX}`,
        openingBalance: 0,
        openingOn: today(),
      })
    ).account.id,
  );
  await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: ground.seller,
    accountId: account,
    operational: true,
  });
  await api(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", {
    teamId: ground.seller,
    warehouseId: ground.warehouse.a,
  });
  for (const s of SIDES) {
    await api(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: ground.warehouse[s], feePercent: 1, minFee: 0 });
  }
  const shop = String(
    (
      await api(page, "selling.v1.ShopService/ShopCreate", {
        teamId: ground.seller,
        name: `E2E Batch Lihat Shop ${SUFFIX}`,
        shopCode: `BOP${SUFFIX}`,
        marketplace: "MARKETPLACE_SHOPEE",
      })
    ).shop.id,
  );
  await api(page, "selling.v1.ShopService/ShopUserAdd", { teamId: ground.seller, shopId: shop, userId: ROOT_USER_ID });

  const productName = `Barang Batch Lihat ${SUFFIX}`;
  const p = (
    await api(page, "product.v1.ProductService/ProductCreate", {
      teamId: ground.seller,
      productCodePart: `BO${SUFFIX}`,
      name: productName,
      categoryId: category,
    })
  ).product;
  ground.product = String(p.id);
  const productCode = String(p.productCode);

  // One restock into each warehouse, accepted whole onto a rack there — one batch each.
  for (const s of SIDES) {
    const w = ground.warehouse[s];
    const rack = String((await api(page, "inventory.v1.RackService/RackCreate", { teamId: w, code: `bo${s}-${SUFFIX}` })).rack.id);
    const raised = (
      await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
        teamId: ground.seller,
        warehouseId: w,
        financeAccountId: account,
        items: [{ productId: ground.product, productCode, name: productName, count: STOCK[s].arrived, total: STOCK[s].arrived * STOCK[s].cost }],
      })
    ).request;
    ground.restock[s] = String(raised.id);
    await api(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
      teamId: w,
      requestId: raised.id,
      lines: (raised.items as { id: string }[]).map((it) => ({
        itemId: it.id,
        receivedCount: STOCK[s].arrived,
        placements: [{ placementId: rack, quantity: STOCK[s].arrived }],
      })),
    });
    const listed = await api(page, "inventory.v1.InventoryService/BatchList", {
      teamId: w,
      filter: { productId: ground.product },
      dataRequest: ["BATCH_LIST_DATA_TYPE_BATCH"],
      page: { page: 1, limit: 10 },
    });
    expect(listed.ids, `one batch of the product in warehouse ${s}`).toHaveLength(1);
    ground.batch[s] = String(listed.ids[0]);
  }

  // 2 of A's 6 leave on an order, walked to the courier by A — so A's batch has 4 ready, not the 6 that arrived.
  const placed = await api(page, "selling.v1.OrderService/OrderCreate", {
    idempotencyKey: `e2e-batch-see-${SUFFIX}`,
    shipmentChannelId: "1",
    teamId: ground.seller,
    shopId: shop,
    warehouseId: ground.warehouse.a,
    customerName: `E2E Batch Lihat Buyer ${SUFFIX}`,
    platformTotal: 100_000,
    platformCreatedAtUnix: Math.floor(Date.now() / 1000),
    orderExternalRefId: `BO${SUFFIX}O1`,
    receiptCode: `JBO${SUFFIX}R1`,
    items: [{ productId: ground.product, productCode, name: productName, quantity: STOCK.a.shipped }],
  });
  for (const st of ["PROCESSED", "PICKED", "SHIPPING"]) {
    const res = await api(page, "selling.v1.OrderService/OrderStatusChange", {
      teamId: ground.warehouse.a,
      orderIds: [String(placed.order.id)],
      to: `ORDER_STATUS_${st}`,
    });
    expect(res.results[0]?.moved, `order → ${st}: ${res.results[0]?.refusedReason}`).toBe(true);
  }

  await page.close();
});

type OwnerRow = { warehouseId?: string; deliveryId?: string; unitCost?: number; readyValue?: number; ready?: string };

test.describe(`selling:all wants to see its batches (${C17})`, () => {
  for (const r of ROLES) {
    test(`${r.given} open product (${C17})`, async ({ page }) => {
      await login(page, username(r.key), PASSWORD);
      await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), ground.seller);

      // WHEN — open product: the product's page, as this role.
      await page.goto(`/products/${ground.product}`);
      const table = page.getByTestId("pd-batch-table");
      await expect(table).toBeVisible();

      await test.step("then: each batch with its warehouse, ready and cost", async () => {
        // Exactly the two deliveries, one per warehouse — the section reads every warehouse, never one picked.
        await expect.soft(table.locator('[data-testid^="pd-batch-row-"]')).toHaveCount(2);
        for (const h of ["Delivery", "Warehouse", "Unit cost", "Ready", "Value"]) {
          await expect.soft(table.getByRole("columnheader", { name: h, exact: true })).toBeVisible();
        }

        // Each row by its batch id: Delivery · Warehouse · Arrived · Expiring · Unit cost · Ready · Value.
        for (const s of SIDES) {
          const k = STOCK[s];
          const cells = page.getByTestId(`pd-batch-row-${ground.batch[s]}`).locator("td");
          await expect.soft(cells.nth(0)).toHaveText(`#${ground.restock[s]}`);
          await expect.soft(cells.nth(1)).toHaveText(k.name);
          await expect.soft(cells.nth(4)).toHaveText(rp(k.cost));
          await expect.soft(cells.nth(5)).toHaveText(`${k.ready} pcs`);
          await expect.soft(cells.nth(6)).toHaveText(rp(k.ready * k.cost));
        }
        await expect
          .soft(page.getByTestId("pd-batch-total"))
          .toContainText(rp(STOCK.a.ready * STOCK.a.cost + STOCK.b.ready * STOCK.b.cost));

        // The same two batches in the read behind the section, under this role's own token.
        const res = await send(page, "inventory.v1.InventoryService/OwnerBatchList", {
          teamId: ground.seller,
          filter: { productId: ground.product },
          dataRequest: ["OWNER_BATCH_LIST_DATA_TYPE_BATCH"],
          page: { page: 1, limit: 10 },
        });
        expect.soft(res.status, `OwnerBatchList: ${JSON.stringify(res.json)}`).toBe(200);
        const rows = Object.assign(
          {},
          ...((res.json.items ?? []) as { batch?: { mapData?: Record<string, OwnerRow> } }[]).map((i) => i.batch?.mapData ?? {}),
        ) as Record<string, OwnerRow>;
        expect.soft(Object.keys(rows).sort()).toEqual(SIDES.map((s) => ground.batch[s]).sort());
        for (const s of SIDES) {
          const b = rows[ground.batch[s]] ?? {};
          expect.soft(String(b.warehouseId ?? "0"), `batch ${s}'s warehouse`).toBe(ground.warehouse[s]);
          expect.soft(String(b.ready ?? "0"), `batch ${s}'s ready`).toBe(String(STOCK[s].ready));
          expect.soft(b.unitCost ?? 0, `batch ${s}'s unit cost`).toBe(STOCK[s].cost);
        }
      });
    });
  }
});
