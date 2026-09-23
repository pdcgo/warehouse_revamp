import { useState } from "react";
import {
  Badge,
  Box,
  Button,
  Card,
  Combobox,
  Flex,
  Icon,
  IconButton,
  Portal,
  Stack,
  Text,
  useListCollection,
} from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { Package, Replace, X } from "lucide-react";

import { AllProductPicker } from "../../../components/products/AllProductPicker";
import { ProductListItem } from "../../../components/products/ProductListItem";
import { QuantityInput } from "../../../components/inputs/QuantityInput";
import type { PickedProduct } from "../../../components/products/ProductSelect";
import type { Availability, Costs } from "../../../features/orders/lines";
import { lineTotal } from "../../../features/orders/lines";
import { formatRupiah } from "../../../lib/money";
import type { BundleDraft, SlotDraft } from "../bundles";
import { slotCap, slotFilled } from "../bundles";
import type { BundleTemplate } from "../mockData";
import { BUNDLES } from "../mockData";
import { coverFor } from "../mockImages";
import { NotImplemented } from "./NotImplemented";
import { ImagePreview } from "./ImagePreview";
import type { PreviewTarget } from "./ImagePreview";

// BUNDLES, AND THE SLOTS THAT CAN BE FILLED WITH SOMETHING ELSE.
//
// The rule the owner stated: a bundle's products are adjustable — one is out of stock, so another
// takes its place, and several products may share one slot — with the ceiling being the bundle's own
// rule × how many bundles were ordered. That ceiling is per SLOT, which is why a slot is a box with
// its own header rather than a row in the items table.
//
// ⚠ SUBSTITUTION IS THE SAME PICKER THE ORDER'S OWN LINES USE, and it hands back the WHOLE ticked
// set — so filling a slot is reconciled, never appended (the quantity typed into a kept product
// survives opening the dialog again). One picker, one mental model: a slot is a small order.

interface BundleCardProps {
  teamId: bigint;
  warehouseId: bigint;
  bundles: BundleDraft[];
  stock?: Availability;
  costs?: Costs;
  onAdd: (templateId: string) => void;
  onQuantity: (key: string, quantity: string) => void;
  onRemove: (key: string) => void;
  onFill: (key: string, slotId: string, products: PickedProduct[]) => void;
  onFillQuantity: (key: string, slotId: string, productId: bigint, quantity: string) => void;
}

export function BundleCard({
  teamId,
  warehouseId,
  bundles,
  stock,
  costs,
  onAdd,
  onQuantity,
  onRemove,
  onFill,
  onFillQuantity,
}: BundleCardProps) {
  const { t } = useTranslation();
  const noWarehouse = warehouseId <= 0n;

  // ONE preview for the whole card, not one per row: which image is open is a single piece of state,
  // so a second click replaces the first rather than stacking dialogs.
  const [preview, setPreview] = useState<PreviewTarget | null>(null);

  return (
    <Card.Root>
      <Card.Body>
        <Stack gap="card">
          <Flex align="start" gap="card" wrap="wrap" justify="space-between">
            <Stack gap="0.5" minW="0">
              <Flex align="center" gap="2" wrap="wrap">
                <Card.Title>{t("orderForm.bundles.title")}</Card.Title>
                <NotImplemented id="bundle" />
              </Flex>
              <Card.Description>{t("orderForm.bundles.help")}</Card.Description>
            </Stack>

            <Box minW={{ base: "full", sm: "72" }}>
              <BundleSearch disabled={noWarehouse} onAdd={onAdd} />
            </Box>
          </Flex>

          {/* Same rule as the items card: with no warehouse, every figure on a slot would be blank. */}
          {noWarehouse && (
            <Text fontSize="sm" color="warning.fg">
              {t("orders.pickWarehouseFirst")}
            </Text>
          )}

          {bundles.length === 0 && !noWarehouse && (
            <Text fontSize="sm" color="fg.muted" data-testid="bundle-empty">
              {t("orderForm.bundles.empty")}
            </Text>
          )}

          {bundles.map((bundle) => (
            <Box
              key={bundle.key}
              borderWidth="1px"
              borderColor="border"
              borderRadius="l2"
              p="card"
              data-testid={`bundle-${bundle.key}`}
            >
              <Stack gap="card">
                <Flex align="center" gap="card" wrap="wrap" justify="space-between">
                  <Flex align="center" gap="2" minW="0">
                    <Icon as={Package} boxSize="4" color="fg.muted" />
                    <Text fontWeight="bold">{bundle.name}</Text>
                  </Flex>

                  <Flex align="center" gap="2">
                    <Text fontSize="sm" color="fg.muted">
                      {t("orderForm.bundles.qty")}
                    </Text>
                    {/* The bundle's own quantity — it multiplies every slot's ceiling below, which is
                        why it sits in the header rather than beside one of them. */}
                    <QuantityInput
                      value={bundle.quantity}
                      min={1}
                      aria-label={t("orderForm.bundles.qty")}
                      testId={`bundle-qty-${bundle.key}`}
                      onChange={(quantity) => onQuantity(bundle.key, quantity)}
                    />
                    <IconButton
                      type="button"
                      size="xs"
                      variant="ghost"
                      aria-label={t("orderForm.bundles.remove")}
                      data-testid={`bundle-remove-${bundle.key}`}
                      onClick={() => onRemove(bundle.key)}
                    >
                      <Icon as={X} boxSize="4" />
                    </IconButton>
                  </Flex>
                </Flex>

                {bundle.slots.map((slot) => (
                  <SlotBox
                    key={slot.id}
                    teamId={teamId}
                    warehouseId={warehouseId}
                    bundle={bundle}
                    slot={slot}
                    stock={stock}
                    costs={costs}
                    onPreview={setPreview}
                    onFill={(products) => onFill(bundle.key, slot.id, products)}
                    onFillQuantity={(productId, quantity) =>
                      onFillQuantity(bundle.key, slot.id, productId, quantity)
                    }
                  />
                ))}
              </Stack>
            </Box>
          ))}
        </Stack>
      </Card.Body>

      <ImagePreview target={preview} onClose={() => setPreview(null)} />
    </Card.Root>
  );
}

// ── Choosing a bundle ───────────────────────────────────────────────────────────────────────────

// A SEARCH BOX, NOT A MENU (owner: "bundles can be very many").
//
// A menu listing every template stops working at twenty, and the catalogue is expected to be far
// larger. This is a combobox in its *search and add* form: it holds no value of its own — picking one
// puts the bundle on the order and empties the input, ready for the next.
//
// Each option carries the slot labels under the name, because two bundles called "Hampers …"
// differ by what is IN them, and that has to be readable before the pick rather than after.
//
// ⚠ THE FILTERING IS LOCAL because the list is local. A real catalogue reads `BundleList(q, page)`
// (HARD RULE 9: it grows), and this control then searches server-side exactly as ProductSelect does —
// the markup below does not change, only where `collection` comes from.
function BundleSearch({ disabled, onAdd }: { disabled: boolean; onAdd: (id: string) => void }) {
  const { t } = useTranslation();
  const [input, setInput] = useState("");

  const { collection, filter } = useListCollection<BundleTemplate>({
    initialItems: BUNDLES,
    itemToString: (bundle) => bundle.name,
    itemToValue: (bundle) => bundle.id,
    filter: (_itemText, filterText, bundle) => {
      const q = filterText.trim().toLowerCase();
      if (q === "") return true;

      // The slot labels are searchable too: somebody looking for the bundle with the coffee in it
      // types "coffee", not the bundle's name — which they are trying to find.
      return (
        bundle.name.toLowerCase().includes(q) ||
        bundle.slots.some((slot) => slot.label.toLowerCase().includes(q))
      );
    },
  });

  return (
    <Combobox.Root
      openOnClick
      collection={collection}
      disabled={disabled}
      // NO VALUE, EVER. The control is an action, not a field: what it produces is a bundle on the
      // order below, and a combobox left displaying the last thing added would read as a filter.
      value={[]}
      // ⚠ AND THE INPUT HAS TO BE CLEARED BY ZAG, not by us. The default selection behaviour is
      // "replace" — it writes the picked item's name into the input AFTER `onValueChange` runs, so
      // emptying it there left "Hampers Lebaran" sitting in the search box. "clear" is the setting
      // that matches what this control is for: pick, add, type the next one.
      selectionBehavior="clear"
      inputValue={input}
      onInputValueChange={(e) => {
        setInput(e.inputValue);
        filter(e.inputValue);
      }}
      onValueChange={(e) => {
        const picked = e.value[0];
        if (picked !== undefined) onAdd(picked);

        // Empty it, and reset the filter with it — otherwise the next open shows yesterday's search.
        setInput("");
        filter("");
      }}
      data-testid="bundle-search"
    >
      <Combobox.Control>
        <Combobox.Input placeholder={t("orderForm.bundles.search")} />
        <Combobox.IndicatorGroup>
          <Combobox.Trigger />
        </Combobox.IndicatorGroup>
      </Combobox.Control>

      <Portal>
        <Combobox.Positioner>
          <Combobox.Content>
            <Combobox.Empty>{t("orderForm.bundles.noMatch")}</Combobox.Empty>
            {collection.items.map((bundle) => (
              <Combobox.Item item={bundle} key={bundle.id} data-testid={`bundle-option-${bundle.id}`}>
                <Stack gap="0.5" minW="0">
                  <Text fontWeight="medium" lineClamp={1}>
                    {bundle.name}
                  </Text>
                  <Text fontSize="xs" color="fg.muted" lineClamp={1}>
                    {t("orderForm.bundles.slotCount", { count: bundle.slots.length })} ·{" "}
                    {bundle.slots.map((slot) => slot.label).join(", ")}
                  </Text>
                </Stack>
                <Combobox.ItemIndicator />
              </Combobox.Item>
            ))}
          </Combobox.Content>
        </Combobox.Positioner>
      </Portal>
    </Combobox.Root>
  );
}

// ── One slot ────────────────────────────────────────────────────────────────────────────────────

function SlotBox({
  teamId,
  warehouseId,
  bundle,
  slot,
  stock,
  costs,
  onPreview,
  onFill,
  onFillQuantity,
}: {
  teamId: bigint;
  warehouseId: bigint;
  bundle: BundleDraft;
  slot: SlotDraft;
  stock?: Availability;
  costs?: Costs;
  onPreview: (target: PreviewTarget) => void;
  onFill: (products: PickedProduct[]) => void;
  onFillQuantity: (productId: bigint, quantity: string) => void;
}) {
  const { t } = useTranslation();

  const cap = slotCap(slot, bundle.quantity);
  const filled = slotFilled(slot);
  // THREE readings, not two: under the ceiling is an INCOMPLETE bundle (the customer paid for a full
  // one), over it is more goods than the bundle says. Both are worth seeing; neither blocks here,
  // because nothing on this screen is submitted.
  const short = filled < cap;
  const over = filled > cap;

  return (
    <Stack gap="2" data-testid={`slot-${bundle.key}-${slot.id}`}>
      <Flex align="baseline" gap="2" wrap="wrap">
        <Text fontSize="sm" fontWeight="bold">
          {slot.label}
        </Text>
        <Text fontSize="xs" color="fg.muted">
          {t("orderForm.bundles.rule", { qty: slot.ruleQty })}
        </Text>
        {/* The ceiling, written as the sum it is — rule × bundles — so the number is checkable
            against the bundle quantity in the header rather than taken on trust. */}
        <Badge
          size="sm"
          colorPalette={over ? "error" : short ? "warning" : "success"}
          variant="subtle"
          data-testid={`slot-fill-${bundle.key}-${slot.id}`}
        >
          {filled} / {cap}
        </Badge>
      </Flex>

      <Stack gap="2">
        {slot.fills.map((fill) => {
          const cover = coverFor(fill);

          return (
            // THE SHARED PRODUCT ROW (CLAUDE.md: look for the component that already does it). It
            // brings the cover, the name over its SKU, the owning team and the stock badge — four
            // things this card was spelling out by hand, each a chance to drift from every other
            // product list in the app.
            <ProductListItem
              key={fill.productId.toString()}
              product={{
                id: fill.productId,
                sku: fill.sku,
                name: fill.name,
                defaultImageThumbnailUrl: cover,
              }}
              stock={stock?.get(fill.productId.toString())}
              onImageClick={() =>
                onPreview({ src: cover, title: fill.name, caption: fill.sku })
              }
              action={
                <Flex align="center" gap="2">
                  <QuantityInput
                    value={fill.quantity}
                    min={0}
                    aria-label={t("orders.qty")}
                    testId={`slot-qty-${fill.productId}`}
                    onChange={(quantity) => onFillQuantity(fill.productId, quantity)}
                  />
                  <Text fontSize="sm" minW="24" textAlign="end">
                    {formatRupiah(lineTotal(fill, costs))}
                  </Text>
                </Flex>
              }
            />
          );
        })}
      </Stack>

      {/* SUBSTITUTION. The trigger says what it does to THIS slot; the dialog is the catalogue, so a
          replacement can come from any team the warehouse holds goods for — which is the case the
          rule exists for. */}
      <Box>
        <AllProductPicker
          teamId={teamId}
          stockWarehouseId={warehouseId}
          readyLens="available"
          value={slot.fills.map((f) => f.productId)}
          onChange={onFill}
          trigger={
            <Button
              type="button"
              size="xs"
              variant="ghost"
              data-testid={`slot-substitute-${bundle.key}-${slot.id}`}
            >
              <Icon as={Replace} boxSize="4" />
              {t("orderForm.bundles.substitute")}
            </Button>
          }
        />
      </Box>
    </Stack>
  );
}
