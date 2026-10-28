import { type MessageInitShape, getOption } from "@bufbuild/protobuf";
import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";

import { productClient, supplierAnalyticClient, supplierClient } from "../../api/clients";
import { key, listQuery } from "../../api/queryClient";
import {
  type FilterItemSchema,
  GroupType,
  type MetricKeys,
  SortType,
  metric,
  metric_sort,
} from "../../gen/warehouse/analytic_base/v1/analytic_pb";
import { type MetricData, SupplierMetricSchema } from "../../gen/warehouse/supplier/v1/supplier_analytic_pb";
import { type PeriodGrain, bucketSpine } from "../../lib/period";
import { productByIdsRowData, productsFromByIds } from "../products/adapt";
import { teamsByIdsQuery } from "../teams/queries";
import { supplierByIdsRowData, suppliersFromByIds } from "./adapt";
import { type SupplierFigures, figuresOf } from "./figures";

// A SUPPLIER'S FIGURES — the reads behind the Statistics tab and the Supplier Report
// (the-figures-are-a-statistics-tab-and-a-supplier-report). supplier_service serves them as ONE metric,
// `metrics/suppliers`, through the analytic pattern every service's figures share (docs/business/analytic/rpc_provide.md,
// the-pattern-replaces-the-shipped-analytics):
//
//   MetricSearch   ranks the keys of a page — suppliers, or one supplier's products
//   MetricData     fills those keys — or, grouped by SUMMARY, reads the headline over the whole window
//
//   useSupplierHeadline         MetricData SUMMARY — the window's total, keyed without the page
//   useSupplierFigureSeries     the periods are listed HERE (a time group needs no search), then MetricData fills
//                               the page's periods
//   useSupplierFiguresByProduct MetricSearch by product, then MetricData for that page
//   useSupplierRanking          MetricSearch by supplier, then MetricData for that page
//
// No read returns a total: a page says only whether another follows (a-metric-page-has-no-total), which is what the
// growing pager reads.
//
// ⚠ A FIGURE LAGS THE ACCEPT by the broker's delivery — the figures are folded, never summed from the restocks live.
//
// All three are `listQuery`: a window, a grain, a team, a search or a page REFINES the same question, so the previous
// figures stay on screen while the next ones load (HARD RULE 10). Pair with RefreshOverlay.

/** The metric's id, read off the proto — never typed by hand (the-pattern-replaces-the-shipped-analytics). */
const SUPPLIERS = getOption(SupplierMetricSchema, metric).metricId;

/**
 * The units a supplier needs in the window to be RANKED by its broken rate (rate-ranking-needs-50-units) — the
 * `rank_min_sample` on `broken_rate`, read off the proto so the screen never keeps a copy of its own.
 */
export const RATE_MIN_UNITS = Number(getOption(SupplierMetricSchema.field.brokenRate, metric_sort).rankMinSample);

/** How the Supplier Report orders its suppliers — each a sortable field of `metrics/suppliers`, by its proto name. */
export type SupplierRankBy = "value" | "brokenRate";

const rankField: Record<SupplierRankBy, string> = {
  value: "restock_valuation",
  brokenRate: "broken_rate",
};

/** A team named on a row — "" when its name could not be resolved, and the screen reads "Team #<id>". */
export interface FigureTeam {
  teamId: bigint;
  name: string;
}

export interface SupplierFigurePoint {
  /** The bucket's first day, `yyyy-mm-dd` — the 1st of a month, 1 January of a year. */
  at: string;
  figures: SupplierFigures;
}

export interface SupplierProductRow {
  /** `<team>|<product>` — two teams buying one item are two rows. The team is 0 when the product is unknown. */
  key: string;
  productId: bigint;
  /** "" when product_service could not name it — the screen reads "Product #<id>". */
  name: string;
  sku: string;
  /** The product's list-sized picture — "" when it has none, and the shared item draws its placeholder. */
  thumbnailUrl: string;
  /** The team whose product it is — the team that restocked it. */
  team: FigureTeam;
  figures: SupplierFigures;
}

export interface RankedSupplier {
  id: bigint;
  /** "" when supplier_service could not name it. */
  name: string;
  /** The team that keeps it. */
  teamId: bigint;
  teamName: string;
  /** Deleted, its figures kept (a-deleted-supplier-is-kept-for-its-figures). Neither detail page shows it. */
  deleted: boolean;
}

export interface SupplierRankRow {
  /** 1-based, across every page. */
  rank: number;
  supplier: RankedSupplier;
  figures: SupplierFigures;
}

interface Window {
  /** The caller's team — the scope every read is authorised in. */
  teamId: bigint | undefined;
  from: string;
  to: string;
  /** False when the window is unbounded or backwards — the screen explains, nothing is asked. */
  valid: boolean;
  /** Whose restocks are counted — 0n is every team's (the-team-filter-picks-any-selling-team). */
  restockTeamId: bigint;
}

interface Paged {
  page: number;
  pageSize: number;
}

type Filter = MessageInitShape<typeof FilterItemSchema>;

/** The window and, when one is picked, the restocking team — the filters every supplier read carries. */
function windowFilters({ from, to, restockTeamId }: Window): Filter[] {
  const out: Filter[] = [{ f: { case: "dateRangeFilter", value: { dateMin: from, dateMax: to } } }];
  if (restockTeamId !== 0n) out.push({ f: { case: "teamFilter", value: { teamId: restockTeamId } } });

  return out;
}

const supplierFilter = (supplierId: bigint): Filter => ({ f: { case: "supplierFilter", value: { supplierId } } });

const idKeys = (ids: bigint[]) => ({ k: { case: "ids" as const, value: { ids } } });

const idsOf = (keys: MetricKeys | undefined): bigint[] => (keys?.k.case === "ids" ? keys.k.value.ids : []);

/** The one answer for `metrics/suppliers` — the call asks for nothing else. */
function supplierData(datas: MetricData[]) {
  const m = datas[0]?.m;

  return {
    byId: m?.case === "supplierById" ? m.value.items : {},
    byDay: m?.case === "supplierByDay" ? m.value.items : {},
    summary: m?.case === "supplierSummary" ? m.value : undefined,
  };
}

/** The headline — the same metric grouped by SUMMARY, over the same filters (the-headline-is-the-metric-grouped-by-summary). */
async function headline(teamId: bigint, filters: Filter[]): Promise<SupplierFigures> {
  const res = await supplierAnalyticClient.metricData({
    teamId,
    groupBy: GroupType.SUMMARY,
    filters,
    metricIds: [SUPPLIERS],
  });

  return figuresOf(supplierData(res.metricDatas).summary);
}

const groupOf: Record<PeriodGrain, GroupType> = {
  day: GroupType.DAILY,
  month: GroupType.MONTHLY,
  year: GroupType.YEARLY,
};

/** A bucket label — `2026-10-07`, `2026-10`, `2026` — as its first day, the key a period is filled by. */
function firstDay(label: string, grain: PeriodGrain): string {
  if (grain === "year") return `${label}-01-01`;
  if (grain === "month") return `${label}-01`;

  return label;
}

/**
 * Team id → name, best-effort: a name is a label, so a failed lookup leaves the rows standing with "Team #<id>" rather
 * than failing the figures.
 */
async function teamNames(client: QueryClient, ids: bigint[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.some((id) => id > 0n)) return out;

  try {
    const teams = await client.fetchQuery(teamsByIdsQuery(ids));
    for (const [id, team] of Object.entries(teams)) out.set(id, team.name);
  } catch {
    // Labels only — see above.
  }

  return out;
}

/**
 * The HEADLINE — the window's six figures as one total, asked of the server rather than summed from the page on screen:
 * one supplier's (the Statistics tab) or every supplier's (the Supplier Report).
 *
 * Its own query, keyed WITHOUT the page: a page turn does not change it, and over a year it is a scan of the whole
 * window (audits/services/supplier_service/performances/MetricData.md, finding 1).
 */
export function useSupplierHeadline(args: Window & { supplierId?: bigint }) {
  const { teamId, from, to, valid, restockTeamId, supplierId = 0n } = args;

  return useQuery({
    ...listQuery,
    queryKey: key.suppliers(teamId, {
      figures: "headline",
      supplierId: supplierId.toString(),
      from,
      to,
      restockTeamId: restockTeamId.toString(),
    }),
    enabled: teamId !== undefined && valid,
    queryFn: () => {
      const filters = windowFilters(args);
      if (supplierId !== 0n) filters.push(supplierFilter(supplierId));

      return headline(teamId!, filters);
    },
  });
}

/**
 * One supplier's six figures over time — every period of the window, NEWEST first, the quiet ones included. Its total
 * is `useSupplierHeadline`.
 *
 * A time group needs no search: the periods are listed here, so a quiet one is a row too, and the page is a slice of
 * that list (the-two-steps).
 */
export function useSupplierFigureSeries(args: Window & Paged & { supplierId: bigint; grain: PeriodGrain }) {
  const { teamId, supplierId, from, to, valid, restockTeamId, grain, page, pageSize } = args;

  return useQuery({
    ...listQuery,
    queryKey: key.suppliers(teamId, {
      figures: "series",
      supplierId: supplierId.toString(),
      from,
      to,
      restockTeamId: restockTeamId.toString(),
      grain,
      page,
      pageSize,
    }),
    enabled: teamId !== undefined && supplierId > 0n && valid,
    queryFn: async () => {
      const filters = [...windowFilters(args), supplierFilter(supplierId)];
      const periods = bucketSpine(from, to, grain)
        .map((label) => firstDay(label, grain))
        .reverse();
      const keys = periods.slice((page - 1) * pageSize, page * pageSize);

      const filled =
        keys.length === 0
          ? undefined
          : await supplierAnalyticClient.metricData({
              teamId: teamId!,
              groupBy: groupOf[grain],
              filters,
              keys: { k: { case: "days", value: { days: keys } } },
              metricIds: [SUPPLIERS],
            });

      const byDay = supplierData(filled?.metricDatas ?? []).byDay;
      const points: SupplierFigurePoint[] = keys.map((at) => ({ at, figures: figuresOf(byDay[at]) }));

      return { points, hasNext: page * pageSize < periods.length };
    },
  });
}

/** One supplier's six figures per product over the window, the largest restocked value first — Product Grouped. */
export function useSupplierFiguresByProduct(args: Window & Paged & { supplierId: bigint }) {
  const { teamId, supplierId, from, to, valid, restockTeamId, page, pageSize } = args;
  const client = useQueryClient();

  return useQuery({
    ...listQuery,
    queryKey: key.suppliers(teamId, {
      figures: "byProduct",
      supplierId: supplierId.toString(),
      from,
      to,
      restockTeamId: restockTeamId.toString(),
      page,
      pageSize,
    }),
    enabled: teamId !== undefined && supplierId > 0n && valid,
    queryFn: async () => {
      const filters = [...windowFilters(args), supplierFilter(supplierId)];

      const ranked = await supplierAnalyticClient.metricSearch({
        teamId: teamId!,
        groupBy: GroupType.PRODUCT,
        filters,
        sort: { metricId: SUPPLIERS, field: "restock_valuation", sortType: SortType.DESC },
        page: { offset: (page - 1) * pageSize, limit: pageSize },
      });

      const productIds = idsOf(ranked.keys);
      if (productIds.length === 0) return { rows: [] as SupplierProductRow[], hasNext: ranked.hasNext };

      const filled = await supplierAnalyticClient.metricData({
        teamId: teamId!,
        groupBy: GroupType.PRODUCT,
        filters,
        keys: idKeys(productIds),
        metricIds: [SUPPLIERS],
      });
      const byId = supplierData(filled.metricDatas).byId;

      // The names are product_service's — any team's product, by id — and so is the team: a product is ITS team's, the
      // team that restocked it. A label, so a failure leaves the ids standing.
      const products = new Map<string, { name: string; sku: string; thumbnailUrl: string; teamId: bigint }>();
      try {
        const resolved = await productClient.productByIds({
          teamId: teamId!,
          filter: { ids: productIds },
          dataRequest: productByIdsRowData(),
        });
        for (const p of productsFromByIds(resolved)) {
          // The picture rides the same read — the thumbnail, or the full image when there is no thumbnail.
          const thumbnailUrl = p.defaultImageThumbnailUrl || p.defaultImageUrl;
          products.set(p.id.toString(), { name: p.name, sku: p.sku, thumbnailUrl, teamId: p.teamId });
        }
      } catch {
        // Labels only.
      }

      const teams = await teamNames(client, [...products.values()].map((p) => p.teamId));

      const rows: SupplierProductRow[] = productIds.map((productId) => {
        const product = products.get(productId.toString());
        const owner = product?.teamId ?? 0n;

        return {
          key: `${owner}|${productId}`,
          productId,
          name: product?.name ?? "",
          sku: product?.sku ?? "",
          thumbnailUrl: product?.thumbnailUrl ?? "",
          team: { teamId: owner, name: teams.get(owner.toString()) ?? "" },
          figures: figuresOf(byId[productId.toString()]),
        };
      });

      return { rows, hasNext: ranked.hasNext };
    },
  });
}

/**
 * Suppliers RANKED over the window — by restocked value, or by broken rate. No search
 * (the-supplier-report-drops-its-search). The headline, every ranked supplier together, is `useSupplierHeadline`.
 *
 * Three reads: the ranking (ids), then their figures and their names together — SupplierByIds, which names a DELETED
 * supplier too.
 */
export function useSupplierRanking(args: Window & Paged & { rankBy: SupplierRankBy }) {
  const { teamId, from, to, valid, restockTeamId, rankBy, page, pageSize } = args;
  const client = useQueryClient();

  return useQuery({
    ...listQuery,
    queryKey: key.suppliers(teamId, {
      figures: "ranking",
      from,
      to,
      restockTeamId: restockTeamId.toString(),
      rankBy,
      page,
      pageSize,
    }),
    enabled: teamId !== undefined && valid,
    queryFn: async () => {
      const filters = windowFilters(args);

      const ranked = await supplierAnalyticClient.metricSearch({
        teamId: teamId!,
        groupBy: GroupType.SUPPLIER,
        filters,
        sort: { metricId: SUPPLIERS, field: rankField[rankBy], sortType: SortType.DESC },
        page: { offset: (page - 1) * pageSize, limit: pageSize },
      });

      const ids = idsOf(ranked.keys);
      if (ids.length === 0) {
        return { rows: [] as SupplierRankRow[], hasNext: ranked.hasNext };
      }

      const [filled, suppliers] = await Promise.all([
        supplierAnalyticClient.metricData({
          teamId: teamId!,
          groupBy: GroupType.SUPPLIER,
          filters,
          keys: idKeys(ids),
          metricIds: [SUPPLIERS],
        }),
        supplierClient
          .supplierByIds({ teamId: teamId!, filter: { ids }, dataRequest: supplierByIdsRowData() })
          .then(suppliersFromByIds),
      ]);
      const byId = supplierData(filled.metricDatas).byId;

      const teams = await teamNames(client, [...suppliers.values()].map((s) => s.teamId));

      const rows: SupplierRankRow[] = ids.map((id, i) => {
        const supplier = suppliers.get(id.toString());
        const owner = supplier?.teamId ?? 0n;

        return {
          rank: (page - 1) * pageSize + i + 1,
          supplier: {
            id,
            name: supplier?.name ?? "",
            teamId: owner,
            teamName: teams.get(owner.toString()) ?? "",
            deleted: supplier?.deleted ?? false,
          },
          figures: figuresOf(byId[id.toString()]),
        };
      });

      return { rows, hasNext: ranked.hasNext };
    },
  });
}
