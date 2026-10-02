// A PICTURE FOR A PRODUCT THAT HAS NONE.
//
// Every product in the Storybook fixtures carries `defaultImageUrl: ""`, so a screen built to show
// covers would be reviewed as a column of package icons — and the thing the owner asked to fix (a
// thumbnail too small to tell two products apart, and the click that opens it properly) would be
// invisible in the one place this screen is looked at.
//
// So the prototype draws its own: an inline SVG, deterministic per product id, carrying the SKU as
// its caption.
//
//   - NO NETWORK. A placeholder service would fail offline, in CI, and behind the Storybook CSP.
//   - NO BINARY ASSETS in the tree for a screen that is meant to be deleted whole.
//   - ONE URI FOR BOTH SIZES: an SVG is resolution-independent, so the 32px tile and the full
//     preview are the same file rather than two that could disagree.
//
// ⚠ IT NEVER OVERRIDES A REAL IMAGE — see `coverFor`. The day products carry photos, this stops
// being visible without anything being switched off.

/** A product's cover, or a generated stand-in when it has none. */
export function coverFor(product: {
  productId: bigint;
  sku: string;
  imageUrl?: string;
  thumbnailUrl?: string;
}): string {
  return (
    product.thumbnailUrl || product.imageUrl || mockProductImage(product.productId, product.sku)
  );
}

/**
 * The stand-in itself: a tinted tile with the SKU across it.
 *
 * The hue walks by the golden angle (137.5°) so consecutive product ids land far apart on the wheel
 * — two products next to each other in a list are never two shades of the same colour, which is the
 * whole point of a picture in a row of text.
 */
export function mockProductImage(productId: bigint, caption: string): string {
  const hue = Number((productId * 137n) % 360n);
  const label = caption.slice(0, 14);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="160" height="160">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="hsl(${hue} 62% 72%)"/>
      <stop offset="100%" stop-color="hsl(${(hue + 28) % 360} 58% 52%)"/>
    </linearGradient>
  </defs>
  <rect width="160" height="160" rx="14" fill="url(#g)"/>
  <circle cx="118" cy="44" r="26" fill="hsl(${hue} 70% 88%)" fill-opacity="0.55"/>
  <rect x="18" y="96" width="124" height="30" rx="8" fill="hsl(${hue} 40% 18%)" fill-opacity="0.55"/>
  <text x="80" y="116" text-anchor="middle" font-family="Lato, sans-serif" font-size="15" fill="#ffffff">${escapeXml(label)}</text>
</svg>`;

  // `encodeURIComponent`, not base64: it keeps the markup readable in devtools, and an SVG data URI
  // must not carry a raw `#` or `<` through an `src`.
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
