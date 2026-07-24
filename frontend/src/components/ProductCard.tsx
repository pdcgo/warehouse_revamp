import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Package } from "lucide-react";
import { Badge } from "./ui/Badge";
import { Card } from "./ui/Card";

export interface ProductCardProps {
  // The SAME shape ProductListItem takes — any product-shaped object, everything optional, so a
  // caller can pass whatever slice it has. The two components are interchangeable on purpose: a
  // screen swaps a list for a grid by swapping the component, not by reshaping its data.
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
  // Optional footer content: actions, a check, etc.
  action?: ReactNode;
}

// ProductCard is the CARD counterpart of ProductListItem (#121) — the same product data, the same
// props, the same PRESENTATIONAL contract (it fetches nothing; a grid renders many of these, so
// resolving stock or team names per card would be an N+1 — the caller batches and passes them in).
// The difference is the shape of the thing: ProductListItem is a compact horizontal row that packs
// many products into a scannable list, this is vertical and image-forward for BROWSING a grid, where
// the picture is what you recognise a product by. It backs Product Discover.
export const description =
  "The shared way to show a product as a card in a grid — a large cover image (or a placeholder), the name, its SKU, the owning team, and an optional ready-stock badge. The image-forward counterpart of ProductListItem: same props and same presentational contract, but vertical and picture-led for browsing a grid, where ProductListItem is a compact row for scanning a list.";

export function ProductCard({ product, stock, teamName, action }: ProductCardProps) {
  const { t } = useTranslation();

  // The FULL image first here, thumbnail as the fallback — the reverse of ProductListItem, and
  // deliberate: this cover is a few hundred pixels wide, so a list-sized thumbnail would be upscaled
  // and soft. A product may have NEITHER — the package icon then shows, which also covers a URL that
  // 404s (an <img> that fails to load would otherwise leave a broken-image glyph).
  const cover = product.defaultImageUrl || product.defaultImageThumbnailUrl;

  const title =
    product.name ||
    product.sku ||
    (product.id !== undefined ? t("productListItem.productFallback", { id: product.id.toString() }) : "");
  // Don't repeat the SKU underneath when it IS the title (a product with no name).
  const sku = product.sku && product.sku !== title ? product.sku : undefined;

  // These strings are the shared product-item vocabulary, so they are READ from productListItem.*
  // rather than duplicated under a productCard.* namespace — two keys holding the same sentence is
  // exactly the drift that leaves one of them stale.
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
    // `h-full` so cards in a grid row share a height regardless of how long their names run; the
    // cover then lines up across the row, which is what makes a grid scannable. Outside a grid the
    // percentage resolves against an auto-height parent and does nothing.
    <Card
      className="flex h-full flex-col overflow-hidden"
      data-testid={`product-card-${product.id ?? ""}`}
    >
      {/* A square cover — the marketplace convention, and it keeps every card the same shape whatever
          the source image is. The aspect-square box decides the cover's height; the tinted panel
          inside fills it and centres the package placeholder, and the image (when it loads) covers
          both. The <img> hides itself on load failure, revealing the placeholder beneath. */}
      <div className="aspect-square w-full">
        <div className="relative flex size-full items-center justify-center overflow-hidden bg-surface-2 text-fg-muted">
          <Package className="size-8" />
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
      </div>

      <div className="flex flex-1 flex-col gap-field p-card">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="line-clamp-2 font-medium">{title}</p>
          {sku && <p className="line-clamp-1 text-xs text-fg-muted">{sku}</p>}
        </div>

        {(team || showStock) && (
          <div className="mt-auto flex flex-wrap items-center gap-2">
            {team && (
              <Badge colorPalette="gray" className="line-clamp-1">
                {team}
              </Badge>
            )}
            {showStock && (
              <Badge
                colorPalette={inStock ? "green" : "red"}
                data-testid={`product-card-stock-${product.id ?? ""}`}
              >
                {inStock ? t("productListItem.stock", { n: stock.toString() }) : t("productListItem.outOfStock")}
              </Badge>
            )}
          </div>
        )}
      </div>

      {action && <div className="p-card pt-0">{action}</div>}
    </Card>
  );
}
