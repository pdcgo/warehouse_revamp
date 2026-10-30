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
import { SupplierListDataType, SupplierListScope, SupplierRowSort, SupplierService } from "../src/gen/warehouse/supplier/v1/supplier_pb";
import { SupplierChannelService } from "../src/gen/warehouse/supplier/v1/supplier_channel_pb";
import { getOption } from "@bufbuild/protobuf";
import { SupplierAnalyticService, SupplierMetricSchema } from "../src/gen/warehouse/supplier/v1/supplier_analytic_pb";
import { type FilterItem, GroupType, SortType, metric_sort } from "../src/gen/warehouse/analytic_base/v1/analytic_pb";
import { CommonSortType, GeneralSort } from "../src/gen/warehouse/common/v1/list_pb";
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

/**
 * MORE ROWS FOR ONE STORY — call it from a story's `beforeEach`, after preview.tsx's reset, and the rows live until the
 * next story resets the tables. For a screen that has to be seen FULL (the AppShell's example page), without growing
 * the shared fixtures every other story counts on.
 */
export function addSupplierRows(more: { suppliers: SupplierFixture[]; channels: ChannelFixture[] }) {
  suppliers.push(...more.suppliers.map((s) => ({ ...s })));
  channels.push(...more.channels.map((c) => ({ ...c })));
}

const nextId = (rows: { id: bigint }[]) => rows.reduce((max, r) => (r.id > max ? r.id : max), 0n) + 1n;

const newestFirst = <R extends { id: bigint }>(rows: R[]) => [...rows].sort((a, b) => (a.id > b.id ? -1 : a.id < b.id ? 1 : 0));

const matches = (q: string, ...fields: string[]) => !q || fields.some((f) => f.toLowerCase().includes(q));

// A store as a LIST carries it — a deleted one never reaches a list, so the flag stays home; only SupplierChannelByIds
// sends it.
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

    const found = newestFirst(
      suppliers
        .filter((s) => !s.deleted && (everyTeam || s.teamId === req.teamId))
        .filter((s) => ownerTeamId === 0n || s.teamId === ownerTeamId)
        .filter((s) => channelType === Marketplace.UNSPECIFIED || liveStoresOf(s.id).some((c) => c.channelType === channelType))
        .filter((s) => matches(q, s.name, s.address, s.contact, ...liveStoresOf(s.id).map((c) => c.name))),
    );
    // By name when asked — the server's order (supplierOrderClause): the name, then the id to break a tie.
    const byName =
      (req.sort?.s.case === "supplier" && req.sort.s.value === SupplierRowSort.NAME) ||
      (req.sort?.s.case === "general" && req.sort.s.value === GeneralSort.NAME);
    const asc = req.sort?.sortType === CommonSortType.ASC;
    const rows = byName
      ? [...found].sort((x, y) => (asc ? 1 : -1) * (x.name.localeCompare(y.name) || Number(x.id - y.id)))
      : found;
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
  // Stores by id, DELETED ONES INCLUDED and marked — what a restock line reads to show its store, badged when it is
  // gone (a-deleted-supplier-still-shows-with-a-badge). An unknown id is simply absent.
  supplierChannelByIds: (req) => {
    const out: Record<string, ReturnType<typeof wireChannel> & { deleted: boolean }> = {};
    for (const id of req.ids) {
      const found = channels.find((c) => c.id === id);
      if (found) out[id.toString()] = { ...wireChannel(found), deleted: found.deleted };
    }
    return { channels: out };
  },

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
// `metrics/suppliers`, read from supplierFigureFixtures.ts the way supplier_service reads its folded table
// (docs/business/analytic/rpc_provide.md): MetricSearch ranks the keys that have figures — the key DESC breaking a tie,
// and by broken rate only the keys with the proto's `rank_min_sample` units ranked, the rest after them in key order —
// and MetricData fills every asked key, zero when quiet, or reads the SUMMARY headline. Every team's restocks unless one
// is picked; a deleted supplier keeps its figures.

type Metric = Omit<FigureFixture, "daysAgo" | "supplierId" | "productId" | "teamId"> & { brokenRate: number };

const zeroMetric = (): Metric => ({
  restockCount: 0n,
  restockValuation: 0n,
  shippingLostCount: 0n,
  shippingLostValuation: 0n,
  shippingBrokenCount: 0n,
  shippingBrokenValuation: 0n,
  brokenRate: 0,
});

const unitsOf = (m: Metric) => m.restockCount + m.shippingLostCount + m.shippingBrokenCount;

/** A row added in — its broken rate recomputed from the new sums, never averaged. */
function addRow(m: Metric, r: FigureFixture): Metric {
  const next = {
    restockCount: m.restockCount + r.restockCount,
    restockValuation: m.restockValuation + r.restockValuation,
    shippingLostCount: m.shippingLostCount + r.shippingLostCount,
    shippingLostValuation: m.shippingLostValuation + r.shippingLostValuation,
    shippingBrokenCount: m.shippingBrokenCount + r.shippingBrokenCount,
    shippingBrokenValuation: m.shippingBrokenValuation + r.shippingBrokenValuation,
    brokenRate: 0,
  };
  const units = unitsOf(next);

  return { ...next, brokenRate: units > 0n ? Number(next.shippingBrokenCount) / Number(units) : 0 };
}

/** The rows the filters keep — the window (inclusive), whose restocks, one supplier, the suppliers the search finds. */
function figureRowsFor(filters: FilterItem[] | undefined): FigureFixture[] {
  let start = "";
  let end = "";
  let restockTeamId = 0n;
  let supplierId = 0n;
  let keyword = "";

  for (const item of filters ?? []) {
    if (item.f.case === "dateRangeFilter") {
      start = item.f.value.dateMin;
      end = item.f.value.dateMax;
    }
    if (item.f.case === "teamFilter") restockTeamId = item.f.value.teamId;
    if (item.f.case === "supplierFilter") supplierId = item.f.value.supplierId;
    if (item.f.case === "supplierKeywordFilter") keyword = item.f.value.q.trim().toLowerCase();
  }

  // The search, as the server runs it (the-supplier-report-keeps-its-search): what SupplierList's `q` finds, deleted
  // suppliers included — they are still ranked.
  const found =
    keyword === ""
      ? undefined
      : new Set(
          suppliers
            .filter((s) => matches(keyword, s.name, s.address, s.contact, ...liveStoresOf(s.id).map((c) => c.name)))
            .map((s) => s.id),
        );

  return figureFixtures.filter((r) => {
    const day = dayAgo(r.daysAgo);

    return (
      day >= start &&
      day <= end &&
      (restockTeamId === 0n || r.teamId === restockTeamId) &&
      (supplierId === 0n || r.supplierId === supplierId) &&
      (found === undefined || found.has(r.supplierId))
    );
  });
}

/** Monday of the week a `yyyy-mm-dd` falls in. */
function mondayOf(day: string): string {
  const t = Date.parse(`${day}T00:00:00Z`);
  const back = (new Date(t).getUTCDay() + 6) % 7;

  return new Date(t - back * 86_400_000).toISOString().slice(0, 10);
}

/** A row's key for a group — an id, or the first day of its period. */
function keyOf(r: FigureFixture, group: GroupType): string {
  const day = dayAgo(r.daysAgo);

  switch (group) {
    case GroupType.SUPPLIER:
      return r.supplierId.toString();
    case GroupType.PRODUCT:
      return r.productId.toString();
    case GroupType.WEEKLY:
      return mondayOf(day);
    case GroupType.MONTHLY:
      return `${day.slice(0, 7)}-01`;
    case GroupType.YEARLY:
      return `${day.slice(0, 4)}-01-01`;
    default:
      return day;
  }
}

const isDayGroup = (group: GroupType) =>
  group === GroupType.DAILY || group === GroupType.WEEKLY || group === GroupType.MONTHLY || group === GroupType.YEARLY;

function grouped(filters: FilterItem[] | undefined, group: GroupType): Map<string, Metric> {
  const out = new Map<string, Metric>();
  for (const r of figureRowsFor(filters)) {
    const k = keyOf(r, group);
    out.set(k, addRow(out.get(k) ?? zeroMetric(), r));
  }

  return out;
}

/** The larger key first — an id by number, a day by date — the tie-break every sort ends on. */
const keyDesc = (a: string, b: string) => (a.length !== b.length ? b.length - a.length : b < a ? -1 : b > a ? 1 : 0);

/** A proto field name as the generated message spells it — `restock_valuation` → `restockValuation`. */
const camel = (field: string) => field.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()) as keyof Metric;

export const supplierAnalyticService: Partial<ServiceImpl<typeof SupplierAnalyticService>> = {
  metricSearch: (req) => {
    const field = req.sort?.field ?? "";
    const sortable = SupplierMetricSchema.fields.find((f) => f.name === field);
    if (!sortable || !getOption(sortable, metric_sort).canSort) {
      throw new ConnectError(`metrics/suppliers cannot be sorted by ${field}`, Code.InvalidArgument);
    }

    const asc = req.sort?.sortType === SortType.ASC;
    const value = (m: Metric) => Number(m[camel(field)]);
    const minimum = BigInt(getOption(sortable, metric_sort).rankMinSample);

    const ranked = [...grouped(req.filters, req.groupBy).entries()].sort(([ka, a], [kb, b]) => {
      const rankedA = unitsOf(a) >= minimum;
      const rankedB = unitsOf(b) >= minimum;
      if (rankedA !== rankedB) return rankedA ? -1 : 1;
      if (rankedA && value(a) !== value(b)) return asc ? value(a) - value(b) : value(b) - value(a);

      return keyDesc(ka, kb);
    });

    const offset = req.page?.offset ?? 0;
    const limit = req.page?.limit ?? 20;
    const page = ranked.slice(offset, offset + limit).map(([k]) => k);

    return {
      keys: isDayGroup(req.groupBy)
        ? { k: { case: "days", value: { days: page } } }
        : { k: { case: "ids", value: { ids: page.map(BigInt) } } },
      hasNext: ranked.length > offset + limit,
    };
  },

  metricData: (req) => {
    if (req.groupBy === GroupType.SUMMARY) {
      let total = zeroMetric();
      for (const r of figureRowsFor(req.filters)) total = addRow(total, r);

      return { metricDatas: req.metricIds.map(() => ({ m: { case: "supplierSummary" as const, value: total } })) };
    }

    const byKey = grouped(req.filters, req.groupBy);

    if (req.keys?.k.case === "days") {
      const items: Record<string, Metric> = {};
      for (const day of req.keys.k.value.days) items[day] = byKey.get(day) ?? zeroMetric();

      return { metricDatas: req.metricIds.map(() => ({ m: { case: "supplierByDay" as const, value: { items } } })) };
    }

    const items: Record<string, Metric> = {};
    for (const id of req.keys?.k.case === "ids" ? req.keys.k.value.ids : []) {
      items[id.toString()] = byKey.get(id.toString()) ?? zeroMetric();
    }

    return { metricDatas: req.metricIds.map(() => ({ m: { case: "supplierById" as const, value: { items } } })) };
  },
};
