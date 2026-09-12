import type { ReactNode } from "react";
import { Avatar, Badge, Box, Card, HStack, Icon, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { Package } from "lucide-react";

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
  // and soft. A product may have NEITHER — Avatar.Fallback then shows the package icon, which also
  // covers a URL that 404s (an <img> that fails to load would otherwise leave a broken-image glyph).
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
    // `h="full"` so cards in a grid row share a height regardless of how long their names run; the
    // cover then lines up across the row, which is what makes a grid scannable. Outside a grid the
    // percentage resolves against an auto-height parent and does nothing.
    <Card.Root variant="outline" overflow="hidden" h="full" data-testid={`product-card-${product.id ?? ""}`}>
      {/* A square cover — the marketplace convention, and it keeps every card the same shape whatever
          the source image is. Avatar sizes itself from --avatar-size, so size="full" hands the sizing
          to this Box; the Box's aspect ratio is then the single thing deciding the cover's height. */}
      <Box aspectRatio="1" w="full">
        {/* `display="flex"` overrides the recipe's inline-flex: an inline-level box sits on the text
            baseline, which would leave a sliver of gap under the cover. It keeps the recipe's
            centring, so the fallback icon stays centred. */}
        <Avatar.Root size="full" shape="square" variant="subtle" colorPalette="gray" display="flex">
          <Avatar.Fallback>
            <Icon as={Package} boxSize="8" />
          </Avatar.Fallback>
          <Avatar.Image src={cover || undefined} alt={title} />
        </Avatar.Root>
      </Box>

      <Card.Body p="card" gap="field">
        <Stack gap="0.5" minW="0">
          <Text fontWeight="medium" lineClamp={2}>
            {title}
          </Text>
          {sku && (
            <Text fontSize="xs" color="fg.muted" lineClamp={1}>
              {sku}
            </Text>
          )}
        </Stack>

        {(team || showStock) && (
          <HStack gap="2" wrap="wrap" mt="auto">
            {team && (
              <Badge colorPalette="gray" size="xs" lineClamp={1}>
                {team}
              </Badge>
            )}
            {showStock && (
              <Badge
                colorPalette={inStock ? "green" : "red"}
                size="xs"
                data-testid={`product-card-stock-${product.id ?? ""}`}
              >
                {inStock ? t("productListItem.stock", { n: stock.toString() }) : t("productListItem.outOfStock")}
              </Badge>
            )}
          </HStack>
        )}
      </Card.Body>

      {action && <Card.Footer p="card" pt="0">{action}</Card.Footer>}
    </Card.Root>
  );
}
