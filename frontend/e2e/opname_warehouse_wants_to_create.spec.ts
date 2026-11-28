import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { API_URL } from "./env";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { pickTeam } from "./pickers";
import { signIn } from "./session";

// warehouse owner · admin wants to check the shelves against the system — the checks behind
// docs/acceptances/inventory/opname.md, section *create*, givens 1–6 (when *create opname*). One test per role of each
// given — warehouse:owner, warehouse:admin — each signed in as a person of that role in a WAREHOUSE OF ITS OWN: one count
// runs per warehouse (one-active-count-per-warehouse), so no test's count can meet another's. Every count is planned
// through the Stock Opname page's own New Count dialog (opname-new-session → opname-new-session-dialog), as the person
// does; the plan's target is only a filter on the shelf book (the-plan-target-is-only-a-filter).
//
//   1 (plan: all racks · 3 racks, 1 of them empty · 1 product at 0 in system on its rack) — racks A, B, C: Kaos on A (5,
//     one already taken by a pending order → 4), Gelas received onto A and all 3 moved to B (A at 0, B 3), C never
//     stocked. Plan All.
//     then: count started, status active — the dialog lands on the count's page, *Active*, and the server says so;
//     then: every rack listed, the empty one too — the count page's rack tiles A, B and C, C *Empty · Nothing expected*
//           (an-all-count-visits-every-rack);
//     then: a row per product on each rack, those at 0 in system included — Kaos@A, Gelas@A (book 0), Gelas@B, and
//           nothing else (a-snapshot-includes-rows-at-zero);
//     then: staff see its racks to count — a warehouse STAFF of the same warehouse opens the active count from the
//           Stock Opname page and reads the same three tiles;
//     then: a product on a counted rack cannot be ordered, the refusal names the count — the selling team's order for
//           Kaos (only rack A holds it) is refused: *… being counted — count #N, started by <name> at … WIB*
//           (a-lock-stops-sales-and-cancels-too, an-abandoned-count-waits-for-the-admin);
//     then: nothing else can be done to it there — a transfer (the seller's), a move, a sample, an adjustment, a
//           put-away (a second restock's accept onto A), a found report (the role's) and the cancel of the order taken
//           before the count (the seller's): each refused naming the count, and rack A still holds 4.
//   2 (plan: one team · selling team Melati · another team's product on the same rack) — Melati's two products on A and B,
//     another selling team's product on A. Plan One Team → Melati.
//     then: only team Melati's products in the rows — two rows, both Melati's;
//     then: the other team's product not locked — the role moves it off rack A (it goes through), while Melati's
//           product on the same rack is refused (the control).
//   3 (plan: one product · on 2 racks) — Sepatu on A (2) and B (3), Tas on A. Plan One Product → Sepatu.
//     then: both racks listed with the product — two rows, Sepatu@A and Sepatu@B, and the count page's tiles A and B.
//   4 (plan: one rack · rack A holds product X · product X also on rack B) — X on A (2) and B (3), Y on A, Z only on B.
//     Plan One Rack → A.
//     then: product X counted on rack B too — rows X@A, Y@A and X@B, never Z (a-rack-plan-counts-its-products-everywhere);
//           rack B's count lists X.
//   5 (plan: one rack · the rack is empty) — rack E never stocked, rack F holds a product. Plan One Rack → E.
//     then: cannot start, nothing to count — the dialog stays open with *… nothing to count*, and no count is active.
//   6 (an earlier count in this warehouse not yet finalized or cancelled) — root started a count of every rack.
//     then: cannot start, names the earlier count — New Count is disabled and the page names *Count #N is active*; the
//           same create sent with the role's token is refused naming count #N, who started it and when.
//
// The ground (root, once): selling team Melati (with a shop and its return warehouse) and another selling team, both
// with an operational account to pay their restocks, and a warehouse a transfer would go to. Per (given, role) a
// warehouse with its fee, its racks, its products restocked onto them and a person of that role (given 1 also a staff).

const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-opname-create-1";
const ROLES = [
  { given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", key: "o" },
  { given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", key: "a" },
] as const;
type Key = (typeof ROLES)[number]["key"];

// Each given's case text, verbatim from opname.md — the marking script finds the tests by it.
const GIVEN = "warehouse owner · admin wants to check the shelves against the system";
const WHEN = "create opname";
const C1 = "plan: all racks · 3 racks, 1 of them empty · 1 product at 0 in system on its rack";
const C2 = "plan: one team · selling team Melati · another team's product on the same rack";
const C3 = "plan: one product · on 2 racks";
const C4 = "plan: one rack · rack A holds product X · product X also on rack B";
const C5 = "plan: one rack · the rack is empty";
const C6 = "an earlier count in this warehouse not yet finalized or cancelled";

type Given = 1 | 2 | 3 | 4 | 5 | 6;

interface Product {
  id: string;
  code: string;
  name: string;
}

interface Ground {
  warehouse: string;
  user: string;
  staff: string;
  racks: Record<string, { id: string; code: string }>;
  products: Record<string, Product>;
  // given 1: the order taken off rack A before the count, and a second restock waiting to be put away on A
  order: string;
  putAway: { request: string; item: string };
  // given 6: the count already running
  earlier: string;
}

const ground = {
  melati: "",
  melatiCode: `QKM${SUFFIX}`,
  melatiName: `Melati ${SUFFIX}`,
  other: "",
  dest: "",
  shop: "",
  melatiAccount: "",
  otherAccount: "",
  category: "",
  g: {} as Record<Given, Record<Key, Ground>>,
};

// Root's page, signed in once: the seeds, and the selling team's own calls (an order, a transfer, a cancel) — root owns
// both selling teams.
let rootPage: Page;

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

async function api(page: Page, method: string, body: unknown): Promise<Record<string, any>> {
  const res = await send(page, method, body);
  if (res.status !== 200) throw new Error(`${method}: ${res.status} ${JSON.stringify(res.json)}`);

  return res.json;
}

// Work in the given team: the active team is per tab, in sessionStorage (TeamContext).
async function useTeam(page: Page, teamId: string) {
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

async function asRole(page: Page, b: Ground, username = b.user) {
  await signIn(page, username, PASSWORD);
  await useTeam(page, b.warehouse);
}

// The count's rows as the role's own OpnameRowList answers: "<product>:<rack>" → the row.
async function rowsOf(page: Page, warehouse: string, session: string) {
  const res = await api(page, "inventory.v1.OpnameService/OpnameRowList", {
    teamId: warehouse,
    filter: { sessionId: session },
    page: { page: 1, limit: 50 },
  });
  const out = new Map<string, { id: string; teamId: string; book: string }>();
  for (const item of (res.items ?? []) as { row?: { mapData: Record<string, Record<string, unknown>> } }[]) {
    for (const r of Object.values(item.row?.mapData ?? {})) {
      out.set(`${r.productId}:${r.placementId}`, {
        id: String(r.id),
        teamId: String(r.teamId ?? ""),
        // proto3 JSON drops a zero
        book: String(r.systemStockCount ?? "0"),
      });
    }
  }

  return out;
}

const key = (p: Product, rack: { id: string }) => `${p.id}:${rack.id}`;

// A product's units on a rack as the role reads it, 0 when the rack no longer lists it.
async function onHand(page: Page, warehouse: string, rackId: string, productId: string) {
  const res = await api(page, "inventory.v1.RackService/RackStock", {
    teamId: warehouse,
    filter: { rackId },
    page: { page: 1, limit: 50 },
  });
  for (const item of (res.items ?? []) as { rackStock?: { mapData: Record<string, { productId: string; onHand?: string }> } }[]) {
    for (const l of Object.values(item.rackStock?.mapData ?? {})) if (l.productId === productId) return Number(l.onHand ?? 0);
  }

  return 0;
}

// The Stock Opname page's New Count dialog, open — `choose` picks the plan and its target.
async function openNewCount(page: Page, choose: (dialog: Locator) => Promise<void>) {
  await page.goto("/inventories/opname/sessions");
  await expect(page.getByTestId("opname-sessions-page")).toBeVisible();
  await expect(page.getByTestId("opname-new-session")).toBeEnabled();
  await page.getByTestId("opname-new-session").click();
  const dialog = page.getByTestId("opname-new-session-dialog");
  await expect(dialog).toBeVisible();
  await choose(dialog);

  return dialog;
}

// Start Count, and the OpnameSessionCreate answer it got.
async function submitCount(page: Page, dialog: Locator) {
  const answer = page.waitForResponse((r) => r.url().includes("OpnameService/OpnameSessionCreate"));
  await expect(dialog.getByTestId("opname-new-session-submit")).toBeEnabled();
  await dialog.getByTestId("opname-new-session-submit").click();
  const res = await answer;

  return { ok: res.ok(), json: (await res.json().catch(() => ({}))) as Record<string, any> };
}

// Plan a count through the dialog; it must start. Returns the count's id.
async function planCount(page: Page, choose: (dialog: Locator) => Promise<void>) {
  const dialog = await openNewCount(page, choose);
  const res = await submitCount(page, dialog);
  expect(res.ok, JSON.stringify(res.json)).toBe(true);

  return String(res.json.session.id);
}

async function pickRack(dialog: Locator, rackId: string) {
  await dialog.getByTestId("opname-plan-placement").click();
  await dialog.getByTestId("opname-plan-rack").click();
  const option = dialog.getByTestId(`rack-select-option-${rackId}`);
  await expect(option).toBeVisible();
  await option.click();
}

// The count's watch page, its rows drawn; checks every row the server listed is on the screen with its rack and book.
async function rowsOnScreen(page: Page, session: string, rows: Map<string, { id: string; book: string }>, label: Map<string, string>) {
  await page.goto(`/inventories/opname/sessions/${session}`);
  const table = page.getByTestId("opname-detail-table");
  await expect(table).toBeVisible();
  await expect(table.locator('tbody tr[data-testid^="opname-row-"]')).toHaveCount(rows.size);
  for (const [k, r] of rows) {
    const row = page.getByTestId(`opname-row-${r.id}`);
    await expect(row).toBeVisible();
    await expect(row.getByRole("cell").first()).toHaveText(label.get(k)!);
    await expect(page.getByTestId(`opname-row-book-${r.id}`)).toHaveText(r.book);
  }
}

// The rack tiles the count page draws (`opname-count-rack-<id>`, never its -state- / -progress- parts).
async function tiles(page: Page) {
  return page
    .getByTestId("opname-count-racks")
    .evaluate((el) =>
      Array.from(el.querySelectorAll("[data-testid]"))
        .map((e) => e.getAttribute("data-testid")!)
        .filter((id) => /^opname-count-rack-\d+$/.test(id))
        .map((id) => id.replace("opname-count-rack-", ""))
        .sort(),
    );
}

// A write refused because the count holds the product on the rack — named by the count, who started it and when. A
// move, sample, adjustment, put-away, found report or cancel reads *… is being counted — count #N, started by …*; a
// TAKE (an order's, a transfer's out-leg) reads *… held on rack <code> by count #N, started by …*.
function expectCounted(
  res: { status: number; json: Record<string, any> },
  session: string,
  what: string,
  words = "being counted",
) {
  expect(res.status, `${what}: ${JSON.stringify(res.json)}`).not.toBe(200);
  const message = String(res.json.message ?? "");
  expect(message, what).toContain(words);
  expect(message, what).toContain(`count #${session}`);
  expect(message, what).toMatch(/started by .+ at \d{4}-\d{2}-\d{2} \d{2}:\d{2} WIB/);
}

test.describe.configure({ timeout: 150_000 });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  const page = await browser.newPage();
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);
  rootPage = page;

  const team = async (name: string, teamCode: string, type: string) =>
    String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);

  ground.melati = await team(ground.melatiName, ground.melatiCode, "TEAM_TYPE_SELLING");
  ground.other = await team(`E2E Opname Lain ${SUFFIX}`, `QKL${SUFFIX}`, "TEAM_TYPE_SELLING");
  ground.dest = await team(`E2E Opname Tujuan ${SUFFIX}`, `QKT${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  await api(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: ground.dest, feePercent: 10, minFee: 0 });
  // Order create refuses a team with no return warehouse (create-refuses-a-team-with-no-return-warehouse).
  await api(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", {
    teamId: ground.melati,
    warehouseId: ground.dest,
  });
  ground.shop = String(
    (
      await api(page, "selling.v1.ShopService/ShopCreate", {
        teamId: ground.melati,
        name: `E2E Opname Shop ${SUFFIX}`,
        shopCode: `QKS${SUFFIX}`,
        marketplace: "MARKETPLACE_SHOPEE",
      })
    ).shop.id,
  );

  const account = async (teamId: string, tag: string) => {
    const id = String(
      (
        await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
          teamId,
          type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
          provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
          name: `E2E opname ${tag} ${SUFFIX}`,
          holderName: "E2E",
          accountNumber: `E2E-QK${tag}-${SUFFIX}`,
          openingBalance: 0,
          openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
        })
      ).account.id,
    );
    // A restock is paid from an OPERATIONAL account (a-restock-names-its-paying-account).
    await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
      teamId,
      accountId: id,
      operational: true,
    });
    return id;
  };
  ground.melatiAccount = await account(ground.melati, "M");
  ground.otherAccount = await account(ground.other, "L");

  ground.category = String(
    (await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Opname ${SUFFIX}` })).category.id,
  );

  const product = async (teamId: string, part: string, name: string): Promise<Product> => {
    const created = await api(page, "product.v1.ProductService/ProductCreate", {
      teamId,
      productCodePart: part,
      name,
      categoryId: ground.category,
    });
    return { id: String(created.product.id), code: String(created.product.productCode), name };
  };

  // A restock of `teamId`'s products into the warehouse — accepted onto the racks unless `accept` is false.
  const restock = async (
    teamId: string,
    accountId: string,
    warehouse: string,
    lines: { p: Product; count: number; total: number; on: [string, number][] }[],
    accept = true,
  ) => {
    const created = await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
      teamId,
      warehouseId: warehouse,
      financeAccountId: accountId,
      items: lines.map((l) => ({ productId: l.p.id, productCode: l.p.code, name: l.p.name, count: l.count, total: l.total })),
    });
    const items = created.request.items as { id: string; productId: string }[];
    if (accept) {
      await api(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
        teamId: warehouse,
        requestId: created.request.id,
        lines: items.map((item) => {
          const line = lines.find((l) => l.p.id === String(item.productId))!;
          return {
            itemId: item.id,
            receivedCount: line.count,
            placements: line.on.map(([placementId, quantity]) => ({ placementId, quantity })),
          };
        }),
      });
    }
    return { request: String(created.request.id), items };
  };

  const warehouseOf = async (g: Given, r: (typeof ROLES)[number], rackLetters: string[]): Promise<Ground> => {
    const warehouse = await team(`E2E Opname ${g}${r.key} ${SUFFIX}`, `QK${g}${r.key.toUpperCase()}${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
    // The warehouse takes orders only with a rate (a-warehouse-with-no-rate-takes-no-orders).
    await api(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: warehouse, feePercent: 10, minFee: 0 });
    const user = `e2eqk${g}${r.key}${SUFFIX}`;
    await api(page, "user.v1.UserService/CreateUser", {
      teamId: warehouse,
      username: user,
      password: PASSWORD,
      name: `Opname ${r.given} ${g} ${SUFFIX}`,
      role: r.role,
    });
    const racks: Ground["racks"] = {};
    for (const letter of rackLetters) {
      const code = `qk${g}${r.key}-${letter}-${SUFFIX}`;
      racks[letter] = {
        id: String((await api(page, "inventory.v1.RackService/RackCreate", { teamId: warehouse, code })).rack.id),
        code,
      };
    }
    return { warehouse, user, staff: "", racks, products: {}, order: "", putAway: { request: "", item: "" }, earlier: "" };
  };

  const part = (g: Given, r: (typeof ROLES)[number], letter: string) => `QK${g}${r.key.toUpperCase()}${letter}${SUFFIX}`;
  const named = (name: string, g: Given, r: (typeof ROLES)[number]) => `${name} ${g}${r.key} ${SUFFIX}`;

  for (const g of [1, 2, 3, 4, 5, 6] as Given[]) ground.g[g] = {} as Record<Key, Ground>;

  for (const r of ROLES) {
    // GIVEN 1 — Kaos 5 on A; Gelas 3 onto A, all moved to B (A at 0); C never stocked. One Kaos taken by an order.
    const g1 = await warehouseOf(1, r, ["a", "b", "c"]);
    g1.staff = `e2eqks${r.key}${SUFFIX}`;
    await api(page, "user.v1.UserService/CreateUser", {
      teamId: g1.warehouse,
      username: g1.staff,
      password: PASSWORD,
      name: `Opname staff ${r.key} ${SUFFIX}`,
      role: "ROLE_WAREHOUSE_STAFF",
    });
    g1.products.kaos = await product(ground.melati, part(1, r, "K"), named("Kaos Hitam", 1, r));
    g1.products.gelas = await product(ground.melati, part(1, r, "G"), named("Gelas Kaca", 1, r));
    await restock(ground.melati, ground.melatiAccount, g1.warehouse, [
      { p: g1.products.kaos, count: 5, total: 50_000, on: [[g1.racks.a.id, 5]] },
      { p: g1.products.gelas, count: 3, total: 30_000, on: [[g1.racks.a.id, 3]] },
    ]);
    await api(page, "inventory.v1.RackService/RackMove", {
      teamId: g1.warehouse,
      fromRackId: g1.racks.a.id,
      lines: [{ productId: g1.products.gelas.id, quantity: 3, toRackId: g1.racks.b.id }],
    });
    const waiting = await restock(
      ground.melati,
      ground.melatiAccount,
      g1.warehouse,
      [{ p: g1.products.kaos, count: 1, total: 10_000, on: [] }],
      false,
    );
    g1.putAway = { request: waiting.request, item: String(waiting.items[0]!.id) };
    const placed = await api(page, "selling.v1.OrderService/OrderCreate", {
      idempotencyKey: `e2e-qk-order-${r.key}-${SUFFIX}`,
      shipmentChannelId: "1",
      teamId: ground.melati,
      shopId: ground.shop,
      warehouseId: g1.warehouse,
      customerName: "E2E Opname Buyer",
      platformTotal: 15000,
      platformCreatedAtUnix: Math.floor(Date.now() / 1000),
      orderExternalRefId: `QK1${r.key.toUpperCase()}${SUFFIX}`,
      items: [{ productId: g1.products.kaos.id, productCode: g1.products.kaos.code, name: g1.products.kaos.name, quantity: 1 }],
    });
    g1.order = String(placed.order.id);
    ground.g[1][r.key] = g1;

    // GIVEN 2 — Melati's M1 on A, M2 on B; the other team's O1 on A.
    const g2 = await warehouseOf(2, r, ["a", "b"]);
    g2.products.m1 = await product(ground.melati, part(2, r, "M"), named("Kemeja Melati", 2, r));
    g2.products.m2 = await product(ground.melati, part(2, r, "N"), named("Rok Melati", 2, r));
    g2.products.o1 = await product(ground.other, part(2, r, "O"), named("Topi Lain", 2, r));
    await restock(ground.melati, ground.melatiAccount, g2.warehouse, [
      { p: g2.products.m1, count: 3, total: 30_000, on: [[g2.racks.a.id, 3]] },
      { p: g2.products.m2, count: 2, total: 20_000, on: [[g2.racks.b.id, 2]] },
    ]);
    await restock(ground.other, ground.otherAccount, g2.warehouse, [
      { p: g2.products.o1, count: 2, total: 20_000, on: [[g2.racks.a.id, 2]] },
    ]);
    ground.g[2][r.key] = g2;

    // GIVEN 3 — Sepatu on A (2) and B (3), Tas on A.
    const g3 = await warehouseOf(3, r, ["a", "b"]);
    g3.products.p = await product(ground.melati, part(3, r, "P"), named("Sepatu Opname", 3, r));
    g3.products.q = await product(ground.melati, part(3, r, "Q"), named("Tas Opname", 3, r));
    await restock(ground.melati, ground.melatiAccount, g3.warehouse, [
      { p: g3.products.p, count: 5, total: 50_000, on: [[g3.racks.a.id, 2], [g3.racks.b.id, 3]] },
      { p: g3.products.q, count: 1, total: 10_000, on: [[g3.racks.a.id, 1]] },
    ]);
    ground.g[3][r.key] = g3;

    // GIVEN 4 — X on A (2) and B (3), Y on A, Z only on B.
    const g4 = await warehouseOf(4, r, ["a", "b"]);
    g4.products.x = await product(ground.melati, part(4, r, "X"), named("Jaket X", 4, r));
    g4.products.y = await product(ground.melati, part(4, r, "Y"), named("Celana Y", 4, r));
    g4.products.z = await product(ground.melati, part(4, r, "Z"), named("Sabuk Z", 4, r));
    await restock(ground.melati, ground.melatiAccount, g4.warehouse, [
      { p: g4.products.x, count: 5, total: 50_000, on: [[g4.racks.a.id, 2], [g4.racks.b.id, 3]] },
      { p: g4.products.y, count: 1, total: 10_000, on: [[g4.racks.a.id, 1]] },
      { p: g4.products.z, count: 2, total: 20_000, on: [[g4.racks.b.id, 2]] },
    ]);
    ground.g[4][r.key] = g4;

    // GIVEN 5 — rack E never stocked; rack F holds a product.
    const g5 = await warehouseOf(5, r, ["e", "f"]);
    g5.products.f = await product(ground.melati, part(5, r, "F"), named("Payung F", 5, r));
    await restock(ground.melati, ground.melatiAccount, g5.warehouse, [
      { p: g5.products.f, count: 2, total: 20_000, on: [[g5.racks.f.id, 2]] },
    ]);
    ground.g[5][r.key] = g5;

    // GIVEN 6 — a product on A, and a count of every rack root started, still active.
    const g6 = await warehouseOf(6, r, ["a"]);
    g6.products.w = await product(ground.melati, part(6, r, "W"), named("Dompet W", 6, r));
    await restock(ground.melati, ground.melatiAccount, g6.warehouse, [
      { p: g6.products.w, count: 2, total: 20_000, on: [[g6.racks.a.id, 2]] },
    ]);
    g6.earlier = String(
      (await api(page, "inventory.v1.OpnameService/OpnameSessionCreate", { teamId: g6.warehouse, plan: "OPNAME_PLAN_ALL" })).session.id,
    );
    ground.g[6][r.key] = g6;
  }
});

test.afterAll(async () => {
  await rootPage?.close();
});

test.describe(`${GIVEN} (${C1})`, () => {
  for (const r of ROLES) {
    test(`${r.given} ${WHEN} (${C1})`, async ({ page, browser }) => {
      const b = ground.g[1][r.key];
      const { kaos, gelas } = b.products;
      const { a, b: rb, c } = b.racks;
      await asRole(page, b);

      // GIVEN — Kaos 4 on A (one taken by the order), Gelas 0 on A and 3 on B, C empty.
      expect(await onHand(page, b.warehouse, a.id, kaos.id)).toBe(4);
      expect(await onHand(page, b.warehouse, rb.id, gelas.id)).toBe(3);

      const session = await planCount(page, async (dialog) => {
        await dialog.getByTestId("opname-plan-all").click();
      });

      await test.step("then: count started, status active", async () => {
        await expect(page).toHaveURL(new RegExp(`/inventories/opname/sessions/${session}$`));
        await expect(page.getByTestId("opname-detail-heading")).toContainText(`#${session}`);
        await expect(page.getByTestId("opname-session-status-1")).toHaveText("Active");
        const detail = await api(page, "inventory.v1.OpnameService/OpnameSessionDetail", { teamId: b.warehouse, sessionId: session });
        expect(detail.session.status).toBe("OPNAME_SESSION_STATUS_ACTIVE");
        expect(detail.session.plan).toBe("OPNAME_PLAN_ALL");
      });

      await test.step("then: a row per product on each rack, those at 0 in system included", async () => {
        const rows = await rowsOf(page, b.warehouse, session);
        expect([...rows.keys()].sort()).toEqual([key(kaos, a), key(gelas, a), key(gelas, rb)].sort());
        expect(rows.get(key(kaos, a))!.book).toBe("4");
        expect(rows.get(key(gelas, a))!.book).toBe("0");
        expect(rows.get(key(gelas, rb))!.book).toBe("3");
        await rowsOnScreen(
          page,
          session,
          rows,
          new Map([
            [key(kaos, a), a.code],
            [key(gelas, a), a.code],
            [key(gelas, rb), rb.code],
          ]),
        );
      });

      await test.step("then: every rack listed, the empty one too", async () => {
        await page.getByTestId("opname-detail-count").click();
        await expect(page).toHaveURL(new RegExp(`/inventories/opname/sessions/${session}/count`));
        await expect(page.getByTestId("opname-count-racks")).toBeVisible();
        for (const rack of [a, rb, c]) await expect(page.getByTestId(`opname-count-rack-${rack.id}`)).toContainText(rack.code);
        await expect.poll(() => tiles(page)).toEqual([a.id, rb.id, c.id].sort());
        await expect(page.getByTestId(`opname-count-rack-state-${c.id}`)).toHaveText("Empty");
        await expect(page.getByTestId(`opname-count-rack-progress-${c.id}`)).toHaveText("Nothing expected");
        await page.getByTestId(`opname-count-rack-${c.id}`).click();
        await expect(page.getByTestId("opname-count-nothing-expected")).toBeVisible();
      });

      await test.step("then: staff see its racks to count", async () => {
        const staff = await browser.newPage();
        try {
          await signIn(staff, b.staff, PASSWORD);
          await useTeam(staff, b.warehouse);
          await staff.goto("/inventories/opname/sessions");
          await expect(staff.getByTestId("opname-active-session")).toContainText(`#${session}`);
          await staff.getByTestId("opname-active-count").click();
          await expect(staff).toHaveURL(new RegExp(`/inventories/opname/sessions/${session}/count`));
          await expect(staff.getByTestId("opname-count-racks")).toBeVisible();
          for (const rack of [a, rb, c]) await expect(staff.getByTestId(`opname-count-rack-${rack.id}`)).toContainText(rack.code);
          await expect.poll(() => tiles(staff)).toEqual([a.id, rb.id, c.id].sort());
        } finally {
          await staff.close();
        }
      });

      await test.step("then: a product on a counted rack cannot be ordered, the refusal names the count", async () => {
        const res = await send(rootPage, "selling.v1.OrderService/OrderCreate", {
          idempotencyKey: `e2e-qk-refused-${r.key}-${SUFFIX}`,
          shipmentChannelId: "1",
          teamId: ground.melati,
          shopId: ground.shop,
          warehouseId: b.warehouse,
          customerName: "E2E Opname Buyer",
          platformTotal: 15000,
          platformCreatedAtUnix: Math.floor(Date.now() / 1000),
          orderExternalRefId: `QK1${r.key.toUpperCase()}X${SUFFIX}`,
          items: [{ productId: kaos.id, productCode: kaos.code, name: kaos.name, quantity: 1 }],
        });
        expectCounted(res, session, "order", "BEING_COUNTED");
        expect(String(res.json.message), "order").toContain(`held on rack ${a.code} by count #${session}`);
        // nothing was placed
        const refs = await api(rootPage, "selling.v1.OrderService/OrderByExternalRefs", {
          teamId: ground.melati,
          filter: { refs: [`QK1${r.key.toUpperCase()}X${SUFFIX}`] },
          dataRequest: ["ORDER_BY_EXTERNAL_REFS_DATA_TYPE_ORDER_REF"],
        });
        expect(refs.items?.[`QK1${r.key.toUpperCase()}X${SUFFIX}`]).toBeUndefined();
      });

      await test.step("then: nothing else can be done to it there: no transfer, move, sample, adjustment, put-away, found report or cancel", async () => {
        // a transfer — the selling team's, its out-leg taken at create from rack A
        expectCounted(
          await send(rootPage, "inventory.v1.WarehouseTransferService/WarehouseTransferCreate", {
            teamId: ground.melati,
            fromWarehouseId: b.warehouse,
            toWarehouseId: ground.dest,
            lines: [{ productId: kaos.id, count: "1" }],
          }),
          session,
          "transfer",
          `held on rack ${a.code} by count #${session}`,
        );
        // a move off A
        expectCounted(
          await send(page, "inventory.v1.RackService/RackMove", {
            teamId: b.warehouse,
            fromRackId: a.id,
            lines: [{ productId: kaos.id, quantity: 1, toRackId: c.id }],
          }),
          session,
          "move",
        );
        // a sample off A
        expectCounted(
          await send(page, "inventory.v1.RackService/RackSample", {
            teamId: b.warehouse,
            rackId: a.id,
            lines: [{ productId: kaos.id, quantity: 1 }],
            recipient: "E2E Penerima",
            description: `sampel opname ${SUFFIX}`,
          }),
          session,
          "sample",
        );
        // an adjustment of A
        expectCounted(
          await send(page, "inventory.v1.InventoryService/StockAdjust", {
            warehouseId: b.warehouse,
            productId: kaos.id,
            reasonType: "STOCK_ADJUST_REASON_RECOUNT",
            onHand: 3,
            rackId: a.id,
            reason: `hitung ulang ${SUFFIX}`,
          }),
          session,
          "adjustment",
        );
        // a put-away onto A — the second restock's accept
        expectCounted(
          await send(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
            teamId: b.warehouse,
            requestId: b.putAway.request,
            lines: [{ itemId: b.putAway.item, receivedCount: 1, placements: [{ placementId: a.id, quantity: 1 }] }],
          }),
          session,
          "put-away",
        );
        // a found report on A
        expectCounted(
          await send(page, "inventory.v1.FoundRequestService/FoundRequestCreate", {
            teamId: b.warehouse,
            productId: kaos.id,
            rackId: a.id,
            quantity: 1,
            note: `ketemu di rak ${SUFFIX}`,
          }),
          session,
          "found report",
        );
        // the cancel of the order taken off A before the count — the selling team's
        expectCounted(
          await send(rootPage, "selling.v1.OrderService/OrderCancel", { teamId: ground.melati, orderId: b.order }),
          session,
          "cancel",
        );

        // Nothing moved: A still holds 4 Kaos, C nothing, and the order is still pending.
        expect(await onHand(page, b.warehouse, a.id, kaos.id)).toBe(4);
        expect(await onHand(page, b.warehouse, c.id, kaos.id)).toBe(0);
        const order = await api(rootPage, "selling.v1.OrderService/OrderDetail", { teamId: ground.melati, orderId: b.order });
        expect(order.order.status).toBe("ORDER_STATUS_PENDING");
      });
    });
  }
});

test.describe(`${GIVEN} (${C2})`, () => {
  for (const r of ROLES) {
    test(`${r.given} ${WHEN} (${C2})`, async ({ page }) => {
      const b = ground.g[2][r.key];
      const { m1, m2, o1 } = b.products;
      const { a, b: rb } = b.racks;
      await asRole(page, b);

      const session = await planCount(page, async (dialog) => {
        await dialog.getByTestId("opname-plan-team").click();
        await pickTeam(page, dialog.getByTestId("team-select"), ground.melatiCode);
      });

      await test.step("then: only team Melati's products in the rows", async () => {
        const detail = await api(page, "inventory.v1.OpnameService/OpnameSessionDetail", { teamId: b.warehouse, sessionId: session });
        expect(detail.session.plan).toBe("OPNAME_PLAN_TEAM");
        const rows = await rowsOf(page, b.warehouse, session);
        expect([...rows.keys()].sort()).toEqual([key(m1, a), key(m2, rb)].sort());
        for (const row of rows.values()) expect(row.teamId).toBe(ground.melati);
        await rowsOnScreen(
          page,
          session,
          rows,
          new Map([
            [key(m1, a), a.code],
            [key(m2, rb), rb.code],
          ]),
        );
        for (const row of rows.values()) await expect(page.getByTestId(`opname-row-${row.id}`)).toContainText(ground.melatiName);
        await expect(page.getByTestId("opname-detail-table")).not.toContainText(o1.name);
      });

      await test.step("then: the other team's product not locked", async () => {
        // The control: Melati's product on the same rack is held by the count.
        expectCounted(
          await send(page, "inventory.v1.RackService/RackMove", {
            teamId: b.warehouse,
            fromRackId: a.id,
            lines: [{ productId: m1.id, quantity: 1, toRackId: rb.id }],
          }),
          session,
          "Melati's move",
        );
        // The other team's product moves off rack A.
        const moved = await send(page, "inventory.v1.RackService/RackMove", {
          teamId: b.warehouse,
          fromRackId: a.id,
          lines: [{ productId: o1.id, quantity: 1, toRackId: rb.id }],
        });
        expect(moved.status, JSON.stringify(moved.json)).toBe(200);
        expect(await onHand(page, b.warehouse, a.id, o1.id)).toBe(1);
        expect(await onHand(page, b.warehouse, rb.id, o1.id)).toBe(1);
        expect(await onHand(page, b.warehouse, a.id, m1.id)).toBe(3);
      });
    });
  }
});

test.describe(`${GIVEN} (${C3})`, () => {
  for (const r of ROLES) {
    test(`${r.given} ${WHEN} (${C3})`, async ({ page }) => {
      const b = ground.g[3][r.key];
      const { p, q } = b.products;
      const { a, b: rb } = b.racks;
      await asRole(page, b);

      const session = await planCount(page, async (dialog) => {
        await dialog.getByTestId("opname-plan-product").click();
        const input = dialog.getByRole("combobox");
        await input.click();
        await input.pressSequentially("Sepatu Opname", { delay: 30 });
        const option = dialog.getByTestId(`product-select-option-${p.code}`);
        await expect(option).toBeVisible();
        await option.click();
      });

      await test.step("then: both racks listed with the product", async () => {
        const detail = await api(page, "inventory.v1.OpnameService/OpnameSessionDetail", { teamId: b.warehouse, sessionId: session });
        expect(detail.session.plan).toBe("OPNAME_PLAN_PRODUCT");
        const rows = await rowsOf(page, b.warehouse, session);
        expect([...rows.keys()].sort()).toEqual([key(p, a), key(p, rb)].sort());
        expect(rows.get(key(p, a))!.book).toBe("2");
        expect(rows.get(key(p, rb))!.book).toBe("3");
        await rowsOnScreen(
          page,
          session,
          rows,
          new Map([
            [key(p, a), a.code],
            [key(p, rb), rb.code],
          ]),
        );
        for (const row of rows.values()) await expect(page.getByTestId(`opname-row-${row.id}`)).toContainText(p.name);
        await expect(page.getByTestId("opname-detail-table")).not.toContainText(q.name);

        // The count page lists the two racks the product is on.
        await page.getByTestId("opname-detail-count").click();
        await expect(page.getByTestId("opname-count-racks")).toBeVisible();
        await expect.poll(() => tiles(page)).toEqual([a.id, rb.id].sort());
      });
    });
  }
});

test.describe(`${GIVEN} (${C4})`, () => {
  for (const r of ROLES) {
    test(`${r.given} ${WHEN} (${C4})`, async ({ page }) => {
      const b = ground.g[4][r.key];
      const { x, y, z } = b.products;
      const { a, b: rb } = b.racks;
      await asRole(page, b);

      const session = await planCount(page, async (dialog) => {
        await pickRack(dialog, a.id);
      });

      await test.step("then: product X counted on rack B too", async () => {
        const detail = await api(page, "inventory.v1.OpnameService/OpnameSessionDetail", { teamId: b.warehouse, sessionId: session });
        expect(detail.session.plan).toBe("OPNAME_PLAN_PLACEMENT");
        const rows = await rowsOf(page, b.warehouse, session);
        expect([...rows.keys()].sort()).toEqual([key(x, a), key(y, a), key(x, rb)].sort());
        expect(rows.get(key(x, rb))!.book).toBe("3");
        await rowsOnScreen(
          page,
          session,
          rows,
          new Map([
            [key(x, a), a.code],
            [key(y, a), a.code],
            [key(x, rb), rb.code],
          ]),
        );
        await expect(page.getByTestId(`opname-row-${rows.get(key(x, rb))!.id}`)).toContainText(x.name);
        await expect(page.getByTestId("opname-detail-table")).not.toContainText(z.name);

        // Rack B's count lists X, and only X.
        await page.getByTestId("opname-detail-count").click();
        await expect(page.getByTestId("opname-count-racks")).toBeVisible();
        await expect.poll(() => tiles(page)).toEqual([a.id, rb.id].sort());
        await page.getByTestId(`opname-count-rack-${rb.id}`).click();
        await expect(page.getByTestId("opname-count-rack")).toBeVisible();
        await expect(page.getByTestId(`opname-count-row-${rows.get(key(x, rb))!.id}`)).toContainText(x.name);
        await expect(page.getByTestId("opname-count-rack")).not.toContainText(z.name);
      });
    });
  }
});

test.describe(`${GIVEN} (${C5})`, () => {
  for (const r of ROLES) {
    test(`${r.given} ${WHEN} (${C5})`, async ({ page }) => {
      const b = ground.g[5][r.key];
      await asRole(page, b);

      await test.step("then: cannot start, nothing to count", async () => {
        const dialog = await openNewCount(page, async (d) => {
          await pickRack(d, b.racks.e.id);
        });
        const res = await submitCount(page, dialog);
        expect(res.ok).toBe(false);
        expect(String(res.json.message ?? "")).toContain("nothing to count");
        await expect(dialog.getByTestId("opname-new-session-error")).toContainText("nothing to count");
        await expect(dialog).toBeVisible();

        const active = await api(page, "inventory.v1.OpnameService/OpnameSessionList", {
          teamId: b.warehouse,
          filter: { status: "OPNAME_SESSION_STATUS_ACTIVE" },
          page: { page: 1, limit: 5 },
        });
        expect(active.ids ?? []).toHaveLength(0);
      });
    });
  }
});

test.describe(`${GIVEN} (${C6})`, () => {
  for (const r of ROLES) {
    test(`${r.given} ${WHEN} (${C6})`, async ({ page }) => {
      const b = ground.g[6][r.key];
      await asRole(page, b);

      await test.step("then: cannot start, names the earlier count", async () => {
        await page.goto("/inventories/opname/sessions");
        await expect(page.getByTestId("opname-sessions-page")).toBeVisible();
        await expect(page.getByTestId("opname-active-session")).toContainText(`Count #${b.earlier} is active`);
        await expect(page.getByTestId("opname-new-session")).toBeDisabled();

        // The same create sent anyway with the role's token: refused, naming the earlier count, its starter and when.
        const res = await send(page, "inventory.v1.OpnameService/OpnameSessionCreate", {
          teamId: b.warehouse,
          plan: "OPNAME_PLAN_ALL",
        });
        expect(res.status, JSON.stringify(res.json)).not.toBe(200);
        expect(String(res.json.message ?? "")).toContain(`count #${b.earlier}`);
        expect(String(res.json.message ?? "")).toMatch(/started by .+ at \d{4}-\d{2}-\d{2} \d{2}:\d{2} WIB/);

        const active = await api(page, "inventory.v1.OpnameService/OpnameSessionList", {
          teamId: b.warehouse,
          filter: { status: "OPNAME_SESSION_STATUS_ACTIVE" },
          page: { page: 1, limit: 5 },
        });
        expect(active.ids).toEqual([b.earlier]);
      });
    });
  }
});
