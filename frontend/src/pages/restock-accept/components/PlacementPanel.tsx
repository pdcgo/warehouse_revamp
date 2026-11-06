import { Badge, Box, Button, Flex, Icon, IconButton, Spacer, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { History, LayoutGrid, PackageX, Plus, Trash2, TriangleAlert } from "lucide-react";

import type { ProductPlace } from "../../../gen/warehouse/inventory/v1/inventory_pb";
import { QuantityInput } from "../../../components/inputs/QuantityInput";
import type { LineDraft, LineState } from "../draft";
import { nextKey } from "../draft";
import { PcsMark } from "./PcsMark";
import { PlacementSelect } from "./PlacementSelect";

// WHERE THE UNITS GO — the good units onto placements of this warehouse, adding up to exactly received − broken
// (there-is-no-unplaced-pile); and, when the broken units go onto a rack, THEIR rack too, as a row of its own marked Rusak
// (owner: *"rusak kalau ditaruh di rak kasih ke penempatan dan tanda penempatan rusak"*,
// the-broken-units-rack-is-a-marked-placement). The badge in the corner is the line's put-away balance; until it
// balances, the header's ready line names this line's placement as what Terima waits for.
//
// NOTHING HERE MOVES UNTIL DITERIMA IS SET (owner: *"disabled penempatan jika diterima belum di set, maksimalnya ikut ke
// diterima"*, putaway-waits-for-the-count): before the box is counted there is nothing to place, so every picker, count
// and button is off; once it is, a good row holds at most what Diterima leaves good.
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
  const locked = !st.counted;
  const nothingToPlace = st.counted && st.good === 0n;
  // The broken units on a rack — a row of its own here, holding all of them.
  const brokenOnRack = st.counted && !st.brokenOver && st.broken > 0n && draft.brokenTo === "rack";
  // The most one good row can hold: what Diterima leaves good.
  const maxGood = st.counted && st.good > 0n ? Number(st.good) : undefined;

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

  // ONE RACK ONCE PER LINE (one-rack-once-per-line) — each row's picker shows the racks the OTHER rows hold, disabled:
  // the good rows' and the broken row's alike, so a rack holds this product's good units or its broken ones, never both.
  // (`duplicate` in draft.ts stays as the guard the accept handler also is.)
  const goodPlaces = draft.placements.map((row) => row.place).filter((place) => place !== "");
  const brokenPlace = brokenOnRack && draft.brokenPlace !== "" ? [draft.brokenPlace] : [];
  const chosen = [...goodPlaces, ...brokenPlace];
  const takenBy = (index: number) => [
    ...draft.placements.filter((row, i) => i !== index && row.place !== "").map((row) => row.place),
    ...brokenPlace,
  ];

  // A "placed here before" chip drops the goods onto a shelf they already sit on (#156): the first row with no
  // placement yet, else the first row. A rack another row already holds is off — a chip must not make the duplicate the
  // picker refuses.
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
    <Box borderWidth="1px" borderColor="border" borderRadius="md" bg="bg.muted" p="card" h="full" data-locked={locked || undefined}>
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
                    disabled={locked || chosen.includes(rec.rackId.toString())}
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
              // A following row shows the units it will hold — and before the box is counted, the empty box's 0.
              const shown = follows ? (st.counted ? row.effective.toString() : "") : row.quantity;

              return (
                <Flex key={row.key} align="center" gap="2" wrap="wrap">
                  <PlacementSelect
                    warehouseId={warehouseId}
                    value={row.place}
                    disabled={locked}
                    takenRackIds={takenBy(index)}
                    testId={`accept-placement-${productId}-${index}`}
                    onChange={(place) => patchRow(index, { place })}
                  />
                  <Flex align="center" gap="2" ml="auto">
                    <QuantityInput
                      min={0}
                      max={maxGood}
                      width="16"
                      value={shown}
                      disabled={locked}
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
                      disabled={locked || st.rows.length === 1}
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
              disabled={locked}
              data-testid={`accept-add-placement-${productId}`}
              onClick={addRow}
            >
              <Icon as={Plus} boxSize="4" />
              {t("restock.accept.addPlacement")}
            </Button>
          </>
        )}

        {/* THE BROKEN UNITS' RACK, MARKED (the-broken-units-rack-is-a-marked-placement) — chosen in the Rusak block as
            "Ditaruh di rak", placed here: a Rusak tag, its rack, and all the broken units, which is not typed. */}
        {brokenOnRack && (
          <Stack
            gap="1.5"
            borderTopWidth={nothingToPlace ? undefined : "1px"}
            borderColor="border"
            pt={nothingToPlace ? undefined : "card"}
            data-testid={`accept-placement-broken-${productId}`}
          >
            <Flex align="center" gap="2" wrap="wrap">
              {/* What goes there, then where: Rusak, how many, the rack. */}
              <Flex align="center" gap="1.5" flexShrink={0}>
                <Badge colorPalette="error" variant="subtle" data-testid={`accept-placement-broken-tag-${productId}`}>
                  <Icon as={PackageX} boxSize="3.5" />
                  {t("restock.problem.broken")}
                </Badge>
                <PcsMark tone="error" testId={`accept-placement-broken-qty-${productId}`}>
                  {t("restock.accept.pcs", { n: st.broken.toString() })}
                </PcsMark>
              </Flex>
              <PlacementSelect
                warehouseId={warehouseId}
                value={draft.brokenPlace}
                takenRackIds={goodPlaces}
                testId={`accept-broken-place-${productId}`}
                onChange={(next) => update((d) => ({ ...d, brokenPlace: next }))}
              />
            </Flex>
            {st.brokenNeedsPlace && (
              <Flex gap="1.5" align="flex-start" color="error.fg" data-testid={`accept-broken-place-error-${productId}`}>
                <Icon as={TriangleAlert} boxSize="4" mt="0.5" flexShrink={0} />
                <Text fontSize="sm">{t("restock.accept.brokenTo.rackRequired")}</Text>
              </Flex>
            )}
          </Stack>
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
    if (st.brokenNeedsPlace) return blocked(t("restock.accept.choosePlacement"));
    return (
      <Badge colorPalette="gray" data-testid={`accept-balanced-${productId}`}>
        {t("restock.accept.nothingToPlace")}
      </Badge>
    );
  }

  if (st.needsPlace || st.brokenNeedsPlace) return blocked(t("restock.accept.choosePlacement"));
  if (st.duplicate) return blocked(t("restock.accept.duplicatePlacement"));
  if (st.toPlace > 0n) return blocked(t("restock.accept.toPlace", { count: st.toPlace.toString() }));
  if (st.toPlace < 0n) return blocked(t("restock.accept.tooMany", { count: (-st.toPlace).toString() }));

  return (
    <Badge colorPalette="success" data-testid={`accept-balanced-${productId}`}>
      {t("restock.accept.placed", { count: st.placed.toString() })}
    </Badge>
  );
}
