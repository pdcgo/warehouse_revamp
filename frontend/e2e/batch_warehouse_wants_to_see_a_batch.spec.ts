import { expect, test } from "@playwright/test";
import type { Browser, Page, Response } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, api, login } from "./restock_helpers";
import { API_URL } from "./env";

// warehouse:all wants to see a batch — the checks behind docs/acceptances/inventory/batch.md, section *batch*, when
// *open batch* (givens 8–12). One test per role the given names (warehouse owner · admin · staff), each signed in as a
// person of that role, opening Inventories › Batches from the menu and clicking the batch's row — the batch's page
// (/inventories/batches/:id).
//
//   8 (arrived 10 · 2 broken · 1 lost · 7 ready) — a restock line of 10: 9 in the box, 2 of them broken, so 1 missing
//     at the door and 7 good put away
//     then: arrived 10 = broken 2 + lost 1 + used 0 + ready 7 — the lifecycle strip's five figures, which add up; the
//           page's own BatchDetail answer (the role's token) carries the same five.
//   9 (put away 6 on rack A and 4 on rack B when accepted · later all moved to rack C) — accepted as 6 onto RAK-A and 4
//     onto RAK-B, then both moved to RAK-C (RackMove)
//     then: put away at accept still shows rack A 6 and rack B 4, not rack C — *Put Away at Accept* lists rak-a 6 and
//           rak-b 4 and no rak-c row (a-batch-shows-the-racks-it-was-put-on); the page's BatchPlacementList answer the
//           same; RackStock under the role's token proves the move did happen (all 10 on RAK-C now).
//  10 (from restock #503 · accepted by Rudi) — a restock accepted by Rudi, a warehouse admin, with his own token
//     then: from restock #503, accepted by Rudi — Info's *From* reads *Restock #<id>* and opens that restock's page
//           (a-batch-opens-where-it-came-from); *Accepted by* names Rudi; the page's BatchDetail answer names the
//           restock as the delivery and Rudi as the accepter. #503 is the row's example number: the check reads the
//           restock this spec made.
//  11 (3 sold · 1 lost at an opname) — 10 put away on a rack of its own; an order of 3 walked to the courier; a count
//     of the rack that finds 6 of the 7 (counted by a staff member, finalized by root — never by its counter)
//     then: each in its history with the change and ready after — *History* holds the sale (Picked, -3, ready after
//           7) and the count's loss (Counted, -1, ready after 6); the page's BatchDetail answer reads ready 6.
//  12 (made by a return) — an order of 2 shipped from this warehouse, claimed back to return by the seller and accepted
//     back onto a rack here: the return mints a batch of its own
//     then: from a return — the *Return* badge beside the number, Info's *From* reads *Return · order #<id>* and
//           opens that order's warehouse page (a-returns-batch-opens-its-order); the page's BatchDetail answer has
//           origin RETURN and the order. A regression step reads the same product's restock batch as *Restock*.
//
// The ground (root, once): a selling team with an operational account, a shop and its return warehouse W; W with a
// person of every warehouse role, Rudi (admin) and a counter (staff); five products, one per given, so no batch can
// stand in for another.

const PASSWORD = "e2e-batch-see-pass-1";
const WAREHOUSE = [
  { given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", key: "own" },
  { given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", key: "adm" },
  { given: "warehouse:staff", role: "ROLE_WAREHOUSE_STAFF", key: "stf" },
] as const;

// Each given's case text, verbatim from batch.md — the marking script finds the tests by it.
const C8 = "arrived 10 · 2 broken · 1 lost · 7 ready";
const C9 = "put away 6 on rack A and 4 on rack B when accepted · later all moved to rack C";
const C10 = "from restock #503 · accepted by Rudi";
const C11 = "3 sold · 1 lost at an opname";
const C12 = "made by a return";

// A username is lowercase letters and digits only.
const username = (key: string) => `e2ebsee${key}${SUFFIX}`;

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

type Batch = {
  id?: string;
  deliveryId?: string;
  arrived?: string;
  broken?: string;
  lost?: string;
  used?: string;
  ready?: string;
  acceptedBy?: string;
  origin?: string;
  returnOrderId?: string;
};

const ground = {
  w: "",
  seller: "",
  rackA: "",
  rackB: "",
  rackC: "",
  rackD: "",
  rackN: "",
  rudi: "",
  p9: "",
  p11: "",
  g8: "",
  g9: "",
  g10: "",
  g10Restock: "",
  g11: "",
  g11Order: "",
  g12: "",
  g12Restock: "",
  g12RestockBatch: "",
  g12Order: "",
};

// A call that may be refused — the status and the answer, never a throw.
async function send(page: Page, method: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
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

// Signed in as `user`, working in `teamId`: the active team is per tab, in sessionStorage (TeamContext).
async function asUser(page: Page, user: string, teamId: string) {
  await login(page, user, PASSWORD);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

// A person on a page of their own (a fresh context: the form sign-in), working in `teamId`.
async function pageAs(browser: Browser, user: string, teamId: string): Promise<Page> {
  const p = await browser.newPage();
  await asUser(p, user, teamId);
  return p;
}

// A shelf as the server answers the signed-in person: product id → its units there ("0" when it lists none).
async function onHand(page: Page, rackId: string, productId: string): Promise<string> {
  const res = await send(page, "inventory.v1.RackService/RackStock", {
    teamId: ground.w,
    filter: { rackId },
    dataRequest: ["RACK_STOCK_DATA_TYPE_RACK_STOCK"],
    page: { page: 1, limit: 50 },
  });
  expect.soft(res.status, `RackStock ${rackId}`).toBe(200);
  const lines = Object.assign(
    {},
    ...((res.json.items ?? []) as { rackStock?: { mapData?: object } }[]).map((it) => it.rackStock?.mapData ?? {}),
  ) as Record<string, { onHand?: string }>;
  return String(lines[productId]?.onHand ?? "0");
}

type Opened = { detail: { batch?: Batch }; placements: Record<string, unknown> };

// WHEN — open batch: the menu's Inventories › Batches, then the batch's row. Returns the page's own BatchDetail and
// BatchPlacementList answers — read under the role's token, as the page reads them.
async function openBatch(page: Page, id: string): Promise<Opened> {
  await page.goto("/");
  const link = page.getByTestId("sidebar").locator('a[href="/inventories/batches"]');
  await expect(link).toHaveCount(1);
  if (!(await link.isVisible())) await page.getByTestId("nav-group-toggle-nav.inventories").click();
  await link.click();
  await expect(page).toHaveURL(/\/inventories\/batches$/);
  await expect(page.getByTestId(`batches-row-${id}`)).toBeVisible();

  const asked = (rpc: string): Promise<Response> =>
    page.waitForResponse(
      (r) => r.url().endsWith(`/warehouse.inventory.v1.InventoryService/${rpc}`) && (r.request().postData() ?? "").includes(`"batchId":"${id}"`),
    );
  const [detail, placements] = [asked("BatchDetail"), asked("BatchPlacementList")];
  // The Ready cell — a plain number: the row opens the batch (the source link under the number would open its source).
  await page.getByTestId(`batches-ready-${id}`).click();
  await expect(page).toHaveURL(new RegExp(`/inventories/batches/${id}$`));
  await expect(page.getByTestId("batch-detail-page")).toBeVisible();
  const [d, p] = [await detail, await placements];
  expect(d.status(), "BatchDetail").toBe(200);
  expect(p.status(), "BatchPlacementList").toBe(200);
  return { detail: (await d.json()) as Opened["detail"], placements: (await p.json()) as Record<string, unknown> };
}

// A proto3 JSON number field, zero included (proto3 drops a zero).
const n = (v: unknown) => String(v ?? "0");

// The History table's rows as text, each keyed by its column header: When · What · Place · Change · Ready after.
async function historyRows(page: Page): Promise<Record<string, string>[]> {
  return page.getByTestId("batch-detail-history-table").evaluate((table) => {
    const heads = Array.from(table.querySelectorAll("thead th")).map((th) => th.textContent?.trim() ?? "");
    return Array.from(table.querySelectorAll("tbody tr")).map((tr) => {
      const cells = Array.from(tr.querySelectorAll("td")).map((td) => td.textContent?.trim() ?? "");
      return Object.fromEntries(heads.map((h, i) => [h, cells[i] ?? ""]));
    });
  });
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  const page = await browser.newPage();
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string) =>
    String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);

  // The goods' owner: a selling team, a category, the operational account its restocks are paid from, and a shop.
  ground.seller = await team(`E2E Batch Lihat Seller ${SUFFIX}`, `BVS${SUFFIX}`, "TEAM_TYPE_SELLING");
  ground.w = await team(`E2E Batch Lihat Gudang ${SUFFIX}`, `BVW${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
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
  // W ships the seller's orders and takes its returns back.
  await api(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", { teamId: ground.seller, warehouseId: ground.w });
  await api(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: ground.w, feePercent: 1, minFee: 0 });
  const shop = String(
    (
      await api(page, "selling.v1.ShopService/ShopCreate", {
        teamId: ground.seller,
        name: `E2E Batch Lihat Shop ${SUFFIX}`,
        shopCode: `BVP${SUFFIX}`,
        marketplace: "MARKETPLACE_SHOPEE",
      })
    ).shop.id,
  );
  await api(page, "selling.v1.ShopService/ShopUserAdd", { teamId: ground.seller, shopId: shop, userId: ROOT_USER_ID });

  // W's people: one of every warehouse role, Rudi (admin, given 10's accepter) and a counter (staff, given 11's count).
  const user = async (key: string, name: string, role: string) =>
    String(
      (await api(page, "user.v1.UserService/CreateUser", { teamId: ground.w, username: username(key), password: PASSWORD, name, role }))
        .user.id,
    );
  for (const r of WAREHOUSE) await user(r.key, `Batch Lihat ${r.given} ${SUFFIX}`, r.role);
  ground.rudi = await user("rudi", "Rudi", "ROLE_WAREHOUSE_ADMIN");
  await user("cnt", `Batch Lihat Counter ${SUFFIX}`, "ROLE_WAREHOUSE_STAFF");

  const rack = async (code: string) => String((await api(page, "inventory.v1.RackService/RackCreate", { teamId: ground.w, code })).rack.id);
  ground.rackA = await rack("RAK-A");
  ground.rackB = await rack("RAK-B");
  ground.rackC = await rack("RAK-C");
  ground.rackD = await rack("RAK-D");
  ground.rackN = await rack("RAK-N");

  // One product of the seller's per given.
  const products: Record<string, { id: string; code: string; name: string }> = {};
  for (const g of ["8", "9", "10", "11", "12"]) {
    const name = `Barang Batch Lihat ${g} ${SUFFIX}`;
    const p = (
      await api(page, "product.v1.ProductService/ProductCreate", {
        teamId: ground.seller,
        productCodePart: `BV${g}${SUFFIX}`,
        name,
        categoryId: category,
      })
    ).product;
    products[g] = { id: String(p.id), code: String(p.productCode), name };
  }
  ground.p9 = products["9"]!.id;
  ground.p11 = products["11"]!.id;

  // A one-line restock of `g`'s product into W, raised by root for the seller; accepted by `by` (root unless named).
  async function restock(
    g: string,
    count: number,
    total: number,
    accept: { receivedCount: number; brokenCount?: number; brokenNote?: string; missingNote?: string; placements: { placementId: string; quantity: number }[] },
    by: Page = page,
  ) {
    const p = products[g]!;
    const raised = (
      await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
        teamId: ground.seller,
        warehouseId: ground.w,
        financeAccountId: account,
        items: [{ productId: p.id, productCode: p.code, name: p.name, count, total }],
      })
    ).request;
    await api(by, "inventory.v1.RestockRequestService/RestockRequestAccept", {
      teamId: ground.w,
      requestId: raised.id,
      lines: [{ itemId: (raised.items as { id: string }[])[0]!.id, ...accept }],
    });
    return String(raised.id);
  }

  // A product's batches at W, as root reads them.
  const batchesOf = async (productId: string): Promise<Batch[]> => {
    const listed = await api(page, "inventory.v1.InventoryService/BatchList", {
      teamId: ground.w,
      filter: { productId },
      page: { page: 1, limit: 10 },
    });
    const byId: Record<string, Batch> = Object.assign(
      {},
      ...((listed.items ?? []) as { batch?: { mapData?: Record<string, Batch> } }[]).map((i) => i.batch?.mapData ?? {}),
    );
    return ((listed.ids ?? []) as string[]).map((id) => ({ ...byId[String(id)], id: String(id) }));
  };
  const onlyBatch = async (g: string) => {
    const b = await batchesOf(products[g]!.id);
    expect(b, `one batch of given ${g}'s product`).toHaveLength(1);
    return b[0]!.id!;
  };

  // An order of `quantity` from W, walked to the courier by W.
  const move = async (teamId: string, orderId: string, to: string) => {
    const res = await api(page, "selling.v1.OrderService/OrderStatusChange", { teamId, orderIds: [orderId], to: `ORDER_STATUS_${to}` });
    expect(res.results[0]?.moved, `${orderId} → ${to}: ${res.results[0]?.refusedReason}`).toBe(true);
  };
  const order = async (g: string, quantity: number) => {
    const p = products[g]!;
    const placed = await api(page, "selling.v1.OrderService/OrderCreate", {
      idempotencyKey: `e2e-batch-see-${g}-${SUFFIX}`,
      shipmentChannelId: "1",
      teamId: ground.seller,
      shopId: shop,
      warehouseId: ground.w,
      customerName: `E2E Batch Lihat Buyer ${g} ${SUFFIX}`,
      platformTotal: 100_000,
      platformCreatedAtUnix: Math.floor(Date.now() / 1000),
      orderExternalRefId: `BV${SUFFIX}O${g}`,
      receiptCode: `JBV${SUFFIX}R${g}`,
      items: [{ productId: p.id, productCode: p.code, name: p.name, quantity }],
    });
    const id = String(placed.order.id);
    for (const s of ["PROCESSED", "PICKED", "SHIPPING"]) await move(ground.w, id, s);
    return { id, item: String(placed.order.items[0].id) };
  };

  // GIVEN 8 — a line of 10: 9 in the box, 2 broken (so 1 missing at the door), the 7 good onto RAK-D.
  await restock("8", 10, 100_000, {
    receivedCount: 9,
    brokenCount: 2,
    brokenNote: `pecah di jalan ${SUFFIX}`,
    missingNote: `kurang satu ${SUFFIX}`,
    placements: [{ placementId: ground.rackD, quantity: 7 }],
  });
  ground.g8 = await onlyBatch("8");

  // GIVEN 9 — 6 onto RAK-A and 4 onto RAK-B, then all of it moved to RAK-C.
  await restock("9", 10, 50_000, {
    receivedCount: 10,
    placements: [
      { placementId: ground.rackA, quantity: 6 },
      { placementId: ground.rackB, quantity: 4 },
    ],
  });
  ground.g9 = await onlyBatch("9");
  for (const [from, quantity] of [
    [ground.rackA, 6],
    [ground.rackB, 4],
  ] as const) {
    await api(page, "inventory.v1.RackService/RackMove", {
      teamId: ground.w,
      fromRackId: from,
      lines: [{ productId: ground.p9, quantity, toRackId: ground.rackC }],
      description: `pindah ke rak C ${SUFFIX}`,
    });
  }

  // GIVEN 10 — accepted by Rudi, with his own token.
  const rudi = await pageAs(browser, username("rudi"), ground.w);
  ground.g10Restock = await restock("10", 4, 40_000, { receivedCount: 4, placements: [{ placementId: ground.rackD, quantity: 4 }] }, rudi);
  await rudi.close();
  ground.g10 = await onlyBatch("10");

  // GIVEN 11 — 10 onto RAK-N alone; an order of 3 walked to the courier (the rack then holds 7); a count of RAK-N
  // finding 6: the counter counts, root finalizes.
  await restock("11", 10, 100_000, { receivedCount: 10, placements: [{ placementId: ground.rackN, quantity: 10 }] });
  ground.g11 = await onlyBatch("11");
  ground.g11Order = (await order("11", 3)).id;
  expect(await onHand(page, ground.rackN, ground.p11), "RAK-N holds 7 once the order is picked").toBe("7");
  const session = String(
    (await api(page, "inventory.v1.OpnameService/OpnameSessionCreate", { teamId: ground.w, plan: "OPNAME_PLAN_PLACEMENT", filterPlacementId: ground.rackN }))
      .session.id,
  );
  const rows = await api(page, "inventory.v1.OpnameService/OpnameRowList", {
    teamId: ground.w,
    filter: { sessionId: session },
    page: { page: 1, limit: 50 },
  });
  const row = ((rows.items ?? []) as { row?: { mapData?: Record<string, { id: string; productId: string }> } }[])
    .flatMap((i) => Object.values(i.row?.mapData ?? {}))
    .find((r) => String(r.productId) === ground.p11);
  expect(row, "the count's row for given 11's product").toBeTruthy();
  const counter = await pageAs(browser, username("cnt"), ground.w);
  await api(counter, "inventory.v1.OpnameService/OpnameRowCount", { teamId: ground.w, rowId: row!.id, count: 6 });
  await api(counter, "inventory.v1.OpnameService/OpnameRowMarkCounted", {
    teamId: ground.w,
    rowId: row!.id,
    lostNote: `tidak ada di rak ${SUFFIX}`,
  });
  await counter.close();
  await api(page, "inventory.v1.OpnameService/OpnameSessionFinalize", { teamId: ground.w, sessionId: session });

  // GIVEN 12 — 5 onto RAK-D; an order of 2 shipped, claimed back to return by the seller, accepted back onto RAK-D.
  ground.g12Restock = await restock("12", 5, 40_000, { receivedCount: 5, placements: [{ placementId: ground.rackD, quantity: 5 }] });
  const back = await order("12", 2);
  ground.g12Order = back.id;
  await move(ground.seller, back.id, "RETURN");
  await api(page, "selling.v1.OrderService/OrderReturnAccept", {
    teamId: ground.w,
    orderId: back.id,
    lines: [{ orderItemId: back.item, placements: [{ rackId: ground.rackD, quantity: 2 }] }],
  });
  const b12 = await batchesOf(products["12"]!.id);
  expect(b12, "given 12's product: its restock batch and the return's").toHaveLength(2);
  ground.g12 = b12.find((b) => b.origin === "BATCH_ORIGIN_RETURN")?.id ?? "";
  ground.g12RestockBatch = b12.find((b) => b.origin !== "BATCH_ORIGIN_RETURN")?.id ?? "";
  expect(ground.g12, "a batch minted by the return").not.toBe("");

  await page.close();
});

test.describe(`warehouse:all wants to see a batch (${C8})`, () => {
  for (const r of WAREHOUSE) {
    test(`${r.given} open batch (${C8})`, async ({ page }) => {
      await asUser(page, username(r.key), ground.w);
      const { detail } = await openBatch(page, ground.g8);

      await test.step("then: arrived 10 = broken 2 + lost 1 + used 0 + ready 7", async () => {
        const fig = (k: string) => page.getByTestId(`batch-detail-${k}`);
        const want: [string, string, string][] = [
          ["arrived", "10", "Arrived"],
          ["broken", "2", "Broken"],
          ["lost", "1", "Lost"],
          ["used", "0", "Used"],
          ["ready", "7", "Ready"],
        ];
        for (const [k, v, label] of want) {
          await expect.soft(fig(k), k).toHaveText(v);
          await expect.soft(page.getByTestId(`batch-detail-${k}-card`)).toContainText(label);
        }
        // The strip adds up as drawn: Arrived is the sum of the other four.
        const read = async (k: string) => Number((await fig(k).textContent()) ?? "NaN");
        expect.soft(await read("arrived")).toBe((await read("broken")) + (await read("lost")) + (await read("used")) + (await read("ready")));

        // The page's own BatchDetail answer, under the role's token: the same five.
        const b = detail.batch ?? {};
        expect.soft([n(b.arrived), n(b.broken), n(b.lost), n(b.used), n(b.ready)]).toEqual(["10", "2", "1", "0", "7"]);
      });
    });
  }
});

test.describe(`warehouse:all wants to see a batch (${C9})`, () => {
  for (const r of WAREHOUSE) {
    test(`${r.given} open batch (${C9})`, async ({ page }) => {
      await asUser(page, username(r.key), ground.w);
      const { placements } = await openBatch(page, ground.g9);

      await test.step("then: put away at accept still shows rack A 6 and rack B 4, not rack C", async () => {
        await expect.soft(page.getByTestId("batch-placements-panel")).toContainText("Put Away at Accept");
        const shelf = (rackId: string) => page.getByTestId(`batch-detail-shelf-${rackId}`);
        for (const [rackId, code, qty] of [
          [ground.rackA, "rak-a", "6"],
          [ground.rackB, "rak-b", "4"],
        ] as const) {
          await expect.soft(shelf(rackId).locator("td").nth(0)).toHaveText(code);
          await expect.soft(shelf(rackId).locator("td").nth(1)).toHaveText(qty);
        }
        await expect.soft(shelf(ground.rackC)).toHaveCount(0);
        await expect.soft(page.getByTestId("batch-detail-placements-table").locator("tbody tr")).toHaveCount(2);

        // The page's own BatchPlacementList answer, under the role's token: rack A 6, rack B 4 — nothing on C.
        const shelves: Record<string, string> = {};
        for (const it of (placements.items ?? []) as { shelf?: { mapData?: Record<string, { rackId?: string; qty?: string }> } }[]) {
          for (const s of Object.values(it.shelf?.mapData ?? {})) shelves[n(s.rackId)] = n(s.qty);
        }
        expect.soft(shelves).toEqual({ [ground.rackA]: "6", [ground.rackB]: "4" });

        // The move did happen: today all 10 sit on RAK-C, none on A or B.
        expect.soft(await onHand(page, ground.rackC, ground.p9), "on RAK-C now").toBe("10");
        expect.soft(await onHand(page, ground.rackA, ground.p9), "on RAK-A now").toBe("0");
        expect.soft(await onHand(page, ground.rackB, ground.p9), "on RAK-B now").toBe("0");
      });
    });
  }
});

test.describe(`warehouse:all wants to see a batch (${C10})`, () => {
  for (const r of WAREHOUSE) {
    test(`${r.given} open batch (${C10})`, async ({ page }) => {
      await asUser(page, username(r.key), ground.w);
      const { detail } = await openBatch(page, ground.g10);

      await test.step("then: from restock #503, accepted by Rudi", async () => {
        const from = page.getByTestId("batch-detail-order");
        await expect.soft(from).toHaveText(`Restock #${ground.g10Restock}`);
        await expect.soft(page.getByTestId("batch-detail-received-by")).toHaveText(`Rudi (${username("rudi")})`);
        await expect.soft(page.getByTestId("batch-detail-origin")).toHaveText("Restock");

        // The page's own BatchDetail answer, under the role's token: that restock, accepted by Rudi.
        expect.soft(n(detail.batch?.deliveryId)).toBe(ground.g10Restock);
        expect.soft(n(detail.batch?.acceptedBy)).toBe(ground.rudi);

        // It is a way there: *From* opens that restock's page.
        await from.click();
        await expect.soft(page).toHaveURL(new RegExp(`/inventories/restock/${ground.g10Restock}$`));
      });
    });
  }
});

test.describe(`warehouse:all wants to see a batch (${C11})`, () => {
  for (const r of WAREHOUSE) {
    test(`${r.given} open batch (${C11})`, async ({ page }) => {
      await asUser(page, username(r.key), ground.w);
      const { detail } = await openBatch(page, ground.g11);

      await test.step("then: each in its history with the change and ready after", async () => {
        await expect(page.getByTestId("batch-detail-history-table")).toBeVisible();
        const has = (what: string, change: string, after: string) => (rows: Record<string, string>[]) =>
          rows.some((x) => x["What"] === what && x["Change"] === change && x["Ready after"] === after);
        // The sale: the order's 3 taken, 7 left.
        await expect.soft.poll(async () => has("Picked", "-3", "7")(await historyRows(page)), { message: "the sale's row" }).toBe(true);
        // The count's loss: 1 lost, 6 left.
        await expect.soft.poll(async () => has("Counted", "-1", "6")(await historyRows(page)), { message: "the count's row" }).toBe(true);
        // What came in, for the arithmetic: 10 received.
        expect.soft(has("Received", "+10", "10")(await historyRows(page)), "the put-away's row").toBe(true);

        // The page's own BatchDetail answer, under the role's token: 6 ready.
        expect.soft(n(detail.batch?.ready)).toBe("6");
      });
    });
  }
});

test.describe(`warehouse:all wants to see a batch (${C12})`, () => {
  for (const r of WAREHOUSE) {
    test(`${r.given} open batch (${C12})`, async ({ page }) => {
      await asUser(page, username(r.key), ground.w);
      const { detail } = await openBatch(page, ground.g12);

      await test.step("then: from a return", async () => {
        await expect.soft(page.getByTestId("batch-detail-origin")).toHaveText("Return");
        const from = page.getByTestId("batch-detail-return");
        await expect.soft(from).toHaveText(`Return · order #${ground.g12Order}`);

        // The page's own BatchDetail answer, under the role's token: minted by that order's return.
        expect.soft(detail.batch?.origin).toBe("BATCH_ORIGIN_RETURN");
        expect.soft(n(detail.batch?.returnOrderId)).toBe(ground.g12Order);

        // It is a way there: *From* opens the order's warehouse page, where the return was accepted.
        await from.click();
        await expect.soft(page).toHaveURL(new RegExp(`/warehouse-orders/${ground.g12Order}$`));
      });

      await test.step("regression: the same product's restock batch reads Restock", async () => {
        await openBatch(page, ground.g12RestockBatch);
        await expect.soft(page.getByTestId("batch-detail-origin")).toHaveText("Restock");
        await expect.soft(page.getByTestId("batch-detail-order")).toHaveText(`Restock #${ground.g12Restock}`);
      });
    });
  }
});
