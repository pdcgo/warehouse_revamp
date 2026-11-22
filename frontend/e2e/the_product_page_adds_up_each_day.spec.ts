import { expect, test } from "@playwright/test";
import type { Locator, Page, Response } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";
import { pickTeam } from "./pickers";

// KELUAR MASUK HARIAN IS REAL (backlog #114) — the product page's daily tab and the Discover detail's, end to end on the
// real server and Postgres (docs/technical/frontend/products_decision.md):
//
//   the-warehouse-zone-is-tabs — "the last fourteen days: date, in, out, on hand", a tab of the Per Gudang card; built
//     on InventoryService.ProductDailyMoves: fourteen Jakarta days, today first, Sisa read back from today's stock;
//   the-warehouse-picker-splits-the-page — the tab is the PICKED warehouse's: only what moved, and what is on hand, there;
//   the-discover-detail-has-the-warehouse-zone + stock-history-is-everyones — another team's Discover detail reads the
//     OWNER's days, units only: no Rp in the panel and no value field on the wire.
//
// ⚠ HELD by the owner's open question Q2 (which movements are Masuk and which Keluar; built as option A, every movement by
// its direction). NOTHING HERE PINS THAT SPLIT: the seeded moves are a restock (Masuk under every option — A, B and C)
// and an order (Keluar under every option), so today's Masuk / Keluar and "Sisa kemarin + Masuk − Keluar = Sisa" hold
// whatever the owner picks. The last test's SAMPLE is option-dependent: there only Sisa (read from the shelves, whatever
// the split) and Masuk (a sample adds nothing in under any option) are pinned — never its Keluar, never the day adding up.
//
// No acceptance then covers this slice — every check is a regression step.
//
// The ground, all the spec's own: a SELLING team of its own (root's) with one product, made today — 10 received into
// Gudang A, 4 into Gudang B, then an order taking 3 at A; a VIEWER selling team with a CS person; a STAFF person of
// Gudang A. Root's own team is never touched.

const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-kmh-pass-1";
// A username is lowercase letters and digits only.
const VIEWER_CS = `e2ekmhcs${SUFFIX}`;
const WH_STAFF = `e2ekmhwh${SUFFIX}`;
const WH_A = `KMA${SUFFIX}`;
const WH_B = `KMB${SUFFIX}`;
const NAME = `E2E KMH Kopi ${SUFFIX}`;
const UNIT_COST = 10_000;

const state = { seller: "", viewer: "", whA: "", whB: "", rackA: "", product: "", code: "" };

// ── The server, as the signed-in person ────────────────────────────────────────────────────────────────────────────

async function call(page: Page, method: string, body: unknown) {
  return page.evaluate(
    async ([m, b, apiUrl]) => {
      const bearer =
        window.sessionStorage.getItem("warehouse_revamp.token") ?? window.localStorage.getItem("warehouse_revamp.token");

      const res = await fetch(`${apiUrl}/warehouse.${m as string}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
        body: JSON.stringify(b),
      });

      return { status: res.status, body: await res.json() };
    },
    [method, body, API_URL] as const,
  );
}

// A call that must succeed — its JSON body.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ok<T = Record<string, any>>(page: Page, method: string, body: unknown): Promise<T> {
  const res = await call(page, method, body);
  expect(res.status, `${method}: ${JSON.stringify(res.body)}`).toBe(200);

  return res.body as T;
}

async function useTeam(page: Page, teamId: string) {
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

// ── The days ───────────────────────────────────────────────────────────────────────────────────────────────────────

type WireDay = {
  id?: string;
  day?: string;
  inUnits?: string;
  outUnits?: string;
  onHand?: string;
  kinds?: { changeType?: string; units?: string }[];
};
type DailyAnswer = { ids?: string[]; items?: Record<string, { mapData?: Record<string, WireDay> }>[] };

/** One day as the tab (or the wire) says it — Masuk, Keluar (a positive count), Sisa. */
type Day = { day: string; in: number; out: number; balance: number };

const dailyMoves = (page: Page, teamId: string, warehouseId = "0") =>
  call(page, "inventory.v1.InventoryService/ProductDailyMoves", {
    teamId,
    filter: { productId: state.product, warehouseId },
    dataRequest: ["PRODUCT_DAILY_MOVES_DATA_TYPE_DAY"],
  });

// The wire's days in its own order — `ids`, each looked up in the DAY slice. proto3 JSON drops a 0, hence `?? 0`.
function wireDays(body: DailyAnswer): WireDay[] {
  const map = body.items?.find((item) => item.day)?.day?.mapData ?? {};

  return (body.ids ?? []).map((id) => map[id] ?? {});
}

const asDays = (body: DailyAnswer): Day[] =>
  wireDays(body).map((d) => ({
    day: d.day ?? "",
    in: Number(d.inUnits ?? 0),
    out: Number(d.outUnits ?? 0),
    balance: Number(d.onHand ?? 0),
  }));

/** Each change type's net units on the wire's first day (today), signed. */
const todaysKinds = (body: DailyAnswer) =>
  Object.fromEntries((wireDays(body)[0]?.kinds ?? []).map((k) => [k.changeType ?? "", Number(k.units ?? 0)]));

// UNITS ONLY: a day carries its position, its date, Masuk, Keluar, Sisa and its kinds — nothing else, and no key
// anywhere in the answer names a price, a value, a cost or an amount.
function expectUnitsOnly(body: DailyAnswer) {
  const days = wireDays(body);
  expect(days).toHaveLength(14);
  for (const d of days) {
    expect(Object.keys(d).filter((k) => !["id", "day", "inUnits", "outUnits", "onHand", "kinds"].includes(k)), d.day).toEqual([]);
    for (const k of d.kinds ?? []) expect(Object.keys(k).filter((x) => !["changeType", "units"].includes(x)), d.day).toEqual([]);
  }

  const keys: string[] = [];
  const walk = (v: unknown) => {
    if (v === null || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      keys.push(k);
      walk(x);
    }
  };
  walk(body);
  expect(keys.filter((k) => /price|value|cost|amount|rupiah|money/i.test(k))).toEqual([]);
}

const jakartaToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

function daysBack(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);

  return d.toISOString().slice(0, 10);
}

// FOURTEEN JAKARTA DAYS, TODAY FIRST, one day apart — today's figures as given, and every earlier day empty (the product
// was made today: nothing moved, nothing was on hand).
function expectFourteen(days: Day[], today: Partial<Omit<Day, "day">>) {
  const t = jakartaToday();
  expect(days.map((d) => d.day)).toEqual(Array.from({ length: 14 }, (_, i) => daysBack(t, i)));

  const first = days[0]!;
  const pinned = Object.fromEntries(Object.keys(today).map((k) => [k, first[k as keyof Omit<Day, "day">]]));
  expect(pinned, `today ${first.day}`).toEqual(today);

  for (const d of days.slice(1)) expect({ in: d.in, out: d.out, balance: d.balance }, d.day).toEqual({ in: 0, out: 0, balance: 0 });
}

// EVERY DAY ADDS UP: the day before's Sisa + Masuk − Keluar = the day's Sisa.
function expectAddsUp(days: Day[]) {
  for (let i = 0; i < days.length - 1; i++) {
    const d = days[i]!;
    const before = days[i + 1]!;
    expect(before.balance + d.in - d.out, `${d.day}: ${before.balance} + ${d.in} − ${d.out}`).toBe(d.balance);
  }
}

// The tab's rows as drawn, read in one pass — each row's index from its own test id, its day from data-day.
async function readTable(panel: Locator): Promise<(Day & { index: string })[]> {
  return panel.locator('[data-testid^="pd-daily-row-"]').evaluateAll((rows) =>
    rows.map((row) => {
      const index = (row.getAttribute("data-testid") ?? "").replace("pd-daily-row-", "");
      // "+14 pcs", "−3 pcs", "11 pcs" — or "—" for none.
      const units = (part: string) =>
        Number((row.querySelector(`[data-testid="pd-daily-${part}-${index}"]`)?.textContent ?? "").replace(/[^\d]/g, "") || "0");

      return { index, day: row.getAttribute("data-day") ?? "", in: units("in"), out: units("out"), balance: units("balance") };
    }),
  );
}

// The table once it says today's figures (it keeps the last lens's rows while the next one loads) — then its rows.
async function settledTable(panel: Locator, today: Partial<Omit<Day, "day">>): Promise<Day[]> {
  await expect(panel.getByTestId("pd-daily-table")).toBeVisible();

  let days: Day[] = [];
  await expect(async () => {
    const rows = await readTable(panel);
    expect(rows.map((r) => r.index)).toEqual(Array.from({ length: 14 }, (_, i) => String(i)));
    days = rows.map(({ day, in: i, out, balance }) => ({ day, in: i, out, balance }));
    expectFourteen(days, today);
  }).toPass({ timeout: 15_000 });

  return days;
}

// A ProductDailyMoves answer the page asked for, in `warehouseId` ("0" = every warehouse: proto3 JSON drops it).
const dailyAnswer = (warehouseId: string) => (r: Response) => {
  if (!r.url().includes("InventoryService/ProductDailyMoves")) return false;
  const asked = JSON.parse(r.request().postData() ?? "{}");

  return String(asked.filter?.warehouseId ?? "0") === warehouseId;
};

async function answerOf(res: Response) {
  return { asked: JSON.parse(res.request().postData() ?? "{}"), body: (await res.json()) as DailyAnswer };
}

// The Overview's Siap for the picked warehouse: "<n> pcs".
const siap = (n: number) => new RegExp(`(^|\\D)${n} pcs`);

test.describe.configure({ mode: "serial" });

test("setup: a selling team of its own — 10 received at Gudang A, 4 at Gudang B, an order taking 3 at A", async ({ page }) => {
  test.setTimeout(150_000);
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string) =>
    String((await ok(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);

  state.seller = await team(`E2E KMH Seller ${SUFFIX}`, `KMS${SUFFIX}`, "TEAM_TYPE_SELLING");
  state.viewer = await team(`E2E KMH Viewer ${SUFFIX}`, `KMV${SUFFIX}`, "TEAM_TYPE_SELLING");
  state.whA = await team(`E2E KMH Gudang A ${SUFFIX}`, WH_A, "TEAM_TYPE_WAREHOUSE");
  state.whB = await team(`E2E KMH Gudang B ${SUFFIX}`, WH_B, "TEAM_TYPE_WAREHOUSE");

  const category = (await ok(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E KMH ${SUFFIX}` })).category.id;
  const product = (
    await ok(page, "product.v1.ProductService/ProductCreate", {
      teamId: state.seller,
      productCodePart: `KMP${SUFFIX}`,
      name: NAME,
      categoryId: category,
    })
  ).product;
  state.product = String(product.id);
  state.code = String(product.productCode);

  // A restock is paid from an OPERATIONAL account of the seller's own (a-restock-names-its-paying-account).
  const account = String(
    (
      await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId: state.seller,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name: `E2E KMH restock ${SUFFIX}`,
        holderName: "E2E",
        accountNumber: `E2E-KMH-${SUFFIX}`,
        openingBalance: 14 * UNIT_COST,
        openingOn: jakartaToday(),
      })
    ).account.id,
  );
  await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: state.seller,
    accountId: account,
    operational: true,
  });

  // A restock of `count`, accepted onto a rack of the warehouse — that rack's id.
  const receive = async (warehouse: string, count: number) => {
    const rack = String((await ok(page, "inventory.v1.RackService/RackCreate", { teamId: warehouse, code: `kmh-${SUFFIX}` })).rack.id);
    const created = await ok(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
      teamId: state.seller,
      warehouseId: warehouse,
      financeAccountId: account,
      items: [{ productId: state.product, productCode: state.code, name: NAME, count, total: count * UNIT_COST }],
    });
    await ok(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
      teamId: warehouse,
      requestId: created.request.id,
      lines: [{ itemId: created.request.items[0].id, receivedCount: count, placements: [{ placementId: rack, quantity: count }] }],
    });

    return rack;
  };
  state.rackA = await receive(state.whA, 10);
  await receive(state.whB, 4);

  // An order of 3 shipped from A: its shop (root a member), A's rate, the seller's return warehouse.
  const shop = String(
    (
      await ok(page, "selling.v1.ShopService/ShopCreate", {
        teamId: state.seller,
        name: `E2E KMH Shop ${SUFFIX}`,
        shopCode: `KMH${SUFFIX}`,
        marketplace: "MARKETPLACE_SHOPEE",
      })
    ).shop.id,
  );
  await ok(page, "selling.v1.ShopService/ShopUserAdd", { teamId: state.seller, shopId: shop, userId: ROOT_USER_ID });
  await ok(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: state.whA, feePercent: 1, minFee: 0 });
  await ok(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", {
    teamId: state.seller,
    warehouseId: state.whA,
  });
  await ok(page, "selling.v1.OrderService/OrderCreate", {
    idempotencyKey: `e2e-kmh-${SUFFIX}`,
    // Every order names its courier (no-order-without-a-courier).
    shipmentChannelId: "1",
    teamId: state.seller,
    shopId: shop,
    warehouseId: state.whA,
    customerName: `E2E KMH Buyer ${SUFFIX}`,
    platformTotal: 60_000,
    platformCreatedAtUnix: Math.floor(Date.now() / 1000),
    orderExternalRefId: `KMR${SUFFIX}`,
    items: [{ productId: state.product, productCode: state.code, name: NAME, quantity: 3 }],
  });

  // The people: a CS of the viewer team, a staff of Gudang A.
  await ok(page, "user.v1.UserService/CreateUser", {
    teamId: state.viewer,
    username: VIEWER_CS,
    password: PASSWORD,
    name: `KMH Viewer CS ${SUFFIX}`,
    role: "ROLE_SELLING_CS",
  });
  await ok(page, "user.v1.UserService/CreateUser", {
    teamId: state.whA,
    username: WH_STAFF,
    password: PASSWORD,
    name: `KMH Gudang Staff ${SUFFIX}`,
    role: "ROLE_WAREHOUSE_STAFF",
  });

  // The fold has the restocks and the order's take: today ends on 11 on hand, the order's −3 among its kinds.
  await expect
    .poll(
      async () => {
        const res = await dailyMoves(page, state.seller);
        const body = res.body as DailyAnswer;

        return `${asDays(body)[0]?.balance} ${todaysKinds(body)["STOCK_CHANGE_TYPE_ORDER"] ?? 0}`;
      },
      { timeout: 45_000 },
    )
    .toBe("11 -3");
});

test("the product page's Keluar Masuk Harian: fourteen Jakarta days, today first, each adding up — every warehouse, then A, then B", async ({
  page,
}) => {
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);
  await useTeam(page, state.seller);
  await page.goto(`/products/${state.product}`);
  await expect(page.getByTestId("product-detail-page")).toBeVisible();
  const panel = page.getByTestId("pd-panel-daily");

  await test.step("regression: the Overview's Siap for every warehouse is the stock now — 11 pcs", async () => {
    await expect(page.getByTestId("pd-overview-row-ready")).toContainText(siap(11));
  });

  const answered = page.waitForResponse(dailyAnswer("0"));
  await page.getByTestId("pd-tab-daily").click();
  const all = await answerOf(await answered);

  await test.step("regression: the tab is real — the owning team asks ProductDailyMoves for the product; no pending mark", async () => {
    expect(all.asked.teamId).toBe(state.seller);
    expect(all.asked.filter.productId).toBe(state.product);
    await expect(page.getByTestId("not-implemented-daily")).toHaveCount(0);
    await expect(page.getByTestId("pending-row-daily")).toHaveCount(0);
  });

  await test.step("regression: every warehouse — today Masuk 14, Keluar 3, Sisa 11 (A + B); 13 empty days before it; each day adds up", async () => {
    const days = await settledTable(panel, { in: 14, out: 3, balance: 11 });
    expectAddsUp(days);
    // The table says what the server answered, day by day.
    expect(days).toEqual(asDays(all.body));
  });

  await test.step("regression: units only — no Rp in the panel, no value field on the wire", async () => {
    await expect(panel).not.toContainText("Rp");
    expectUnitsOnly(all.body);
  });

  await test.step("regression: the picker on Gudang A — A's numbers only: today Masuk 10, Keluar 3, Sisa 7, each day adding up", async () => {
    const inA = page.waitForResponse(dailyAnswer(state.whA));
    await pickTeam(page, page.getByTestId("pd-warehouse-filter"), WH_A);
    const a = await answerOf(await inA);
    expect(a.asked.teamId).toBe(state.seller);

    const days = await settledTable(panel, { in: 10, out: 3, balance: 7 });
    expectAddsUp(days);
    expect(days).toEqual(asDays(a.body));
    await expect(panel).not.toContainText("Rp");

    // Sisa today is A's stock now: the Overview under the same pick says 7 pcs ready.
    await page.getByTestId("pd-tab-overview").click();
    await expect(page.getByTestId("pd-overview-row-ready")).toContainText(siap(7));
    await page.getByTestId("pd-tab-daily").click();
    await settledTable(panel, { in: 10, out: 3, balance: 7 });
  });

  await test.step("regression: the picker on Gudang B — B's numbers only: today Masuk 4, nothing out, Sisa 4", async () => {
    const inB = page.waitForResponse(dailyAnswer(state.whB));
    await pickTeam(page, page.getByTestId("pd-warehouse-filter"), WH_B);
    await inB;

    const days = await settledTable(panel, { in: 4, out: 0, balance: 4 });
    expectAddsUp(days);

    await page.getByTestId("pd-tab-overview").click();
    await expect(page.getByTestId("pd-overview-row-ready")).toContainText(siap(4));
  });
});

test("the Discover detail's Keluar Masuk Harian: another team reads the owner's units — same days, no Rp, no value on the wire, narrowed by the picker", async ({
  page,
}) => {
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  // The owner's own answer, to compare against.
  const owner = asDays((await ok(page, "inventory.v1.InventoryService/ProductDailyMoves", {
    teamId: state.seller,
    filter: { productId: state.product },
    dataRequest: ["PRODUCT_DAILY_MOVES_DATA_TYPE_DAY"],
  })) as DailyAnswer);

  await useTeam(page, state.viewer);
  await page.goto(`/products/discover/${state.product}`);
  await expect(page.getByTestId("discover-detail-page")).toBeVisible();
  const panel = page.getByTestId("dd-panel-daily");

  const answered = page.waitForResponse(dailyAnswer("0"));
  await page.getByTestId("dd-tab-daily").click();
  const all = await answerOf(await answered);

  await test.step("regression: the viewer team asks, and the days are the OWNER's — today 14 in, 3 out, 11 on hand, each day adding up", async () => {
    expect(all.asked.teamId).toBe(state.viewer);
    expect(all.asked.filter.productId).toBe(state.product);
    const days = await settledTable(panel, { in: 14, out: 3, balance: 11 });
    expectAddsUp(days);
    expect(days).toEqual(owner);
    expect(asDays(all.body)).toEqual(owner);
    await expect(page.getByTestId("not-implemented-daily")).toHaveCount(0);
    await expect(page.getByTestId("pending-row-daily")).toHaveCount(0);
  });

  await test.step("regression: units only — no Rp anywhere in the panel, no value field in the answer", async () => {
    await expect(panel).not.toContainText("Rp");
    expectUnitsOnly(all.body);
  });

  await test.step("regression: the card's picker on Gudang B narrows it — B's 4 in, nothing out, 4 on hand", async () => {
    const inB = page.waitForResponse(dailyAnswer(state.whB));
    await pickTeam(page, page.getByTestId("dd-warehouse-filter"), WH_B);
    const b = await answerOf(await inB);
    expect(b.asked.teamId).toBe(state.viewer);

    const days = await settledTable(panel, { in: 4, out: 0, balance: 4 });
    expectAddsUp(days);
    expectUnitsOnly(b.body);
    await expect(panel).not.toContainText("Rp");
  });

  await test.step("regression: on Gudang A — A's 10 in, 3 out, 7 on hand", async () => {
    const inA = page.waitForResponse(dailyAnswer(state.whA));
    await pickTeam(page, page.getByTestId("dd-warehouse-filter"), WH_A);
    await inA;

    expectAddsUp(await settledTable(panel, { in: 10, out: 3, balance: 7 }));
  });
});

test("ProductDailyMoves: a person of another selling team reads the owner's days in units, per warehouse; a warehouse is refused", async ({
  page,
  browser,
}) => {
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);
  const ownerAll = (await ok(page, "inventory.v1.InventoryService/ProductDailyMoves", {
    teamId: state.seller,
    filter: { productId: state.product },
    dataRequest: ["PRODUCT_DAILY_MOVES_DATA_TYPE_DAY"],
  })) as DailyAnswer;
  const ownerA = (await dailyMoves(page, state.seller, state.whA)).body as DailyAnswer;

  const cs = await browser.newPage();
  await signIn(cs, VIEWER_CS, PASSWORD);
  await useTeam(cs, state.viewer);

  await test.step("regression: the viewer team's CS reads the owner's fourteen days — the owner's own Masuk, Keluar and Sisa", async () => {
    const res = await dailyMoves(cs, state.viewer);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = res.body as DailyAnswer;
    expect(asDays(body)).toEqual(asDays(ownerAll));
    expectFourteen(asDays(body), { in: 14, out: 3, balance: 11 });
    expectAddsUp(asDays(body));
    expectUnitsOnly(body);
  });

  await test.step("regression: each change type's net on today — RESTOCK +14, ORDER −3, summing to the day's change of Sisa", async () => {
    const body = (await dailyMoves(cs, state.viewer)).body as DailyAnswer;
    const kinds = todaysKinds(body);
    expect(kinds).toEqual({ STOCK_CHANGE_TYPE_RESTOCK: 14, STOCK_CHANGE_TYPE_ORDER: -3 });
    const [today, yesterday] = asDays(body);
    expect(Object.values(kinds).reduce((a, b) => a + b, 0)).toBe(today!.balance - yesterday!.balance);
  });

  await test.step("regression: the warehouse filter narrows it for them too — Gudang A's 10 in, 3 out, 7 on hand", async () => {
    const res = await dailyMoves(cs, state.viewer, state.whA);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = res.body as DailyAnswer;
    expect(asDays(body)).toEqual(asDays(ownerA));
    expectFourteen(asDays(body), { in: 10, out: 3, balance: 7 });
    expect(todaysKinds(body)).toEqual({ STOCK_CHANGE_TYPE_RESTOCK: 10, STOCK_CHANGE_TYPE_ORDER: -3 });
  });
  await cs.close();

  await test.step("regression: a warehouse person is refused — a warehouse has no product page (ProductSupplierGoods' policy)", async () => {
    const staff = await browser.newPage();
    await signIn(staff, WH_STAFF, PASSWORD);
    await useTeam(staff, state.whA);
    const res = await dailyMoves(staff, state.whA);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.code).toBe("permission_denied");
    await staff.close();
  });
});

test("a sample of 1 off Gudang A's rack: today's Sisa drops by it, Masuk and every earlier day untouched", async ({ page }) => {
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);
  await ok(page, "inventory.v1.RackService/RackSample", {
    teamId: state.whA,
    rackId: state.rackA,
    lines: [{ productId: state.product, quantity: 1 }],
    recipient: `Pak KMH ${SUFFIX}`,
  });

  // Sisa is read from the shelves — whatever Q2 decides about Masuk and Keluar. Keluar and "the day adds up" are NOT
  // pinned here: a sample's side is the owner's open question (option B would leave it out of both).
  await test.step("regression: the server's today — Sisa 10 every warehouse, 6 at A; Masuk still 14 / 10; the sample's −1 among the kinds", async () => {
    await expect
      .poll(async () => asDays((await dailyMoves(page, state.seller)).body as DailyAnswer)[0]?.balance, { timeout: 45_000 })
      .toBe(10);
    const all = (await dailyMoves(page, state.seller)).body as DailyAnswer;
    expectFourteen(asDays(all), { in: 14, balance: 10 });
    expect(todaysKinds(all)["STOCK_CHANGE_TYPE_SAMPLE"]).toBe(-1);
    expectUnitsOnly(all);

    const inA = (await dailyMoves(page, state.seller, state.whA)).body as DailyAnswer;
    expectFourteen(asDays(inA), { in: 10, balance: 6 });
  });

  await test.step("regression: the product page says it — every warehouse Sisa 10, Gudang A Sisa 6, earlier days empty", async () => {
    await useTeam(page, state.seller);
    await page.goto(`/products/${state.product}`);
    await expect(page.getByTestId("product-detail-page")).toBeVisible();
    const panel = page.getByTestId("pd-panel-daily");
    await page.getByTestId("pd-tab-daily").click();
    await settledTable(panel, { in: 14, balance: 10 });

    await pickTeam(page, page.getByTestId("pd-warehouse-filter"), WH_A);
    await settledTable(panel, { in: 10, balance: 6 });
    await expect(panel).not.toContainText("Rp");

    // Gudang B never saw the sample: its day still adds up, 4 in and 4 on hand.
    await pickTeam(page, page.getByTestId("pd-warehouse-filter"), WH_B);
    expectAddsUp(await settledTable(panel, { in: 4, out: 0, balance: 4 }));
  });
});
