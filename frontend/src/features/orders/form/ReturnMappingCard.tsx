import { useState } from "react";
import { Badge, Box, Card, Flex, Icon, Skeleton, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { ArrowRight, History, Lock } from "lucide-react";

import { rpcError } from "../../../api/clients";
import { ConfirmDialog } from "../../../components/feedback/ConfirmDialog";
import { toaster } from "../../../components/feedback/Toaster";
import { ProductListItem } from "../../../components/products/ProductListItem";
import { ProductSelect } from "../../../components/products/ProductSelect";
import type { PickedProduct } from "../../../components/products/ProductSelect";
import { mockProductImage } from "./mockImages";
import { useCreateProductReturnMap } from "../queries";
import { ImagePreview } from "./ImagePreview";
import type { PreviewTarget } from "./ImagePreview";

// WHERE A RETURN OF SOMEBODY ELSE'S GOODS LANDS.
//
// The owner's rule: a product ordered from another team MUST be mapped to one of ours before the
// order is created (a-borrowed-line-needs-its-map-at-create), and THIS CARD is where it is mapped
// (a-borrowed-product-is-mapped-on-the-order-form) — the person already has the product on screen at
// the moment the create would be refused.
//
// ⚠ THE ONLY ANSWER IS ONE OF OUR OWN PRODUCTS. There is no "Duplicate Product": a return never
// creates a product (a-return-never-clones-a-product), so the picker searches this team's catalogue
// and nothing else.
//
// ⚠ A PICK IS WRITTEN THE MOMENT IT IS CONFIRMED, and is then locked. The map is its own write —
// ProductReturnMapCreate, separate from the order (the-map-is-written-when-it-is-picked) — and a map is written once
// and never re-pointed (a-return-map-is-written-once): units already on a shelf went there under it. So every
// mapped row is locked, with no Change, and the pick asks first: it is the one thing on this form that
// cannot be taken back. A pair written before this order also says where it came from.
//
// ⚠ THE PAIR THAT STANDS IS THE ANSWER. Two people can map the same product at the same second; the server keeps the
// first and hands it back to the second (`created = false`). The row then shows THAT pair, locked, and says the pick
// was not saved — showing the pick would be showing a map that does not exist.
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
  /** Our product — always one that already exists in this team's catalogue. */
  productId: bigint;
  /** Undefined while the product read that names it is in flight — shown loading, never as an id or a blank. */
  name?: string;
  /** True when the pair was written before this order, rather than picked on it. Locked either way. */
  remembered?: boolean;
  /** The pick that LOST — a different pair already stood. Its name, so the row can say it was not saved. */
  notSaved?: string;
}

interface ReturnMappingCardProps {
  teamId: bigint;
  lines: CrossLine[];
  /** productId (theirs) → our product. */
  mapping: Map<string, MappedProduct>;
  /** Called once a pick has been confirmed AND written — the card owns the write. */
  onMap: (crossProductId: bigint, mapped: MappedProduct) => void;
  /**
   * The pairs already standing are still being read. A row with no answer yet is then UNKNOWN, not unmapped — it shows
   * a placeholder rather than the picker, and the count waits, so "not read yet" never reads as "needs mapping".
   */
  checking?: boolean;
}

export function ReturnMappingCard({ teamId, lines, mapping, onMap, checking = false }: ReturnMappingCardProps) {
  const { t } = useTranslation();
  const createMap = useCreateProductReturnMap();
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  // The pick waiting on its confirmation. Nothing is written until it is confirmed.
  const [pending, setPending] = useState<{ line: CrossLine; product: PickedProduct } | null>(null);
  // Bumped on a cancelled pick, to remount the picker empty rather than leave the declined product
  // sitting in the field as if it were the answer.
  const [pickerReset, setPickerReset] = useState(0);

  const unmapped = lines.filter((l) => !mapping.has(l.productId.toString())).length;

  // The write. ConfirmDialog holds its button busy while this runs, and closes when it returns — on a failure too, so
  // the failure is said here and the row stays unmapped, its picker emptied for another try.
  async function writeMap() {
    if (!pending) return;

    try {
      const written = await createMap.mutateAsync({
        teamId,
        sharedProductId: pending.line.productId,
        ownProductId: pending.product.id,
        ownName: pending.product.name,
      });

      onMap(pending.line.productId, {
        productId: written.productId,
        name: written.name,
        notSaved: written.productId === pending.product.id ? undefined : pending.product.name,
      });
    } catch (err) {
      toaster.create({ type: "error", title: t("orderForm.returnMap.failed"), description: rpcError(err) });
    }
  }

  return (
    <Card.Root>
      <Card.Header>
        <Flex align="center" gap="2" wrap="wrap">
          <Card.Title>{t("orderForm.returnMap.title")}</Card.Title>
          {/* The count is the card's whole job on a long order: how many still need an answer. */}
          {unmapped > 0 && !checking && (
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
                      !mapped && !checking ? (
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
                    <Stack gap="1">
                      <Flex
                        align="center"
                        gap="2"
                        wrap="wrap"
                        data-testid={`return-map-locked-${line.productId}`}
                      >
                        {/* EVERY MAPPED ROW IS LOCKED, and shows it — without the lock, the missing
                            Change would read as a bug. */}
                        <Icon as={Lock} boxSize="4" color="fg.muted" />
                        {/* Named from the product read; until it answers, a placeholder — never an id, never a blank. */}
                        {mapped.name !== undefined ? (
                          <Text fontSize="sm" truncate>
                            {mapped.name}
                          </Text>
                        ) : (
                          <Skeleton
                            height="4"
                            width="40"
                            data-testid={`return-map-name-loading-${line.productId}`}
                          />
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
                      </Flex>
                      {/* THE PICK LOST: somebody mapped it first, and their pair stands. Said, so the person does
                          not believe the product they chose is where returns will land. */}
                      {mapped.notSaved && (
                        <Text
                          fontSize="xs"
                          color="fg.muted"
                          data-testid={`return-map-not-saved-${line.productId}`}
                        >
                          {t("orderForm.returnMap.notSaved", { picked: mapped.notSaved })}
                        </Text>
                      )}
                    </Stack>
                  ) : checking ? (
                    // Not read yet — neither the answer nor the question.
                    <Skeleton height="8" data-testid={`return-map-checking-${line.productId}`} />
                  ) : (
                    <ProductSelect
                      key={pickerReset}
                      teamId={teamId}
                      value={0n}
                      placeholder={t("orderForm.returnMap.pick")}
                      onChange={(product: PickedProduct) => setPending({ line, product })}
                    />
                  )}
                </Box>
              </Flex>
            );
          })}
        </Stack>
      </Card.Body>

      <ImagePreview target={preview} onClose={() => setPreview(null)} />

      {/* THE ONE PERMANENT ACT ON THIS FORM ASKS FIRST — a map cannot be re-pointed afterwards. Not
          red: nothing is lost, it is only final. */}
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (open) return;
          // Closed without writing (Cancel, ✕, Escape) the picker empties again; after a write the row
          // shows the locked pair instead, so the remount touches nothing.
          setPickerReset((n) => n + 1);
          setPending(null);
        }}
        title={t("orderForm.returnMap.confirmTitle")}
        message={
          pending
            ? t("orderForm.returnMap.confirmMessage", {
                theirs: pending.line.name,
                ours: pending.product.name,
              })
            : undefined
        }
        confirmLabel={t("orderForm.returnMap.confirmLabel")}
        destructive={false}
        onConfirm={writeMap}
      />
    </Card.Root>
  );
}
