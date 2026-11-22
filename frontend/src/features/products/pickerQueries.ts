import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { productClient } from "../../api/clients";
import { key, referenceQuery } from "../../api/queryClient";
import type { PickerBadges, PickerPage } from "../../components/products/ProductPickerShell";
import type { Product } from "../../gen/warehouse/product/v1/product_pb";
import { teamsByIdsQuery } from "../teams/queries";
import { productByIdsRowData, productsFromByIds } from "./adapt";

// THE PRODUCT PICKERS' READS (#121) — the four dialogs built on components/products/ProductPickerShell.
//
// They used to be the shell's own effects: a page load, a badge read, a team-name read and a resolve of the seeded ids,
// each a `useEffect` with its own cancel flag, all thrown away when the dialog closed. Through the query cache now, so
// every picker reads like the rest of the app (HARD RULE 10) and a reopened dialog draws what it already knows.
//
// TWO KINDS OF ANSWER, and they are not bought out alike:
//
//   a CATALOGUE page   ProductList / ProductDiscover — which products, by name     `key.products`, referenceQuery
//   the STOCK figures  READY / ONGOING, and a warehouse's stocked page            `key.inventory`, always fresh
//
// The catalogue is a picker feed — read to choose a product, not worked from — and HARD RULE 10 names a debounced
// product search as exactly what `referenceQuery` is for: a second open of the same picker asks nothing. The figures are
// stock, and a stale stock count is not cosmetic (`useStockAvailability`'s note): they are re-read on every open, as
// they always were, with the last answer kept on screen while the new one runs. The stocked pickers' page IS stock — it
// lists what a warehouse holds and carries READY with it — so it stays fresh as a whole.
//
// Each lives under the domain whose writes change it: a product created or renamed (`products`) or stock moved
// (`inventory`) marks the entry stale, so a closed picker re-reads on its next open even inside the 5-minute window.

/** What one picker's answer depends on, besides the page and the term — the variant's `loadKey` and the active tab. */
type Source = string;

// A PAGE TURN AND A NEW TERM REFINE THE SAME QUESTION — the rows on screen stay while the next answer loads
// (`listQuery`'s `keepPreviousData`, HARD RULE 10). A different SOURCE does not: another tab, another warehouse, another
// owner team is another list, and its first read shows the spinner rather than the last list's rows under its name.
function keepWithinSource(param: "picker" | "pickerBadges", source: Source) {
  return <T>(previous: T | undefined, previousQuery: { queryKey: readonly unknown[] } | undefined): T | undefined => {
    const params = previousQuery?.queryKey[2] as Record<string, unknown> | undefined;

    return params?.[param] === source ? previous : undefined;
  };
}

/**
 * ONE PAGE OF A PICKER'S ROWS — whatever its `load` answers. Read only while the dialog is open (`enabled`): a closed
 * picker on every line of a form costs nothing.
 */
export function useProductPickerPage(args: {
  scopeTeamId: bigint;
  source: Source;
  /** The rows ARE a warehouse's stock (the stocked pickers) — always fresh, under `inventory`. */
  stocked: boolean;
  q: string;
  page: number;
  enabled: boolean;
  load: ((args: { page: number; q: string }) => Promise<PickerPage>) | undefined;
}) {
  const { scopeTeamId, source, stocked, q, page, enabled, load } = args;
  const params = { picker: source, q, page };

  return useQuery({
    // By name, and only for the catalogue — see the table above.
    ...(stocked ? {} : referenceQuery),
    queryKey: stocked ? key.inventory(scopeTeamId, params) : key.products(scopeTeamId, params),
    enabled: enabled && scopeTeamId > 0n && load !== undefined,
    placeholderData: keepWithinSource("picker", source),
    queryFn: () => load!({ page, q }),
  });
}

/**
 * READY and ONGOING for the products on the page, for the pickers whose list does not carry them (`loadBadges`). Per
 * PAGE, keyed by its ids: the ask is the ten rows on screen, so paging re-reads and nothing is pulled that nobody looks
 * at. Stock, so the plain always-fresh default — and DECORATION in a picker: `loadBadges` swallows its own failures.
 */
export function useProductPickerBadges(args: {
  scopeTeamId: bigint;
  source: Source;
  products: Product[];
  enabled: boolean;
  loadBadges: ((products: Product[]) => Promise<PickerBadges>) | undefined;
}) {
  const { scopeTeamId, source, products, enabled, loadBadges } = args;
  const ids = products.map((p) => p.id.toString()).join(",");

  return useQuery({
    queryKey: key.inventory(scopeTeamId, { pickerBadges: source, ids }),
    enabled: enabled && scopeTeamId > 0n && loadBadges !== undefined && products.length > 0,
    // The last page's figures stay while this page's land: a row is looked up by its id, so a figure never sits beside
    // another product — the new rows simply have none until their answer is in.
    placeholderData: keepWithinSource("pickerBadges", source),
    queryFn: () => loadBadges!(products),
  });
}

/**
 * The OWNING TEAM'S NAME for each row's badge — one TeamByIds for the page, through the shared name lookup
 * (`teamsByIdsQuery`, referenceQuery), so paging back or reopening asks nothing. It never gates the rows: they draw at
 * once with ProductListItem's "Team #<id>" and upgrade in place — and the last page's names stay meanwhile, so a team
 * already named keeps its name on the next page.
 */
export function useProductPickerTeamNames(args: { products: Product[]; enabled: boolean }) {
  const ids = [...new Set(args.products.map((p) => p.teamId).filter((id) => id > 0n))];

  return useQuery({
    ...teamsByIdsQuery(ids),
    // TeamByIds requires at least one id — an empty set never becomes a call.
    enabled: args.enabled && ids.length > 0,
    placeholderData: keepPreviousData,
  });
}

/**
 * The SEEDED ids the browse has not shown yet, resolved to products so a selection the person never scrolls to still
 * Confirms with a real snapshot. ProductByIds (#138), in ONE call: it resolves ids the caller already holds, whoever
 * owns them — so a cross-team tick resolves too. A name lookup, so `referenceQuery`: a second open with the same seed
 * asks nothing. An options object as well as a hook, because Confirm AWAITS it (`client.fetchQuery`) when a click lands
 * before the answer — the same entry, so that wait never sends a second request.
 */
export function productPickerSeedQuery(scopeTeamId: bigint, ids: bigint[]) {
  const wanted = [...new Set(ids.filter((id) => id > 0n).map((id) => id.toString()))].sort();

  return {
    ...referenceQuery,
    queryKey: key.products(scopeTeamId, { pickerSeed: wanted.join(",") }),
    queryFn: async (): Promise<Product[]> => {
      const res = await productClient.productByIds({
        teamId: scopeTeamId,
        filter: { ids: wanted.map((id) => BigInt(id)) },
        dataRequest: productByIdsRowData(),
      });

      return productsFromByIds(res);
    },
  };
}

export function useProductPickerSeed(args: { scopeTeamId: bigint; ids: bigint[]; enabled: boolean }) {
  const { scopeTeamId, ids, enabled } = args;

  return useQuery({
    ...productPickerSeedQuery(scopeTeamId, ids),
    enabled: enabled && scopeTeamId > 0n && ids.length > 0,
  });
}
