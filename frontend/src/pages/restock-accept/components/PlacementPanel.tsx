import { Badge, Box, Button, Flex, Icon, IconButton, Spacer, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { History, LayoutGrid, Plus, Trash2 } from "lucide-react";

import type { ProductPlace } from "../../../gen/warehouse/inventory/v1/inventory_pb";
import { QuantityInput } from "../../../components/inputs/QuantityInput";
import type { LineDraft, LineState } from "../draft";
import { nextKey } from "../draft";
import { PlacementSelect } from "./PlacementSelect";

// WHERE THE GOOD UNITS GO — onto placements of this warehouse, adding up to exactly received − broken
// (there-is-no-unplaced-pile). The badge in the corner is the line's put-away balance, and it is what the header's
// "lines to finish" counts.
//
// The first row FOLLOWS the good units until somebody types into it: count 12, pick a placement, done. Split the line
// and the first row keeps the remainder, so a split is "how many go elsewhere", not a second sum to get right.
export function PlacementPanel({
  productId,
  warehouseId,
  draft,
  st,
  recommendations,
  update,
}: {
  productId: bigint;
  warehouseId: bigint;
  draft: LineDraft;
  st: LineState;
  recommendations: ProductPlace[];
  update: (fn: (d: LineDraft) => LineDraft) => void;
}) {
  const { t } = useTranslation();
  const nothingToPlace = st.counted && st.good === 0n;

  function patchRow(index: number, patch: { place?: string; quantity?: string }) {
    update((d) => ({
      ...d,
      // Typing into the first row's quantity takes it over — it stops following the good units.
      firstFollows: index === 0 && patch.quantity !== undefined ? false : d.firstFollows,
      placements: d.placements.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }));
  }

  function addRow() {
    update((d) => ({
      ...d,
      placements: [...d.placements, { key: nextKey(), place: "", quantity: "" }],
    }));
  }

  function removeRow(index: number) {
    update((d) => ({
      ...d,
      // The row that becomes first was typed by hand; it does not start following now.
      firstFollows: index === 0 ? false : d.firstFollows,
      placements: d.placements.filter((_, i) => i !== index),
    }));
  }

  // A "placed here before" chip drops the goods onto a shelf they already sit on (#156): the first row with no
  // placement yet, else the first row.
  function recommend(rackId: bigint) {
    update((d) => {
      const target = d.placements.findIndex((row) => row.place === "");
      const index = target === -1 ? 0 : target;

      return {
        ...d,
        placements: d.placements.map((row, i) => (i === index ? { ...row, place: rackId.toString() } : row)),
      };
    });
  }

  return (
    <Box borderWidth="1px" borderColor="border" borderRadius="md" bg="bg.muted" p="card" h="full">
      <Stack gap="card">
        <Flex align="center" gap="2" wrap="wrap">
          <Icon as={LayoutGrid} boxSize="4" color="brand.fg" />
          <Text fontSize="sm" fontWeight="bold">
            {t("restock.accept.putaway")}
          </Text>
          <Spacer />
          <BalanceBadge productId={productId} st={st} />
        </Flex>

        {nothingToPlace ? (
          <Text fontSize="sm" color="fg.muted" data-testid={`accept-nothing-to-place-${productId}`}>
            {t("restock.accept.nothingToPlaceHint")}
          </Text>
        ) : (
          <>
            {recommendations.length > 0 && (
              <Flex align="center" gap="2" wrap="wrap">
                <Flex align="center" gap="1" color="fg.muted">
                  <Icon as={History} boxSize="3.5" />
                  <Text fontSize="xs">{t("restock.accept.placedBefore")}</Text>
                </Flex>
                {recommendations.map((rec) => (
                  <Button
                    key={rec.rackId.toString()}
                    size="xs"
                    variant="outline"
                    data-testid={`accept-rec-${productId}-${rec.rackId}`}
                    onClick={() => recommend(rec.rackId)}
                  >
                    {rec.rackCode}
                    <Text as="span" color="fg.muted" ml="1">
                      {t("restock.accept.hereCount", {
                        count: rec.onHand.toString(),
                      })}
                    </Text>
                  </Button>
                ))}
              </Flex>
            )}

            {st.rows.map((row, index) => {
              const follows = index === 0 && draft.firstFollows;
              // A following row shows the units it will hold — but nothing before the box is counted, because a 0
              // there would read as "nothing goes here".
              const shown = follows ? (st.counted ? row.effective.toString() : "") : row.quantity;

              return (
                <Flex key={row.key} align="center" gap="2" wrap="wrap">
                  <PlacementSelect
                    warehouseId={warehouseId}
                    value={row.place}
                    testId={`accept-placement-${productId}-${index}`}
                    onChange={(place) => patchRow(index, { place })}
                  />
                  <Flex align="center" gap="2" ml="auto">
                    <QuantityInput
                      min={0}
                      width="16"
                      value={shown}
                      aria-label={t("restock.accept.placementQty")}
                      testId={`accept-placement-qty-${productId}-${index}`}
                      onChange={(quantity) => patchRow(index, { quantity })}
                    />
                    <IconButton
                      size="xs"
                      variant="ghost"
                      colorPalette="error"
                      flexShrink={0}
                      aria-label={t("restock.accept.removePlacement")}
                      disabled={st.rows.length === 1}
                      data-testid={`accept-remove-placement-${productId}-${index}`}
                      onClick={() => removeRow(index)}
                    >
                      <Icon as={Trash2} boxSize="4" />
                    </IconButton>
                  </Flex>
                </Flex>
              );
            })}

            <Button
              size="xs"
              variant="outline"
              alignSelf="flex-start"
              data-testid={`accept-add-placement-${productId}`}
              onClick={addRow}
            >
              <Icon as={Plus} boxSize="4" />
              {t("restock.accept.addPlacement")}
            </Button>
          </>
        )}
      </Stack>
    </Box>
  );
}

// The line's put-away balance, in one badge — the first thing still wrong, or how many went onto placements.
function BalanceBadge({ productId, st }: { productId: bigint; st: LineState }) {
  const { t } = useTranslation();
  const blocked = (label: string) => (
    <Badge colorPalette="warning" data-testid={`accept-unbalanced-${productId}`}>
      {label}
    </Badge>
  );

  if (!st.counted) {
    return (
      <Badge colorPalette="gray" data-testid={`accept-uncounted-${productId}`}>
        {t("restock.accept.countFirst")}
      </Badge>
    );
  }

  if (st.good === 0n) {
    return (
      <Badge colorPalette="gray" data-testid={`accept-balanced-${productId}`}>
        {t("restock.accept.nothingToPlace")}
      </Badge>
    );
  }

  if (st.needsPlace) return blocked(t("restock.accept.choosePlacement"));
  if (st.duplicate) return blocked(t("restock.accept.duplicatePlacement"));
  if (st.toPlace > 0n) return blocked(t("restock.accept.toPlace", { count: st.toPlace.toString() }));
  if (st.toPlace < 0n) return blocked(t("restock.accept.tooMany", { count: (-st.toPlace).toString() }));

  return (
    <Badge colorPalette="success" data-testid={`accept-balanced-${productId}`}>
      {t("restock.accept.placed", { count: st.placed.toString() })}
    </Badge>
  );
}
