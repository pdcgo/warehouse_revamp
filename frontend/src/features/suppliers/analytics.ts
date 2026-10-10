import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";

import { productClient, supplierAnalyticClient, supplierClient } from "../../api/clients";
import { key, listQuery } from "../../api/queryClient";
import { CommonSortType } from "../../gen/warehouse/common/v1/list_pb";
import { AnalyticGroupSort, AnalyticTimeframe } from "../../gen/warehouse/supplier/v1/supplier_analytic_pb";
import type { PeriodGrain } from "../../lib/period";
import { productByIdsRowData, productsFromByIds } from "../products/adapt";
import { teamsByIdsQuery } from "../teams/queries";
import { supplierByIdsRowData, suppliersFromByIds } from "./adapt";
import { type SupplierFigures, figuresOf } from "./figures";

// A SUPPLIER'S FIGURES — the reads behind the Statistics tab and the Supplier Report
// (the-figures-are-a-statistics-tab-and-a-supplier-report, accepted with the-figures-screens-are-accepted). Each is one
// read of supplier_service's SupplierAnalyticService, which folds the restock's *Restock Accepted* event
// (the-report-is-processed-like-settlement):
//
//   useSupplierFigureSeries     AnalyticTimeSearch      the six figures by day, month or year, and the window's total
//   useSupplierFiguresByProduct AnalyticProductSearch   the six figures per product, over the window
//   useSupplierRanking          AnalyticGroupSearch     suppliers ranked over the window, and their headline
//                               + AnalyticGroupMetric
//
// ⚠ A FIGURE LAGS THE ACCEPT by the broker's delivery — the figures are folded, never summed from the restocks live.
//
// All three are `listQuery`: a window, a grain, a team, a search or a page REFINES the same question, so the previous
// figures stay on screen while the next ones load (HARD RULE 10). Pair with RefreshOverlay.

/** How the Supplier Report orders its suppliers. */
export type SupplierRankBy = "value" | "brokenRate";

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
  /** `<team>|<product>` — two teams buying one item are two rows. */
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

const timeframeOf: Record<PeriodGrain, AnalyticTimeframe> = {
  day: AnalyticTimeframe.DAILY,
  month: AnalyticTimeframe.MONTHLY,
  year: AnalyticTimeframe.YEARLY,
};

const sortOf: Record<SupplierRankBy, AnalyticGroupSort> = {
  value: AnalyticGroupSort.RESTOCK_VALUATION,
  brokenRate: AnalyticGroupSort.BROKEN_RATE,
};

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
 * One supplier's six figures over time — every period of the window, NEWEST first, the quiet ones included — and the
 * WHOLE window as one total, asked of the server rather than summed from the page on screen.
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
      const res = await supplierAnalyticClient.analyticTimeSearch({
        teamId: teamId!,
        supplierId,
        timeframe: timeframeOf[grain],
        filter: { dateRange: { startDate: from, endDate: to }, restockTeamId },
        sortType: CommonSortType.DESC,
        page: { page, limit: pageSize },
      });

      const points: SupplierFigurePoint[] = res.datas.map((d) => ({ at: d.at, figures: figuresOf(d.metric) }));

      return {
        points,
        totalItems: Number(res.pageInfo?.totalItems ?? 0n),
        total: figuresOf(res.total),
      };
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
      const res = await supplierAnalyticClient.analyticProductSearch({
        teamId: teamId!,
        supplierId,
        filter: { dateRange: { startDate: from, endDate: to }, restockTeamId },
        page: { page, limit: pageSize },
      });

      const productIds = res.datas.map((d) => d.productId);

      // The names are product_service's — any team's product, by id. A label, so a failure leaves the ids standing.
      const products = new Map<string, { name: string; sku: string; thumbnailUrl: string }>();
      if (productIds.length > 0) {
        try {
          const resolved = await productClient.productByIds({
            teamId: teamId!,
            filter: { ids: productIds },
            dataRequest: productByIdsRowData(),
          });
          for (const p of productsFromByIds(resolved)) {
            // The picture rides the same read — the thumbnail, or the full image when there is no thumbnail.
            const thumbnailUrl = p.defaultImageThumbnailUrl || p.defaultImageUrl;
            products.set(p.id.toString(), { name: p.name, sku: p.sku, thumbnailUrl });
          }
        } catch {
          // Labels only.
        }
      }

      const teams = await teamNames(client, res.datas.map((d) => d.teamId));

      const rows: SupplierProductRow[] = res.datas.map((d) => {
        const product = products.get(d.productId.toString());

        return {
          key: `${d.teamId}|${d.productId}`,
          productId: d.productId,
          name: product?.name ?? "",
          sku: product?.sku ?? "",
          thumbnailUrl: product?.thumbnailUrl ?? "",
          team: { teamId: d.teamId, name: teams.get(d.teamId.toString()) ?? "" },
          figures: figuresOf(d.metric),
        };
      });

      return { rows, totalItems: Number(res.pageInfo?.totalItems ?? 0n) };
    },
  });
}

/**
 * Suppliers RANKED over the window — by restocked value, or by broken rate — and every ranked supplier together, the
 * report's headline. `q` finds suppliers as Discover does (the-supplier-report-searches-like-discover).
 *
 * Three reads: the ranking (ids), their figures, and their names — SupplierByIds, which names a DELETED supplier too.
 */
export function useSupplierRanking(args: Window & Paged & { rankBy: SupplierRankBy; q: string }) {
  const { teamId, from, to, valid, restockTeamId, rankBy, q, page, pageSize } = args;
  const client = useQueryClient();

  return useQuery({
    ...listQuery,
    queryKey: key.suppliers(teamId, {
      figures: "ranking",
      from,
      to,
      restockTeamId: restockTeamId.toString(),
      rankBy,
      q,
      page,
      pageSize,
    }),
    enabled: teamId !== undefined && valid,
    queryFn: async () => {
      const filter = { dateRange: { startDate: from, endDate: to }, restockTeamId, q };

      const ranked = await supplierAnalyticClient.analyticGroupSearch({
        teamId: teamId!,
        filter,
        sort: sortOf[rankBy],
        page: { page, limit: pageSize },
      });

      const base = {
        totalItems: Number(ranked.pageInfo?.totalItems ?? 0n),
        total: figuresOf(ranked.total),
        rateMinUnits: Number(ranked.rateMinUnits),
      };

      if (ranked.ids.length === 0) {
        return { ...base, rows: [] as SupplierRankRow[] };
      }

      const [metrics, suppliers] = await Promise.all([
        supplierAnalyticClient.analyticGroupMetric({ teamId: teamId!, filter, ids: ranked.ids }),
        supplierClient
          .supplierByIds({ teamId: teamId!, filter: { ids: ranked.ids }, dataRequest: supplierByIdsRowData() })
          .then(suppliersFromByIds),
      ]);

      const teams = await teamNames(client, [...suppliers.values()].map((s) => s.teamId));

      const rows: SupplierRankRow[] = ranked.ids.map((id, i) => {
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
          figures: figuresOf(metrics.metrics[id.toString()]),
        };
      });

      return { ...base, rows };
    },
  });
}
