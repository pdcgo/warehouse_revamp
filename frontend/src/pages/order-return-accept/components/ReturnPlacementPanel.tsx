import { Badge, Box, Button, Flex, Icon, IconButton, Spacer, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { LayoutGrid, Plus, Trash2 } from "lucide-react";

import { QuantityInput } from "../../../components/inputs/QuantityInput";
import { RackSelect } from "../../../components/pickers/RackSelect";
import type { ReturnLineDraft, ReturnLineState } from "../draft";
import { nextRackKey } from "../draft";

// WHERE THE SOUND UNITS GO — onto racks of THIS warehouse (only-the-return-warehouse-accepts-a-return: its crew puts the
// units on its own racks), adding up to exactly the sound units (there-is-no-unplaced-pile). Accept Delivery's put-away,
// drawn the same way: the badge in the corner is the line's balance, and it is what the header's "lines to finish" counts.
//
// The first row FOLLOWS the sound units until somebody types into it: pick a rack, done. Split the line and the first row
// keeps the remainder, so a split is "how many go elsewhere", not a second sum to get right.
export function ReturnPlacementPanel({
  itemId,
  warehouseId,
  draft,
  st,
  update,
}: {
  itemId: bigint;
  warehouseId: bigint;
  draft: ReturnLineDraft;
  st: ReturnLineState;
  update: (fn: (d: ReturnLineDraft) => ReturnLineDraft) => void;
}) {
  const { t } = useTranslation();
  const nothingToPlace = st.sound === 0;

  function patchRow(index: number, patch: { rack?: string; quantity?: string }) {
    update((d) => ({
      ...d,
      // Typing into the first row's quantity takes it over — it stops following the sound units.
      firstFollows: index === 0 && patch.quantity !== undefined ? false : d.firstFollows,
      racks: d.racks.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }));
  }

  function addRow() {
    update((d) => ({ ...d, racks: [...d.racks, { key: nextRackKey(), rack: "", quantity: "" }] }));
  }

  function removeRow(index: number) {
    update((d) => ({
      ...d,
      // The row that becomes first was typed by hand; it does not start following now.
      firstFollows: index === 0 ? false : d.firstFollows,
      racks: d.racks.filter((_, i) => i !== index),
    }));
  }

  return (
    <Box borderWidth="1px" borderColor="border" borderRadius="md" bg="bg.muted" p="card" h="full">
      <Stack gap="card">
        <Flex align="center" gap="2" wrap="wrap">
          <Icon as={LayoutGrid} boxSize="4" color="brand.fg" />
          <Text fontSize="sm" fontWeight="bold">
            {t("picking.returnAccept.putaway")}
          </Text>
          <Spacer />
          <BalanceBadge itemId={itemId} st={st} />
        </Flex>

        {nothingToPlace ? (
          <Text fontSize="sm" color="fg.muted" data-testid={`return-accept-nothing-to-place-${itemId}`}>
            {t("picking.returnAccept.nothingToPlaceHint")}
          </Text>
        ) : (
          <>
            {st.rows.map((row, index) => {
              const follows = index === 0 && draft.firstFollows;
              const shown = follows ? String(row.effective) : row.quantity;

              return (
                <Flex key={row.key} align="center" gap="2" wrap="wrap">
                  {/* Shares a row with the quantity on a desktop; on a phone it takes the row and the quantity wraps. */}
                  <Box flex="1 1 12rem" minW="0" data-testid={`return-accept-rack-${itemId}-${index}`}>
                    <RackSelect
                      warehouseId={warehouseId}
                      value={row.rack}
                      allowUnplaced={false}
                      placeholder={t("picking.returnAccept.rackPlaceholder")}
                      onChange={(rack) => patchRow(index, { rack })}
                    />
                  </Box>
                  <Flex align="center" gap="2" ml="auto">
                    <QuantityInput
                      min={0}
                      width="16"
                      value={shown}
                      aria-label={t("picking.returnAccept.rackQty")}
                      testId={`return-accept-rack-qty-${itemId}-${index}`}
                      onChange={(quantity) => patchRow(index, { quantity })}
                    />
                    <IconButton
                      size="xs"
                      variant="ghost"
                      colorPalette="error"
                      flexShrink={0}
                      aria-label={t("picking.returnAccept.removeRack")}
                      disabled={st.rows.length === 1}
                      data-testid={`return-accept-remove-rack-${itemId}-${index}`}
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
              data-testid={`return-accept-add-rack-${itemId}`}
              onClick={addRow}
            >
              <Icon as={Plus} boxSize="4" />
              {t("picking.returnAccept.addRack")}
            </Button>
          </>
        )}
      </Stack>
    </Box>
  );
}

// The line's put-away balance, in one badge — the first thing still wrong, or how many went onto racks.
function BalanceBadge({ itemId, st }: { itemId: bigint; st: ReturnLineState }) {
  const { t } = useTranslation();
  const blocked = (label: string) => (
    <Badge colorPalette="warning" data-testid={`return-accept-unbalanced-${itemId}`}>
      {label}
    </Badge>
  );

  if (st.over > 0) return blocked(t("picking.returnAccept.fixCountFirst"));

  if (st.sound === 0) {
    return (
      <Badge colorPalette="gray" data-testid={`return-accept-balanced-${itemId}`}>
        {t("picking.returnAccept.nothingToPlace")}
      </Badge>
    );
  }

  if (st.needsRack) return blocked(t("picking.returnAccept.chooseRack"));
  if (st.duplicate) return blocked(t("picking.returnAccept.duplicateRack"));
  if (st.toPlace > 0) return blocked(t("picking.returnAccept.toPlace", { count: st.toPlace }));
  if (st.toPlace < 0) return blocked(t("picking.returnAccept.tooMany", { count: -st.toPlace }));

  return (
    <Badge colorPalette="success" data-testid={`return-accept-balanced-${itemId}`}>
      {t("picking.returnAccept.placed", { count: st.placed })}
    </Badge>
  );
}
