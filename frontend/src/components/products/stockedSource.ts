import { inventoryClient, productClient } from "../../api/clients";
import type { Product } from "../../gen/warehouse/product/v1/product_pb";
import { productByIdsRowData, productListRowData, productsFromByIds } from "../../features/products/adapt";
import { PAGE_SIZE, SEARCH_RESOLVE_LIMIT } from "./ProductPickerShell";
import type { PickerPage } from "./ProductPickerShell";

// THE WAREHOUSE IS THE CATALOGUE — the shared half of the two stocked pickers.
//
// Paging happens in inventory_service, over the products a warehouse actually HOLDS. Filtering an
// out-of-stock product out of a catalogue page instead would show two rows out of ten while the pager
// went on counting all ten (`StockedProductList`'s own reason for existing).
//
// The awkward part, and it is inherent rather than accidental: names and SKUs live in the CATALOGUE,
// which inventory cannot see and must not join to (HARD RULE 3 — services stay independent). So every
// narrowing that mentions a name has to be resolved to ids in product_service first and handed over as
// `filter.product_ids`. That is what both functions below do; they differ only in WHOSE catalogue they
// resolve against, which is exactly the own/all split.

// `StockedProductListFilter.product_ids` is validated `max_items: 500`. It is the hard ceiling on
// "narrow this warehouse to my catalogue" — past it the narrowing cannot be expressed at all, and the
// honest fix is an `owner_team_id` on the filter rather than a bigger list.
export const CATALOGUE_ID_LIMIT = 500;

// PageFilter.limit is validated 1..200, so collecting a catalogue costs ceil(n/200) calls.
const ID_PAGE = 200;

/** What a catalogue resolve produced: the ids to narrow by, and whether it saw everything. */
export interface ResolvedIds {
  ids: bigint[];
  capped: boolean;
}

/**
 * Every product id in ONE team's catalogue, up to the filter's ceiling.
 *
 * ⚠ THIS IS THE COST OF "own" ON A STOCKED PICKER, and it is worth seeing plainly: inventory_service
 * has no owner axis, so "my catalogue, in this building" can only be asked as "these 500 ids, in this
 * building". A 400-product catalogue is two round-trips before the first row renders.
 *
 * Cached by the caller for the dialog's life — it is a fact about a team, not about a page.
 */
export async function ownCatalogueIds(teamId: bigint): Promise<ResolvedIds> {
  const ids: bigint[] = [];
  let page = 1;
  let total = 0;

  while (ids.length < CATALOGUE_ID_LIMIT) {
    const res = await productClient.productList({
      teamId,
      filter: {},
      dataRequest: productListRowData(),
      page: { page, limit: ID_PAGE },
    });

    total = Number(res.pageInfo?.totalItems ?? 0n);
    ids.push(...res.ids);

    if (res.ids.length < ID_PAGE || ids.length >= total) {
      break;
    }

    page += 1;
  }

  return { ids: ids.slice(0, CATALOGUE_ID_LIMIT), capped: total > CATALOGUE_ID_LIMIT };
}

/**
 * The ids matching a search term, resolved against a catalogue before inventory sees them.
 *
 * `own` picks the RPC: ProductList stays inside one team's catalogue, ProductDiscover reaches across
 * every team — which is the only difference between searching the own-stocked and all-stocked pickers.
 */
export async function searchCatalogueIds(args: {
  scopeTeamId: bigint;
  q: string;
  own: boolean;
}): Promise<ResolvedIds> {
  const { scopeTeamId, q, own } = args;

  const req = {
    teamId: scopeTeamId,
    filter: { q },
    dataRequest: productListRowData(),
    page: { page: 1, limit: SEARCH_RESOLVE_LIMIT },
  };

  const res = own
    ? await productClient.productList(req)
    : await productClient.productDiscover(req);

  return {
    ids: res.ids,
    capped: Number(res.pageInfo?.totalItems ?? 0n) > SEARCH_RESOLVE_LIMIT,
  };
}

/**
 * One page of "what this warehouse holds", narrowed to `productIds` when given.
 *
 * ⚠ AN EMPTY `productIds` MEANS "NO NARROWING" TO INVENTORY — the whole warehouse. A caller whose
 * resolve legitimately matched nothing must therefore say so itself rather than sending an empty
 * list, or a search for a product the team does not sell would return the entire building.
 */
export async function stockedPage(args: {
  scopeTeamId: bigint;
  warehouseId: bigint;
  productIds: bigint[];
  page: number;
  capped: boolean;
}): Promise<PickerPage> {
  const { scopeTeamId, warehouseId, productIds, page, capped } = args;

  const listed = await inventoryClient.stockedProductList({
    teamId: scopeTeamId,
    filter: { warehouseId, productIds },
    page: { page, limit: PAGE_SIZE },
  });

  // The ready figure rides along with the list — it is the number the list was built from, so there
  // is no second read to disagree with it.
  const ready = new Map(listed.items.map((it) => [it.productId.toString(), it.available]));

  // The NAMES and covers, for this page's ten ids. ProductByIds resolves whoever owns them, which is
  // what lets a warehouse hold another team's goods and still show them properly.
  const details =
    listed.ids.length === 0
      ? []
      : productsFromByIds(
          await productClient.productByIds({
            teamId: scopeTeamId,
            filter: { ids: listed.ids },
            dataRequest: productByIdsRowData(),
          }),
        );

  // Back into the order inventory returned, which is the order the pager is built on — the by-ids
  // response is a map and carries no order of its own.
  const byId = new Map(details.map((p) => [p.id.toString(), p]));

  return {
    products: listed.ids.map((id) => byId.get(id.toString())).filter((p): p is Product => !!p),
    total: Number(listed.pageInfo?.totalItems ?? 0n),
    capped,
    ready,
  };
}

/** The page a picker shows when its resolve matched nothing — see the warning on `stockedPage`. */
export function noMatches(capped: boolean): PickerPage {
  return { products: [], total: 0, capped, ready: new Map() };
}
