import { useEffect, useRef, useState } from "react";

import { productClient, rackClient, rpcError, teamClient } from "../../api/clients";
import { productByIdsRowData, productsFromByIds } from "../../features/products/adapt";
import { rackStockFromList, rackStockRowData } from "../../features/racks/adapt";
import { teamByIdsRowData, teamsByIds } from "../../features/teams/adapt";
import type { RackStockLine } from "../../gen/warehouse/inventory/v1/rack_pb";
import type { Product } from "../../gen/warehouse/product/v1/product_pb";
import type { Team } from "../../gen/warehouse/team/v1/team_pb";

/** One page of what is on a rack, and what each thing IS — with its own pager. */
export interface RackShelf {
  lines: RackStockLine[];
  /** productId → product. ProductByIds answers unordered and may answer SHORT, so rows are matched by id. */
  products: Map<string, Product>;
  /** teamId → team, for each row's Tim column — resolved after the rows, cached for the page's life. */
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

// WHAT IS ON A RACK, ONE PAGE OF IT, PRICED — the Produk section's read and its pager (a-rack-page-is-one-page-of-sections).
//
// The two calls are deliberately SERIALISED and committed together, rather than showing the lines and letting the names
// land after: "Unknown product" is a claim — that the catalogue no longer lists it — and flashing it down the column on
// every page load, while the lookup is merely in flight, would assert something false. (A team NAME is decoration with an
// honest "Team #<id>" fallback, so that one resolves after.)
//
// The page exists because a warehouse holds OTHER TEAMS' goods: RackStock returns product ids this warehouse does not
// own, and ONLY ids — resolving them is the caller's job, via ProductByIds and NOT ProductList, which serves the
// warehouse's own catalogue and would silently omit most of the shelf.
export function useRackShelf(teamId: bigint | undefined, rackId: bigint, reloadKey: number): RackShelf {
  const [lines, setLines] = useState<RackStockLine[]>([]);
  const [products, setProducts] = useState<Map<string, Product>>(new Map());
  const [teams, setTeams] = useState<Map<string, Team>>(new Map());
  const [fetching, setFetching] = useState(true);
  // Which rack the lines on screen are: a re-read of the SAME rack keeps them drawn while it asks (a refresh moves
  // nothing — HARD RULE 10, backlog #45); another rack's lines are not this one's to show, so that is a first load.
  const [shownFor, setShownFor] = useState<bigint | null>(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(20);
  const [totalItems, setTotalItems] = useState(0);

  // Read inside the effect WITHOUT making it a dependency: `teams` grows as pages resolve, so depending on it would re-run
  // the effect on its own result.
  const teamsRef = useRef(teams);
  teamsRef.current = teams;

  useEffect(() => {
    if (teamId === undefined || rackId === 0n) {
      setFetching(false);
      return;
    }

    let ignore = false;

    setFetching(true);
    setError("");

    void (async () => {
      try {
        const res = await rackClient.rackStock({
          teamId,
          filter: { rackId },
          dataRequest: rackStockRowData(),
          page: { page, limit: pageSize },
        });
        if (ignore) return;

        const stockLines = rackStockFromList(res.items, res.ids);

        // Unique and non-zero: ProductByIds demands min_items:1, unique ids, each > 0 — so a duplicate or an empty set
        // must never become a call. The cap is 200 and a page is at most 50, so a page's ids always fit in ONE call.
        const ids = [...new Set(stockLines.map((line) => line.productId).filter((id) => id > 0n))];
        const resolved = new Map<string, Product>();

        if (ids.length > 0) {
          try {
            // `teamId` here is the team the CALLER holds a role in — this warehouse — not the team whose products come
            // back. That is what lets it resolve a selling team's product.
            const productRes = await productClient.productByIds({
              teamId,
              filter: { ids },
              dataRequest: productByIdsRowData(),
            });
            if (ignore) return;

            for (const product of productsFromByIds(productRes)) {
              resolved.set(product.id.toString(), product);
            }
          } catch {
            // Swallowed on purpose: the goods are on the shelf whether or not the catalogue can be read. Every row falls
            // back to the unresolved label and KEEPS ITS COUNT, which is the number someone at the rack came for.
          }
        }

        if (ignore) return;

        setLines(stockLines);
        setProducts(resolved);
        setTotalItems(Number(res.pageInfo?.totalItems ?? 0n));
        setShownFor(rackId);
      } catch (err) {
        if (!ignore) {
          setError(rpcError(err));
          setLines([]);
          setProducts(new Map());
          setTotalItems(0);
          setShownFor(null);
        }
      } finally {
        if (!ignore) setFetching(false);
      }
    })();

    return () => {
      ignore = true;
    };
  }, [teamId, rackId, page, pageSize, reloadKey]);

  // The owning team per row, resolved in ONE batch and cached for the page's life — paging back, or a second page owned by
  // the same teams, costs nothing. Deliberately does NOT gate `loading`: rows render with TeamItem's "Team #<id>" fallback
  // and upgrade in place.
  useEffect(() => {
    if (products.size === 0) return;

    const missing = [
      ...new Set(
        [...products.values()]
          .map((product) => product.teamId)
          .filter((id) => id > 0n && !teamsRef.current.has(id.toString())),
      ),
    ];

    if (missing.length === 0) return;

    let ignore = false;

    void (async () => {
      try {
        const found = teamsByIds(await teamClient.teamByIds({ filter: { ids: missing }, dataRequest: teamByIdsRowData() }));
        if (ignore) return;

        setTeams((prev) => {
          const next = new Map(prev);
          for (const [id, team] of Object.entries(found)) {
            next.set(id, team);
          }

          return next;
        });
      } catch {
        // A name is decoration: TeamItem falls back to "Team #<id>".
      }
    })();

    return () => {
      ignore = true;
    };
  }, [products]);

  const setPageSize = (size: number) => {
    setPageSizeState(size);
    setPage(1);
  };

  const shown = shownFor === rackId;

  return {
    lines,
    products,
    teams,
    loading: fetching && !shown,
    refreshing: fetching && shown,
    error,
    page,
    setPage,
    pageSize,
    setPageSize,
    totalItems,
  };
}
