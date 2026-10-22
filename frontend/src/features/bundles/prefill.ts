// A NEW BUNDLE, PREFILLED — how another screen hands the bundle form a recipe to start from.
//
// The draft page's **Make It a Bundle** (a-draft-row-maps-to-a-product-a-bundle-or-a-split) turns a split row into a
// bundle: the listing's name, and its parts at their quantity per listing unit — which is exactly a bundle's quantity
// per ONE bundle. It travels in the URL rather than in router state because the form opens in a NEW TAB, so the
// draft's unsaved mapping is not lost.
//
//   /products/bundles/new?name=Paket%20Hemat&lines=74:1,73:2
//
// Only a starting point: the form shows it, and the person saves it — or not.

export interface BundlePrefill {
  name: string;
  lines: { productId: bigint; quantity: string }[];
}

/** The bundle form's address, carrying a recipe to start from. Lines with no product are left out. */
export function newBundleLink(prefill: BundlePrefill): string {
  const params = new URLSearchParams();
  if (prefill.name.trim() !== "") params.set("name", prefill.name.trim());

  const lines = prefill.lines.filter((l) => l.productId > 0n).map((l) => `${l.productId}:${l.quantity || "1"}`);
  if (lines.length > 0) params.set("lines", lines.join(","));

  const query = params.toString();
  return `/products/bundles/new${query ? `?${query}` : ""}`;
}

/** What a `newBundleLink` carried. A malformed or repeated line is dropped rather than guessed at. */
export function readPrefill(params: URLSearchParams): BundlePrefill {
  const lines: BundlePrefill["lines"] = [];
  const seen = new Set<string>();

  for (const part of (params.get("lines") ?? "").split(",")) {
    const [id, quantity] = part.split(":");
    if (!id || !/^\d+$/.test(id) || seen.has(id)) continue;

    seen.add(id);
    lines.push({ productId: BigInt(id), quantity: quantity && /^\d+$/.test(quantity) ? quantity : "1" });
  }

  return { name: params.get("name") ?? "", lines };
}
