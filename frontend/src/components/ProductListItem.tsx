import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Package } from "lucide-react";
import { Badge } from "./ui/Badge";

export interface ProductListItemProps {
  // Any product-shaped object — a Product, or the trimmed shape a list RPC returns. Everything is
  // optional so a caller can pass whatever slice it has.
  product: {
    id?: bigint;
    teamId?: bigint;
    sku?: string;
    name?: string;
    defaultImageUrl?: string;
    defaultImageThumbnailUrl?: string;
  };
  /** Ready stock (on-hand). OPTIONAL — omit it and no stock is shown ("optional show"). It lives in
   * inventory_service (StockList), not on Product, so the CALLER supplies it. */
  stock?: bigint;
  /** The owning team's name. Not on Product either — only `teamId` — so the caller resolves ids →
   * names in ONE batch call (e.g. TeamByIds) and passes it down. Falls back to "Team #<id>". */
  teamName?: string;
  // Optional trailing content: actions, a check, etc.
  action?: ReactNode;
}

// ProductListItem is the shared way to show a product (#128): its cover image, name + SKU, the owning
// team, and — optionally — ready stock. It is PRESENTATIONAL and fetches nothing: a list renders many
// of these, so resolving stock or team names per item would be an N+1. The caller batches those and
// passes them in. Everything that renders "a product in a list" should use this.
export const description =
  "The shared way to show a product — cover image (or a placeholder), name + SKU, the owning team, and an optional ready-stock badge.";

export function ProductListItem({ product, stock, teamName, action }: ProductListItemProps) {
  const { t } = useTranslation();

  // The thumbnail is the list-sized render; the full image is the fallback. A product may have
  // NEITHER — the package icon then shows, which also covers a URL that 404s.
  const cover = product.defaultImageThumbnailUrl || product.defaultImageUrl;

  const title =
    product.name ||
    product.sku ||
    (product.id !== undefined ? t("productListItem.productFallback", { id: product.id.toString() }) : "");
  // Don't repeat the SKU underneath when it IS the title (a product with no name).
  const sku = product.sku && product.sku !== title ? product.sku : undefined;

  const team =
    teamName ||
    (product.teamId !== undefined
      ? t("productListItem.teamFallback", { id: product.teamId.toString() })
      : undefined);

  // `stock` is optional and 0n is FALSY — so the "show it?" test must be `!== undefined`. A plain
  // `if (stock)` would hide the out-of-stock case, which is the one worth seeing.
  const showStock = stock !== undefined;
  const inStock = stock !== undefined && stock > 0n;

  return (
    <div className="flex w-full items-center gap-card" data-testid={`product-list-item-${product.id ?? ""}`}>
      {/* Cover: a gray-tinted rounded box holding the package placeholder, with the image layered on
          top. The <img> hides itself if it fails to load, revealing the placeholder beneath. */}
      <div className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-control bg-surface-2 text-fg-muted">
        <Package className="size-4" />
        {cover && (
          <img
            key={cover}
            src={cover}
            alt={title}
            className="absolute inset-0 size-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="line-clamp-1 text-start font-medium">{title}</p>
        <div className="flex min-w-0 items-center gap-2">
          {sku && <span className="line-clamp-1 shrink-0 text-xs text-fg-muted">{sku}</span>}
          {team && (
            <Badge colorPalette="gray" className="line-clamp-1">
              {team}
            </Badge>
          )}
        </div>
      </div>

      {showStock && (
        <Badge
          colorPalette={inStock ? "green" : "red"}
          className="shrink-0"
          data-testid={`product-list-item-stock-${product.id ?? ""}`}
        >
          {inStock ? t("productListItem.stock", { n: stock.toString() }) : t("productListItem.outOfStock")}
        </Badge>
      )}

      {action}
    </div>
  );
}
