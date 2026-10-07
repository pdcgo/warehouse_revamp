// supplier_service as Storybook's stub — SupplierService and SupplierChannelService of warehouse.supplier.v1.
//
// It plays the server's DECIDED rules, because a screen must already honour them:
//   only-a-selling-team-has-suppliers           SupplierCreate refuses a team that is not a selling team.
//   reads cross teams, writes do not            SupplierDetail / SupplierChannelList / SupplierByIds answer for any
//                                               team's supplier; every write answers NotFound unless the supplier
//                                               is the CALLER's team's.
//   a-deleted-supplier-is-kept-for-its-figures  SupplierDelete marks the row: gone from List, Detail and the store
//                                               list, still returned by SupplierByIds with `deleted: true`. Its
//                                               stores are NOT marked — they hide with it.
//   a-store-delete-is-soft-too                  SupplierChannelDelete marks the store: gone from every list.
//
// And the lists' shapes: SupplierList's OWN / EVERY_TEAM scope, its `q` over the supplier's name, address and
// contact and its live stores' names, its channel-type filter and its CHANNELS slice; SupplierChannelList's `q`
// over a store's name, link and description, its type filter and its paging — all on the "server", here. Both
// order newest first (id DESC), as the server does when no sort is sent.
//
// WRITEABLE: a supplier added in one step is on the list in the next. Module state survives between stories
// in one tab — preview.tsx calls `resetSupplierStub()` in its `beforeEach`.

import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect";

import { Marketplace } from "../src/gen/warehouse/marketplace/v1/marketplace_pb";
import { SupplierListDataType, SupplierListScope, SupplierService } from "../src/gen/warehouse/supplier/v1/supplier_pb";
import { SupplierChannelService } from "../src/gen/warehouse/supplier/v1/supplier_channel_pb";
import {
  AnalyticGroupSort,
  AnalyticTimeframe,
  SupplierAnalyticService,
} from "../src/gen/warehouse/supplier/v1/supplier_analytic_pb";
import { CommonSortType } from "../src/gen/warehouse/common/v1/list_pb";
import { TeamType } from "../src/gen/warehouse/team/v1/team_pb";
import { teams } from "./fixtures";
import { type ChannelFixture, type SupplierFixture, channelFixtures, supplierFixtures } from "./supplierFixtures";
import { type FigureFixture, dayAgo, figureFixtures } from "./supplierFigureFixtures";

// ── The tables ──────────────────────────────────────────────────────────────────────────────────

let suppliers: SupplierFixture[] = [];
let channels: ChannelFixture[] = [];

export function resetSupplierStub() {
  suppliers = supplierFixtures.map((s) => ({ ...s }));
  channels = channelFixtures.map((c) => ({ ...c }));
}

resetSupplierStub();

const nextId = (rows: { id: bigint }[]) => rows.reduce((max, r) => (r.id > max ? r.id : max), 0n) + 1n;

const newestFirst = <R extends { id: bigint }>(rows: R[]) => [...rows].sort((a, b) => (a.id > b.id ? -1 : a.id < b.id ? 1 : 0));

const matches = (q: string, ...fields: string[]) => !q || fields.some((f) => f.toLowerCase().includes(q));

// A store as the wire carries it — the message has no `deleted`, so the stub's own bookkeeping stays home.
const wireChannel = ({ deleted: _deleted, ...c }: ChannelFixture) => c;

// The guideline List envelope's paging — the same shape stubTransport.ts serves, kept here so this stub
// stands alone (a story imports it without pulling the whole transport into the typecheck).
type PageReq = { page?: bigint; limit?: bigint } | undefined;

function pageOf<R>(rows: R[], page: PageReq) {
  const limit = Number(page?.limit ?? 20n) || 20;
  const current = Number(page?.page ?? 1n) || 1;

  return {
    rows: rows.slice((current - 1) * limit, current * limit),
    pageInfo: {
      currentPage: current,
      totalPage: Math.max(1, Math.ceil(rows.length / limit)),
      totalItems: BigInt(rows.length),
    },
  };
}

const liveStoresOf = (supplierId: bigint) => channels.filter((c) => c.supplierId === supplierId && !c.deleted);

// Any team's LIVE supplier — what every read but SupplierByIds answers for.
function live(supplierId: bigint): SupplierFixture {
  const found = suppliers.find((s) => s.id === supplierId && !s.deleted);
  if (!found) {
    throw new ConnectError("supplier not found", Code.NotFound);
  }
  return found;
}

// The CALLER's team's live supplier — what every write needs. Another team's reads as NotFound, exactly as a
// missing one does.
function inTeam(teamId: bigint, supplierId: bigint): SupplierFixture {
  const found = live(supplierId);
  if (found.teamId !== teamId) {
    throw new ConnectError("supplier not found", Code.NotFound);
  }
  return found;
}

// A live store of a live supplier of the caller's team.
function channelInTeam(teamId: bigint, channelId: bigint): ChannelFixture {
  const found = channels.find((c) => c.id === channelId && !c.deleted);
  if (!found) {
    throw new ConnectError("channel not found", Code.NotFound);
  }
  inTeam(teamId, found.supplierId);
  return found;
}

function required(value: string, field: string) {
  if (value.trim() === "") {
    throw new ConnectError(`${field}: value is required`, Code.InvalidArgument);
  }
}

function channelTypeRequired(channelType: Marketplace) {
  if (channelType === Marketplace.UNSPECIFIED) {
    throw new ConnectError("channel_type: value must not be in list [0]", Code.InvalidArgument);
  }
}

// ── SupplierService ─────────────────────────────────────────────────────────────────────────────

export const supplierService: Partial<ServiceImpl<typeof SupplierService>> = {
  supplierList: (req) => {
    const q = (req.filter?.q ?? "").trim().toLowerCase();
    const everyTeam = req.filter?.scope === SupplierListScope.EVERY_TEAM;
    const channelType = req.filter?.channelType ?? Marketplace.UNSPECIFIED;
    // Discover's Team filter — the team that keeps the supplier. 0 = any team.
    const ownerTeamId = req.filter?.ownerTeamId ?? 0n;

    const rows = newestFirst(
      suppliers
        .filter((s) => !s.deleted && (everyTeam || s.teamId === req.teamId))
        .filter((s) => ownerTeamId === 0n || s.teamId === ownerTeamId)
        .filter((s) => channelType === Marketplace.UNSPECIFIED || liveStoresOf(s.id).some((c) => c.channelType === channelType))
        .filter((s) => matches(q, s.name, s.address, s.contact, ...liveStoresOf(s.id).map((c) => c.name))),
    );
    const { rows: page, pageInfo } = pageOf(rows, req.page as PageReq);

    const supplierMap: Record<string, SupplierFixture> = {};
    const channelMap: Record<string, { channels: ReturnType<typeof wireChannel>[] }> = {};
    for (const s of page) {
      supplierMap[s.id.toString()] = s;
      channelMap[s.id.toString()] = { channels: liveStoresOf(s.id).map(wireChannel) };
    }

    // The slices asked for — the CHANNELS one is every supplier on the page, an empty set included.
    const wants = (slice: SupplierListDataType) => req.dataRequest.includes(slice);
    const items = [
      ...(wants(SupplierListDataType.SUPPLIER) ? [{ d: { case: "supplier" as const, value: { mapData: supplierMap } } }] : []),
      ...(wants(SupplierListDataType.CHANNELS) ? [{ d: { case: "channels" as const, value: { mapData: channelMap } } }] : []),
    ];

    return { items, ids: page.map((s) => s.id), pageInfo };
  },

  // Crosses teams by design (a warehouse reads a delivery's vendor), and a deleted supplier is still returned,
  // marked `deleted` — a past restock and the figures read its name.
  supplierByIds: (req) => {
    const items: Record<string, { items: { d: { case: "supplier"; value: { mapData: Record<string, SupplierFixture> } } }[] }> = {};

    for (const id of req.filter?.ids ?? []) {
      const found = suppliers.find((s) => s.id === id);
      if (found) {
        items[id.toString()] = { items: [{ d: { case: "supplier", value: { mapData: { [id.toString()]: found } } } }] };
      }
    }

    return { items };
  },

  // Any team's live supplier (another-team-sees-everything-of-a-supplier).
  supplierDetail: (req) => ({ supplier: live(req.supplierId) }),

  supplierCreate: (req) => {
    // only-a-selling-team-has-suppliers.
    const team = teams.find((t) => t.id === req.teamId);
    if (team?.type !== TeamType.SELLING) {
      throw new ConnectError("only a selling team has suppliers", Code.FailedPrecondition);
    }

    required(req.name, "name");

    const row: SupplierFixture = {
      id: nextId(suppliers),
      teamId: req.teamId,
      name: req.name,
      contact: req.contact,
      address: req.address,
      description: req.description,
      deleted: false,
    };
    suppliers = [...suppliers, row];

    return { supplier: row };
  },

  supplierUpdate: (req) => {
    const row = inTeam(req.teamId, req.supplierId);

    if (req.name !== undefined) {
      required(req.name, "name");
    }

    const next: SupplierFixture = {
      ...row,
      name: req.name ?? row.name,
      contact: req.contact ?? row.contact,
      address: req.address ?? row.address,
      description: req.description ?? row.description,
    };
    suppliers = suppliers.map((s) => (s.id === row.id ? next : s));

    return { supplier: next };
  },

  // a-deleted-supplier-is-kept-for-its-figures: the row is marked, not removed — and its stores are left as they
  // are, hidden with it.
  supplierDelete: (req) => {
    const row = inTeam(req.teamId, req.supplierId);
    suppliers = suppliers.map((s) => (s.id === row.id ? { ...s, deleted: true } : s));

    return {};
  },
};

// ── SupplierChannelService ──────────────────────────────────────────────────────────────────────

export const supplierChannelService: Partial<ServiceImpl<typeof SupplierChannelService>> = {
  // Any team's live supplier's live stores — searched, filtered and paged here, as the server does.
  supplierChannelList: (req) => {
    const supplier = live(req.filter?.supplierId ?? 0n);
    const q = (req.filter?.q ?? "").trim().toLowerCase();
    const channelType = req.filter?.channelType ?? Marketplace.UNSPECIFIED;

    const rows = newestFirst(
      liveStoresOf(supplier.id)
        .filter((c) => channelType === Marketplace.UNSPECIFIED || c.channelType === channelType)
        .filter((c) => matches(q, c.name, c.uri, c.description)),
    );
    const { rows: page, pageInfo } = pageOf(rows, req.page as PageReq);

    const mapData: Record<string, ReturnType<typeof wireChannel>> = {};
    for (const c of page) {
      mapData[c.id.toString()] = wireChannel(c);
    }

    return {
      items: [{ d: { case: "supplierChannel", value: { mapData } } }],
      ids: page.map((c) => c.id),
      pageInfo,
    };
  },

  supplierChannelCreate: (req) => {
    inTeam(req.teamId, req.supplierId);
    channelTypeRequired(req.channelType);
    required(req.name, "name");

    const row: ChannelFixture = {
      id: nextId(channels),
      supplierId: req.supplierId,
      channelType: req.channelType,
      name: req.name,
      uri: req.uri,
      description: req.description,
      deleted: false,
    };
    channels = [...channels, row];

    return { channel: wireChannel(row) };
  },

  supplierChannelUpdate: (req) => {
    const row = channelInTeam(req.teamId, req.channelId);

    if (req.name !== undefined) {
      required(req.name, "name");
    }
    if (req.channelType !== undefined) {
      channelTypeRequired(req.channelType);
    }

    const next: ChannelFixture = {
      ...row,
      channelType: req.channelType ?? row.channelType,
      name: req.name ?? row.name,
      uri: req.uri ?? row.uri,
      description: req.description ?? row.description,
    };
    channels = channels.map((c) => (c.id === row.id ? next : c));

    return { channel: wireChannel(next) };
  },

  // a-store-delete-is-soft-too: the store is marked, not removed.
  supplierChannelDelete: (req) => {
    const row = channelInTeam(req.teamId, req.channelId);
    channels = channels.map((c) => (c.id === row.id ? { ...c, deleted: true } : c));

    return {};
  },
};

// ── SupplierAnalyticService ─────────────────────────────────────────────────────────────────────
//
// A supplier's figures, read from supplierFigureFixtures.ts the way supplier_service reads its folded table: every
// bucket of the window a point, every team's restocks unless one is picked, a deleted supplier ranked with its figures,
// and — by broken rate — the suppliers under the minimum after the others (rate-ranking-needs-50-units).

const RATE_MIN_UNITS = 50n;

type Metric = Omit<FigureFixture, "daysAgo" | "supplierId" | "productId" | "teamId">;

const zeroMetric = (): Metric => ({
  restockCount: 0n,
  restockValuation: 0n,
  shippingLostCount: 0n,
  shippingLostValuation: 0n,
  shippingBrokenCount: 0n,
  shippingBrokenValuation: 0n,
});

function addRow(m: Metric, r: FigureFixture): Metric {
  return {
    restockCount: m.restockCount + r.restockCount,
    restockValuation: m.restockValuation + r.restockValuation,
    shippingLostCount: m.shippingLostCount + r.shippingLostCount,
    shippingLostValuation: m.shippingLostValuation + r.shippingLostValuation,
    shippingBrokenCount: m.shippingBrokenCount + r.shippingBrokenCount,
    shippingBrokenValuation: m.shippingBrokenValuation + r.shippingBrokenValuation,
  };
}

const unitsOf = (m: Metric) => m.restockCount + m.shippingLostCount + m.shippingBrokenCount;

type Range = { startDate: string; endDate: string } | undefined;

/** The window's rows — inclusive at both ends — narrowed to one restocking team when one is picked. */
function figureRowsIn(range: Range, restockTeamId: bigint): FigureFixture[] {
  const start = range?.startDate ?? "";
  const end = range?.endDate ?? "";

  return figureFixtures.filter((r) => {
    const day = dayAgo(r.daysAgo);

    return day >= start && day <= end && (restockTeamId === 0n || r.teamId === restockTeamId);
  });
}

/** The bucket a day rolls up into — the day, the 1st of its month, or 1 January. */
function bucketOfDay(day: string, timeframe: AnalyticTimeframe): string {
  if (timeframe === AnalyticTimeframe.MONTHLY) return `${day.slice(0, 7)}-01`;
  if (timeframe === AnalyticTimeframe.YEARLY) return `${day.slice(0, 4)}-01-01`;

  return day;
}

/** Every bucket of the window, oldest first — walked in UTC, as calendar labels. */
function bucketSpine(range: Range, timeframe: AnalyticTimeframe): string[] {
  const start = Date.parse(`${range?.startDate ?? ""}T00:00:00Z`);
  const end = Date.parse(`${range?.endDate ?? ""}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return [];

  const seen = new Set<string>();
  for (let t = start; t <= end; t += 86_400_000) {
    seen.add(bucketOfDay(new Date(t).toISOString().slice(0, 10), timeframe));
  }

  return [...seen];
}

export const supplierAnalyticService: Partial<ServiceImpl<typeof SupplierAnalyticService>> = {
  analyticTimeSearch: (req) => {
    const timeframe = req.timeframe;
    const rows = figureRowsIn(req.filter?.dateRange, req.filter?.restockTeamId ?? 0n).filter(
      (r) => r.supplierId === req.supplierId,
    );

    const byBucket = new Map<string, Metric>();
    let total = zeroMetric();
    for (const r of rows) {
      const at = bucketOfDay(dayAgo(r.daysAgo), timeframe);
      byBucket.set(at, addRow(byBucket.get(at) ?? zeroMetric(), r));
      total = addRow(total, r);
    }

    let spine = bucketSpine(req.filter?.dateRange, timeframe);
    if (req.sortType === CommonSortType.DESC) spine = spine.reverse();

    const { rows: page, pageInfo } = pageOf(spine, req.page as PageReq);

    return {
      datas: page.map((at) => ({ at, metric: byBucket.get(at) ?? zeroMetric() })),
      pageInfo,
      total,
    };
  },

  analyticProductSearch: (req) => {
    const rows = figureRowsIn(req.filter?.dateRange, req.filter?.restockTeamId ?? 0n).filter(
      (r) => r.supplierId === req.supplierId,
    );

    const byProduct = new Map<string, { productId: bigint; teamId: bigint; metric: Metric }>();
    for (const r of rows) {
      const key = `${r.teamId}|${r.productId}`;
      const had = byProduct.get(key) ?? { productId: r.productId, teamId: r.teamId, metric: zeroMetric() };
      byProduct.set(key, { ...had, metric: addRow(had.metric, r) });
    }

    const sorted = [...byProduct.values()].sort((a, b) => {
      if (a.metric.restockValuation !== b.metric.restockValuation) {
        return a.metric.restockValuation > b.metric.restockValuation ? -1 : 1;
      }

      return a.productId < b.productId ? -1 : 1;
    });

    const { rows: page, pageInfo } = pageOf(sorted, req.page as PageReq);

    return { datas: page, pageInfo };
  },

  analyticGroupSearch: (req) => {
    const q = (req.filter?.q ?? "").trim().toLowerCase();
    // The search finds suppliers as SupplierList does — a deleted one included, since its figures are kept.
    const found = (supplierId: bigint) => {
      const s = suppliers.find((x) => x.id === supplierId);
      if (!s) return q === "";

      return matches(q, s.name, s.address, s.contact, ...liveStoresOf(s.id).map((c) => c.name));
    };

    const bySupplier = new Map<bigint, Metric>();
    let total = zeroMetric();
    for (const r of figureRowsIn(req.filter?.dateRange, req.filter?.restockTeamId ?? 0n)) {
      if (!found(r.supplierId)) continue;
      bySupplier.set(r.supplierId, addRow(bySupplier.get(r.supplierId) ?? zeroMetric(), r));
      total = addRow(total, r);
    }

    const byRate = req.sort === AnalyticGroupSort.BROKEN_RATE;
    const rate = (m: Metric) => Number(m.shippingBrokenCount) / Number(unitsOf(m));

    const ranked = [...bySupplier.entries()].sort(([idA, a], [idB, b]) => {
      if (byRate) {
        const ratedA = unitsOf(a) >= RATE_MIN_UNITS;
        const ratedB = unitsOf(b) >= RATE_MIN_UNITS;
        if (ratedA !== ratedB) return ratedA ? -1 : 1;
        if (rate(a) !== rate(b)) return rate(b) - rate(a);
      }
      if (a.restockValuation !== b.restockValuation) return a.restockValuation > b.restockValuation ? -1 : 1;

      return idA < idB ? -1 : 1;
    });

    const { rows: page, pageInfo } = pageOf(ranked, req.page as PageReq);

    return { ids: page.map(([id]) => id), pageInfo, total, rateMinUnits: RATE_MIN_UNITS };
  },

  analyticGroupMetric: (req) => {
    const metrics: Record<string, Metric> = {};
    for (const id of req.ids) metrics[id.toString()] = zeroMetric();

    for (const r of figureRowsIn(req.filter?.dateRange, req.filter?.restockTeamId ?? 0n)) {
      const key = r.supplierId.toString();
      if (key in metrics) metrics[key] = addRow(metrics[key]!, r);
    }

    return { metrics };
  },
};
