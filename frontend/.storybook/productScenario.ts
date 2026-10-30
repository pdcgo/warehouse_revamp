import { allProducts, patchProduct } from "./productStub";

// A PRODUCT'S STATE AS ONE STORY NEEDS IT — locked by its owner, archived, or held back by a reserve — without touching
// `products` in fixtures.ts, which dozens of stories count on exactly as it is.
//
// It writes through productStub.ts's writeable catalogue (`patchProduct`), so an override reaches every read a screen
// makes: ProductByIds answers the product locked or archived (and still answers an archived one, as the server does),
// and ProductList / ProductDiscover leave out what the server would. Nothing changes unless a story asks, and
// preview.tsx's `beforeEach` resets the catalogue, which takes every override with it.
//
// ⚠ ITS OWN MODULE, for the reason sessionScenario.ts gives: a story imports it, and importing from stubTransport.ts
// would pull the whole stub into `npm run typecheck`.

type ProductState = { crossLocked?: boolean; deleted?: boolean; reservedStock?: number };

/** Kept for preview.tsx's `beforeEach`: the overrides live in productStub's rows, which `resetProductStub` restores. */
export function resetProductScenario() {}

/**
 * A `beforeEach`: product `id` is now in this state — `{ crossLocked: true }` (its owner locked it), `{ deleted: true }`,
 * or `{ reservedStock: 20 }` (its owner holds the last 20 back from other teams).
 */
export function withProductState(id: bigint, state: ProductState) {
  return () => patchProduct(id, state);
}

/** The catalogue as this story left it — the fixtures plus productStub's own rows, with every override applied. */
export function productsNow() {
  return allProducts();
}
