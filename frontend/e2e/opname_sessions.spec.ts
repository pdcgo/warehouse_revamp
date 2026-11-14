import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";

// THE STOCK COUNT, end to end on the real server (docs/business/inventory/opname.md): the warehouse plans a count, the
// shelf book is snapshotted and LOCKED; a staff member counts blind, sees the book only after, splits the shortage into
// broken and lost and gives every draft its reason; a SECOND person finalizes — and the ledgers move: a `problem` for
// the torn and the lost units, a `move` for the unit on the wrong rack, every rack at its sellable count, the lock gone.
//
// A warehouse of its own, so its one active count (one-active-count-per-warehouse) cannot meet another spec's.
//
//   Rak A: Kaos A 6 · Kaos B 5          Rak B: Kaos A 4
//   counted   Kaos A 4, one torn         counted   Kaos A 5
//             Kaos B 4
//   Kaos A — book 10, sellable 9, broken 1: the rest 0 → broken 1 (a problem) and 1 moved A → B (a move)
//   Kaos B — book 5, sellable 4: the rest −1 → lost 1 (a problem)
//   the warehouse owes 1 × Rp 10.000 + 1 × Rp 20.000 = Rp 30.000

const SUFFIX = Date.now().toString().slice(-6);
const STAFF = `e2ecounter${SUFFIX}`;
const STAFF_PASSWORD = "e2epassword1";
// The warehouse's Admin — not Root — plans the last count through the picker (a-warehouse-picks-only-what-it-has-held).
const ADMIN = `e2ecountadmin${SUFFIX}`;

async function login(page: Page, username: string, password: string) {
  await signIn(page, username, password);
}

// rpc calls the API with the page's own token, so a seed runs as the person the UI is signed in as.
async function rpc<T = Record<string, unknown>>(page: Page, method: string, body: unknown): Promise<T> {
  return page.evaluate(
    async ([m, b, apiUrl]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ??
        window.localStorage.getItem("warehouse_revamp.token");

      const res = await fetch(`${apiUrl}/warehouse.${m}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(b),
      });

      if (!res.ok) throw new Error(`${m}: ${res.status} ${await res.text()}`);

      return res.json();
    },
    [method, body, API_URL] as const,
  ) as Promise<T>;
}

// rpcError is the error text of a call that must be refused.
async function rpcError(page: Page, method: string, body: unknown): Promise<string> {
  try {
    await rpc(page, method, body);
  } catch (err) {
    return String(err);
  }

  return "";
}

// Work in the given team: the active team is per tab, in sessionStorage (TeamContext).
async function useTeam(page: Page, teamId: string) {
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

const state = {
  warehouse: "",
  rakA: "",
  rakB: "",
  kaosA: "",
  kaosB: "",
  // In the catalogue, matching "Kaos", and never stocked here — the picker must not offer it.
  kaosC: "",
  codes: new Map<string, string>(),
  session: "",
  // (product, rack) → row id
  rows: new Map<string, string>(),
};

const rowOf = (product: string, rack: string) => state.rows.get(`${product}:${rack}`)!;

test.describe.configure({ mode: "serial" });

test("Count: the warehouse plans a count of every rack, and the shelves are locked", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const wh = await rpc<{ team: { id: string } }>(page, "team.v1.TeamService/TeamCreate", {
    name: `E2E Count WH ${SUFFIX}`,
    teamCode: `CW${SUFFIX}`,
    type: "TEAM_TYPE_WAREHOUSE",
    ownerUserId: "1",
  });
  state.warehouse = wh.team.id;

  const rack = async (code: string) =>
    (await rpc<{ rack: { id: string } }>(page, "inventory.v1.RackService/RackCreate", { teamId: state.warehouse, code }))
      .rack.id;
  state.rakA = await rack(`cnt-a-${SUFFIX}`);
  state.rakB = await rack(`cnt-b-${SUFFIX}`);

  const category = await rpc<{ category: { id: string } }>(page, "category.v1.CategoryService/CategoryCreate", {
    name: `E2E Count ${SUFFIX}`,
  });
  const product = async (code: string, name: string) => {
    const created = (
      await rpc<{ product: { id: string; productCode: string } }>(page, "product.v1.ProductService/ProductCreate", {
        teamId: "1",
        productCodePart: code,
        name,
        categoryId: category.category.id,
      })
    ).product;
    state.codes.set(created.id, created.productCode);
    return created.id;
  };
  state.kaosA = await product(`CA${SUFFIX}`, "Kaos A");
  state.kaosB = await product(`CB${SUFFIX}`, "Kaos B");
  state.kaosC = await product(`CC${SUFFIX}`, "Kaos C");

  const account = await rpc<{ account: { id: string } }>(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
    teamId: "1",
    type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
    provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
    name: `E2E count ${SUFFIX}`,
    holderName: "E2E",
    accountNumber: `E2E-CNT-${SUFFIX}`,
    openingBalance: 0,
    openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
  });
  // The restock is paid from an OPERATIONAL account (a-restock-names-its-paying-account) — the server refuses any other.
  await rpc(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: "1",
    accountId: account.account.id,
    operational: true,
  });

  // Kaos A at Rp 10.000 a unit, Kaos B at Rp 20.000 — what the shortage is priced at.
  const restock = await rpc<{ request: { id: string; items: { id: string }[] } }>(
    page,
    "inventory.v1.RestockRequestService/RestockRequestCreate",
    {
      teamId: "1",
      warehouseId: state.warehouse,
      financeAccountId: account.account.id,
      items: [
        { productId: state.kaosA, productCode: `CA${SUFFIX}`, name: "Kaos A", count: 10, total: 100000 },
        { productId: state.kaosB, productCode: `CB${SUFFIX}`, name: "Kaos B", count: 5, total: 100000 },
      ],
    },
  );

  await rpc(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: state.warehouse,
    requestId: restock.request.id,
    lines: [
      {
        itemId: restock.request.items[0].id,
        receivedCount: 10,
        placements: [
          { placementId: state.rakA, quantity: 6 },
          { placementId: state.rakB, quantity: 4 },
        ],
      },
      { itemId: restock.request.items[1].id, receivedCount: 5, placements: [{ placementId: state.rakA, quantity: 5 }] },
    ],
  });

  await rpc(page, "user.v1.UserService/CreateUser", {
    teamId: state.warehouse,
    username: STAFF,
    password: STAFF_PASSWORD,
    name: "E2E Counter",
    role: "ROLE_WAREHOUSE_STAFF",
  });
  await rpc(page, "user.v1.UserService/CreateUser", {
    teamId: state.warehouse,
    username: ADMIN,
    password: STAFF_PASSWORD,
    name: "E2E Count Admin",
    role: "ROLE_WAREHOUSE_ADMIN",
  });

  await useTeam(page, state.warehouse);

  // The retired one-rack page's address lands on the counts, and the menu opens them.
  await page.goto("/inventories/opname");
  await expect(page.getByTestId("opname-sessions-page")).toBeVisible();
  await expect(page).toHaveURL(/\/inventories\/opname\/sessions$/);

  await page.getByTestId("opname-new-session").click();
  await page.getByTestId("opname-plan-all").click();
  await page.getByTestId("opname-new-session-submit").click();
  await expect(page.getByTestId("opname-active-session")).toBeVisible();

  const list = await rpc<{ ids: string[] }>(page, "inventory.v1.OpnameService/OpnameSessionList", {
    teamId: state.warehouse,
    filter: { status: "OPNAME_SESSION_STATUS_ACTIVE" },
    page: { page: 1, limit: 5 },
  });
  expect(list.ids).toHaveLength(1);
  state.session = list.ids[0];

  const rows = await rpc<{ items: { row?: { mapData: Record<string, { id: string; productId: string; placementId: string }> } }[] }>(
    page,
    "inventory.v1.OpnameService/OpnameRowList",
    { teamId: state.warehouse, filter: { sessionId: state.session }, page: { page: 1, limit: 50 } },
  );
  for (const item of rows.items) {
    for (const r of Object.values(item.row?.mapData ?? {})) state.rows.set(`${r.productId}:${r.placementId}`, r.id);
  }
  expect(state.rows.size).toBe(3);

  // THE LOCK: nothing moves a counted product on its rack, and the refusal names the count.
  const refused = await rpcError(page, "inventory.v1.RackService/RackMove", {
    teamId: state.warehouse,
    fromRackId: state.rakA,
    lines: [{ productId: state.kaosA, quantity: 1, toRackId: state.rakB }],
  });
  expect(refused).toContain("being counted");
  expect(refused).toContain(`count #${state.session}`);
});

test("Count: staff count blind, give every difference its reason, and mark each row counted", async ({ page }) => {
  await login(page, STAFF, STAFF_PASSWORD);

  const count = async (rack: string, product: string, n: number, opts: { broken?: number; lost?: string; over?: string } = {}) => {
    const row = rowOf(product, rack);
    await page.goto(`/inventories/opname/sessions/${state.session}/count?rack=${rack}`);
    await expect(page.getByTestId(`opname-count-row-${row}`)).toBeVisible();

    // BLIND: the book figure is not on the screen before the count.
    await expect(page.getByTestId(`opname-count-hidden-${row}`)).toBeVisible();
    await expect(page.getByTestId(`opname-count-expected-${row}`)).toHaveCount(0);

    await page.getByTestId(`opname-count-input-${row}`).fill(String(n));
    await page.getByTestId(`opname-count-submit-${row}`).click();
    await expect(page.getByTestId(`opname-count-expected-${row}`)).toBeVisible();

    if (opts.broken) {
      await page.getByTestId(`opname-count-broken-${row}`).fill(String(opts.broken));
      await page.getByTestId(`opname-count-broken-note-${row}`).fill("torn at the seam, thrown away");
    }
    if (opts.lost) await page.getByTestId(`opname-count-lost-note-${row}`).fill(opts.lost);
    if (opts.over) await page.getByTestId(`opname-count-surplus-note-${row}`).fill(opts.over);

    await page.getByTestId(`opname-count-mark-${row}`).click();
    await expect(page.getByTestId(`opname-count-mark-${row}`)).toHaveCount(0);
  };

  await count(state.rakA, state.kaosA, 4, { broken: 1, lost: "not found, checked under the shelf" });
  await count(state.rakA, state.kaosB, 4, { lost: "gone, the whole aisle checked" });
  await count(state.rakB, state.kaosA, 5, { over: "found behind the boxes" });

  // Staff never read the admin's page with the book figures.
  const refused = await rpcError(page, "inventory.v1.OpnameService/OpnameRowList", {
    teamId: state.warehouse,
    filter: { sessionId: state.session },
    page: { page: 1, limit: 50 },
  });
  expect(refused).toContain("403");
});

test("Count: a second person finalizes — the problem and the move post, the racks are corrected, the lock lifts", async ({
  page,
}) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await useTeam(page, state.warehouse);

  await page.goto(`/inventories/opname/sessions/${state.session}/finalize`);
  await expect(page.getByTestId("opname-finalize-summary")).toBeVisible();

  await expect(page.getByTestId("opname-finalize-owed")).toContainText("Rp 30.000");
  await expect(page.getByTestId("opname-finalize-moved")).toContainText("1 unit");
  await expect(page.getByTestId(`opname-finalize-tx-${state.kaosA}`)).toContainText("Problem");
  await expect(page.getByTestId(`opname-finalize-tx-${state.kaosA}`)).toContainText("Move");
  await expect(page.getByTestId(`opname-finalize-tx-${state.kaosB}`)).toHaveText("Problem");

  await page.getByTestId("opname-finalize-submit").click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Finalize" }).click();
  await expect(page.getByTestId("opname-detail-page")).toBeVisible();

  const detail = await rpc<{ session: { status: string; finalizedById: string } }>(page, "inventory.v1.OpnameService/OpnameSessionDetail", {
    teamId: state.warehouse,
    sessionId: state.session,
  });
  expect(detail.session.status).toBe("OPNAME_SESSION_STATUS_FINISH");

  // Every rack at its sellable count.
  const onRack = async (rack: string) => {
    const res = await rpc<{ items: { rackStock?: { mapData: Record<string, { productId: string; onHand: string }> } }[] }>(
      page,
      "inventory.v1.RackService/RackStock",
      { teamId: state.warehouse, filter: { rackId: rack }, page: { page: 1, limit: 50 } },
    );
    const out = new Map<string, number>();
    for (const item of res.items) for (const l of Object.values(item.rackStock?.mapData ?? {})) out.set(l.productId, Number(l.onHand));
    return out;
  };

  const a = await onRack(state.rakA);
  const b = await onRack(state.rakB);
  expect(a.get(state.kaosA)).toBe(4);
  expect(a.get(state.kaosB)).toBe(4);
  expect(b.get(state.kaosA)).toBe(5);

  // Released: the shelf moves again.
  await rpc(page, "inventory.v1.RackService/RackMove", {
    teamId: state.warehouse,
    fromRackId: state.rakB,
    lines: [{ productId: state.kaosA, quantity: 1, toRackId: state.rakA }],
  });
});

// A PRODUCT PLAN, planned by the warehouse ADMIN — not Root — through the New Count dialog's picker, on the real server
// (a-warehouse-picks-only-what-it-has-held). The picker's own read must admit the warehouse roles: it searches only what
// this warehouse holds or has held, so Kaos A and Kaos B are offered and Kaos C — in the catalogue, never stocked here —
// is not. The count is cancelled after, so nothing is left active.
test("Count: the warehouse Admin plans a one-product count, picking from what the warehouse has held", async ({ page }) => {
  await login(page, ADMIN, STAFF_PASSWORD);
  await useTeam(page, state.warehouse);

  await page.goto("/inventories/opname/sessions");
  await expect(page.getByTestId("opname-sessions-page")).toBeVisible();
  await page.getByTestId("opname-new-session").click();
  const dialog = page.getByTestId("opname-new-session-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("opname-plan-product").click();
  await expect(dialog.getByTestId("opname-new-session-submit")).toBeDisabled();

  await dialog.getByRole("combobox").click();
  await dialog.getByRole("combobox").pressSequentially("Kaos", { delay: 30 });
  await expect(dialog.getByTestId(`product-select-option-${state.codes.get(state.kaosA)}`)).toBeVisible();
  await expect(dialog.getByTestId(`product-select-option-${state.codes.get(state.kaosB)}`)).toBeVisible();
  await expect(dialog.getByTestId(`product-select-option-${state.codes.get(state.kaosC)}`)).toHaveCount(0);
  await expect(dialog.getByRole("option")).toHaveCount(2);

  await dialog.getByTestId(`product-select-option-${state.codes.get(state.kaosB)}`).click();
  await expect(dialog.getByTestId("opname-new-session-submit")).toBeEnabled();
  await dialog.getByTestId("opname-new-session-submit").click();
  await expect(dialog).toBeHidden();

  const list = await rpc<{ ids: string[] }>(page, "inventory.v1.OpnameService/OpnameSessionList", {
    teamId: state.warehouse,
    filter: { status: "OPNAME_SESSION_STATUS_ACTIVE" },
    page: { page: 1, limit: 5 },
  });
  expect(list.ids).toHaveLength(1);

  const detail = await rpc<{ session: { plan: string } }>(page, "inventory.v1.OpnameService/OpnameSessionDetail", {
    teamId: state.warehouse,
    sessionId: list.ids[0],
  });
  expect(detail.session.plan).toBe("OPNAME_PLAN_PRODUCT");

  // Only Kaos B's shelf rows were snapshotted.
  const rows = await rpc<{ items: { row?: { mapData: Record<string, { productId: string }> } }[] }>(
    page,
    "inventory.v1.OpnameService/OpnameRowList",
    { teamId: state.warehouse, filter: { sessionId: list.ids[0] }, page: { page: 1, limit: 50 } },
  );
  const products = new Set(rows.items.flatMap((i) => Object.values(i.row?.mapData ?? {}).map((r) => r.productId)));
  expect([...products]).toEqual([state.kaosB]);

  await rpc(page, "inventory.v1.OpnameService/OpnameSessionCancel", { teamId: state.warehouse, sessionId: list.ids[0] });
});

// LOST STOCK, read back from the count above (inventory-lost-counts-the-warehouses-custody-losses): its shortage was
// Kaos B's 1 unit lost at Rp 20.000 — counted — and Kaos A's torn unit — broken, NOT counted. Read through
// InventoryAnalyticService and the Analytic composer, as the warehouse (a-warehouse-sees-its-lost-amount).
test("Lost stock: the count's shortage is read back, its broken unit is not", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await useTeam(page, state.warehouse);

  const LOST = "metrics/inventory/lost";
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
  const week = new Date(Date.now() - 6 * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
  const filters = [{ dateRangeFilter: { dateMin: week, dateMax: today } }];

  const ranked = await rpc<{ keys: { ids: { ids: string[] } } }>(page, "inventory.v1.InventoryAnalyticService/MetricSearch", {
    teamId: state.warehouse,
    groupBy: "GROUP_TYPE_PRODUCT",
    filters,
    sort: { metricId: LOST, field: "lost_amount", sortType: "SORT_TYPE_DESC" },
    page: { offset: 0, limit: 20 },
  });
  expect(ranked.keys.ids.ids).toEqual([state.kaosB]);

  type Lost = { lostCount?: string; lostAmount?: number };
  const head = await rpc<{ metricDatas: { lostSummary: Lost }[] }>(page, "inventory.v1.InventoryAnalyticService/MetricData", {
    teamId: state.warehouse,
    groupBy: "GROUP_TYPE_SUMMARY",
    filters,
    metricIds: [LOST],
  });
  expect([Number(head.metricDatas[0]!.lostSummary.lostCount ?? 0), head.metricDatas[0]!.lostSummary.lostAmount ?? 0]).toEqual([1, 20000]);

  await page.goto(`/analytic?g=product&m=${LOST}&r=7d&s=${LOST}:lost_amount:desc`);
  await expect(page.getByTestId("analytic-table")).toBeVisible();
  await expect(page.getByTestId(`analytic-row-${state.kaosB}`)).toContainText("Kaos B");
  await expect(page.getByTestId(`analytic-cell-${state.kaosB}-lost_amount`)).toHaveText("Rp 20.000");
  await expect(page.getByTestId(`analytic-row-${state.kaosA}`)).toHaveCount(0);
  await expect(page.getByTestId("analytic-headline-lost_count-value")).toHaveText("1");
  await expect(page.getByTestId("analytic-rows-line")).toContainText("with lost stock in this period");

  // THE PRODUCT FILTER (backlog #19): a warehouse searches what it holds (WarehouseProductSearch) — Kaos A, whose torn
  // unit is no loss, narrows the table to nothing; Kaos B brings its row back. The pick is in the URL and reads as a
  // chip named by ProductByIds, after a reload too.
  const pickProduct = async (id: string) => {
    const input = page.getByTestId("analytic-filter-product").getByRole("combobox");
    await input.click();
    await input.fill("Kaos");
    await page.getByTestId(`product-select-option-${state.codes.get(id)}`).click();
    await expect(page).toHaveURL(new RegExp(`[?&]product=${id}(&|$)`));
  };

  await pickProduct(state.kaosA);
  await expect(page.getByTestId("analytic-product-chip")).toHaveText("Kaos A");
  await expect(page.getByTestId(`analytic-row-${state.kaosB}`)).toHaveCount(0);

  await page.getByTestId("analytic-product-chip-remove").click();
  await pickProduct(state.kaosB);
  await expect(page.getByTestId(`analytic-row-${state.kaosB}`)).toContainText("Kaos B");
  await expect(page.getByTestId("analytic-headline-lost_count-value")).toHaveText("1");

  await page.reload();
  await expect(page.getByTestId("analytic-product-chip")).toHaveText("Kaos B");
  await expect(page.getByTestId(`analytic-cell-${state.kaosB}-lost_amount`)).toHaveText("Rp 20.000");
});
