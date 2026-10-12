import { inventoryClient } from "../../api/clients";
import { ownerStockFromByIds } from "../../features/products/adapt";
import type { Product } from "../../gen/warehouse/product/v1/product_pb";
import type { PickerBadges } from "./ProductPickerShell";

/**
 * WHICH "ready" a badge means. Two callers, two different truths, and they are not interchangeable:
 *
 * - `"owned"` — what this team OWNS at that warehouse, via `OwnerStockByIds`. The right answer when
 *   you are BUYING: a restock asks "how much of mine is already there".
 * - `"available"` — what a PICK would find there, via `StockAvailability`. The right answer when you
 *   are SELLING: an order takes whatever is on the shelf, regardless of which restock brought it in,
 *   so the ownership figure would show 0 for stock the order would happily draw.
 *
 * Getting this wrong is not cosmetic. An order screen showing the owned figure refuses goods the
 * warehouse can plainly ship; a purchasing screen showing the available figure counts another team's
 * stock as yours.
 */
export type ReadyLens = "owned" | "available";

/**
 * READY and ONGOING for a loaded page, for the pickers that browse a CATALOGUE.
 *
 * The stocked pickers do not use this: their READY figure arrives with the list, from the same query
 * the list was built from, and asking again would be a second answer to a settled question.
 *
 * Two reads, because they are two different questions:
 *
 *   ready   — `warehouse_id` = the destination. What is on a shelf THERE, which is what says whether
 *             that building needs a delivery at all.
 *   ongoing — `warehouse_id` = 0, every warehouse. What is already bought and not yet accepted
 *             ANYWHERE, which is what stops the same order being placed twice.
 *
 * They cannot share a call: `filter.warehouse_id` is one lens over the whole OwnerStockItem, so a
 * single request would have to answer both figures for the same building.
 *
 * OwnerStockByIds, not StockList, and that is the load-bearing choice: StockList is policied to
 * WAREHOUSE roles, so a selling team asking about the destination warehouse was denied every time and
 * the catch below silently swallowed it — the badge never rendered for the people this dialog is for.
 * OwnerStockByIds answers the SELLING side by construction (it establishes ownership through
 * restock_requests.requesting_team_id).
 */
export function catalogueBadges(args: {
  scopeTeamId: bigint;
  stockWarehouseId?: bigint;
  readyLens: ReadyLens;
}) {
  const { scopeTeamId, stockWarehouseId, readyLens } = args;

  return async function loadBadges(products: Product[]): Promise<PickerBadges> {
    const productIds = products.map((p) => p.id).filter((id) => id > 0n);

    if (productIds.length === 0) {
      return {};
    }

    // Each read swallows its own failure, so one lens failing never blanks the other. Stock is
    // DECORATION in a picker — the job of the dialog is picking products, and a read the caller has
    // no role for must not take it down.
    const ask = (warehouseId: bigint) =>
      inventoryClient
        .ownerStockByIds({ teamId: scopeTeamId, filter: { productIds, warehouseId } })
        .then(ownerStockFromByIds)
        .catch(() => null);

    const askAvailable = (warehouseId: bigint) =>
      inventoryClient
        .stockAvailability({ teamId: scopeTeamId, warehouseId, productIds })
        .then((res) => new Map(res.items.map((it) => [it.productId.toString(), it.available])))
        .catch(() => null);

    // ONGOING is NOT gated on a warehouse, and deliberately so (owner): it is totalled across EVERY
    // warehouse holding the team's goods, because "have I already bought this?" is a question about
    // the purchase, not about a building. So it appears as soon as there is a catalogue.
    const wantReady = stockWarehouseId !== undefined && stockWarehouseId > 0n;

    const readyAsk = () => {
      if (!wantReady) {
        return Promise.resolve(null);
      }

      return readyLens === "available"
        ? askAvailable(stockWarehouseId)
        : ask(stockWarehouseId).then((rows) =>
            rows === null
              ? null
              : new Map(productIds.map((id) => [id.toString(), rows.get(id.toString())?.readyQty ?? 0n])),
          );
    };

    const [readyRes, ongoingRes] = await Promise.all([readyAsk(), ask(0n)]);

    // ABSENT means ZERO here, not unknown — and only because we named the ids. The response omits a
    // product the team holds none of ("nothing to say travels lighter"), but we asked about every id
    // on the page, so silence about one IS the answer for it. Unknown is the whole map missing: the
    // read failed, or was never made, and then no badge is shown rather than a fabricated 0.
    const spread = (
      rows: Map<string, { readyQty: bigint; ongoingQty: bigint }> | null,
      pick: "readyQty" | "ongoingQty",
    ) => {
      if (!rows) {
        return undefined;
      }

      return new Map(productIds.map((id) => [id.toString(), rows.get(id.toString())?.[pick] ?? 0n]));
    };

    return {
      // Already spread over the asked ids by whichever lens produced it.
      ready: readyRes ?? undefined,
      ongoing: spread(ongoingRes, "ongoingQty"),
    };
  };
}
