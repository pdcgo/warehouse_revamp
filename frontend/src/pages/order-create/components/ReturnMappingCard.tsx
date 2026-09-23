import { useState } from "react";
import { Badge, Box, Button, Card, Flex, Icon, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { ArrowRight, CopyPlus, History } from "lucide-react";

import { ProductListItem } from "../../../components/products/ProductListItem";
import { ProductSelect } from "../../../components/products/ProductSelect";
import type { PickedProduct } from "../../../components/products/ProductSelect";
import { mockProductImage } from "../mockImages";
import { NotImplemented } from "./NotImplemented";
import { ImagePreview } from "./ImagePreview";
import type { PreviewTarget } from "./ImagePreview";

// WHERE A RETURN OF SOMEBODY ELSE'S GOODS LANDS.
//
// The owner's rule: a product ordered from another team MUST be mapped to one of ours. The business
// doc resolves the same question LATER — at return time, duplicating the cross product if no link
// exists — so this card moves that step to the moment the order is typed, where the person already
// has the product on screen and a customer on the phone.
//
// ⚠ THE SECOND ANSWER IS "DUPLICATE PRODUCT", NOT "USE MY OWN" (owner). The button does not pick
// something we already have — it COPIES the other team's product into our catalogue and links the
// pair. The old wording said the opposite of what happens, which is the kind of label somebody
// clicks once and then has to undo.
//
// ⚠ THE ANSWER IS REMEMBERED. Once a pair is set it comes back pre-filled the next time that product
// is ordered (the business doc's Product LinkMap), so this card empties itself over time instead of
// asking the same question every order. A row that arrives pre-filled says so, and can be changed —
// a remembered answer that could not be corrected would be worse than no memory at all.
//
// ⚠ AND AN UNANSWERED ROW IS LOUD, in three places: on the row, as the count in this header, and as
// the reason under the disabled Create Order. The owner's question — *if they do not choose, how do
// we know?* — is answered by never letting "not chosen" look like "done".

export interface CrossLine {
  productId: bigint;
  sku: string;
  name: string;
  ownerTeamId: bigint;
  ownerName: string;
}

export interface MappedProduct {
  /** Our product. `0n` = the copy "Duplicate Product" stands for, which has no id until it exists. */
  productId: bigint;
  name: string;
  /** True when it arrived from the remembered link rather than from this person, this order. */
  remembered?: boolean;
}

interface ReturnMappingCardProps {
  teamId: bigint;
  lines: CrossLine[];
  /** productId (theirs) → our product. */
  mapping: Map<string, MappedProduct>;
  onMap: (crossProductId: bigint, mapped: MappedProduct | undefined) => void;
}

export function ReturnMappingCard({ teamId, lines, mapping, onMap }: ReturnMappingCardProps) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<PreviewTarget | null>(null);

  const unmapped = lines.filter((l) => !mapping.has(l.productId.toString())).length;

  return (
    <Card.Root>
      <Card.Header>
        <Flex align="center" gap="2" wrap="wrap">
          <Card.Title>{t("orderForm.returnMap.title")}</Card.Title>
          <NotImplemented id="returnMap" />
          {/* The count is the card's whole job on a long order: how many still need an answer. */}
          {unmapped > 0 && (
            <Badge colorPalette="warning" size="sm" data-testid="return-map-unmapped">
              {t("orderForm.returnMap.unmapped", { count: unmapped })}
            </Badge>
          )}
        </Flex>
        <Card.Description>{t("orderForm.returnMap.help")}</Card.Description>
      </Card.Header>

      <Card.Body>
        {lines.length === 0 && (
          <Text fontSize="sm" color="fg.muted" data-testid="return-map-empty">
            {t("orderForm.returnMap.empty")}
          </Text>
        )}

        <Stack gap="card">
          {lines.map((line) => {
            const mapped = mapping.get(line.productId.toString());
            const cover = mockProductImage(line.productId, line.sku);

            return (
              <Flex
                key={line.productId.toString()}
                gap="card"
                align={{ base: "stretch", md: "center" }}
                direction={{ base: "column", md: "row" }}
                data-testid={`return-map-${line.productId}`}
              >
                {/* THEIRS — the shared product row, so it reads exactly like the same product does
                    everywhere else: cover, name over SKU, and the owning team as a badge. */}
                <Box flex="1" minW="0">
                  <ProductListItem
                    product={{
                      id: line.productId,
                      sku: line.sku,
                      name: line.name,
                      defaultImageThumbnailUrl: cover,
                    }}
                    teamName={line.ownerName}
                    onImageClick={() =>
                      setPreview({ src: cover, title: line.name, caption: line.sku })
                    }
                    action={
                      !mapped ? (
                        <Badge
                          colorPalette="warning"
                          size="sm"
                          data-testid={`return-map-needs-${line.productId}`}
                        >
                          {t("orderForm.returnMap.needs")}
                        </Badge>
                      ) : undefined
                    }
                  />
                </Box>

                <Icon
                  as={ArrowRight}
                  boxSize="4"
                  color="fg.subtle"
                  display={{ base: "none", md: "block" }}
                />

                {/* OURS — what a return of it becomes. */}
                <Box flex="1" minW="0">
                  {mapped ? (
                    <Flex align="center" gap="2" wrap="wrap">
                      {mapped.productId === 0n && (
                        <Badge colorPalette="gray" variant="outline" borderStyle="dashed" size="sm">
                          {t("orderForm.returnMap.wouldDuplicate")}
                        </Badge>
                      )}
                      {/* A REMEMBERED ANSWER SAYS SO. Pre-filling silently would put a product on a
                          row nobody chose and look identical to a choice somebody made. */}
                      {mapped.remembered && (
                        <Badge
                          colorPalette="gray"
                          size="sm"
                          gap="1"
                          data-testid={`return-map-remembered-${line.productId}`}
                        >
                          <Icon as={History} boxSize="3" />
                          {t("orderForm.returnMap.remembered")}
                        </Badge>
                      )}
                      <Text fontSize="sm" truncate>
                        {mapped.name}
                      </Text>
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        onClick={() => onMap(line.productId, undefined)}
                        data-testid={`return-map-undo-${line.productId}`}
                      >
                        {t("orderForm.returnMap.undo")}
                      </Button>
                    </Flex>
                  ) : (
                    <Stack gap="1">
                      <ProductSelect
                        teamId={teamId}
                        value={0n}
                        placeholder={t("orderForm.returnMap.pick")}
                        onChange={(product: PickedProduct) =>
                          onMap(line.productId, { productId: product.id, name: product.name })
                        }
                      />
                      {/* The other answer: we do not have one, so make one. One click, because the
                          alternative — leaving the form to create a product and coming back — is
                          how a rule like this gets worked around instead of followed. */}
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        alignSelf="start"
                        onClick={() => onMap(line.productId, { productId: 0n, name: line.name })}
                        data-testid={`return-map-duplicate-${line.productId}`}
                      >
                        <Icon as={CopyPlus} boxSize="4" />
                        {t("orderForm.returnMap.duplicate")}
                      </Button>
                    </Stack>
                  )}
                </Box>
              </Flex>
            );
          })}
        </Stack>
      </Card.Body>

      <ImagePreview target={preview} onClose={() => setPreview(null)} />
    </Card.Root>
  );
}
