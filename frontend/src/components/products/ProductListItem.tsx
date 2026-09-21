import type { ReactNode } from "react";
import { Avatar, Badge, HStack, Icon, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { Package } from "lucide-react";

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
  /** READY stock — on a shelf now, sellable. OPTIONAL: omit it and no stock is shown ("optional
   * show"). It lives in inventory_service (OwnerStockByIds), not on Product, so the CALLER supplies
   * it — and the caller also decides WHICH warehouse it describes, since stock is held per building. */
  stock?: bigint;
  /** ONGOING stock — ordered on restocks the warehouse has not accepted yet (#209's word for it).
   *
   * Shown only when it is > 0, unlike `stock`. The two follow OPPOSITE rules on purpose: a ready
   * count of 0 is the case most worth seeing ("out of stock"), while nothing on the way is simply
   * the normal state of most products, and a badge saying so on every row is noise. */
  ongoing?: bigint;
  /** The owning team's name. Not on Product either — only `teamId` — so the caller resolves ids →
   * names in ONE batch call (e.g. TeamByIds) and passes it down. Falls back to "Team #<id>". */
  teamName?: string;
  // Optional trailing content: actions, a check, etc.
  action?: ReactNode;
  /** Presentation size. "md" (default) is the compact list row; "lg" enlarges the image and title for
   * use as a detail-page header, where the product is the subject rather than one row among many. */
  size?: "md" | "lg";
}

// ProductListItem is the shared way to show a product (#128): its cover image, name + SKU, the owning
// team, and — optionally — ready stock. It is PRESENTATIONAL and fetches nothing: a list renders many
// of these, so resolving stock or team names per item would be an N+1. The caller batches those and
// passes them in. Everything that renders "a product in a list" should use this.
export const description =
  "The shared way to show a product — cover image (or a placeholder), name + SKU, the owning team, and optional stock badges: READY (on a shelf now, shown even at 0, because out-of-stock is the case worth seeing) and ONGOING (on an unaccepted restock, shown only when there is some).";

export function ProductListItem({
  product,
  stock,
  ongoing,
  teamName,
  action,
  size = "md",
}: ProductListItemProps) {
  const { t } = useTranslation();
  const large = size === "lg";

  // The thumbnail is the list-sized render; the full image is the fallback. A product may have
  // NEITHER — Avatar.Fallback then shows the package icon, which also covers a URL that 404s.
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

  // `ongoing`, by contrast, is shown ONLY when there is some — see the prop's note. So the plain
  // truthiness test that would be a bug above is exactly right here.
  const showOngoing = ongoing !== undefined && ongoing > 0n;

  return (
    <HStack gap="card" w="full" data-testid={`product-list-item-${product.id ?? ""}`}>
      <Avatar.Root shape="rounded" size={large ? "2xl" : "md"} colorPalette="gray" flexShrink={0}>
        <Avatar.Fallback>
          <Icon as={Package} boxSize={large ? "6" : "4"} />
        </Avatar.Fallback>
        <Avatar.Image src={cover || undefined} alt={title} />
      </Avatar.Root>

      <Stack gap="0.5" flex="1" minW="0">
        <Text fontWeight="medium" fontSize={large ? "lg" : undefined} lineClamp={1} textAlign="start">
          {title}
        </Text>
        <HStack gap="2" minW="0">
          {sku && (
            <Text fontSize="xs" color="fg.muted" lineClamp={1} flexShrink={0}>
              {sku}
            </Text>
          )}
          {team && (
            <Badge colorPalette="gray" size="xs" lineClamp={1}>
              {team}
            </Badge>
          )}
        </HStack>
      </Stack>

      {/* Ready first, then ongoing: what is here now is the number the decision rests on, and what
          is coming only qualifies it. Read the other way round, a big ongoing count reads as stock. */}
      {showStock && (
        <Badge
          colorPalette={inStock ? "green" : "red"}
          flexShrink={0}
          data-testid={`product-list-item-stock-${product.id ?? ""}`}
        >
          {inStock ? t("productListItem.stock", { n: stock.toString() }) : t("productListItem.outOfStock")}
        </Badge>
      )}

      {showOngoing && (
        <Badge
          colorPalette="blue"
          variant="subtle"
          flexShrink={0}
          data-testid={`product-list-item-ongoing-${product.id ?? ""}`}
        >
          {t("productListItem.ongoing", { n: ongoing.toString() })}
        </Badge>
      )}

      {action}
    </HStack>
  );
}
