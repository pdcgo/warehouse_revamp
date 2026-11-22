import { useState } from "react";

import { rpcError } from "../../api/clients";
import { useRackShelfPage, useShelfTeams } from "../../features/racks/queries";
import type { RackStockLine } from "../../gen/warehouse/inventory/v1/rack_pb";
import type { Product } from "../../gen/warehouse/product/v1/product_pb";
import type { Team } from "../../gen/warehouse/team/v1/team_pb";

/** One page of what is on a rack, and what each thing IS — with its own pager. */
export interface RackShelf {
  lines: RackStockLine[];
  /** productId → product. ProductByIds answers unordered and may answer SHORT, so rows are matched by id. */
  products: Map<string, Product>;
  /** teamId → team, for each row's Tim column — resolved after the rows, kept for the page's life. */
  teams: Map<string, Team>;
  /** The FIRST read of this rack's shelf, nothing of it drawn yet — the section shows its skeleton. */
  loading: boolean;
  /** A re-read over rows already drawn (a write on the page, a page turned) — they stay, under RefreshOverlay. */
  refreshing: boolean;
  error: string;
  page: number;
  setPage: (page: number) => void;
  pageSize: number;
  setPageSize: (size: number) => void;
  totalItems: number;
}

const NO_LINES: RackStockLine[] = [];
const NO_PRODUCTS = new Map<string, Product>();

// WHAT IS ON A RACK, ONE PAGE OF IT, PRICED — the Produk section's read and its pager (a-rack-page-is-one-page-of-sections).
//
// The read is a query (features/racks useRackShelfPage — the lines and their product names committed together, then
// useShelfTeams for the owners), so a write on the page refreshes it by invalidation; this keeps the pager and turns the
// query's states into the section's two: `loading` — the first read of THIS rack, nothing drawn, the skeleton — and
// `refreshing` — a re-read over rows already drawn (`isFetching && !isPending`, HARD RULE 10, #45): a write on the page,
// a page turned. Another rack (the address changed) is a first load, never the previous rack's rows (keepWithinRack).
export function useRackShelf(teamId: bigint | undefined, rackId: bigint): RackShelf {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(20);

  const query = useRackShelfPage({ teamId, rackId, page, pageSize });
  const products = query.data?.products ?? NO_PRODUCTS;
  const teams = useShelfTeams(products);

  const setPageSize = (size: number) => {
    setPageSizeState(size);
    setPage(1);
  };

  return {
    lines: query.data?.lines ?? NO_LINES,
    products,
    teams,
    loading: query.isPending,
    refreshing: query.isFetching && !query.isPending,
    error: query.error ? rpcError(query.error) : "",
    page,
    setPage,
    pageSize,
    setPageSize,
    totalItems: query.data?.totalItems ?? 0,
  };
}
