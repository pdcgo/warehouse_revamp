import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { API_URL } from "./env";
import { ROOT_USER_ID } from "./global-setup";
import { asRoot, call, login, root, signInAs, today } from "./metric_ground";

// warehouse owner · admin wants to settle a count — the checks behind docs/acceptances/inventory/opname.md, section
// *finalize*, givens 19–25, and section *found*, given 35 (when *finalize opname*). One test per role the givens name —
// warehouse:owner, warehouse:admin — each signed in as a person of that role in a WAREHOUSE OF ITS OWN (one active count
// per warehouse, one-active-count-per-warehouse), where root planned a count of every rack and a COUNTER — a warehouse
// staff of the same warehouse — did the given's counting through the API (the counting is givens 7–14's). The role then
// settles it as a person does: the count's watch page → *Finalize* → the finalize page (what it will post) → *Finalize*
// → the confirm *Finalize Count #N?* → OpnameSessionFinalize (business rules: opname.md §How We Manage Stock Problem In
// Warehouses, broken-posts-as-written-the-rest-nets, a-surplus-claims-the-oldest-loss-first,
// last-price-is-the-teams-newest-batch-here, a-count-nets-each-product-across-the-session, nobody-finalizes-their-own-count,
// a-quiet-count-is-finalized-by-a-non-counter, a-count-settles-the-found-it-counted, a-loss-in-custody-is-a-stock-problem).
// Every product is a selling team's; its units came in by that team's restock at Rp 10.000 a unit unless said.
//
//   19 (every row counted · all match the system) — rack A, product X 5, counted 5.
//     then: count finalized, status finished — the answer FINISH; the toast *Count #N finalized*; the watch page's badge
//           *Finished*, *finalized by <the role's person>*, no Finalize left; the finalize page again says it is
//           finalized; OpnameSessionDetail under the role's token FINISH, finalized by the role's person.
//     then: says it only releases the racks, no stock or debt changes — before confirming, *Every product matches its
//           book — finalizing only releases the racks.*, the warehouse owes Rp 0, the confirm says so; after, the answer
//           posts no transaction, ready 5 and rack A 5 as before, one batch, the pair's balance and entries unchanged.
//     then: the counted products can be ordered again — an order of X from this warehouse is refused while the count
//           holds rack A (*held on rack … by count #N*), and taken once it is finalized.
//   20 (product X 5 in system · counted 3 · 1 broken · 1 lost · reasons written)
//     then: preview shows what posts and what the warehouse owes, before confirming — *Problem — the warehouse owes*
//           Rp 20.000, the product's *Problem* badge and arithmetic, its lines Broken 1 and Lost 1 on its batch at
//           Rp 10.000, the confirm naming Rp 20.000 — and nothing posted while the confirm is open (the count active,
//           ready 5, no ledger entry);
//     then: ready stock of product X decreases by 2 — 5 → 3 (ProductStockSummary, the product page's On hand);
//     then: broken 1 and lost 1 recorded at their batch price — the batch: broken 1, lost 1, ready 3, unit cost
//           Rp 10.000, its broken and lost cards Rp 10.000 each (BatchDetail and the batch page);
//     then: the warehouse owes the selling team for broken and lost — the pair's ledger gains *Goods broken* and
//           *Goods lost* on the count's problem transaction, −Rp 10.000 each from the warehouse's side, balance −20.000;
//     then: stock loss on the warehouse's daily statement — today's row's Stock loss Rp 20.000, *of which Rp 20.000
//           stock written off*;
//     then: recorded in lost stock analytic metric — Analytic › Lost stock by product: lost 1, Rp 10.000 (the broken
//           unit is not a loss in custody's count).
//   21 (product X · rack A 1 under · rack B 1 over) — 3 on A, 2 on B; counted A 2, B 3.
//     then: recorded as a move between racks, no debt changes — *Move* 1 unit, *Move: 1 unit between racks, no money*,
//           no posting line, owed Rp 0; the answer's one transaction is a MOVE; the pair unchanged;
//     then: ready stock of product X unchanged — 5;
//     then: rack A and rack B corrected — rack A 2, rack B 3 (RackStock and the product's Placement tab).
//   22 (product X 1 over · an old lost of product X not found yet · the warehouse owes the selling team) — 5 received,
//      1 adjusted LOST (StockAdjust: the batch's lost 1, the warehouse owes Rp 10.000), counted 5 of the book's 4.
//     then: the surplus claims the old loss, back into its batch at its price — *Claimed back* on that batch,
//           *claims loss #<the problem>*, 1 × Rp 10.000, *Found — claimed back* Rp 10.000; after, the batch's lost 0 and
//           ready 5, still one batch;
//     then: the warehouse's debt to the selling team decreases — the pair −10.000 → 0, a *Goods found again* reversal
//           +Rp 10.000 on the count's found transaction.
//   23 (product X 1 over · no old loss · product X's newest batch here at Rp 10.000) — 2 at Rp 8.000, then 3 at
//      Rp 10.000; counted 6.
//     then: a new batch at Rp 10.000 — *New batch* 1 × Rp 10.000 on the preview; after, a third batch: arrived 1, unit
//           cost Rp 10.000 (BatchDetail and its page);
//     then: ready stock of product X increases by 1 — 5 → 6;
//     then: no debt between the warehouse and the selling team changes — the pair's balance and entries unchanged.
//   24 (a row not counted yet) — X on rack A (counted) and rack B (not).
//     then: finalize not offered, says how many rows are left — the watch page: 1 / 2 counted, Finalize disabled,
//           *Finalize opens once every row is counted — 1 to go.*; the finalize page by its address: *1 rows are not
//           counted yet.*, its Finalize disabled; OpnameSessionFinalize under the role's token refused, the count active.
//   25 (this owner or admin counted a row in this count) — the role counted rack A's one row itself.
//     then: cannot finalize, says another owner or admin finalizes — *You counted rows in this count — another Owner or
//           Admin finalizes it.*, Finalize disabled; refused under the role's token, the count active.
//   35 (found report of 2 product X on rack A waiting · the count found product X on rack A 2 over) — the counter
//      reported 2 found on rack A before the count (FoundRequestCreate, waiting); counted 7 of the book's 5.
//     then: found report closed, settled by the count — the request SETTLED_BY_COUNT by this count, decided by the
//           role's person; Found Stock › All shows *Settled by count* and *Settled by count #N*, Waiting lists it no more;
//     then: ready stock of product X rises by 2 once, through the count, not again through the report — 5 → 7, one new
//           batch of 2; approving the request after is refused and ready stays 7, two batches.
//
// The ground (root, once): a selling team with an operational account, a category, a shop and a return warehouse (for
// given 19's order). Per (given, role) a warehouse with its fee, its racks, product X restocked, the role's person, the
// counter, root's count of every rack and the counting.

const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-opname-final-1";
const ROLES = [
  { given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", key: "o" },
  { given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", key: "a" },
] as const;
type Role = (typeof ROLES)[number];
type Key = Role["key"];

// A given naming two roles is written with neither token in the describe — the marker reads the role from each test.
const GIVEN = "warehouse owner · admin wants to settle a count";
const WHEN = "finalize opname";
// Each given's case text, verbatim from opname.md — the marking script finds the tests by it.
const CASE = {
  19: "every row counted · all match the system",
  20: "product X 5 in system · counted 3 · 1 broken · 1 lost · reasons written",
  21: "product X · rack A 1 under · rack B 1 over",
  22: "product X 1 over · an old lost of product X not found yet · the warehouse owes the selling team",
  23: "product X 1 over · no old loss · product X's newest batch here at Rp 10.000",
  24: "a row not counted yet",
  25: "this owner or admin counted a row in this count",
  35: "found report of 2 product X on rack A waiting · the count found product X on rack A 2 over",
} as const;
type Given = keyof typeof CASE;
const GIVENS: Given[] = [19, 20, 21, 22, 23, 24, 25, 35];
// A team code is at most 10 characters: QF + the two-character tag + the 6-digit SUFFIX.
const TAG: Record<Given, string> = { 19: "A", 20: "B", 21: "C", 22: "D", 23: "E", 24: "F", 25: "G", 35: "H" };

// What each given's warehouse holds and how it was counted: the racks, the restocks (unit price, units per rack), a
// LOST adjusted or a found reported on rack A before the count, and per rack the count (null = not counted; `byRole` =
// the role's person counted it, not the counter).
interface Plan {
  racks: number;
  restocks: { unit: number; on: number[] }[];
  lostBefore?: number;
  foundBefore?: number;
  counts: ({ n: number; broken?: number; byRole?: boolean } | null)[];
}
const PLAN: Record<Given, Plan> = {
  19: { racks: 1, restocks: [{ unit: 10_000, on: [5] }], counts: [{ n: 5 }] },
  20: { racks: 1, restocks: [{ unit: 10_000, on: [5] }], counts: [{ n: 3, broken: 1 }] },
  21: { racks: 2, restocks: [{ unit: 10_000, on: [3, 2] }], counts: [{ n: 2 }, { n: 3 }] },
  22: { racks: 1, restocks: [{ unit: 10_000, on: [5] }], lostBefore: 1, counts: [{ n: 5 }] },
  23: { racks: 1, restocks: [{ unit: 8_000, on: [2] }, { unit: 10_000, on: [3] }], counts: [{ n: 6 }] },
  24: { racks: 2, restocks: [{ unit: 10_000, on: [3, 2] }], counts: [{ n: 3 }, null] },
  25: { racks: 1, restocks: [{ unit: 10_000, on: [5] }], counts: [{ n: 5, byRole: true }] },
  35: { racks: 1, restocks: [{ unit: 10_000, on: [5] }], foundBefore: 2, counts: [{ n: 7 }] },
};

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
  racks: Rack[];
  product: { id: string; code: string; name: string };
  session: string;
  rows: string[];
  // The product's batches before the count.
  batches: string[];
  found: string;
}

const ground = {
  seller: "",
  account: "",
  category: "",
  shop: "",
  g: {} as Record<Given, Record<Key, Ground>>,
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

interface Batch {
  id: string;
  unitCost?: number;
  arrived?: string;
  broken?: string;
  lost?: string;
  ready?: string;
}
async function batchOf(b: Ground, id: string): Promise<Batch> {
  return (await call(b.token, "inventory.v1.InventoryService/BatchDetail", { teamId: b.warehouse, batchId: id })).batch as Batch;
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

interface Log {
  id: string;
  amount?: number;
  sourceType?: string;
  sourceId?: string;
  reversal?: boolean;
}
// What the warehouse and the selling team owe each other, from the warehouse's side (a payable is negative), and the
// pair's entries — the role's own LiabilityLogList.
async function pairOf(b: Ground): Promise<{ balance: number; logs: Log[] }> {
  const res = await call(b.token, "liability.v1.LiabilityService/LiabilityLogList", {
    teamId: b.warehouse,
    filter: { counterpartyId: ground.seller },
    dataRequest: ["LIABILITY_LOG_LIST_DATA_TYPE_LOG"],
    page: { page: 1, limit: 50 },
  });
  const byId: Record<string, Log> = Object.assign({}, ...(res.items ?? []).map((it: { log?: { mapData?: object } }) => it.log?.mapData ?? {}));

  return { balance: num(res.balance), logs: ((res.ids ?? []) as unknown[]).map((id) => byId[String(id)]!).filter(Boolean) };
}

async function sessionOf(b: Ground): Promise<{ status?: string; finalizedById?: string }> {
  return (await call(b.token, "inventory.v1.OpnameService/OpnameSessionDetail", { teamId: b.warehouse, sessionId: b.session }))
    .session;
}

interface FoundRequest {
  id: string;
  status?: string;
  stockCount?: string;
  decidedById?: string;
  settledByCountingSessionId?: string;
}
async function foundOf(b: Ground): Promise<FoundRequest> {
  const res = await call(b.token, "inventory.v1.FoundRequestService/FoundRequestList", {
    teamId: b.warehouse,
    filter: {},
    dataRequest: ["FOUND_REQUEST_LIST_DATA_TYPE_REQUEST"],
    page: { page: 1, limit: 20 },
  });
  const byId: Record<string, FoundRequest> = Object.assign(
    {},
    ...(res.items ?? []).map((it: { request?: { mapData?: object } }) => it.request?.mapData ?? {}),
  );

  return byId[b.found]!;
}

// An order of one unit of X from this warehouse, placed by root for the selling team.
async function orderOne(b: Ground, n: number) {
  return send(await root(), "selling.v1.OrderService/OrderCreate", {
    idempotencyKey: `e2e-qf-${b.tag}-${n}-${SUFFIX}`,
    shipmentChannelId: "1",
    teamId: ground.seller,
    shopId: ground.shop,
    warehouseId: b.warehouse,
    customerName: "E2E Final Buyer",
    platformTotal: 15000,
    platformCreatedAtUnix: Math.floor(Date.now() / 1000),
    orderExternalRefId: `QF${b.tag}${n}${SUFFIX}`,
    items: [{ productId: b.product.id, productCode: b.product.code, name: b.product.name, quantity: 1 }],
  });
}

async function build(g: Given, r: Role): Promise<Ground> {
  const plan = PLAN[g];
  const tag = `${TAG[g]}${r.key.toUpperCase()}`;
  const rootToken = await root();
  const warehouse = String(
    (
      await asRoot("team.v1.TeamService/TeamCreate", {
        name: `E2E Final ${tag} ${SUFFIX}`,
        teamCode: `QF${tag}${SUFFIX}`,
        type: "TEAM_TYPE_WAREHOUSE",
        ownerUserId: ROOT_USER_ID,
      })
    ).team.id,
  );
  await asRoot("warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: warehouse, feePercent: 10, minFee: 0 });

  const user = `e2eqf${g}${r.key}${SUFFIX}`;
  const userName = `Final ${r.given} ${g} ${SUFFIX}`;
  const created = await asRoot("user.v1.UserService/CreateUser", { teamId: warehouse, username: user, password: PASSWORD, name: userName, role: r.role });
  const counter = `e2eqfc${g}${r.key}${SUFFIX}`;
  await asRoot("user.v1.UserService/CreateUser", {
    teamId: warehouse,
    username: counter,
    password: PASSWORD,
    name: `Penghitung ${tag} ${SUFFIX}`,
    role: "ROLE_WAREHOUSE_STAFF",
  });

  const racks: Rack[] = [];
  for (let i = 0; i < plan.racks; i++) {
    const code = `qf${tag.toLowerCase()}-${"ab"[i]}-${SUFFIX}`;
    racks.push({ id: String((await asRoot("inventory.v1.RackService/RackCreate", { teamId: warehouse, code })).rack.id), code });
  }

  const name = `Kaos X ${tag} ${SUFFIX}`;
  const p = (
    await asRoot("product.v1.ProductService/ProductCreate", {
      teamId: ground.seller,
      productCodePart: `QF${tag}X${SUFFIX}`,
      name,
      categoryId: ground.category,
    })
  ).product;
  const product = { id: String(p.id), code: String(p.productCode), name };

  // GIVEN — the units, by the selling team's restocks, one after the other (the later one is the newest batch).
  for (const rs of plan.restocks) {
    const count = rs.on.reduce((a, q) => a + q, 0);
    const restock = await asRoot("inventory.v1.RestockRequestService/RestockRequestCreate", {
      teamId: ground.seller,
      warehouseId: warehouse,
      financeAccountId: ground.account,
      items: [{ productId: product.id, productCode: product.code, name, count, total: count * rs.unit }],
    });
    await asRoot("inventory.v1.RestockRequestService/RestockRequestAccept", {
      teamId: warehouse,
      requestId: restock.request.id,
      lines: [
        {
          itemId: restock.request.items[0].id,
          receivedCount: count,
          placements: rs.on.map((q, i) => ({ placementId: racks[i]!.id, quantity: q })).filter((x) => x.quantity > 0),
        },
      ],
    });
  }
  const batches = await batchIds(rootToken, warehouse, product.id);
  expect(batches, `${g}${r.key}: one batch a restock`).toHaveLength(plan.restocks.length);

  const book = racks.map((_, i) => plan.restocks.reduce((s, rs) => s + (rs.on[i] ?? 0), 0));
  if (plan.lostBefore) {
    // GIVEN — an old lost, not found yet: the batch's unit adjusted LOST on rack A (the warehouse owes for it).
    await asRoot("inventory.v1.InventoryService/StockAdjust", {
      warehouseId: warehouse,
      productId: product.id,
      reasonType: "STOCK_ADJUST_REASON_LOST",
      batchId: batches[0],
      quantity: plan.lostBefore,
      rackId: racks[0]!.id,
      reason: `hilang dari rak ${SUFFIX}`,
    });
    book[0] = book[0]! - plan.lostBefore;
  }

  const token = await login(user, PASSWORD);
  const counterToken = await login(counter, PASSWORD);
  let found = "";
  if (plan.foundBefore) {
    // GIVEN — the counter's found report on rack A, waiting (staff-may-report-a-found).
    found = String(
      (
        await call(counterToken, "inventory.v1.FoundRequestService/FoundRequestCreate", {
          teamId: warehouse,
          productId: product.id,
          rackId: racks[0]!.id,
          quantity: plan.foundBefore,
          note: `di balik kardus ${SUFFIX}`,
        })
      ).foundRequest.id,
    );
  }

  // The count — every rack, started by root (the given is the counting, not the start).
  const session = String((await asRoot("inventory.v1.OpnameService/OpnameSessionCreate", { teamId: warehouse, plan: "OPNAME_PLAN_ALL" })).session.id);
  const listed = await asRoot("inventory.v1.OpnameService/OpnameRowList", {
    teamId: warehouse,
    filter: { sessionId: session },
    page: { page: 1, limit: 20 },
  });
  const byRack = new Map<string, string>();
  for (const it of listed.items ?? []) {
    for (const row of Object.values(it.row?.mapData ?? {}) as { id: string; placementId: string }[]) byRack.set(String(row.placementId), String(row.id));
  }
  const rows = racks.map((k) => byRack.get(k.id) ?? "");
  expect(byRack.size, `${g}${r.key}: a row a rack`).toBe(racks.length);

  // GIVEN — the counting: counted, the reasons written, marked counted.
  for (const [i, c] of plan.counts.entries()) {
    if (!c) continue;
    const t = c.byRole ? token : counterToken;
    await call(t, "inventory.v1.OpnameService/OpnameRowCount", { teamId: warehouse, rowId: rows[i], count: c.n });
    const broken = c.broken ?? 0;
    // the rest: lost when short, a surplus when over (broken-posts-as-written-the-rest-nets)
    const lost = book[i]! - broken - c.n;
    await call(t, "inventory.v1.OpnameService/OpnameRowMarkCounted", {
      teamId: warehouse,
      rowId: rows[i],
      brokenCount: broken,
      ...(broken > 0 ? { brokenNote: "sobek di jahitan, dibuang" } : {}),
      ...(lost > 0 ? { lostNote: "tidak ketemu, sudah dicek di bawah rak" } : {}),
      ...(c.n > book[i]! ? { surplusNote: "ketemu di balik kardus" } : {}),
    });
  }

  return { tag, warehouse, user, userId: String(created.user.id), userName, token, racks, product, session, rows, batches, found };
}

// Signed in as the role, in its warehouse: the count's watch page → Finalize → the finalize page. Returns the preview
// the page read (OpnameFinalizePreview).
async function openFinalize(page: Page, b: Ground): Promise<Record<string, any>> {
  await signInAs(page, b.user, PASSWORD, b.warehouse);
  await page.goto(`/inventories/opname/sessions/${b.session}`);
  await expect(page.getByTestId("opname-detail-page")).toBeVisible();
  const finalize = page.getByTestId("opname-detail-finalize");
  await expect(finalize).toBeEnabled();
  const preview = page.waitForResponse((res) => res.url().includes("OpnameService/OpnameFinalizePreview"));
  await finalize.click();
  await expect(page).toHaveURL(new RegExp(`/inventories/opname/sessions/${b.session}/finalize$`));
  const json = (await (await preview).json()) as Record<string, any>;
  await expect(page.getByTestId("opname-finalize-page")).toBeVisible();
  await expect(page.getByTestId("opname-finalize-summary")).toBeVisible();

  return json;
}

// Finalize on the page: the confirm opens, naming what the warehouse owes. Returns the open dialog.
async function askToFinalize(page: Page, b: Ground, owed: string): Promise<Locator> {
  await expect(page.getByTestId("opname-finalize-submit")).toBeEnabled();
  await page.getByTestId("opname-finalize-submit").click();
  const dialog = page.getByRole("alertdialog", { name: `Finalize Count #${b.session}?` });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(`This posts every line above and releases the racks. The warehouse owes ${owed}. It cannot be undone.`);

  return dialog;
}

interface Finalized {
  session?: { status?: string };
  transactions?: { transactionId: string; teamId: string; type: string }[];
}
// WHEN — confirmed: OpnameSessionFinalize; the page lands back on the count. Returns the answer.
async function confirm(page: Page, b: Ground, dialog: Locator): Promise<Finalized> {
  const answer = page.waitForResponse((res) => res.url().includes("OpnameService/OpnameSessionFinalize"));
  await dialog.getByTestId("confirm-action").click();
  const res = await answer;
  const json = (await res.json().catch(() => ({}))) as Finalized;
  expect(res.ok(), JSON.stringify(json)).toBe(true);
  await expect(page).toHaveURL(new RegExp(`/inventories/opname/sessions/${b.session}$`));
  await expect(page.getByTestId("opname-detail-page")).toBeVisible();

  return json;
}

// The preview product's posting lines on the page, each its cells: Posts · Batch · Units · Price · Amount.
async function lineCells(page: Page, b: Ground): Promise<string[][]> {
  const rows = page.getByTestId(`opname-finalize-lines-${b.product.id}`).locator("tbody tr");
  const out: string[][] = [];
  for (let i = 0; i < (await rows.count()); i++) out.push((await rows.nth(i).locator("td").allInnerTexts()).map((s) => s.trim()));

  return out;
}

const RP = (n: number) => new RegExp(`^Rp\\s?${n.toLocaleString("id-ID").replace(/\./g, "\\.")}$`);

// The pair's ledger on the warehouse's liability page with the selling team: the entry naming `cause`.
async function ledgerEntry(page: Page, cause: string): Promise<Locator> {
  await page.goto(`/liability/${ground.seller}`);
  const entry = page.getByTestId("liability-detail-all").locator('[data-testid^="liability-detail-entry-"]').filter({ hasText: cause });
  await expect(entry).toHaveCount(1);

  return entry;
}

// The product page's On hand, as the role sees it.
async function onHandShown(page: Page, b: Ground, n: number) {
  await page.goto(`/inventories/products/${b.product.id}`);
  await expect(page.getByTestId("warehouse-product-onhand")).toContainText(String(n));
}

// The batch page's History rows as text, each keyed by its column header: When · What · Place · Change · Ready after.
async function historyRows(page: Page): Promise<Record<string, string>[]> {
  const table = page.getByTestId("batch-detail-history-table");
  if ((await table.count()) === 0) return [];

  return table.evaluate((t) => {
    const heads = Array.from(t.querySelectorAll("thead th")).map((th) => th.textContent?.trim() ?? "");
    return Array.from(t.querySelectorAll("tbody tr")).map((tr) => {
      const cells = Array.from(tr.querySelectorAll("td")).map((td) => td.textContent?.trim() ?? "");
      return Object.fromEntries(heads.map((h, i) => [h, cells[i] ?? ""]));
    });
  });
}

test.describe.configure({ timeout: 150_000 });

test.beforeAll(async () => {
  test.setTimeout(420_000);
  const team = async (name: string, teamCode: string, type: string) =>
    String((await asRoot("team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);

  ground.seller = await team(`E2E Final Seller ${SUFFIX}`, `QFS${SUFFIX}`, "TEAM_TYPE_SELLING");
  ground.account = String(
    (
      await asRoot("financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId: ground.seller,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name: `E2E final ${SUFFIX}`,
        holderName: "E2E",
        accountNumber: `E2E-QF-${SUFFIX}`,
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
  ground.category = String((await asRoot("category.v1.CategoryService/CategoryCreate", { name: `E2E Final ${SUFFIX}` })).category.id);

  // Given 19's order: the team's shop, and a return warehouse (create-refuses-a-team-with-no-return-warehouse).
  const ret = await team(`E2E Final Retur ${SUFFIX}`, `QFR${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  await asRoot("warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: ret, feePercent: 10, minFee: 0 });
  await asRoot("selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", { teamId: ground.seller, warehouseId: ret });
  ground.shop = String(
    (
      await asRoot("selling.v1.ShopService/ShopCreate", {
        teamId: ground.seller,
        name: `E2E Final Shop ${SUFFIX}`,
        shopCode: `QFP${SUFFIX}`,
        marketplace: "MARKETPLACE_SHOPEE",
      })
    ).shop.id,
  );

  for (const g of GIVENS) {
    ground.g[g] = {} as Record<Key, Ground>;
    for (const r of ROLES) ground.g[g][r.key] = await build(g, r);
  }
});

// ── 19 (every row counted · all match the system) ──────────────────────────────────────────────────────────────────────

test.describe(`${GIVEN} (${CASE[19]})`, () => {
  for (const r of ROLES) {
    test(`${r.given} ${WHEN} (${CASE[19]})`, async ({ page }) => {
      const b = ground.g[19][r.key];

      // GIVEN — while the count holds rack A, X cannot be ordered from here.
      const refused = await orderOne(b, 1);
      expect(refused.status, JSON.stringify(refused.json)).not.toBe(200);
      expect(String(refused.json.message ?? "")).toContain(`held on rack ${b.racks[0]!.code} by count #${b.session}`);
      const pairBefore = await pairOf(b);
      expect(await readyOf(b)).toBe(5);

      const preview = await openFinalize(page, b);
      let done: Finalized = {};

      await test.step("then: says it only releases the racks, no stock or debt changes", async () => {
        expect(preview.products ?? []).toEqual([]);
        expect(num(preview.owedAmount)).toBe(0);
        await expect(page.getByTestId("opname-finalize-nothing")).toHaveText(
          "Every product matches its book — finalizing only releases the racks.",
        );
        await expect(page.getByTestId("opname-finalize-owed")).toContainText("Rp 0");
        await expect(page.getByTestId(`opname-finalize-product-${b.product.id}`)).toHaveCount(0);
        const dialog = await askToFinalize(page, b, "Rp 0");
        done = await confirm(page, b, dialog);

        expect(done.transactions ?? []).toEqual([]);
        expect(await readyOf(b)).toBe(5);
        expect(await onRack(b, b.racks[0]!)).toBe(5);
        expect(await batchIds(b.token, b.warehouse, b.product.id)).toEqual(b.batches);
        const pairAfter = await pairOf(b);
        expect(pairAfter.balance).toBeCloseTo(pairBefore.balance, 3);
        expect(pairAfter.logs.map((l) => l.id)).toEqual(pairBefore.logs.map((l) => l.id));
      });

      await test.step("then: count finalized, status finished", async () => {
        expect(done.session?.status).toBe("OPNAME_SESSION_STATUS_FINISH");
        await expect(page.getByText(`Count #${b.session} finalized`)).toBeVisible();
        await expect(page.getByTestId("opname-session-status-2")).toHaveText("Finished");
        await expect(page.getByTestId("opname-detail-started")).toContainText(`finalized by ${b.userName}`);
        await expect(page.getByTestId("opname-detail-finalize")).toHaveCount(0);
        const s = await sessionOf(b);
        expect(s.status).toBe("OPNAME_SESSION_STATUS_FINISH");
        expect(String(s.finalizedById)).toBe(b.userId);
        await page.goto(`/inventories/opname/sessions/${b.session}/finalize`);
        await expect(page.getByTestId("opname-finalize-finished")).toHaveText(
          "This count is finalized — its problem, found and move transactions are posted.",
        );
        await expect(page.getByTestId("opname-finalize-submit")).toHaveCount(0);
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

// ── 20 (product X 5 in system · counted 3 · 1 broken · 1 lost · reasons written) ───────────────────────────────────────

test.describe(`${GIVEN} (${CASE[20]})`, () => {
  for (const r of ROLES) {
    test(`${r.given} ${WHEN} (${CASE[20]})`, async ({ page }) => {
      const b = ground.g[20][r.key];
      const batch = b.batches[0]!;
      const pairBefore = await pairOf(b);
      expect(await readyOf(b)).toBe(5);

      const preview = await openFinalize(page, b);
      let done: Finalized = {};

      await test.step("then: preview shows what posts and what the warehouse owes, before confirming", async () => {
        expect(num(preview.owedAmount)).toBe(20000);
        const p = (preview.products ?? [])[0] ?? {};
        expect((preview.products ?? []).length).toBe(1);
        expect(
          (p.lines ?? []).map((l: any) => [l.type, String(l.batchId), num(l.stockCount), num(l.priceUnit), num(l.amount)]),
        ).toEqual([
          ["OPNAME_POST_TYPE_BROKEN", batch, 1, 10000, 10000],
          ["OPNAME_POST_TYPE_LOST", batch, 1, 10000, 10000],
        ]);
        await expect(page.getByTestId("opname-finalize-owed")).toContainText("Rp 20.000");
        await expect(page.getByTestId(`opname-finalize-tx-${b.product.id}`)).toHaveText("Problem");
        await expect(page.getByTestId(`opname-finalize-arithmetic-${b.product.id}`)).toContainText("Book 5 · sellable 3 · broken 1 · the rest");
        const cells = await lineCells(page, b);
        expect(cells.map((c) => c[0])).toEqual(["Broken", "Lost"]);
        for (const c of cells) {
          expect(c[1]).toBe(`#${batch}`);
          expect(c[2]).toBe("1");
          expect(c[3]).toMatch(RP(10000));
          expect(c[4]).toMatch(RP(10000));
        }

        const dialog = await askToFinalize(page, b, "Rp 20.000");
        // nothing is posted while the confirm is open
        expect((await sessionOf(b)).status).toBe("OPNAME_SESSION_STATUS_ACTIVE");
        expect(await readyOf(b)).toBe(5);
        expect((await pairOf(b)).logs.length).toBe(pairBefore.logs.length);
        done = await confirm(page, b, dialog);
      });

      const problem = (done.transactions ?? []).find((t) => t.type === "OPNAME_TRANSACTION_TYPE_PROBLEM");

      await test.step("then: ready stock of product X decreases by 2", async () => {
        expect(await readyOf(b)).toBe(3);
        expect(await onRack(b, b.racks[0]!)).toBe(3);
        await onHandShown(page, b, 3);
      });

      await test.step("then: broken 1 and lost 1 recorded at their batch price", async () => {
        // ⚠ The batch's Broken / Lost cards count only what the DOOR found wrong (restock_problem_items); a count's
        // broken and lost are written on the batch's own history, and priced on the pair's ledger at the batch's price.
        const d = await batchOf(b, batch);
        expect([num(d.ready), num(d.unitCost)]).toEqual([3, 10000]);
        await page.goto(`/inventories/batches/${batch}`);
        await expect(page.getByTestId("batch-detail-ready")).toHaveText("3");
        await expect(page.getByTestId("batch-detail-unit-cost")).toContainText("Rp 10.000");
        // the batch's history: the broken 1, then the lost 1 — one unit each off this batch, 4 then 3 left
        await expect
          .poll(async () => (await historyRows(page)).filter((x) => x["Change"] === "-1").map((x) => x["Ready after"]).sort())
          .toEqual(["3", "4"]);
        // each valued at the batch's price: 1 × Rp 10.000 on the pair's ledger
        const added = (await pairOf(b)).logs.filter((l) => !pairBefore.logs.some((x) => x.id === l.id));
        expect(added.map((l) => Math.abs(num(l.amount)))).toEqual([num(d.unitCost), num(d.unitCost)]);
      });

      await test.step("then: the warehouse owes the selling team for broken and lost", async () => {
        expect(problem, JSON.stringify(done)).toBeTruthy();
        expect(String(problem!.teamId)).toBe(ground.seller);
        const after = await pairOf(b);
        const added = after.logs.filter((l) => !pairBefore.logs.some((x) => x.id === l.id));
        expect(
          added.map((l) => [l.sourceType, String(l.sourceId), num(l.amount), l.reversal ?? false]).sort(),
        ).toEqual(
          [
            ["LIABILITY_SOURCE_TYPE_BROKEN_GOOD", problem!.transactionId, -10000, false],
            ["LIABILITY_SOURCE_TYPE_LOST_GOOD", problem!.transactionId, -10000, false],
          ].sort(),
        );
        expect(after.balance - pairBefore.balance).toBeCloseTo(-20000, 3);
        for (const cause of [`Goods broken · movement #${problem!.transactionId}`, `Goods lost · movement #${problem!.transactionId}`]) {
          const entry = await ledgerEntry(page, cause);
          await expect(entry).toContainText(/−\s?Rp\s?10\.000/);
        }
      });

      await test.step("then: stock loss on the warehouse's daily statement", async () => {
        await expect(async () => {
          await page.goto("/statement");
          const row = page.getByTestId(`statement-row-${today()}`);
          await expect(row.locator("td").nth(3)).toHaveText(RP(20000), { timeout: 5_000 });
          await expect(page.getByTestId("statement-total-stock-loss")).toHaveText(/^of which Rp\s?20\.000 stock written off$/, {
            timeout: 2_000,
          });
        }).toPass({ timeout: 45_000 });
      });

      await test.step("then: recorded in lost stock analytic metric", async () => {
        await expect(async () => {
          await page.goto(`/analytic?g=product&m=metrics/inventory/lost&r=7d&product=${b.product.id}`);
          await expect(page.getByTestId(`analytic-cell-${b.product.id}-lost_count`)).toHaveText("1", { timeout: 5_000 });
          await expect(page.getByTestId(`analytic-cell-${b.product.id}-lost_amount`)).toHaveText(RP(10000), { timeout: 2_000 });
        }).toPass({ timeout: 45_000 });
      });
    });
  }
});

// ── 21 (product X · rack A 1 under · rack B 1 over) ────────────────────────────────────────────────────────────────────

test.describe(`${GIVEN} (${CASE[21]})`, () => {
  for (const r of ROLES) {
    test(`${r.given} ${WHEN} (${CASE[21]})`, async ({ page }) => {
      const b = ground.g[21][r.key];
      const [a, rb] = [b.racks[0]!, b.racks[1]!];
      const pairBefore = await pairOf(b);
      expect([await readyOf(b), await onRack(b, a), await onRack(b, rb)]).toEqual([5, 3, 2]);

      const preview = await openFinalize(page, b);
      let done: Finalized = {};

      await test.step("then: recorded as a move between racks, no debt changes", async () => {
        const p = (preview.products ?? [])[0] ?? {};
        expect([num(p.restCount), num(p.movedCount), num(p.rackChangeCount), (p.lines ?? []).length]).toEqual([0, 1, 2, 0]);
        expect(num(preview.owedAmount)).toBe(0);
        await expect(page.getByTestId("opname-finalize-moved")).toContainText("1 unit");
        await expect(page.getByTestId("opname-finalize-owed")).toContainText("Rp 0");
        await expect(page.getByTestId(`opname-finalize-tx-${b.product.id}`)).toHaveText("Move");
        await expect(page.getByTestId(`opname-finalize-move-${b.product.id}`)).toHaveText("Move: 1 unit between racks, no money");
        await expect(page.getByTestId(`opname-finalize-arithmetic-${b.product.id}`)).toContainText("2 racks corrected");
        await expect(page.getByTestId(`opname-finalize-lines-${b.product.id}`)).toHaveCount(0);

        done = await confirm(page, b, await askToFinalize(page, b, "Rp 0"));
        expect((done.transactions ?? []).map((t) => t.type)).toEqual(["OPNAME_TRANSACTION_TYPE_MOVE"]);
        const after = await pairOf(b);
        expect(after.balance).toBeCloseTo(pairBefore.balance, 3);
        expect(after.logs.map((l) => l.id)).toEqual(pairBefore.logs.map((l) => l.id));
      });

      await test.step("then: ready stock of product X unchanged", async () => {
        expect(await readyOf(b)).toBe(5);
        await onHandShown(page, b, 5);
      });

      await test.step("then: rack A and rack B corrected", async () => {
        expect([await onRack(b, a), await onRack(b, rb)]).toEqual([2, 3]);
        await page.goto(`/inventories/products/${b.product.id}`);
        await page.getByTestId("wp-tab-placement").click();
        const table = page.getByTestId("wp-placement-table");
        await expect(table.locator("tbody tr").filter({ hasText: a.code }).locator("td").nth(1)).toHaveText("2");
        await expect(table.locator("tbody tr").filter({ hasText: rb.code }).locator("td").nth(1)).toHaveText("3");
      });
    });
  }
});

// ── 22 (product X 1 over · an old lost of product X not found yet · the warehouse owes the selling team) ──────────────

test.describe(`${GIVEN} (${CASE[22]})`, () => {
  for (const r of ROLES) {
    test(`${r.given} ${WHEN} (${CASE[22]})`, async ({ page }) => {
      const b = ground.g[22][r.key];
      const batch = b.batches[0]!;
      // GIVEN — the old lost: one unit of the batch adjusted lost (4 left), the warehouse owes Rp 10.000 for it
      const before = await batchOf(b, batch);
      expect(num(before.ready)).toBe(4);
      const pairBefore = await pairOf(b);
      expect(pairBefore.balance).toBeCloseTo(-10000, 3);
      expect(pairBefore.logs.filter((l) => l.sourceType === "LIABILITY_SOURCE_TYPE_LOST_GOOD").map((l) => num(l.amount))).toEqual([-10000]);

      const preview = await openFinalize(page, b);
      let done: Finalized = {};

      await test.step("then: the surplus claims the old loss, back into its batch at its price", async () => {
        const lines = ((preview.products ?? [])[0]?.lines ?? []) as any[];
        expect(lines.map((l) => [l.type, String(l.batchId), num(l.stockCount), num(l.priceUnit), num(l.amount)])).toEqual([
          ["OPNAME_POST_TYPE_CLAIM", batch, 1, 10000, 10000],
        ]);
        const problemId = String(lines[0]?.problemId ?? "");
        expect(problemId).not.toBe("");
        expect(num(preview.claimedAmount)).toBe(10000);
        await expect(page.getByTestId("opname-finalize-claimed")).toContainText("Rp 10.000");
        await expect(page.getByTestId(`opname-finalize-tx-${b.product.id}`)).toHaveText("Found");
        const cells = await lineCells(page, b);
        expect(cells).toHaveLength(1);
        expect(cells[0]![0]).toBe("Claimed back");
        expect(cells[0]![1]).toBe(`#${batch} · claims loss #${problemId}`);
        expect(cells[0]![2]).toBe("1");
        expect(cells[0]![3]).toMatch(RP(10000));

        done = await confirm(page, b, await askToFinalize(page, b, "Rp 0"));
        const after = await batchOf(b, batch);
        expect([num(after.ready), num(after.unitCost)]).toEqual([5, 10000]);
        expect(await batchIds(b.token, b.warehouse, b.product.id)).toEqual([batch]);
        expect(await readyOf(b)).toBe(5);
        await page.goto(`/inventories/batches/${batch}`);
        await expect(page.getByTestId("batch-detail-ready")).toHaveText("5");
        // back into ITS batch: the claim's +1 on this batch's own history, 5 after
        await expect
          .poll(async () => (await historyRows(page)).some((x) => x["Change"] === "+1" && x["Ready after"] === "5"))
          .toBe(true);
      });

      await test.step("then: the warehouse's debt to the selling team decreases", async () => {
        const foundTx = (done.transactions ?? []).find((t) => t.type === "OPNAME_TRANSACTION_TYPE_FOUND");
        expect(foundTx, JSON.stringify(done)).toBeTruthy();
        const after = await pairOf(b);
        expect(after.balance - pairBefore.balance).toBeCloseTo(10000, 3);
        expect(after.balance).toBeCloseTo(0, 3);
        const added = after.logs.filter((l) => !pairBefore.logs.some((x) => x.id === l.id));
        expect(added.map((l) => [l.sourceType, String(l.sourceId), num(l.amount), l.reversal ?? false])).toEqual([
          ["LIABILITY_SOURCE_TYPE_FOUND", foundTx!.transactionId, 10000, true],
        ]);
        const entry = await ledgerEntry(page, `Goods found again · movement #${foundTx!.transactionId}`);
        await expect(entry).toContainText(/\+\s?Rp\s?10\.000/);
        await expect(entry.locator('[data-testid^="liability-detail-reversal-"]')).toHaveCount(1);
      });
    });
  }
});

// ── 23 (product X 1 over · no old loss · product X's newest batch here at Rp 10.000) ───────────────────────────────────

test.describe(`${GIVEN} (${CASE[23]})`, () => {
  for (const r of ROLES) {
    test(`${r.given} ${WHEN} (${CASE[23]})`, async ({ page }) => {
      const b = ground.g[23][r.key];
      // GIVEN — two batches here: the older at Rp 8.000, the newest at Rp 10.000
      expect((await Promise.all(b.batches.map((id) => batchOf(b, id)))).map((x) => num(x.unitCost))).toEqual([8000, 10000]);
      const pairBefore = await pairOf(b);
      expect(await readyOf(b)).toBe(5);

      const preview = await openFinalize(page, b);
      let done: Finalized = {};

      await test.step("then: a new batch at Rp 10.000", async () => {
        const lines = ((preview.products ?? [])[0]?.lines ?? []) as any[];
        expect(lines.map((l) => [l.type, num(l.stockCount), num(l.priceUnit), num(l.amount)])).toEqual([
          ["OPNAME_POST_TYPE_MINT", 1, 10000, 10000],
        ]);
        expect(num(preview.mintedAmount)).toBe(10000);
        await expect(page.getByTestId("opname-finalize-minted")).toContainText("Rp 10.000");
        await expect(page.getByTestId(`opname-finalize-tx-${b.product.id}`)).toHaveText("Found");
        const cells = await lineCells(page, b);
        expect(cells).toHaveLength(1);
        expect(cells[0]!.slice(0, 3)).toEqual(["New batch", "New batch", "1"]);
        expect(cells[0]![3]).toMatch(RP(10000));

        done = await confirm(page, b, await askToFinalize(page, b, "Rp 0"));
        const ids = await batchIds(b.token, b.warehouse, b.product.id);
        const minted = ids.filter((id) => !b.batches.includes(id));
        expect(minted).toHaveLength(1);
        const m = await batchOf(b, minted[0]!);
        expect([num(m.arrived), num(m.ready), num(m.unitCost)]).toEqual([1, 1, 10000]);
        await page.goto(`/inventories/batches/${minted[0]}`);
        await expect(page.getByTestId("batch-detail-unit-cost")).toContainText("Rp 10.000");
        await expect(page.getByTestId("batch-detail-arrived")).toHaveText("1");
      });

      await test.step("then: ready stock of product X increases by 1", async () => {
        expect(await readyOf(b)).toBe(6);
        await onHandShown(page, b, 6);
      });

      await test.step("then: no debt between the warehouse and the selling team changes", async () => {
        expect((done.transactions ?? []).map((t) => t.type)).toEqual(["OPNAME_TRANSACTION_TYPE_FOUND"]);
        const after = await pairOf(b);
        expect(after.balance).toBeCloseTo(pairBefore.balance, 3);
        expect(after.logs.map((l) => l.id)).toEqual(pairBefore.logs.map((l) => l.id));
      });
    });
  }
});

// ── 24 (a row not counted yet) ─────────────────────────────────────────────────────────────────────────────────────────

test.describe(`${GIVEN} (${CASE[24]})`, () => {
  for (const r of ROLES) {
    test(`${r.given} ${WHEN} (${CASE[24]})`, async ({ page }) => {
      const b = ground.g[24][r.key];

      await test.step("then: finalize not offered, says how many rows are left", async () => {
        await signInAs(page, b.user, PASSWORD, b.warehouse);
        await page.goto(`/inventories/opname/sessions/${b.session}`);
        await expect(page.getByTestId("opname-detail-page")).toBeVisible();
        await expect(page.getByTestId("opname-summary-counted")).toContainText("1 / 2");
        await expect(page.getByTestId("opname-detail-finalize")).toBeDisabled();
        await expect(page.getByTestId("opname-detail-finalize-wait")).toHaveText("Finalize opens once every row is counted — 1 to go.");

        // the finalize page by its address
        const preview = page.waitForResponse((res) => res.url().includes("OpnameService/OpnameFinalizePreview"));
        await page.goto(`/inventories/opname/sessions/${b.session}/finalize`);
        expect(((await (await preview).json()) as Record<string, any>).block).toBe("OPNAME_FINALIZE_BLOCK_ROWS_NOT_COUNTED");
        await expect(page.getByTestId("opname-finalize-block-2")).toHaveText("1 rows are not counted yet.");
        await expect(page.getByTestId("opname-finalize-submit")).toBeDisabled();

        const res = await send(b.token, "inventory.v1.OpnameService/OpnameSessionFinalize", { teamId: b.warehouse, sessionId: b.session });
        expect(res.status, JSON.stringify(res.json)).not.toBe(200);
        expect((await sessionOf(b)).status).toBe("OPNAME_SESSION_STATUS_ACTIVE");
      });
    });
  }
});

// ── 25 (this owner or admin counted a row in this count) ───────────────────────────────────────────────────────────────

test.describe(`${GIVEN} (${CASE[25]})`, () => {
  for (const r of ROLES) {
    test(`${r.given} ${WHEN} (${CASE[25]})`, async ({ page }) => {
      const b = ground.g[25][r.key];

      await test.step("then: cannot finalize, says another owner or admin finalizes", async () => {
        // every row is counted, so the watch page opens the finalize page — which refuses this person
        const preview = await openFinalize(page, b);
        expect(preview.block).toBe("OPNAME_FINALIZE_BLOCK_OWN_COUNT");
        await expect(page.getByTestId("opname-finalize-block-3")).toHaveText(
          "You counted rows in this count — another Owner or Admin finalizes it.",
        );
        await expect(page.getByTestId("opname-finalize-submit")).toBeDisabled();

        const res = await send(b.token, "inventory.v1.OpnameService/OpnameSessionFinalize", { teamId: b.warehouse, sessionId: b.session });
        expect(res.status, JSON.stringify(res.json)).not.toBe(200);
        expect((await sessionOf(b)).status).toBe("OPNAME_SESSION_STATUS_ACTIVE");
        expect(await readyOf(b)).toBe(5);
      });
    });
  }
});

// ── 35 (found report of 2 product X on rack A waiting · the count found product X on rack A 2 over) ───────────────────

test.describe(`${GIVEN} (${CASE[35]})`, () => {
  for (const r of ROLES) {
    test(`${r.given} ${WHEN} (${CASE[35]})`, async ({ page }) => {
      const b = ground.g[35][r.key];
      // GIVEN — the report waits, 2 units, nothing posted
      const waiting = await foundOf(b);
      expect([waiting.status, num(waiting.stockCount)]).toEqual(["FOUND_REQUEST_STATUS_WAITING", 2]);
      expect(await readyOf(b)).toBe(5);

      const preview = await openFinalize(page, b);
      const lines = ((preview.products ?? [])[0]?.lines ?? []) as any[];
      expect(lines.map((l) => [l.type, num(l.stockCount), num(l.priceUnit)])).toEqual([["OPNAME_POST_TYPE_MINT", 2, 10000]]);
      await confirm(page, b, await askToFinalize(page, b, "Rp 0"));

      await test.step("then: found report closed, settled by the count", async () => {
        const settled = await foundOf(b);
        expect([settled.status, String(settled.settledByCountingSessionId), String(settled.decidedById)]).toEqual([
          "FOUND_REQUEST_STATUS_SETTLED_BY_COUNT",
          b.session,
          b.userId,
        ]);
        await page.goto("/inventories/found-stock?status=all");
        const row = page.getByTestId(`found-request-${b.found}`);
        await expect(row.getByTestId("found-request-status-4")).toHaveText("Settled by count");
        await expect(page.getByTestId(`found-request-settled-link-${b.found}`)).toHaveText(`Settled by count #${b.session}`);
        const listed = page.waitForResponse((res) => res.url().includes("FoundRequestService/FoundRequestList"));
        await page.goto("/inventories/found-stock");
        await listed;
        await expect(page.getByTestId("found-requests-page")).toBeVisible();
        await expect(page.getByTestId(`found-request-${b.found}`)).toHaveCount(0);
      });

      await test.step("then: ready stock of product X rises by 2 once, through the count, not again through the report", async () => {
        expect(await readyOf(b)).toBe(7);
        const ids = await batchIds(b.token, b.warehouse, b.product.id);
        const minted = ids.filter((id) => !b.batches.includes(id));
        expect(minted).toHaveLength(1);
        expect(num((await batchOf(b, minted[0]!)).arrived)).toBe(2);
        // the report cannot post them again
        const again = await send(b.token, "inventory.v1.FoundRequestService/FoundRequestApprove", { teamId: b.warehouse, foundRequestId: b.found });
        expect(again.status, JSON.stringify(again.json)).not.toBe(200);
        expect(await readyOf(b)).toBe(7);
        expect(await batchIds(b.token, b.warehouse, b.product.id)).toHaveLength(2);
        await onHandShown(page, b, 7);
      });
    });
  }
});
