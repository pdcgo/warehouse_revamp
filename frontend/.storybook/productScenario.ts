import { products } from "./fixtures";

// A PRODUCT'S STATE AS ONE STORY NEEDS IT — locked by its owner, archived, or held back by a reserve — without touching
// `products` in fixtures.ts, which dozens of stories count on exactly as it is.
//
// The stub's ProductService reads products through `productsNow()`, so an override reaches every read a screen makes:
// ProductByIds answers the product locked or archived (and still answers an archived one, as the server does), and
// ProductList / ProductDiscover leave out what the server would. Empty by default — no story sees a difference unless
// it asks for one — and reset in preview.tsx's `beforeEach`.
//
// ⚠ ITS OWN MODULE, for the reason sessionScenario.ts gives: a story imports it, and importing from stubTransport.ts
// would pull the whole stub into `npm run typecheck`.

type ProductState = { crossLocked?: boolean; deleted?: boolean; reservedStock?: number };

export const productScenario = {
  overrides: {} as Record<string, ProductState>,
};

export function resetProductScenario() {
  productScenario.overrides = {};
}

/**
 * A `beforeEach`: product `id` is now in this state — `{ crossLocked: true }` (its owner locked it), `{ deleted: true }`,
 * or `{ reservedStock: 20 }` (its owner holds the last 20 back from other teams).
 */
export function withProductState(id: bigint, state: ProductState) {
  return () => {
    productScenario.overrides = { ...productScenario.overrides, [id.toString()]: { ...productScenario.overrides[id.toString()], ...state } };
  };
}

/** The product fixtures, with this story's overrides applied. */
export function productsNow(): typeof products {
  return products.map((p) => ({ ...p, ...productScenario.overrides[p.id.toString()] }));
}
