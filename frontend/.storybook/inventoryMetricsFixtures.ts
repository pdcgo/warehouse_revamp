// THE FOUR INVENTORY METRICS' FIGURES for Storybook — Restock, Transfer, Returned stock and Ready stock as
// inventory_service serves them (the-inventory-metrics-prototype-is-accepted), answered over the stub transport by
// inventoryAnalyticStub.ts. The accepted prototype's own sample, kept so the live stories draw the accepted pictures.
//
// THE SAMPLE is one simulation of Toko Melati's (12) stock in Gudang Pusat (11, where orders ship and returns land) and
// Gudang Cabang (14, a reserve), day by day from SAMPLE_START: each product's daily orders and the sample's lost stock
// take units out, restocks refill a shelf that runs low, transfers move units between the two, returns put units back.
// So every figure here agrees with every other: Ready moves by exactly what the flows moved.
//
// READ AS THE SERVER READS (inventory_v1/inventory_metric_*.go):
//   · who reads — the warehouse the fact happened in and the seller owning the goods, the root team every one; any
//     other team nothing (`warehouse_id = T OR team_id = T`);
//   · a WAREHOUSE is given units only on Restock, Transfer and Returned stock — their value fields are LEFT OUT (unset),
//     and ranking by one is refused; Ready's value it is given (a-warehouse-sees-ready-value-but-a-shelf-only-units);
//   · movements add over the window; POSITIONS (in transit, on hand) are read at an edge — a time row at its period's
//     last day, an id row and the headline at the window's last day, never a day still to come — and add across keys;
//   · Transfer's sides each on their own day (a-transfer-counts-each-side-on-its-own-day): sent under the sender on the
//     create day, received under the receiver on the accept day, in transit under the receiver in between.

import { type TableGroup, type TimeGroup, isTimeGroup } from "../src/features/analytic/catalogue";
import { type MetricBody, type ReportFilters, type ReportKey, type SortDirection, bucketOfDay } from "../src/features/analytic/provider";
import { SAMPLE_LOST_WAREHOUSE, SAMPLE_PRODUCTS, SAMPLE_SELLER, sampleFacts } from "../src/features/analytic/sample";
import { jakartaToday } from "../src/lib/jakartaDay";
import { daySpine } from "../src/lib/period";

export const RESTOCK_ID = "metrics/inventory/restock";
export const TRANSFER_ID = "metrics/inventory/transfer";
export const RETURN_ID = "metrics/inventory/return";
export const READY_ID = "metrics/inventory/ready";

type MetricKey = "restock" | "transfer" | "return" | "ready";

/** Each metric's facts, its fields, the ones that are POSITIONS and the ones a warehouse is not given. */
const METRIC: Record<string, { key: MetricKey; fields: string[]; positions: Set<string>; sellerMoney: Set<string> }> = {
  [RESTOCK_ID]: {
    key: "restock",
    fields: ["accepted_count", "accepted_value", "broken_count", "missing_count"],
    positions: new Set(),
    sellerMoney: new Set(["accepted_value"]),
  },
  [TRANSFER_ID]: {
    key: "transfer",
    fields: ["sent_count", "sent_value", "received_count", "received_value", "in_transit_count", "in_transit_value"],
    positions: new Set(["in_transit_count", "in_transit_value"]),
    sellerMoney: new Set(["sent_value", "received_value", "in_transit_value"]),
  },
  [RETURN_ID]: {
    key: "return",
    fields: ["back_count", "back_value", "broken_count", "missing_count"],
    positions: new Set(),
    sellerMoney: new Set(["back_value"]),
  },
  [READY_ID]: {
    key: "ready",
    fields: ["on_hand_count", "on_hand_value"],
    positions: new Set(["on_hand_count", "on_hand_value"]),
    sellerMoney: new Set(),
  },
};

export const INVENTORY_METRIC_IDS = Object.keys(METRIC);

// ── the simulation ───────────────────────────────────────────────────────────────────────────────

const SAMPLE_START = "2025-01-01";
const PUSAT = "11";
const CABANG = "14";
const WAREHOUSES = [PUSAT, CABANG];

/** One day's figures of one product in one warehouse, owned by one seller. */
interface Fact {
  day: string;
  product: string;
  supplier: string;
  team: string;
  warehouse: string;
  values: Record<string, number>;
}

/** A number in [0, 1), the same for the same seed on every run — FNV-1a, then an avalanche (sample.ts's). */
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

const between = (seed: string, low: number, high: number) => low + Math.floor(seeded(seed) * (high - low + 1));

function addDay(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);

  return d.toISOString().slice(0, 10);
}

/** What each warehouse keeps of each product — Gudang Cabang a reserve of three, refilled in big lots. */
const HELD: Record<string, string[]> = {
  [PUSAT]: SAMPLE_PRODUCTS.map((p) => p.id),
  [CABANG]: ["201", "204", "205"],
};

const START_STOCK: Record<string, number> = { [PUSAT]: 40, [CABANG]: 60 };

/** Below this a shelf is restocked; the lot is between the two sizes. */
const REORDER: Record<string, { below: number; low: number; high: number }> = {
  [PUSAT]: { below: 10, low: 25, high: 50 },
  [CABANG]: { below: 12, low: 30, high: 50 },
};

/** Gudang Pusat's orders per product: the chance a day has any, and the most units in a day. */
const DEMAND: Record<string, { chance: number; most: number }> = {
  "201": { chance: 0.45, most: 3 },
  "202": { chance: 0.4, most: 3 },
  "203": { chance: 0.8, most: 4 },
  "204": { chance: 0.7, most: 4 },
  "205": { chance: 0.4, most: 3 },
  "206": { chance: 0.35, most: 2 },
};

interface Moving {
  product: string;
  from: string;
  to: string;
  units: number;
  missing: number;
  sent: string;
  accepted: string;
}

type Facts = Record<MetricKey, Fact[]>;

function simulate(): Facts {
  const today = jakartaToday();
  const out: Facts = { restock: [], transfer: [], return: [], ready: [] };

  // The sample's lost stock leaves where it sat.
  const lost = new Map<string, number>();
  for (const f of sampleFacts("metrics/inventory/lost")) {
    const k = `${f.day}|${f.warehouse}|${f.product}`;
    lost.set(k, (lost.get(k) ?? 0) + (f.values.lost_count ?? 0));
  }

  const stock: Record<string, Record<string, number>> = Object.fromEntries(
    WAREHOUSES.map((w) => [w, Object.fromEntries(HELD[w]!.map((p) => [p, w === CABANG && p === "201" ? 0 : START_STOCK[w]!]))]),
  );
  const moving: Moving[] = [];
  const product = (id: string) => SAMPLE_PRODUCTS.find((p) => p.id === id)!;
  const fact = (bucket: Fact[], day: string, p: string, warehouse: string, values: Record<string, number>) =>
    bucket.push({ day, product: p, supplier: product(p).supplier, team: SAMPLE_SELLER, warehouse, values });
  const take = (w: string, p: string, n: number) => {
    const held = stock[w]![p] ?? 0;
    const taken = Math.min(held, n);
    stock[w]![p] = held - taken;

    return taken;
  };
  const put = (w: string, p: string, n: number) => {
    stock[w]![p] = (stock[w]![p] ?? 0) + n;
  };

  for (const [index, day] of daySpine(SAMPLE_START, today).entries()) {
    // 1. A transfer the receiver accepts today: the units counted in go on its racks; a missing one never does.
    for (const m of moving.filter((x) => x.accepted === day)) {
      const received = m.units - m.missing;
      put(m.to, m.product, received);
      const price = product(m.product).price;
      fact(out.transfer, day, m.product, m.to, { received_count: received, received_value: received * price });
    }

    for (const w of WAREHOUSES) {
      for (const p of HELD[w]!) {
        const price = product(p).price;

        // 2. A shelf below its mark is restocked and accepted today; the door finds a few broken or missing.
        const rule = REORDER[w]!;
        if ((stock[w]![p] ?? 0) < rule.below) {
          const lot = between(`rl|${day}|${w}|${p}`, rule.low, rule.high);
          const broken = seeded(`rb|${day}|${w}|${p}`) < 0.25 ? between(`rbc|${day}|${w}|${p}`, 1, 2) : 0;
          const missing = seeded(`rm|${day}|${w}|${p}`) < 0.15 ? between(`rmc|${day}|${w}|${p}`, 1, 3) : 0;
          const accepted = lot - broken - missing;
          put(w, p, accepted);
          fact(out.restock, day, p, w, {
            accepted_count: accepted,
            accepted_value: accepted * price,
            broken_count: broken,
            missing_count: missing,
          });
        }

        // 3. Returns land at the team's return warehouse only (only-the-return-warehouse-accepts-a-return).
        if (w === PUSAT && seeded(`ret|${day}|${p}`) < 0.07) {
          const back = between(`retb|${day}|${p}`, 1, 2);
          const broken = seeded(`retx|${day}|${p}`) < 0.2 ? 1 : 0;
          const missing = seeded(`retm|${day}|${p}`) < 0.1 ? 1 : 0;
          put(w, p, back);
          fact(out.return, day, p, w, { back_count: back, back_value: back * price, broken_count: broken, missing_count: missing });
        }

        // 4. What leaves: the day's orders (Gudang Pusat ships them all — taken at the order) and the day's lost stock.
        const demand = DEMAND[p]!;
        if (w === PUSAT && seeded(`d|${day}|${p}`) < demand.chance) take(w, p, between(`dc|${day}|${p}`, 1, demand.most));
        if (SAMPLE_LOST_WAREHOUSE[p] === w) take(w, p, lost.get(`${day}|${w}|${p}`) ?? 0);
      }
    }

    // 5. Transfers the seller opens today. Gudang Cabang sends its reserve of 204 / 205 to where they sell; Gudang Pusat
    //    sends 201 to the reserve now and then. The units leave the sender's stock now (a-transfer-takes-from-the-sender-
    //    at-create) and reach the receiver at its accept, two to four days later.
    const opens: { p: string; from: string; to: string; low: number; high: number }[] = [];
    const n = index + 1;
    if (n % 9 === 3) opens.push({ p: n % 18 === 3 ? "204" : "205", from: CABANG, to: PUSAT, low: 8, high: 15 });
    if (n % 31 === 0) opens.push({ p: "201", from: PUSAT, to: CABANG, low: 6, high: 12 });

    for (const o of opens) {
      const units = take(o.from, o.p, between(`tu|${day}|${o.p}`, o.low, o.high));
      if (units === 0) continue;

      const price = product(o.p).price;
      moving.push({
        product: o.p,
        from: o.from,
        to: o.to,
        units,
        missing: seeded(`tm|${day}|${o.p}`) < 0.15 ? 1 : 0,
        sent: day,
        accepted: addDay(day, between(`ta|${day}|${o.p}`, 2, 4)),
      });
      fact(out.transfer, day, o.p, o.from, { sent_count: units, sent_value: units * price });
    }

    // 6. At the day's end: what is on the road — under the warehouse it is going to — and what each shelf holds.
    for (const m of moving.filter((x) => x.sent <= day && day < x.accepted)) {
      const price = product(m.product).price;
      fact(out.transfer, day, m.product, m.to, { in_transit_count: m.units, in_transit_value: m.units * price });
    }

    for (const w of WAREHOUSES) {
      for (const p of HELD[w]!) {
        const units = stock[w]![p] ?? 0;
        if (units > 0) fact(out.ready, day, p, w, { on_hand_count: units, on_hand_value: units * product(p).price });
      }
    }
  }

  return out;
}

let cache: Facts | undefined;

function factsOf(metric: MetricKey): Fact[] {
  cache ??= simulate();

  return cache[metric];
}

// ── answering as the service does ────────────────────────────────────────────────────────────────

const ROOT_READER = "1";

/** The sample's warehouses — a reader that is one of them is a WAREHOUSE caller. */
export const SAMPLE_WAREHOUSE_READERS = new Set(WAREHOUSES);

/** May `reader` read the fact? The warehouse it happened in, the seller owning the goods, root every one. */
function readable(fact: Fact, reader: string): boolean {
  return reader === ROOT_READER || fact.warehouse === reader || fact.team === reader;
}

/** The filters but the date range, each a dimension — a warehouse matches the fact's own side. */
function inScope(fact: Fact, filters: ReportFilters): boolean {
  if (fact.day < filters.from || fact.day > filters.to) return false;
  if (filters.team && fact.team !== filters.team) return false;
  if (filters.warehouse && fact.warehouse !== filters.warehouse) return false;
  if (filters.product && fact.product !== filters.product) return false;
  if (filters.supplier && fact.supplier !== filters.supplier) return false;

  return true;
}

function keyOf(fact: Fact, group: TableGroup): ReportKey | undefined {
  if (isTimeGroup(group)) return bucketOfDay(fact.day, group);
  if (group === "product") return fact.product;
  if (group === "supplier") return fact.supplier;
  if (group === "team") return fact.team;
  if (group === "warehouse") return fact.warehouse;

  return undefined;
}

/** The last day of a period, by its first. */
function lastDayOf(bucket: string, group: TimeGroup): string {
  if (group === "weekly") return addDay(bucket, 6);
  if (group === "yearly") return `${bucket.slice(0, 4)}-12-31`;
  if (group === "monthly") {
    const next = new Date(`${bucket}T00:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    next.setUTCDate(0);

    return next.toISOString().slice(0, 10);
  }

  return bucket;
}

/** THE EDGE A POSITION IS READ AT: a period's last day, cut by the window, and never a day still to come. */
function edgeOf(group: TableGroup | "summary", key: ReportKey, to: string): string {
  const today = jakartaToday();
  const end = group !== "summary" && isTimeGroup(group) ? lastDayOf(key, group) : to;
  const cut = end < to ? end : to;

  return cut < today ? cut : today;
}

function compareKeys(a: ReportKey, b: ReportKey, group: TableGroup): number {
  if (isTimeGroup(group)) return a < b ? -1 : a > b ? 1 : 0;

  return Number(a) - Number(b);
}

/** Is this one of the four, answered here? */
export function isInventoryMetric(metricId: string): boolean {
  return metricId in METRIC;
}

/** Is `field` of `metricId` a figure a warehouse is not given (its value on Restock, Transfer, Returned stock)? */
export function hiddenFromWarehouse(metricId: string, field: string): boolean {
  return METRIC[metricId]?.sellerMoney.has(field) ?? false;
}

/** One metric's figures by key — movements summed over the window, positions at each key's edge, the reader's scope. */
function rollUp(metricId: string, group: TableGroup | "summary", filters: ReportFilters, reader: string): Map<ReportKey, MetricBody> {
  const metric = METRIC[metricId]!;
  const empty = (): MetricBody => Object.fromEntries(metric.fields.map((f) => [f, 0]));
  const out = new Map<ReportKey, MetricBody>();

  for (const fact of factsOf(metric.key)) {
    if (!inScope(fact, filters) || !readable(fact, reader)) continue;

    const key = group === "summary" ? "" : keyOf(fact, group);
    if (key === undefined) continue;

    const edge = edgeOf(group, key, filters.to);
    const adds = metric.fields.filter((f) => f in fact.values && (!metric.positions.has(f) || fact.day === edge));
    if (adds.length === 0) continue;

    const body = out.get(key) ?? empty();
    for (const f of adds) body[f] = (body[f] ?? 0) + (fact.values[f] ?? 0);
    out.set(key, body);
  }

  return out;
}

/** The body the reader is given: a warehouse never a seller's money — the field LEFT OUT, as the server leaves it unset. */
function given(metricId: string, body: MetricBody | undefined, reader: string): MetricBody {
  const metric = METRIC[metricId]!;
  const full = body ?? Object.fromEntries(metric.fields.map((f) => [f, 0]));
  if (!SAMPLE_WAREHOUSE_READERS.has(reader)) return full;

  return Object.fromEntries(Object.entries(full).filter(([name]) => !metric.sellerMoney.has(name)));
}

export const inventoryMetricSample = {
  /** STEP 1 — the keys with figures, ranked by one field, the key DESC on a tie; limit + 1. */
  search(
    metricId: string,
    req: { groupBy: TableGroup; filters: ReportFilters; field: string; dir: SortDirection; offset: number; limit: number; reader: string },
  ): { keys: ReportKey[]; hasNext: boolean } {
    const rows = [...rollUp(metricId, req.groupBy, req.filters, req.reader).entries()];
    const sign = req.dir === "desc" ? -1 : 1;
    rows.sort(([ka, a], [kb, b]) => sign * ((a[req.field] ?? 0) - (b[req.field] ?? 0)) || -compareKeys(ka, kb, req.groupBy));

    const taken = rows.slice(req.offset, req.offset + req.limit + 1);

    return { keys: taken.slice(0, req.limit).map(([key]) => key), hasNext: taken.length > req.limit };
  },

  /** STEP 2 — every asked key, all zero where nothing happened. */
  data(metricId: string, groupBy: TableGroup, filters: ReportFilters, keys: ReportKey[], reader: string): Record<ReportKey, MetricBody> {
    const rolled = rollUp(metricId, groupBy, filters, reader);

    return Object.fromEntries(keys.map((key) => [key, given(metricId, rolled.get(key), reader)]));
  },

  /** THE HEADLINE — movements over the window, positions at its last day. */
  summary(metricId: string, filters: ReportFilters, reader: string): MetricBody {
    return given(metricId, rollUp(metricId, "summary", filters, reader).get(""), reader);
  },
};

/**
 * Every Ready fact on one day, as root reads it — what a story checks a position against (the sum of the shelves that
 * day), never a sum over days.
 */
export function readyOn(day: string, filter: { warehouse?: string; product?: string } = {}): { units: number; value: number } {
  let units = 0;
  let value = 0;
  for (const f of factsOf("ready")) {
    if (f.day !== day) continue;
    if (filter.warehouse && f.warehouse !== filter.warehouse) continue;
    if (filter.product && f.product !== filter.product) continue;
    units += f.values.on_hand_count ?? 0;
    value += f.values.on_hand_value ?? 0;
  }

  return { units, value };
}
