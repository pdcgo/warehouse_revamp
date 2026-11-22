import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { API_URL } from "./env";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, api, login } from "./restock_helpers";

// warehouse:all wants to tidy the racks — the checks behind docs/acceptances/inventory/placement.md, section *rack*,
// givens 13–16 (when *move goods in rack*). The move goods in rack regression spec: one test per role of each given —
// warehouse:owner, warehouse:admin, warehouse:staff — each signed in as a person of that role in the warehouse, on racks
// and products of its own, so no figure is moved by another test. Every move goes through Rack detail's own dialog
// (rack-action-move → move-goods-dialog).
//
//   13 (rack A: 4 units · all to rack C) — default rack C, Move Everything, Move
//      then: A −4, C +4 — A's shelf 4 → 0 (the product leaves A's page, a-shelf-never-goes-below-zero), C's 0 → 4, on
//            the two rack pages and on RackStock under the role's own token;
//      then: batches and value unchanged — the product's batches (BatchList: arrived, ready, used, broken, lost, unit
//            cost, line cost, ready value) and its ready units and value here (ProductStockSummary) read the same before
//            and after (a-move-writes-two-rack-rows-and-no-batch-row, a-move-lists-its-units-at-zero-value); the units
//            on C carry A's unit cost, so C is worth what A was (Rp 40.000);
//      then: move in both racks' history with who moved it — a Moved row on A (−4, on shelf after 0) and on C (+4, 4),
//            each By the role's person (any-warehouse-member-may-move-goods), on the screen and on RackHistory.
//   14 (rack A: 6 units · 4 to C, 2 to D) — default rack C with 4, Split to Another Rack → D with 2, Move
//      then: C +4, D +2 (a-move-is-one-rack-to-one-or-more-racks).
//   15 (product in a running opname) — a count planned on the rack (OPNAME_PLAN_PLACEMENT), started by root
//      then: move refused, message says it is being counted — the dialog shows the line locked, *Being counted ·
//            Locked until the count ends.*, with no quantity and nothing for Move to take; the same move sent anyway with
//            the role's token is refused failed_precondition, its message *… is being counted …*
//            (a-move-is-all-or-nothing, a-lock-stops-sales-and-cancels-too); the shelf stays 2.
//   16 (moving 2 products · 1 of them taken by an order while the dialog is open) — Move Everything fills both (3 + 2),
//      then root places an order for 1 of the second product, whose take lowers that rack (the only shelf holding it),
//      then Move
//      then: nothing moved, both stay on the rack — the move is refused whole (a-move-is-all-or-nothing): the dialog says
//            *Nothing was moved*, the rack still holds both products (3 and the 1 the order left), the destination
//            holds nothing, and neither rack's history has a Moved row.
//
// The ground (root, once): a selling team that owns the goods (with a shop, its return warehouse = the warehouse) and a
// warehouse, both root's. Per role a person and racks of its own (13 A/C, 14 A/C/D, 16 A/C) and four products, all
// restocked in ONE restock accepted onto those racks. Given 15 is SHARED by the three roles — one count runs per
// warehouse, and a refused move changes nothing: one rack (15 A, its product 2 units) under the count, and an empty
// rack (15 B) the refused move names as its destination. The count starts last, after every accept.

const PASSWORD = "e2e-rack-tidy-pass-1";
const ROLES = [
  { given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", key: "own" },
  { given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", key: "adm" },
  { given: "warehouse:staff", role: "ROLE_WAREHOUSE_STAFF", key: "stf" },
] as const;
type Key = (typeof ROLES)[number]["key"];

// Each given's case text, verbatim from placement.md — the marking script finds the tests by it.
const C13 = "rack A: 4 units · all to rack C";
const C14 = "rack A: 6 units · 4 to C, 2 to D";
const C15 = "product in a running opname";
const C16 = "moving 2 products · 1 of them taken by an order while the dialog is open";
const GIVEN = "warehouse:all wants to tidy the racks";

// A username is lowercase letters and digits only.
const username = (key: Key) => `e2erktidy${key}${SUFFIX}`;
const displayName = (given: string) => `Rapi ${given} ${SUFFIX}`;
const rackCode = (n: string, tag: string) => `mv${n}-${tag}-${SUFFIX}`;

// The products of a role: M on 13 A, N on 14 A, R and T on 16 A — and the shared X on 15 A.
const LINES = {
  M: { name: "Kaos Rapi", count: 4, total: 40_000 },
  N: { name: "Topi Rapi", count: 6, total: 90_000 },
  R: { name: "Celana Rapi", count: 3, total: 30_000 },
  T: { name: "Sabuk Rapi", count: 2, total: 24_000 },
} as const;
type Line = keyof typeof LINES;
const X = { name: "Jaket Rapi", count: 2, total: 20_000 } as const;
const productCode = (line: string, tag: string) => `MV${line}${tag.toUpperCase()}${SUFFIX}`;
const productName = (name: string, tag: string) => `${name} ${tag} ${SUFFIX}`;

interface Ground {
  user: string;
  racks: { a13: string; c13: string; a14: string; c14: string; d14: string; a16: string; c16: string };
  products: Record<Line, { id: string; code: string }>;
}

const ground = {
  warehouse: "",
  seller: "",
  shop: "",
  account: "",
  shared: { a15: "", b15: "", x: { id: "", code: "" }, count: "" },
  roles: {} as Record<Key, Ground>,
};

// Root's page, signed in once — the order of given 16 is placed from it while the role's dialog is open.
let rootPage: Page;

interface Movement {
  id: string;
  productId: string;
  delta?: string;
  balance?: string;
  kind: string;
  actorUserId?: string;
}

interface ShelfLine {
  productId: string;
  onHand?: string;
  unitCost?: number;
  costKnown?: boolean;
  value?: number;
  counting?: boolean;
}

// An RPC as the signed-in person — the status and the JSON, so a refusal is asserted as well as a success.
async function send(page: Page, method: string, body: unknown): Promise<{ status: number; json: Record<string, any> }> {
  return page.evaluate(
    async ([m, b, apiUrl]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ?? window.localStorage.getItem("warehouse_revamp.token");
      const res = await fetch(`${apiUrl}/warehouse.${m as string}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(b),
      });

      return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, any> };
    },
    [method, body, API_URL] as const,
  );
}

// Work in the given team: the active team is per tab, in sessionStorage (TeamContext).
async function useTeam(page: Page, teamId: string) {
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

async function asRole(page: Page, key: Key) {
  await login(page, username(key), PASSWORD);
  await useTeam(page, ground.warehouse);
}

// The shelf, as the server answers the signed-in person: product id → its line.
async function rackStock(page: Page, rackId: string): Promise<Record<string, ShelfLine>> {
  const res = await api(page, "inventory.v1.RackService/RackStock", {
    teamId: ground.warehouse,
    filter: { rackId },
    dataRequest: ["RACK_STOCK_DATA_TYPE_RACK_STOCK"],
    page: { page: 1, limit: 50 },
  });
  return Object.assign({}, ...(res.items ?? []).map((it: { rackStock?: { mapData: object } }) => it.rackStock?.mapData ?? {}));
}

// A product's units on a rack, 0 when the rack no longer lists it.
const onHand = async (page: Page, rackId: string, productId: string) => (await rackStock(page, rackId))[productId]?.onHand ?? "0";

// The rack's history, as the server answers the signed-in person — in its order.
async function rackHistory(page: Page, rackId: string): Promise<Movement[]> {
  const res = await api(page, "inventory.v1.RackService/RackHistory", {
    teamId: ground.warehouse,
    filter: { rackId },
    dataRequest: ["RACK_HISTORY_DATA_TYPE_MOVEMENT"],
    page: { page: 1, limit: 20 },
  });
  const byId: Record<string, Movement> = Object.assign(
    {},
    ...(res.items ?? []).map((it: { movement?: { mapData: object } }) => it.movement?.mapData ?? {}),
  );
  return ((res.ids ?? []) as string[]).map((id) => byId[id]!).filter(Boolean);
}

const moves = async (page: Page, rackId: string) => (await rackHistory(page, rackId)).filter((m) => m.kind === "MOVEMENT_KIND_MOVE");

// The product's batches here, each with every figure a batch carries — id → figures.
async function batchesOf(page: Page, productId: string) {
  const res = await api(page, "inventory.v1.InventoryService/BatchList", {
    teamId: ground.warehouse,
    filter: { productId },
    dataRequest: ["BATCH_LIST_DATA_TYPE_BATCH"],
    page: { page: 1, limit: 20 },
  });
  const byId: Record<string, Record<string, unknown>> = Object.assign(
    {},
    ...(res.items ?? []).map((it: { batch?: { mapData: object } }) => it.batch?.mapData ?? {}),
  );
  return Object.fromEntries(
    Object.entries(byId).map(([id, b]) => [
      id,
      {
        arrived: b.arrived ?? "0",
        ready: b.ready ?? "0",
        used: b.used ?? "0",
        broken: b.broken ?? "0",
        lost: b.lost ?? "0",
        unitCost: b.unitCost ?? 0,
        lineCost: b.lineCost ?? 0,
        readyValue: b.readyValue ?? 0,
      },
    ]),
  );
}

// The product's READY units and value in this warehouse — ProductStockSummary.
async function readyOf(page: Page, productId: string) {
  const res = await api(page, "inventory.v1.InventoryService/ProductStockSummary", { teamId: ground.warehouse, productId });
  return { qty: Number(res.readyQty ?? 0), value: Number(res.readyValue ?? 0) };
}

// One history row's cells on a desktop: When · What · Product · By · Change · On shelf after.
const cellsOf = (page: Page, movementId: string) => page.getByTestId(`rack-history-row-${movementId}`).getByRole("cell");

async function openRack(page: Page, rackId: string) {
  await page.goto(`/inventories/racks/${rackId}`);
  await expect(page.getByTestId("rack-detail-page")).toBeVisible();
}

// The Move dialog of the rack on screen, its lines loaded.
async function openMove(page: Page, firstProductId: string) {
  await page.getByTestId("rack-action-move").click();
  const dialog = page.getByTestId("move-goods-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId(`move-line-${firstProductId}`)).toBeVisible();
  return dialog;
}

// The dialog's default rack — the one every line goes to unless changed.
async function pickDefault(dialog: Locator, rackId: string) {
  await dialog.getByTestId("move-default-to").click();
  const option = dialog.getByTestId(`rack-select-option-${rackId}`);
  await expect(option).toBeVisible();
  await option.click();
}

// Move, and the RackMove answer it sent.
async function submitMove(page: Page, dialog: Locator) {
  const answer = page.waitForResponse((r) => r.url().includes("RackService/RackMove"));
  await dialog.getByTestId("move-submit").click();
  return answer;
}

test.describe.configure({ timeout: 120_000 });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  const page = await browser.newPage();
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  rootPage = page;

  const team = async (name: string, teamCode: string, type: string) =>
    String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
  ground.seller = await team(`E2E Rapi Seller ${SUFFIX}`, `MVS${SUFFIX}`, "TEAM_TYPE_SELLING");
  ground.warehouse = await team(`E2E Rapi Gudang ${SUFFIX}`, `MVW${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  await api(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: ground.warehouse, feePercent: 10, minFee: 0 });
  await api(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", {
    teamId: ground.seller,
    warehouseId: ground.warehouse,
  });
  ground.shop = String(
    (
      await api(page, "selling.v1.ShopService/ShopCreate", {
        teamId: ground.seller,
        name: `E2E Rapi Shop ${SUFFIX}`,
        shopCode: `MVH${SUFFIX}`,
        marketplace: "MARKETPLACE_SHOPEE",
      })
    ).shop.id,
  );

  const category = await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Rapi ${SUFFIX}` });
  const product = async (name: string, line: string, tag: string) => {
    const created = await api(page, "product.v1.ProductService/ProductCreate", {
      teamId: ground.seller,
      productCodePart: productCode(line, tag),
      name: productName(name, tag),
      categoryId: category.category.id,
    });
    return { id: String(created.product.id), code: String(created.product.productCode) };
  };

  ground.account = String(
    (
      await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId: ground.seller,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name: `E2E rapi restock ${SUFFIX}`,
        holderName: "E2E",
        accountNumber: `E2E-MVG-${SUFFIX}`,
        openingBalance: 0,
        openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
      })
    ).account.id,
  );
  // A restock is paid from an OPERATIONAL account (a-restock-names-its-paying-account).
  await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: ground.seller,
    accountId: ground.account,
    operational: true,
  });

  const rack = async (n: string, tag: string) =>
    String((await api(page, "inventory.v1.RackService/RackCreate", { teamId: ground.warehouse, code: rackCode(n, tag) })).rack.id);

  // The restock's lines: product → its count, total and the rack it is put away on.
  const restockLines: { productId: string; code: string; name: string; count: number; total: number; rackId: string }[] = [];

  for (const r of ROLES) {
    const user = String(
      (
        await api(page, "user.v1.UserService/CreateUser", {
          teamId: ground.warehouse,
          username: username(r.key),
          password: PASSWORD,
          name: displayName(r.given),
          role: r.role,
        })
      ).user.id,
    );

    const racks = {
      a13: await rack("13a", r.key),
      c13: await rack("13c", r.key),
      a14: await rack("14a", r.key),
      c14: await rack("14c", r.key),
      d14: await rack("14d", r.key),
      a16: await rack("16a", r.key),
      c16: await rack("16c", r.key),
    };
    const products = {} as Ground["products"];
    for (const line of Object.keys(LINES) as Line[]) products[line] = await product(LINES[line].name, line, r.key);
    ground.roles[r.key] = { user, racks, products };

    const onRack: Record<Line, string> = { M: racks.a13, N: racks.a14, R: racks.a16, T: racks.a16 };
    for (const line of Object.keys(LINES) as Line[]) {
      restockLines.push({
        productId: products[line].id,
        code: products[line].code,
        name: productName(LINES[line].name, r.key),
        count: LINES[line].count,
        total: LINES[line].total,
        rackId: onRack[line],
      });
    }
  }

  // Given 15's ground, shared by the three roles.
  ground.shared.a15 = await rack("15a", "all");
  ground.shared.b15 = await rack("15b", "all");
  ground.shared.x = await product(X.name, "X", "all");
  restockLines.push({
    productId: ground.shared.x.id,
    code: ground.shared.x.code,
    name: productName(X.name, "all"),
    count: X.count,
    total: X.total,
    rackId: ground.shared.a15,
  });

  // GIVEN — one restock, accepted onto the racks: each role's 13 A 4, 14 A 6, 16 A 3 + 2, and 15 A 2.
  const restock = await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
    teamId: ground.seller,
    warehouseId: ground.warehouse,
    financeAccountId: ground.account,
    items: restockLines.map((l) => ({ productId: l.productId, productCode: l.code, name: l.name, count: l.count, total: l.total })),
  });
  await api(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: ground.warehouse,
    requestId: restock.request.id,
    lines: (restock.request.items as { id: string; productId: string }[]).map((item) => {
      const line = restockLines.find((l) => l.productId === String(item.productId))!;
      return { itemId: item.id, receivedCount: line.count, placements: [{ placementId: line.rackId, quantity: line.count }] };
    }),
  });

  // GIVEN (15) — a count planned on rack 15 A, running: its product is locked there.
  const session = await api(page, "inventory.v1.OpnameService/OpnameSessionCreate", {
    teamId: ground.warehouse,
    plan: "OPNAME_PLAN_PLACEMENT",
    filterPlacementId: ground.shared.a15,
  });
  ground.shared.count = String(session.session.id);
});

test.afterAll(async () => {
  await rootPage?.close();
});

test.describe(`${GIVEN} (${C13})`, () => {
  for (const r of ROLES) {
    test(`${r.given} move goods in rack (${C13})`, async ({ page }) => {
      const g = () => ground.roles[r.key];
      const M = () => g().products.M;
      await asRole(page, r.key);

      // BEFORE — read as the role: A holds 4 at Rp 10.000 each, C nothing; the product's batches and ready value here.
      const batchesBefore = await batchesOf(page, M().id);
      expect(Object.keys(batchesBefore)).toHaveLength(1);
      const readyBefore = await readyOf(page, M().id);
      expect(readyBefore).toEqual({ qty: 4, value: 40_000 });
      const shelfBefore = (await rackStock(page, g().racks.a13))[M().id];
      expect(shelfBefore).toMatchObject({ onHand: "4", unitCost: 10_000, value: 40_000 });
      expect(await onHand(page, g().racks.c13, M().id)).toBe("0");

      // WHEN — move goods in rack, through A's own dialog: everything to rack C.
      await openRack(page, g().racks.a13);
      await expect(page.getByTestId(`rack-stock-onhand-${M().id}`)).toHaveText("4");
      const dialog = await openMove(page, M().id);
      await pickDefault(dialog, g().racks.c13);
      await dialog.getByTestId("move-everything").click();
      await expect(dialog.getByTestId(`move-qty-${M().id}-0`)).toHaveValue("4");
      await expect(dialog.getByTestId("move-summary")).toHaveText("4 units of 1 product(s) to 1 rack(s)");
      await dialog.getByTestId("move-note").fill(`tidy aisle A ${SUFFIX}`);
      const answer = await submitMove(page, dialog);
      expect(answer.status()).toBe(200);
      await expect(dialog).toBeHidden();

      await test.step("then: A −4, C +4", async () => {
        // A's page, refreshed in place: the product is gone from its shelf.
        await expect.soft(page.getByTestId(`rack-stock-onhand-${M().id}`)).toHaveCount(0);
        await expect.soft(page.getByTestId("rack-detail-empty")).toBeVisible();
        expect.soft(await onHand(page, g().racks.a13, M().id)).toBe("0");
        expect.soft(await onHand(page, g().racks.c13, M().id)).toBe("4");

        await openRack(page, g().racks.c13);
        await expect.soft(page.getByTestId(`rack-stock-onhand-${M().id}`)).toHaveText("4");
      });

      await test.step("then: batches and value unchanged", async () => {
        // The batch ledger: the same batch, every figure as it was.
        expect.soft(await batchesOf(page, M().id)).toEqual(batchesBefore);
        // The product's ready units and value here: 4, Rp 40.000, as before.
        expect.soft(await readyOf(page, M().id)).toEqual(readyBefore);
        // The units on C carry A's price — C is worth what A was.
        expect.soft((await rackStock(page, g().racks.c13))[M().id]).toMatchObject({
          onHand: "4",
          unitCost: shelfBefore!.unitCost,
          costKnown: true,
          value: shelfBefore!.value,
        });
        await expect.soft(page.getByTestId(`rack-unit-cost-${M().id}`)).toHaveText("Rp 10.000");
        await expect.soft(page.getByTestId(`rack-line-value-${M().id}`)).toHaveText("Rp 40.000");
      });

      await test.step("then: move in both racks' history with who moved it", async () => {
        const want = [
          { rack: g().racks.c13, side: "C", delta: "4", change: "+4", after: "4" },
          { rack: g().racks.a13, side: "A", delta: "-4", change: "-4", after: "0" },
        ];
        for (const w of want) {
          // The ledger, under the role's own token: one Moved row, its change, the shelf after, and who moved it.
          const rows = await moves(page, w.rack);
          expect.soft(rows, `rack ${w.side}: one Moved row`).toHaveLength(1);
          const m = rows[0];
          expect.soft(m?.productId, `rack ${w.side}: the product`).toBe(M().id);
          expect.soft(m?.delta, `rack ${w.side}: change`).toBe(w.delta);
          // A shelf left at 0 comes back with no balance at all (proto3 JSON leaves a zero out).
          expect.soft(m ? (m.balance ?? "0") : undefined, `rack ${w.side}: on the shelf after`).toBe(w.after);
          expect.soft(m?.actorUserId, `rack ${w.side}: moved by`).toBe(g().user);

          // The screen: the rack's Riwayat row — Moved, the product, By the role's person, the change, the shelf after.
          await openRack(page, w.rack);
          await expect.soft(page.getByTestId("rack-history-table")).toBeVisible();
          const cells = cellsOf(page, String(m?.id));
          await expect.soft(cells.nth(1)).toContainText("Moved");
          await expect.soft(cells.nth(2)).toHaveText(productName(LINES.M.name, r.key));
          await expect.soft(cells.nth(3)).toContainText(displayName(r.given));
          await expect.soft(cells.nth(4)).toHaveText(w.change);
          await expect.soft(cells.nth(5)).toHaveText(w.after);
        }
      });
    });
  }
});

test.describe(`${GIVEN} (${C14})`, () => {
  for (const r of ROLES) {
    test(`${r.given} move goods in rack (${C14})`, async ({ page }) => {
      const g = () => ground.roles[r.key];
      const N = () => g().products.N;
      await asRole(page, r.key);
      expect(await onHand(page, g().racks.a14, N().id)).toBe("6");

      // WHEN — move goods in rack: 4 to the default rack C, Split to Another Rack → D with 2.
      await openRack(page, g().racks.a14);
      const dialog = await openMove(page, N().id);
      await pickDefault(dialog, g().racks.c14);
      await dialog.getByTestId(`move-qty-${N().id}-0`).fill("4");
      await dialog.getByTestId(`move-split-${N().id}`).click();
      const leg = dialog.getByTestId(`move-leg-${N().id}-1`);
      await expect(leg).toBeVisible();
      await leg.getByTestId(`move-to-${N().id}-1`).click();
      const option = leg.getByTestId(`rack-select-option-${g().racks.d14}`);
      await expect(option).toBeVisible();
      await option.click();
      await leg.getByTestId(`move-qty-${N().id}-1`).fill("2");
      await expect(dialog.getByTestId("move-summary")).toHaveText("6 units of 1 product(s) to 2 rack(s)");
      const answer = await submitMove(page, dialog);
      expect(answer.status()).toBe(200);
      await expect(dialog).toBeHidden();

      await test.step("then: C +4, D +2", async () => {
        expect.soft(await onHand(page, g().racks.c14, N().id)).toBe("4");
        expect.soft(await onHand(page, g().racks.d14, N().id)).toBe("2");

        await openRack(page, g().racks.c14);
        await expect.soft(page.getByTestId(`rack-stock-onhand-${N().id}`)).toHaveText("4");
        await openRack(page, g().racks.d14);
        await expect.soft(page.getByTestId(`rack-stock-onhand-${N().id}`)).toHaveText("2");
      });

      await test.step("regression: A gave up all 6 — the move took off what it put on", async () => {
        expect.soft(await onHand(page, g().racks.a14, N().id)).toBe("0");
        const into = [...(await moves(page, g().racks.c14)), ...(await moves(page, g().racks.d14))];
        expect.soft(into.map((m) => m.delta).sort()).toEqual(["2", "4"]);
        const outOf = (await moves(page, g().racks.a14)).reduce((s, m) => s + Number(m.delta ?? 0), 0);
        expect.soft(outOf).toBe(-6);
      });
    });
  }
});

test.describe(`${GIVEN} (${C15})`, () => {
  for (const r of ROLES) {
    test(`${r.given} move goods in rack (${C15})`, async ({ page }) => {
      const x = ground.shared.x;
      await asRole(page, r.key);

      // GIVEN — the product on rack 15 A is under a running count, as the role reads it.
      const shelf = (await rackStock(page, ground.shared.a15))[x.id];
      expect(shelf).toMatchObject({ onHand: "2", counting: true });

      // WHEN — move goods in rack: open the dialog on 15 A, pick 15 B, Move Everything.
      await openRack(page, ground.shared.a15);
      const dialog = await openMove(page, x.id);
      await pickDefault(dialog, ground.shared.b15);
      await dialog.getByTestId("move-everything").click();

      await test.step("then: move refused, message says it is being counted", async () => {
        // The dialog: the line is locked and says why — no quantity to type, nothing for Move to take.
        const locked = dialog.getByTestId(`move-counting-${x.id}`);
        await expect.soft(locked).toBeVisible();
        await expect.soft(locked).toContainText("Being counted");
        await expect.soft(locked).toContainText("Locked until the count ends.");
        await expect.soft(dialog.getByTestId(`move-qty-${x.id}-0`)).toHaveCount(0);
        await expect.soft(dialog.getByTestId("move-submit")).toBeDisabled();

        // The same move sent anyway, with the role's own token: refused, and the message says it is being counted.
        const refused = await send(page, "inventory.v1.RackService/RackMove", {
          teamId: ground.warehouse,
          fromRackId: ground.shared.a15,
          lines: [{ productId: x.id, quantity: 1, toRackId: ground.shared.b15 }],
          description: `tidy while counting ${SUFFIX}`,
        });
        expect.soft(refused.status).not.toBe(200);
        expect.soft(refused.json.code).toBe("failed_precondition");
        expect.soft(String(refused.json.message ?? "")).toContain("is being counted");

        // Nothing moved: 15 A still holds 2, 15 B nothing, no Moved row on either.
        expect.soft(await onHand(page, ground.shared.a15, x.id)).toBe("2");
        expect.soft(await onHand(page, ground.shared.b15, x.id)).toBe("0");
        expect.soft(await moves(page, ground.shared.a15)).toHaveLength(0);
        expect.soft(await moves(page, ground.shared.b15)).toHaveLength(0);
      });

      await dialog.getByTestId("move-cancel").click();
      await expect(dialog).toBeHidden();
    });
  }
});

test.describe(`${GIVEN} (${C16})`, () => {
  for (const r of ROLES) {
    test(`${r.given} move goods in rack (${C16})`, async ({ page }) => {
      const g = () => ground.roles[r.key];
      const R = () => g().products.R;
      const T = () => g().products.T;
      await asRole(page, r.key);
      expect(await onHand(page, g().racks.a16, R().id)).toBe("3");
      expect(await onHand(page, g().racks.a16, T().id)).toBe("2");

      // WHEN — move goods in rack: both products, everything, to rack C …
      await openRack(page, g().racks.a16);
      const dialog = await openMove(page, R().id);
      await expect(dialog.getByTestId(`move-line-${T().id}`)).toBeVisible();
      await pickDefault(dialog, g().racks.c16);
      await dialog.getByTestId("move-everything").click();
      await expect(dialog.getByTestId(`move-qty-${R().id}-0`)).toHaveValue("3");
      await expect(dialog.getByTestId(`move-qty-${T().id}-0`)).toHaveValue("2");
      await expect(dialog.getByTestId("move-summary")).toHaveText("5 units of 2 product(s) to 1 rack(s)");

      // … and, while the dialog is open, an order takes 1 of the second product off this rack (the only shelf holding it).
      await api(rootPage, "selling.v1.OrderService/OrderCreate", {
        idempotencyKey: `e2e-mv-${SUFFIX}-${r.key}`,
        shipmentChannelId: "1",
        teamId: ground.seller,
        shopId: ground.shop,
        warehouseId: ground.warehouse,
        customerName: `E2E Rapi Buyer ${r.key}`,
        platformTotal: 50_000,
        platformCreatedAtUnix: Math.floor(Date.now() / 1000),
        orderExternalRefId: `E2E-MV-${SUFFIX}-${r.key}`,
        items: [{ productId: T().id, productCode: T().code, name: productName(LINES.T.name, r.key), quantity: 1 }],
      });
      expect(await onHand(page, g().racks.a16, T().id)).toBe("1");

      // … then Move. The dialog read the shelf when it opened, so Move still offers 2; should it have re-read the shelf
      // meanwhile, it holds the move itself and names the product instead.
      const submit = dialog.getByTestId("move-submit");
      const answer = (await submit.isEnabled()) ? await submitMove(page, dialog) : undefined;
      test.info().annotations.push({
        type: "refused by",
        description: answer ? `the server (RackMove ${answer.status()})` : "the dialog (it re-read the shelf)",
      });

      await test.step("then: nothing moved, both stay on the rack", async () => {
        // Refused whole, and the dialog says so.
        if (answer) {
          expect.soft(answer.status()).not.toBe(200);
          await expect.soft(dialog.getByTestId("move-error")).toBeVisible();
          await expect.soft(dialog.getByTestId("move-error")).toContainText("Nothing was moved");
        } else {
          await expect.soft(dialog.getByTestId("move-problem")).toContainText(productName(LINES.T.name, r.key));
        }

        // The contract: rack A still holds both — 3, and the 1 the order left — rack C nothing, no Moved row on either.
        const a = await rackStock(page, g().racks.a16);
        expect.soft(a[R().id]?.onHand).toBe("3");
        expect.soft(a[T().id]?.onHand).toBe("1");
        expect.soft(Object.keys(await rackStock(page, g().racks.c16))).toEqual([]);
        expect.soft(await moves(page, g().racks.a16)).toHaveLength(0);
        expect.soft(await rackHistory(page, g().racks.c16)).toHaveLength(0);

        // The screen: rack A, read again, lists both; rack C is empty.
        await dialog.getByTestId("move-cancel").click();
        await expect.soft(dialog).toBeHidden();
        await openRack(page, g().racks.a16);
        await expect.soft(page.getByTestId(`rack-stock-onhand-${R().id}`)).toHaveText("3");
        await expect.soft(page.getByTestId(`rack-stock-onhand-${T().id}`)).toHaveText("1");
        await openRack(page, g().racks.c16);
        await expect.soft(page.getByTestId("rack-detail-empty")).toBeVisible();
      });
    });
  }
});
