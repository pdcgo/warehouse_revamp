import type { Product } from "../../gen/warehouse/product/v1/product_pb";
import { type BundleRecord, type LineState, lineState, unavailable } from "../../features/bundles/adapt";

// HOW MANY BUNDLES ONE WAREHOUSE'S STOCK CAN MAKE (a-bundle-has-a-detail-page-that-counts-what-stock-can-make).
//
//   Ready        the warehouse's on-hand for the product
//   Enough for   floor(Ready ÷ per bundle) — or 0 when another team's product is under its owner's reserve: its total
//                across every warehouse is below the reserve, so an order would be refused
//                (the-reserve-stops-other-teams-at-low-stock). The reserve never applies to the team's own product.
//   Can make     the smallest Enough for over the USABLE lines. A locked or archived line is left out — an order fills
//                that slot with something else (a-borrowed-product-never-blocks-its-owner).
//
// Nothing here is guessed: until the products and the stock have answered, a figure is `undefined`, never 0 — 0 is a
// real answer ("none can be made") and must not stand in for "not known yet".

export interface LineMakes {
  productId: bigint;
  quantity: number;
  product: Product | undefined;
  state: LineState;
  /** The chosen warehouse's on-hand. Undefined while loading, and for an unavailable line. */
  ready: bigint | undefined;
  /** Bundles this line alone could fill. Undefined while loading, and for an unavailable line. */
  enough: number | undefined;
  /** Another team's product whose total stock is under its owner's reserve. */
  belowReserve: boolean;
}

export interface BundleMakes {
  lines: LineMakes[];
  /** Undefined while loading, or when no line is usable. */
  canMake: number | undefined;
  /** The line that runs out first — its index in `lines`, or -1. */
  limit: number;
}

export function bundleMakes(args: {
  bundle: BundleRecord;
  products: Map<string, Product> | undefined;
  /** useBundleStock — warehouse id → product id → on-hand. */
  stock: Map<string, Map<string, bigint>> | undefined;
  warehouseId: bigint;
}): BundleMakes {
  const { bundle, products, stock, warehouseId } = args;
  const here = stock?.get(warehouseId.toString());

  const total = (productId: bigint) =>
    [...(stock?.values() ?? [])].reduce((sum, w) => sum + (w.get(productId.toString()) ?? 0n), 0n);

  const lines: LineMakes[] = bundle.lines.map((line) => {
    const product = products?.get(line.productId.toString());
    const state = lineState(product, bundle.teamId);
    const base = { productId: line.productId, quantity: line.quantity, product, state };

    if (unavailable(state) || state === "unknown" || !here) {
      return { ...base, ready: undefined, enough: undefined, belowReserve: false };
    }

    const ready = here.get(line.productId.toString()) ?? 0n;
    const reserve = BigInt(product?.reservedStock ?? 0);
    const belowReserve = state === "borrowed" && reserve > 0n && total(line.productId) < reserve;
    const enough = belowReserve || ready <= 0n ? 0 : Math.floor(Number(ready) / line.quantity);

    return { ...base, ready, enough, belowReserve };
  });

  const usable = lines.map((l, i) => ({ l, i })).filter(({ l }) => !unavailable(l.state));
  if (usable.length === 0 || usable.some(({ l }) => l.enough === undefined)) {
    return { lines, canMake: undefined, limit: -1 };
  }

  let limit = usable[0]!.i;
  for (const { l, i } of usable) {
    if (l.enough! < lines[limit]!.enough!) limit = i;
  }

  return { lines, canMake: lines[limit]!.enough, limit };
}
