import { expect, test } from "@playwright/test";
import { API_URL } from "./env";
import { ROOT_USER_ID } from "./global-setup";
import { asRoot, call, login, root, signInAs, today } from "./metric_ground";

// warehouse owner · admin wants to call a count off — the checks behind docs/acceptances/inventory/opname.md, section
// *cancel*, given 26 (when *cancel opname*). One test per role the given names — warehouse:owner, warehouse:admin — each
// signed in as a person of that role in a WAREHOUSE OF ITS OWN (one active count per warehouse,
// one-active-count-per-warehouse), where root planned a count of every rack and a COUNTER — a warehouse staff of the same
// warehouse — counted ONE of its two rows through the API, short and with a broken unit (the counting is givens 7–14's).
// The role then calls it off as a person does: the count's watch page → *Cancel Count* → the confirm *Cancel Count #N?*
// (*Its rows are released and nothing is posted. The counts already made are dropped.*) → OpnameSessionCancel (business
// rules: opname.md §cancel, the-lock-is-the-open-snapshot-row — cancel posts nothing and releases the racks,
// an-abandoned-count-waits-for-the-admin, a-draft-names-its-session-and-rack — a cancelled session is never read into a
// later count, a-lock-stops-sales-and-cancels-too).
//
//   26 (count active · some rows counted) — product X, 5 units of the selling team's restock at Rp 10.000: 3 on rack A,
//      2 on rack B. Rack A counted 1 of the book's 3 (1 broken, 1 lost, the reasons written) and marked counted; rack B
//      not counted — the watch page reads 1 / 2 counted.
//     then: status cancelled — the answer CANCEL; the toast *Count #N cancelled*; the watch page's badge *Cancelled* with
//           no Count, Cancel Count or Finalize left; OpnameSessionDetail under the role's token CANCEL; the counts list
//           shows no active count and lists it under *Cancelled*; the counter's count of the row left is refused.
//     then: no stock or debt changes, the counts dropped — ready 5 (the product page's On hand 5), rack A 3 and rack B 2,
//           the same batch, the pair's balance and entries unchanged; the cancelled count cannot be finalized; a NEW
//           count of the warehouse starts with every row not counted, no count and no drafts — the dropped counts are not
//           carried (root cancels it again before the next then).
//     then: the counted products can be ordered again — an order of X from this warehouse is refused while the count
//           holds its racks (*held on rack … by count #N*), and taken once it is cancelled (ready 5 → 4).
//
// The ground (root, once): a selling team with an operational account, a category, a shop and a return warehouse (for the
// orders). Per role a warehouse with its fee, two racks, product X restocked, the role's person, the counter, root's count
// of every rack and the counting.

const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-opname-cancel-1";
const ROLES = [
  { given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", key: "o" },
  { given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", key: "a" },
] as const;
type Role = (typeof ROLES)[number];
type Key = Role["key"];

// A given naming two roles is written with neither token in the describe — the marker reads the role from each test.
const GIVEN = "warehouse owner · admin wants to call a count off";
const WHEN = "cancel opname";
// The given's case text, verbatim from opname.md — the marking script finds the tests by it.
const CASE = "count active · some rows counted";

interface Rack {
  id: string;
  code: string;
}
interface Ground {
  tag: string;
  warehouse: string;
  user: string;
  userId: string;
  userName: string;
  token: string;
  counterToken: string;
  racks: Rack[];
  product: { id: string; code: string; name: string };
  session: string;
  rows: string[];
  batches: string[];
}

const ground = {
  seller: "",
  account: "",
  category: "",
  shop: "",
  g: {} as Record<Key, Ground>,
};

// The call under `token`, answering its status and body instead of throwing — a refusal is the point.
async function send(token: string, method: string, body: unknown): Promise<{ status: number; json: Record<string, any> }> {
  const res = await fetch(`${API_URL}/warehouse.${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, any> };
}

const num = (v: unknown) => Number(v ?? 0);

async function batchIds(token: string, warehouse: string, productId: string): Promise<string[]> {
  const res = await call(token, "inventory.v1.InventoryService/BatchList", {
    teamId: warehouse,
    filter: { productId },
    page: { page: 1, limit: 20 },
  });

  return ((res.ids ?? []) as unknown[]).map(String).sort((a, b) => Number(a) - Number(b));
}

// The product's READY units in this warehouse, as the role reads them (ProductStockSummary).
async function readyOf(b: Ground): Promise<number> {
  return num(
    (await call(b.token, "inventory.v1.InventoryService/ProductStockSummary", { teamId: b.warehouse, productId: b.product.id })).readyQty,
  );
}

// The product's units on one rack, as the role reads them (RackStock).
async function onRack(b: Ground, rack: Rack): Promise<number> {
  const res = await call(b.token, "inventory.v1.RackService/RackStock", {
    teamId: b.warehouse,
    filter: { rackId: rack.id },
    page: { page: 1, limit: 20 },
  });
  for (const it of res.items ?? []) {
    for (const l of Object.values(it.rackStock?.mapData ?? {}) as { productId: string; onHand?: string }[]) {
      if (String(l.productId) === b.product.id) return num(l.onHand);
    }
  }

  return 0;
}

// What the warehouse and the selling team owe each other, from the warehouse's side, and the pair's entries — the role's
// own LiabilityLogList.
async function pairOf(b: Ground): Promise<{ balance: number; logs: string[] }> {
  const res = await call(b.token, "liability.v1.LiabilityService/LiabilityLogList", {
    teamId: b.warehouse,
    filter: { counterpartyId: ground.seller },
    dataRequest: ["LIABILITY_LOG_LIST_DATA_TYPE_LOG"],
    page: { page: 1, limit: 50 },
  });

  return { balance: num(res.balance), logs: ((res.ids ?? []) as unknown[]).map(String) };
}

interface Session {
  status?: string;
  rowCount?: string;
  countedRowCount?: string;
}
async function sessionOf(b: Ground, id = b.session): Promise<Session> {
  return (await call(b.token, "inventory.v1.OpnameService/OpnameSessionDetail", { teamId: b.warehouse, sessionId: id })).session;
}

interface Row {
  id: string;
  placementId: string;
  status?: string;
  recountedStockCount?: string;
  countedById?: string;
  drafts?: unknown[];
}
// A count's rows, by rack, as root reads them (OpnameRowList).
async function rowsOf(warehouse: string, session: string): Promise<Map<string, Row>> {
  const listed = await asRoot("inventory.v1.OpnameService/OpnameRowList", {
    teamId: warehouse,
    filter: { sessionId: session },
    page: { page: 1, limit: 20 },
  });
  const byRack = new Map<string, Row>();
  for (const it of listed.items ?? []) {
    for (const row of Object.values(it.row?.mapData ?? {}) as Row[]) byRack.set(String(row.placementId), row);
  }

  return byRack;
}

// An order of one unit of X from this warehouse, placed by root for the selling team.
async function orderOne(b: Ground, n: number) {
  return send(await root(), "selling.v1.OrderService/OrderCreate", {
    idempotencyKey: `e2e-qv-${b.tag}-${n}-${SUFFIX}`,
    shipmentChannelId: "1",
    teamId: ground.seller,
    shopId: ground.shop,
    warehouseId: b.warehouse,
    customerName: "E2E Cancel Count Buyer",
    platformTotal: 15000,
    platformCreatedAtUnix: Math.floor(Date.now() / 1000),
    orderExternalRefId: `QV${b.tag}${n}${SUFFIX}`,
    items: [{ productId: b.product.id, productCode: b.product.code, name: b.product.name, quantity: 1 }],
  });
}

async function build(r: Role): Promise<Ground> {
  const tag = r.key.toUpperCase();
  const rootToken = await root();
  const warehouse = String(
    (
      await asRoot("team.v1.TeamService/TeamCreate", {
        name: `E2E Cancel Count ${tag} ${SUFFIX}`,
        teamCode: `QV${tag}${SUFFIX}`,
        type: "TEAM_TYPE_WAREHOUSE",
        ownerUserId: ROOT_USER_ID,
      })
    ).team.id,
  );
  await asRoot("warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: warehouse, feePercent: 10, minFee: 0 });

  const user = `e2eqv${r.key}${SUFFIX}`;
  const userName = `Batal ${r.given} ${SUFFIX}`;
  const created = await asRoot("user.v1.UserService/CreateUser", { teamId: warehouse, username: user, password: PASSWORD, name: userName, role: r.role });
  const counter = `e2eqvc${r.key}${SUFFIX}`;
  await asRoot("user.v1.UserService/CreateUser", {
    teamId: warehouse,
    username: counter,
    password: PASSWORD,
    name: `Penghitung Batal ${tag} ${SUFFIX}`,
    role: "ROLE_WAREHOUSE_STAFF",
  });

  const racks: Rack[] = [];
  for (const side of ["a", "b"]) {
    const code = `qv${r.key}-${side}-${SUFFIX}`;
    racks.push({ id: String((await asRoot("inventory.v1.RackService/RackCreate", { teamId: warehouse, code })).rack.id), code });
  }

  const name = `Kaos X Batal ${tag} ${SUFFIX}`;
  const p = (
    await asRoot("product.v1.ProductService/ProductCreate", {
      teamId: ground.seller,
      productCodePart: `QV${tag}X${SUFFIX}`,
      name,
      categoryId: ground.category,
    })
  ).product;
  const product = { id: String(p.id), code: String(p.productCode), name };

  // GIVEN — 5 units by the selling team's restock at Rp 10.000: 3 on rack A, 2 on rack B.
  const restock = await asRoot("inventory.v1.RestockRequestService/RestockRequestCreate", {
    teamId: ground.seller,
    warehouseId: warehouse,
    financeAccountId: ground.account,
    items: [{ productId: product.id, productCode: product.code, name, count: 5, total: 50_000 }],
  });
  await asRoot("inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: warehouse,
    requestId: restock.request.id,
    lines: [
      {
        itemId: restock.request.items[0].id,
        receivedCount: 5,
        placements: [
          { placementId: racks[0]!.id, quantity: 3 },
          { placementId: racks[1]!.id, quantity: 2 },
        ],
      },
    ],
  });
  const batches = await batchIds(rootToken, warehouse, product.id);
  expect(batches, `${r.key}: one batch`).toHaveLength(1);

  const token = await login(user, PASSWORD);
  const counterToken = await login(counter, PASSWORD);

  // GIVEN — the count is active: every rack, started by root (the given is the cancel, not the start).
  const session = String((await asRoot("inventory.v1.OpnameService/OpnameSessionCreate", { teamId: warehouse, plan: "OPNAME_PLAN_ALL" })).session.id);
  const byRack = await rowsOf(warehouse, session);
  expect(byRack.size, `${r.key}: a row a rack`).toBe(2);
  const rows = racks.map((k) => String(byRack.get(k.id)?.id ?? ""));

  // GIVEN — some rows counted: rack A counted 1 of the book's 3 — 1 broken, the rest lost — the reasons written, marked
  // counted; rack B not counted.
  await call(counterToken, "inventory.v1.OpnameService/OpnameRowCount", { teamId: warehouse, rowId: rows[0], count: 1 });
  await call(counterToken, "inventory.v1.OpnameService/OpnameRowMarkCounted", {
    teamId: warehouse,
    rowId: rows[0],
    brokenCount: 1,
    brokenNote: "sobek di jahitan, dibuang",
    lostNote: "tidak ketemu, sudah dicek di bawah rak",
  });

  return { tag, warehouse, user, userId: String(created.user.id), userName, token, counterToken, racks, product, session, rows, batches };
}

test.describe.configure({ timeout: 150_000 });

test.beforeAll(async () => {
  test.setTimeout(240_000);
  const team = async (name: string, teamCode: string, type: string) =>
    String((await asRoot("team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);

  ground.seller = await team(`E2E Cancel Count Seller ${SUFFIX}`, `QVS${SUFFIX}`, "TEAM_TYPE_SELLING");
  ground.account = String(
    (
      await asRoot("financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId: ground.seller,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name: `E2E cancel count ${SUFFIX}`,
        holderName: "E2E",
        accountNumber: `E2E-QV-${SUFFIX}`,
        openingBalance: 0,
        openingOn: today(),
      })
    ).account.id,
  );
  // A restock is paid from an OPERATIONAL account (a-restock-names-its-paying-account).
  await asRoot("financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: ground.seller,
    accountId: ground.account,
    operational: true,
  });
  ground.category = String((await asRoot("category.v1.CategoryService/CategoryCreate", { name: `E2E Cancel Count ${SUFFIX}` })).category.id);

  // The orders' shop, and a return warehouse (create-refuses-a-team-with-no-return-warehouse).
  const ret = await team(`E2E Cancel Count Retur ${SUFFIX}`, `QVR${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  await asRoot("warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: ret, feePercent: 10, minFee: 0 });
  await asRoot("selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", { teamId: ground.seller, warehouseId: ret });
  ground.shop = String(
    (
      await asRoot("selling.v1.ShopService/ShopCreate", {
        teamId: ground.seller,
        name: `E2E Cancel Count Shop ${SUFFIX}`,
        shopCode: `QVP${SUFFIX}`,
        marketplace: "MARKETPLACE_SHOPEE",
      })
    ).shop.id,
  );

  for (const r of ROLES) ground.g[r.key] = await build(r);
});

// ── 26 (count active · some rows counted) ───────────────────────────────────────────────────────────────────────────────

test.describe(`${GIVEN} (${CASE})`, () => {
  for (const r of ROLES) {
    test(`${r.given} ${WHEN} (${CASE})`, async ({ page }) => {
      const b = ground.g[r.key];
      const held = new RegExp(`held on rack (${b.racks[0]!.code}|${b.racks[1]!.code}) by count #${b.session}`);

      // GIVEN — the count is active with one of its two rows counted, and while it holds the racks X cannot be ordered.
      const given = await sessionOf(b);
      expect(given.status).toBe("OPNAME_SESSION_STATUS_ACTIVE");
      expect([num(given.countedRowCount), num(given.rowCount)]).toEqual([1, 2]);
      const refused = await orderOne(b, 1);
      expect(refused.status, JSON.stringify(refused.json)).not.toBe(200);
      expect(String(refused.json.message ?? "")).toMatch(held);
      const pairBefore = await pairOf(b);
      expect(await readyOf(b)).toBe(5);

      // WHEN — the watch page → Cancel Count → the confirm → OpnameSessionCancel.
      await signInAs(page, b.user, PASSWORD, b.warehouse);
      await page.goto(`/inventories/opname/sessions/${b.session}`);
      await expect(page.getByTestId("opname-detail-page")).toBeVisible();
      await expect(page.getByTestId("opname-session-status-1")).toHaveText("Active");
      await expect(page.getByTestId("opname-summary-counted")).toContainText("1 / 2");
      await page.getByTestId("opname-detail-cancel").click();
      const dialog = page.getByRole("alertdialog", { name: `Cancel Count #${b.session}?` });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("Its rows are released and nothing is posted. The counts already made are dropped.");
      const answer = page.waitForResponse((res) => res.url().includes("OpnameService/OpnameSessionCancel"));
      await dialog.getByTestId("confirm-action").click();
      const res = await answer;
      const done = (await res.json().catch(() => ({}))) as { session?: Session };
      expect(res.ok(), JSON.stringify(done)).toBe(true);

      await test.step("then: status cancelled", async () => {
        expect(done.session?.status).toBe("OPNAME_SESSION_STATUS_CANCEL");
        await expect(page.getByText(`Count #${b.session} cancelled`)).toBeVisible();
        await expect(page.getByTestId("opname-session-status-3")).toHaveText("Cancelled");
        await expect(page.getByTestId("opname-detail-cancel")).toHaveCount(0);
        await expect(page.getByTestId("opname-detail-count")).toHaveCount(0);
        await expect(page.getByTestId("opname-detail-finalize")).toHaveCount(0);
        expect((await sessionOf(b)).status).toBe("OPNAME_SESSION_STATUS_CANCEL");

        // The counts list: no active count left, and this one under Cancelled.
        await page.goto("/inventories/opname/sessions");
        await expect(page.getByTestId(`opname-session-row-${b.session}`)).toBeVisible();
        await expect(page.getByTestId("opname-active-session")).toHaveCount(0);
        await page.getByTestId("opname-tab-cancel").click();
        await expect(page.getByTestId(`opname-session-row-${b.session}`)).toBeVisible();
        await expect(page.getByTestId(`opname-session-row-${b.session}`)).toContainText("Cancelled");

        // Nothing more is counted in it: the counter's count of the row left is refused.
        const late = await send(b.counterToken, "inventory.v1.OpnameService/OpnameRowCount", { teamId: b.warehouse, rowId: b.rows[1], count: 2 });
        expect(late.status, JSON.stringify(late.json)).not.toBe(200);
        expect((await sessionOf(b)).status).toBe("OPNAME_SESSION_STATUS_CANCEL");
      });

      await test.step("then: no stock or debt changes, the counts dropped", async () => {
        // No stock: rack A's short count and its broken unit posted nothing.
        expect(await readyOf(b)).toBe(5);
        expect(await onRack(b, b.racks[0]!)).toBe(3);
        expect(await onRack(b, b.racks[1]!)).toBe(2);
        expect(await batchIds(b.token, b.warehouse, b.product.id)).toEqual(b.batches);
        await page.goto(`/inventories/products/${b.product.id}`);
        await expect(page.getByTestId("warehouse-product-onhand")).toContainText("5");

        // No debt: the pair's balance and entries as before.
        const pairAfter = await pairOf(b);
        expect(pairAfter.balance).toBeCloseTo(pairBefore.balance, 3);
        expect(pairAfter.logs).toEqual(pairBefore.logs);

        // Nothing can post it later: the cancelled count cannot be finalized.
        const late = await send(b.token, "inventory.v1.OpnameService/OpnameSessionFinalize", { teamId: b.warehouse, sessionId: b.session });
        expect(late.status, JSON.stringify(late.json)).not.toBe(200);
        expect((await sessionOf(b)).status).toBe("OPNAME_SESSION_STATUS_CANCEL");
        expect(await readyOf(b)).toBe(5);

        // The counts dropped: a new count of the warehouse starts with every row not counted — no count, no drafts.
        const next = String(
          (await asRoot("inventory.v1.OpnameService/OpnameSessionCreate", { teamId: b.warehouse, plan: "OPNAME_PLAN_ALL" })).session.id,
        );
        expect(next).not.toBe(b.session);
        const fresh = await sessionOf(b, next);
        expect([num(fresh.countedRowCount), num(fresh.rowCount)]).toEqual([0, 2]);
        const rows = await rowsOf(b.warehouse, next);
        for (const k of b.racks) {
          const row = rows.get(k.id);
          expect(row, `a row for rack ${k.code}`).toBeTruthy();
          expect(row!.status).toBe("OPNAME_ROW_STATUS_CREATED");
          expect(num(row!.recountedStockCount)).toBe(0);
          expect(num(row!.countedById)).toBe(0);
          expect(row!.drafts ?? []).toEqual([]);
        }
        // …and the cancelled count still holds what was counted, for the record — only it is not used.
        const kept = await rowsOf(b.warehouse, b.session);
        expect(kept.get(b.racks[0]!.id)?.status).toBe("OPNAME_ROW_STATUS_COUNTED");
        await asRoot("inventory.v1.OpnameService/OpnameSessionCancel", { teamId: b.warehouse, sessionId: next });
      });

      await test.step("then: the counted products can be ordered again", async () => {
        const placed = await orderOne(b, 2);
        expect(placed.status, JSON.stringify(placed.json)).toBe(200);
        expect(String(placed.json.order?.id ?? "")).not.toBe("");
        await expect.poll(() => readyOf(b)).toBe(4);
      });
    });
  }
});
