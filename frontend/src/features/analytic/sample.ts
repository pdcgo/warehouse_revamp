// ⚠ SAMPLE — INVENTED ROWS. Every live metric is served now (the expense metrics last, 2026-11-06): these facts are
// what the Storybook stubs answer the served RPCs with — OrderAnalyticService, InventoryAnalyticService,
// ExpenseAnalyticService — so a story reads stable numbers through the wire; and a PROTOTYPE metric (catalogue.ts) reads
// them until its service ships. The two SETTLEMENT metrics have no facts here: their stub folds the settlement book in
// .storybook/fixtures.ts, because a position is not a sum of days.
//
// The rows are generated, not typed: one fact per day per shop / product, from 2025-01-01 to today, drawn from a seeded
// hash so every run — and every story — sees the same numbers for the same window.
//
// One shop is shaped on purpose, from the owner's own example (rpc_provide.md §Example Use Case In UI): Toko Satria, many
// cheap orders and NO settlement — sorted by a settlement figure, it is not a row, and the settlement book's shops are
// (the-rows-are-the-keys-step-one-sends made visible: the service that ranks decides the rows). Toko Lama sells nothing.

import { jakartaToday } from "../../lib/jakartaDay";
import { daySpine } from "../../lib/period";

export interface SampleEntity {
  id: string;
  name: string;
}

export interface SampleProduct extends SampleEntity {
  supplier: string;
  price: number;
}

export const SAMPLE_SHOPS: SampleEntity[] = [
  { id: "11", name: "Toko Maryam" },
  { id: "12", name: "Toko Baru Segu" },
  { id: "13", name: "Toko Satria" },
  { id: "14", name: "Toko Lama" },
  { id: "15", name: "Toko Melati" },
  { id: "16", name: "Toko Sinar" },
];

// Toko Melati's own suppliers, named as the Storybook stub's SupplierByIds names them (.storybook/supplierFixtures.ts) —
// Lost stock is served, so its supplier rows are named by that lookup, and the filter's picks must read the same.
export const SAMPLE_SUPPLIERS: SampleEntity[] = [
  { id: "31", name: "PT Sumber Makmur" },
  { id: "32", name: "CV Cahaya Abadi" },
  { id: "33", name: "Toko Grosir Sinar" },
];

export const SAMPLE_PRODUCTS: SampleProduct[] = [
  { id: "201", name: "Kaos Polos Hitam", supplier: "32", price: 45_000 },
  { id: "202", name: "Kemeja Flanel", supplier: "32", price: 120_000 },
  { id: "203", name: "Botol Minum 1L", supplier: "33", price: 6_500 },
  { id: "204", name: "Kotak Makan", supplier: "33", price: 7_000 },
  { id: "205", name: "Sepatu Kanvas", supplier: "31", price: 180_000 },
  { id: "206", name: "Tas Selempang", supplier: "31", price: 95_000 },
];

/** What each shop sells, and how often a day has an order for it. Toko Lama sells nothing in this window. */
const SHOP_PROFILE: Record<string, { products: string[]; chance: number; most: number }> = {
  "11": { products: ["202", "205", "206"], chance: 0.35, most: 3 },
  "12": { products: ["201", "203"], chance: 0.3, most: 3 },
  "13": { products: ["203", "204"], chance: 0.85, most: 4 },
  "14": { products: [], chance: 0, most: 0 },
  "15": { products: ["201", "202", "206"], chance: 0.35, most: 3 },
  "16": { products: ["204", "205"], chance: 0.3, most: 2 },
};

/** Where each product's lost stock sat — Toko Melati's stock, in two warehouses (Gudang Pusat 11, Gudang Cabang 14). */
export const SAMPLE_LOST_WAREHOUSE: Record<string, string> = { "201": "11", "202": "11", "203": "11", "204": "14", "205": "14", "206": "11" };

/** The shops that buy ads. */
const ADS_SHOPS = ["11", "12", "15"];

/**
 * Two ads on Toko Sinar (16), a shop that buys no other ads, each corrected later. In Analytic
 * a correction counts ON THE DAY IT IS MADE (an-expense-correction-counts-on-the-day-it-is-made) and for THE PERSON WHO
 * MADE IT (an-expense-correction-counts-for-who-made-it), so each entry is a fact of its own day and its own person, and
 * past days never change:
 *   14 Oct  +Rp 500.000   typed by Budi (62)                  → 14 Oct reads Rp 500.000
 *   20 Oct  −Rp 450.000   Dewi (64) corrects it to 50.000     → 20 Oct reads −Rp 450.000, under Dewi
 *   16 Oct  +Rp 200.000   typed by Budi                       → 16 Oct reads Rp 200.000
 *   17 Oct  −Rp 200.000   Budi cancels it                     → 17 Oct reads −Rp 200.000 (a cancel, on the cancel day)
 * October nets Rp 50.000. The Expenses page, the statement and the paying account keep each on its expense's day
 * (an-expense-posts-on-its-own-day) — Analytic alone moves it.
 */
const ADS_CORRECTED: { day: string; amount: number; user: string }[] = [
  { day: "2026-10-14", amount: 500_000, user: "62" },
  { day: "2026-10-20", amount: -450_000, user: "64" },
  { day: "2026-10-16", amount: 200_000, user: "62" },
  { day: "2026-10-17", amount: -200_000, user: "62" },
];

/** A second seller, Toko Kenanga (13), with a little rent and payroll: root reads both. */
const SAMPLE_OTHER_SELLER = "13";

/** The last day of its month? Payroll is filed under the month it pays for — typed on the 5th, it belongs to the 30th. */
function lastOfMonth(day: string): boolean {
  const next = new Date(`${day}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);

  return next.getUTCDate() === 1;
}

const SAMPLE_START = "2025-01-01";

/** One day's figures for one shop, product or supplier — or for the whole team, when none is named. */
export interface Fact {
  day: string;
  shop?: string;
  product?: string;
  supplier?: string;
  /** The seller, the warehouse that ships and the order's creator — the order metrics' other keys. */
  team?: string;
  warehouse?: string;
  user?: string;
  /**
   * The team whose fact it is, for a metric a READER scopes (the expense metrics: a team reads its own, root every
   * team's — expenseAnalyticStub.ts). Absent: every reader sees it.
   */
  owner?: string;
  /**
   * The teams that read it, beside root — a fact two teams share (an order status move: the seller and the warehouse
   * that ships it, as selling_service scopes it — the stub passes its caller; a restock's: the seller and the warehouse
   * it goes to). Absent with `owner` absent: every reader.
   */
  readers?: string[];
  values: Record<string, number>;
}

/**
 * THE ORDER FACTS' SELLER, WAREHOUSE AND CREATORS — the Storybook fixtures' own: Toko Melati (12) sells, Gudang Pusat
 * (11) ships, and three of its people place the orders, so a story grouped by team, warehouse or user names real rows.
 */
export const SAMPLE_SELLER = "12";
export const SAMPLE_WAREHOUSE = "11";
const SAMPLE_CREATORS = ["61", "62", "65"];

/** What the platform says the buyer paid, for a figure we priced at `total` — a little above our cost. */
const mpOf = (total: number) => Math.round(total * 1.12);

/** The four moves after a placement, each a chance per placed order, counted on the placement's day for the sample. */
const ORDER_MOVES: { metricId: string; prefix: string; mp: string; chance: number }[] = [
  { metricId: "metrics/orders/cancelled", prefix: "cancel", mp: "mp_total", chance: 0.08 },
  { metricId: "metrics/orders/return_created", prefix: "return_created", mp: "return_created_mp_total", chance: 0.05 },
  { metricId: "metrics/orders/return_arrived", prefix: "return_arrived", mp: "return_arrived_mp_total", chance: 0.03 },
  { metricId: "metrics/orders/lost_created", prefix: "lost_created", mp: "lost_created_mp_total", chance: 0.01 },
];

/** A number in [0, 1), the same for the same seed on every run — FNV-1a, then an avalanche. */
function seeded(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;

  return (h >>> 0) / 4294967296;
}

/** A day `n` days after `day`. */
function addDay(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);

  return d.toISOString().slice(0, 10);
}

const between = (seed: string, low: number, high: number) => low + Math.floor(seeded(seed) * (high - low + 1));

// ── ORDER STATUS MOVES — served by selling_service; the Storybook stub (orderAnalyticStub.ts) answers from these ──

/**
 * One placed order's moves after the placement, each on ITS OWN day (a-fact-counts-on-the-day-it-happened), under the
 * order's shop, seller, warehouse and creator (a-metrics-user-is-the-orders-creator): confirmed the day it is placed;
 * one in twenty handed back to pending that day (goods on no rack) and confirmed again the next; picked, handed to the
 * courier, shipped by the platform; then completed — or a problem first, most of which are resolved to completed. A
 * move still to come is not a fact yet. Returns, losses and cancels are the five metrics' own, not drawn here.
 */
function orderMoves(order: string, placed: string, today: string): { day: string; field: string }[] {
  const out: { day: string; field: string }[] = [{ day: placed, field: "confirmed_count" }];

  let ready = placed;
  if (seeded(`mvb|${order}`) < 0.05) {
    out.push({ day: placed, field: "back_to_pending_count" });
    ready = addDay(placed, 1);
    out.push({ day: ready, field: "confirmed_count" });
  }

  const picked = addDay(ready, 1);
  const handed = addDay(picked, seeded(`mvh|${order}`) < 0.6 ? 0 : 1);
  const shipped = addDay(handed, 1);
  out.push({ day: picked, field: "picked_count" }, { day: handed, field: "handed_over_count" }, { day: shipped, field: "shipped_count" });

  const fate = seeded(`mvf|${order}`);
  if (fate < 0.06) {
    const problem = addDay(shipped, 3);
    out.push({ day: problem, field: "problem_count" });
    if (seeded(`mvr|${order}`) < 0.7) out.push({ day: addDay(problem, 4), field: "completed_count" });
  } else if (fate >= 0.1) {
    out.push({ day: addDay(shipped, between(`mvc|${order}`, 3, 6)), field: "completed_count" });
  }

  return out.filter((m) => m.day <= today);
}

// ── ⚠ PROTOTYPE #85 — RESTOCK BEFORE THE ACCEPT ──────────────────────────────────────────────────

/** A restock's state: where it goes, its lines (product → units) and the shipping its team paid. */
interface RestockState {
  warehouse: string;
  lines: Record<string, number>;
  shipping: number;
}

/** One step of a restock's life — what changed on that day. */
type RestockStep =
  | { day: string; kind: "create"; state: RestockState }
  | { day: string; kind: "edit"; state: Partial<RestockState> }
  | { day: string; kind: "lost" | "cancel" | "arrive" }
  | { day: string; kind: "accept"; broken?: Record<string, number>; missing?: Record<string, number>; cod?: number };

/**
 * THE WORKED RESTOCKS OF OCTOBER 2026 — Toko Melati's (12), each step on its own day, so a story reads every rule on a
 * day of its own (1–20 Oct; nothing else restocks in those days):
 *   R6  1 Oct  ordered 5 × 202, ongkir 15.000 · lost 5 Oct · the box turns up 18 Oct · accepted 19 Oct, COD 5.000
 *   R7  2 Oct  ordered 6 × 205, ongkir 12.000 · arrived 7 Oct · edited while arrived 9 Oct: + 2 × 206 · accepted 12 Oct
 *   R1  6 Oct  ordered 20 × 201 + 10 × 202, ongkir 30.000 · edited 8 Oct: 201 20 → 30 · accepted 10 Oct: 1 × 202
 *              broken, 2 × 201 missing, COD 20.000
 *   R5  7 Oct  ordered 10 × 201, ongkir 10.000 · cancelled 11 Oct
 *   R2 12 Oct  ordered 10 × 205 to Gudang Cabang, ongkir 20.000 · edited 13 Oct: to Gudang Pusat · accepted 16 Oct
 *   R3 14 Oct  ordered 4 × 206, ongkir 20.000 · lost 17 Oct
 *   R4 15 Oct  ordered 50 × 203 + 50 × 204, ongkir 20.000 · edited 16 Oct: ongkir → 35.000 · accepted 20 Oct: 3 × 204
 *              missing, COD 10.000
 * Gudang Pusat (11) unless named.
 */
export const SAMPLE_RESTOCKS_OCTOBER: RestockStep[][] = [
  [
    { day: "2026-10-01", kind: "create", state: { warehouse: "11", lines: { "202": 5 }, shipping: 15_000 } },
    { day: "2026-10-05", kind: "lost" },
    { day: "2026-10-18", kind: "arrive" },
    { day: "2026-10-19", kind: "accept", cod: 5_000 },
  ],
  [
    { day: "2026-10-02", kind: "create", state: { warehouse: "11", lines: { "205": 6 }, shipping: 12_000 } },
    { day: "2026-10-07", kind: "arrive" },
    { day: "2026-10-09", kind: "edit", state: { lines: { "205": 6, "206": 2 } } },
    { day: "2026-10-12", kind: "accept" },
  ],
  [
    { day: "2026-10-06", kind: "create", state: { warehouse: "11", lines: { "201": 20, "202": 10 }, shipping: 30_000 } },
    { day: "2026-10-08", kind: "edit", state: { lines: { "201": 30, "202": 10 } } },
    { day: "2026-10-10", kind: "accept", broken: { "202": 1 }, missing: { "201": 2 }, cod: 20_000 },
  ],
  [
    { day: "2026-10-07", kind: "create", state: { warehouse: "11", lines: { "201": 10 }, shipping: 10_000 } },
    { day: "2026-10-11", kind: "cancel" },
  ],
  [
    { day: "2026-10-12", kind: "create", state: { warehouse: "14", lines: { "205": 10 }, shipping: 20_000 } },
    { day: "2026-10-13", kind: "edit", state: { warehouse: "11" } },
    { day: "2026-10-16", kind: "accept" },
  ],
  [
    { day: "2026-10-14", kind: "create", state: { warehouse: "11", lines: { "206": 4 }, shipping: 20_000 } },
    { day: "2026-10-17", kind: "lost" },
  ],
  [
    { day: "2026-10-15", kind: "create", state: { warehouse: "11", lines: { "203": 50, "204": 50 }, shipping: 20_000 } },
    { day: "2026-10-16", kind: "edit", state: { shipping: 35_000 } },
    { day: "2026-10-20", kind: "accept", missing: { "204": 3 }, cod: 10_000 },
  ],
];

/** The days the worked restocks own — the background never restocks in them. */
const OCTOBER_SHOWCASE = { from: "2026-10-01", to: "2026-10-20" };

/** A product's price — what the sample's restock lines pay per unit. */
const priceOf = (product: string) => SAMPLE_PRODUCTS.find((p) => p.id === product)!.price;

/**
 * A state's figures per product: its units, and its value — the restock's total, the goods plus the shipping its team
 * paid (the-couriers-charge-stays-out-of-total), the shipping spread over the units as the landed price spreads it
 * (restock.md §Calculating Price Unit), so the products' rows add up to the restock.
 */
function orderedOf(state: RestockState): Map<string, { units: number; value: number }> {
  const units = Object.values(state.lines).reduce((s, n) => s + n, 0);
  const out = new Map<string, { units: number; value: number }>();
  for (const [product, n] of Object.entries(state.lines)) {
    out.set(product, { units: n, value: n * priceOf(product) + (units > 0 ? (state.shipping * n) / units : 0) });
  }

  return out;
}

/**
 * One restock's facts, each step on its own day: ordered units and value on the create day; an edit's DIFFERENCE on the
 * edit day — a warehouse change takes it out under the old warehouse and puts it in under the new one that day; a cancel
 * takes the ordered back on its day (⚠ the build's default, asked at the accept); lost on the lost day, taken back on the
 * day a lost box turns up (⚠ the build's default, asked at the accept); at the accept the accepted four as served —
 * accepted units at the landed price ((shipping + COD) / units added to each unit), broken, missing — and the COD, spread
 * like the shipping. Read by the seller and the warehouse the fact is under (and root).
 */
function restockFacts(steps: RestockStep[], today: string): Fact[] {
  const out: Fact[] = [];
  let state: RestockState | undefined;

  const push = (day: string, warehouse: string, product: string, values: Record<string, number>) => {
    if (day > today) return;
    out.push({
      day,
      product,
      supplier: SAMPLE_PRODUCTS.find((p) => p.id === product)!.supplier,
      team: SAMPLE_SELLER,
      warehouse,
      readers: [SAMPLE_SELLER, warehouse],
      values,
    });
  };
  const ordered = (day: string, s: RestockState, sign: 1 | -1) => {
    for (const [product, f] of orderedOf(s)) push(day, s.warehouse, product, { ordered_count: sign * f.units, ordered_value: sign * f.value });
  };

  for (const step of steps) {
    if (step.kind === "create") {
      state = step.state;
      ordered(step.day, state, 1);
      continue;
    }
    if (!state) continue;

    if (step.kind === "edit") {
      const next: RestockState = { ...state, ...step.state };
      ordered(step.day, state, -1);
      ordered(step.day, next, 1);
      state = next;
    } else if (step.kind === "cancel") {
      ordered(step.day, state, -1);
    } else if (step.kind === "lost" || step.kind === "arrive") {
      // A lost box that turns up (lost → arrived, a-late-lost-box-is-signed-for-as-arrived) is no longer lost; an
      // ordinary arrival counts nothing.
      const wasLost = steps.some((s) => s.kind === "lost" && s.day < step.day);
      if (step.kind === "arrive" && !wasLost) continue;
      const sign = step.kind === "lost" ? 1 : -1;
      for (const [product, f] of orderedOf(state)) push(step.day, state.warehouse, product, { lost_count: sign * f.units, lost_value: sign * f.value });
    } else if (step.kind === "accept") {
      const units = Object.values(state.lines).reduce((s, n) => s + n, 0);
      const cod = step.cod ?? 0;
      const landedExtra = (state.shipping + cod) / units;
      for (const [product, n] of Object.entries(state.lines)) {
        const broken = step.broken?.[product] ?? 0;
        const missing = step.missing?.[product] ?? 0;
        const accepted = n - broken - missing;
        push(step.day, state.warehouse, product, {
          accepted_count: accepted,
          accepted_value: accepted * (priceOf(product) + landedExtra),
          broken_count: broken,
          missing_count: missing,
          cod_amount: (cod * n) / units,
        });
      }
    }
  }

  return out;
}

/**
 * The background: a restock every few days from 2026-01-01, outside the worked days — mostly to Gudang Pusat, one to
 * three products, sometimes edited, now and then lost or cancelled, else accepted within a week, a COD on some. Its
 * shipping and COD are whole rupiah per unit, so every spread figure stays whole.
 */
function backgroundRestocks(today: string): RestockStep[][] {
  const out: RestockStep[][] = [];
  const products = SAMPLE_PRODUCTS.map((p) => p.id);

  for (const day of daySpine("2026-01-01", today)) {
    if (seeded(`rs|${day}`) >= 0.3) continue;
    // Every step within eight days, so none reaches into the worked days.
    if (day > addDay(OCTOBER_SHOWCASE.from, -9) && day <= OCTOBER_SHOWCASE.to) continue;

    const lines: Record<string, number> = {};
    const count = between(`rsn|${day}`, 1, 3);
    for (let i = 0; i < count; i++) lines[products[between(`rsp|${day}|${i}`, 0, products.length - 1)]!] = between(`rsu|${day}|${i}`, 10, 40);
    const perUnit = 500 * between(`rss|${day}`, 1, 3);
    const unitsOf = (l: Record<string, number>) => Object.values(l).reduce((s, n) => s + n, 0);
    const create: RestockStep = {
      day,
      kind: "create",
      state: { warehouse: seeded(`rsw|${day}`) < 0.75 ? "11" : "14", lines, shipping: perUnit * unitsOf(lines) },
    };
    const steps: RestockStep[] = [create];
    let units = unitsOf(lines);

    if (seeded(`rse|${day}`) < 0.3) {
      const first = Object.keys(lines)[0]!;
      const edited = { ...lines, [first]: lines[first]! + between(`rsd|${day}`, -5, 10) };
      units = unitsOf(edited);
      steps.push({ day: addDay(day, 2), kind: "edit", state: { lines: edited, shipping: perUnit * units } });
    }

    const fate = seeded(`rsf|${day}`);
    if (fate < 0.05) steps.push({ day: addDay(day, between(`rsl|${day}`, 3, 6)), kind: "lost" });
    else if (fate < 0.1) steps.push({ day: addDay(day, 3), kind: "cancel" });
    else {
      const product = Object.keys(lines)[0]!;
      steps.push({
        day: addDay(day, between(`rsa|${day}`, 4, 7)),
        kind: "accept",
        broken: seeded(`rsb|${day}`) < 0.25 ? { [product]: 1 } : undefined,
        missing: seeded(`rsm|${day}`) < 0.15 ? { [product]: between(`rsmc|${day}`, 1, 2) } : undefined,
        cod: seeded(`rsc|${day}`) < 0.4 ? 250 * units * between(`rscc|${day}`, 1, 4) : undefined,
      });
    }
    out.push(steps);
  }

  return out;
}

function build(): Record<string, Fact[]> {
  const today = jakartaToday();
  const days = daySpine(SAMPLE_START, today);
  const facts: Record<string, Fact[]> = {
    "metrics/orders/created": [],
    ...Object.fromEntries(ORDER_MOVES.map((m) => [m.metricId, []])),
    // Served by inventory_service; the Storybook stub (inventoryAnalyticStub.ts) answers it from these facts.
    "metrics/inventory/lost": [],
    // Served by expense_service; the Storybook stub (expenseAnalyticStub.ts) answers them from these facts.
    "metrics/ads": [],
    "metrics/expenses": [],
    // Served by selling_service; the Storybook stub answers them from these facts.
    "metrics/warehouse_fee": [],
    "metrics/orders/moves": [],
    // ⚠ PROTOTYPES (catalogue.ts PROTOTYPE_METRICS) — read only while a story shows them.
    "metrics/inventory/restock": [...SAMPLE_RESTOCKS_OCTOBER, ...backgroundRestocks(jakartaToday())].flatMap((r) =>
      restockFacts(r, jakartaToday()),
    ),
  };

  for (const day of days) {
    const adsToday: Fact[] = [];

    for (const shop of SAMPLE_SHOPS) {
      const profile = SHOP_PROFILE[shop.id]!;

      for (const productId of profile.products) {
        if (seeded(`o|${day}|${shop.id}|${productId}`) >= profile.chance) continue;

        const product = SAMPLE_PRODUCTS.find((p) => p.id === productId)!;
        const count = 1 + Math.floor(seeded(`oc|${day}|${shop.id}|${productId}`) * profile.most);
        const total = count * product.price;
        const who = {
          day,
          shop: shop.id,
          team: SAMPLE_SELLER,
          warehouse: SAMPLE_WAREHOUSE,
          user: SAMPLE_CREATORS[Number(shop.id) % SAMPLE_CREATORS.length]!,
        };

        facts["metrics/orders/created"]!.push({
          ...who,
          values: { created_count: count, created_total: total, mp_total: mpOf(total) },
        });

        // The warehouse fee, frozen on each placed order: 2.5% of its goods, at least Rp 2.500 — charged on the
        // placement's day, to the seller, by the warehouse that ships. The sample draws no cancel; the server takes one
        // back on the cancel's day (a-warehouse-fee-counts-on-its-day-and-a-cancel-takes-it-back-on-its-day).
        facts["metrics/warehouse_fee"]!.push({
          ...who,
          values: { transaction_count: count, amount: count * Math.max(2_500, Math.round(product.price * 0.025)) },
        });

        // ORDER STATUS MOVES — each of the placed orders' status moves, on the day it happened, read by the seller and
        // the warehouse that ships it (and root).
        for (let i = 0; i < count; i++) {
          for (const move of orderMoves(`${day}|${shop.id}|${productId}|${i}`, day, today)) {
            facts["metrics/orders/moves"]!.push({ ...who, day: move.day, readers: [SAMPLE_SELLER, SAMPLE_WAREHOUSE], values: { [move.field]: 1 } });
          }
        }

        for (const move of ORDER_MOVES) {
          if (seeded(`${move.prefix}|${day}|${shop.id}|${productId}`) >= move.chance) continue;

          facts[move.metricId]!.push({
            ...who,
            values: {
              [`${move.prefix}_count`]: 1,
              [`${move.prefix}_total`]: product.price,
              [move.mp]: mpOf(product.price),
            },
          });
        }
      }

      if (ADS_SHOPS.includes(shop.id) && seeded(`a|${day}|${shop.id}`) < 0.6) {
        const spend = Math.round(20_000 + 130_000 * seeded(`as|${day}|${shop.id}`));
        // Ads expense (the owner's tree: `amount`, filtered by team, shop, user): Toko Melati's, typed by one of its
        // people, read by Toko Melati and root.
        const user = SAMPLE_CREATORS[Number(shop.id) % SAMPLE_CREATORS.length]!;
        adsToday.push({ day, shop: shop.id, team: SAMPLE_SELLER, user, owner: SAMPLE_SELLER, values: { amount: spend } });
      }
    }

    // Toko Sinar's ads and their corrections, each on the day it was made, by whoever made
    // it; then the typed kinds of Toko Melati's, Toko Kenanga's and Gudang Pusat's expenses, each read by its own team
    // (and root). A seller's expense sits under Seller (`team`), a warehouse team's under Warehouse (`warehouse`) —
    // the-expense-metrics-follow-the-decisions-already-made. No STOCK_LOSS: it stays out of Analytic's expenses
    // (stock-loss-stays-out-of-analytic-expenses).
    for (const entry of ADS_CORRECTED.filter((c) => c.day === day)) {
      adsToday.push({ day, shop: "16", team: SAMPLE_SELLER, user: entry.user, owner: SAMPLE_SELLER, values: { amount: entry.amount } });
    }
    facts["metrics/ads"]!.push(...adsToday);

    const expense = (side: { team: string } | { warehouse: string }, user: string, kind: string, amount: number) =>
      facts["metrics/expenses"]!.push({
        day,
        ...side,
        user,
        owner: "team" in side ? side.team : side.warehouse,
        values: { [kind]: amount, total: amount },
      });
    const melati = { team: SAMPLE_SELLER };
    const kenanga = { team: SAMPLE_OTHER_SELLER };
    const pusat = { warehouse: SAMPLE_WAREHOUSE };

    for (const ad of adsToday) expense(melati, ad.user!, "ads", ad.values.amount!);
    if (lastOfMonth(day)) expense(melati, "61", "payroll", 7_500_000);
    if (day.endsWith("-01")) expense(melati, "62", "operational", 2_500_000);
    if (day.endsWith("-10")) expense(melati, "62", "operational", 450_000 + Math.round(300_000 * seeded(`eu|${day}`)));
    if (seeded(`eo|${day}`) < 0.08) expense(melati, "65", "other", 50_000 + Math.round(300_000 * seeded(`eoa|${day}`)));

    if (lastOfMonth(day)) expense(kenanga, "68", "payroll", 4_000_000);
    if (day.endsWith("-01")) expense(kenanga, "68", "operational", 1_500_000);

    // Gudang Pusat's own: its staff's pay (Dewi, the owner), the building's rent and power (Budi), packing supplies (Eko).
    if (lastOfMonth(day)) expense(pusat, "64", "payroll", 6_000_000);
    if (day.endsWith("-01")) expense(pusat, "62", "operational", 3_000_000);
    if (day.endsWith("-10")) expense(pusat, "62", "operational", 600_000 + Math.round(400_000 * seeded(`wu|${day}`)));
    if (seeded(`wo|${day}`) < 0.1) expense(pusat, "65", "other", 40_000 + Math.round(200_000 * seeded(`woa|${day}`)));

    for (const product of SAMPLE_PRODUCTS) {
      if (seeded(`l|${day}|${product.id}`) >= 0.06) continue;

      const lost = 1 + Math.floor(seeded(`lc|${day}|${product.id}`) * 3);
      facts["metrics/inventory/lost"]!.push({
        day,
        product: product.id,
        supplier: product.supplier,
        // The seller is the team owning the stock, the warehouse the one that held it
        // (inventory-lost-groups-and-sits-under-inventory).
        team: SAMPLE_SELLER,
        warehouse: SAMPLE_LOST_WAREHOUSE[product.id]!,
        values: { lost_count: lost, lost_amount: lost * product.price },
      });
    }
  }

  return facts;
}

let cache: Record<string, Fact[]> | undefined;

/** Every invented fact of one metric. Built once per page load. */
export function sampleFacts(metricId: string): Fact[] {
  cache ??= build();

  return cache[metricId] ?? [];
}

/** The name of a shop, product or supplier — what the real screen will ask ShopByIds, ProductByIds, SupplierByIds. */
export function sampleName(kind: "shop" | "product" | "supplier", id: string): string {
  const list = kind === "shop" ? SAMPLE_SHOPS : kind === "product" ? SAMPLE_PRODUCTS : SAMPLE_SUPPLIERS;

  return list.find((e) => e.id === id)?.name ?? `#${id}`;
}
