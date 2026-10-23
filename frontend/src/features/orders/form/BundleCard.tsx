import { useState } from "react";
import {
  Badge,
  Box,
  Button,
  Card,
  Flex,
  Icon,
  IconButton,
  Stack,
  Text,
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
import type { BundleDraft, SlotDraft } from "./bundles";
import { slotCap, slotFilled } from "./bundles";
import { BUNDLES } from "./mockData";
import { BundlePicker } from "./BundlePicker";
import { coverFor } from "./mockImages";
import { NotImplemented } from "../../../features/pending/NotImplemented";
import { ORDER_FORM_PENDING } from "./pending";
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
          {/* THE ITEMS CARD'S SHAPE (owner: *"tambah bundle buat seperti item"*, bundles-are-added-like-items) — the
              title and what the card is for, and on the right the button that opens the picker; the two cards are the
              two ways to fill one order (an-order-holds-items-or-bundles), so they read alike. */}
          <Flex align="start" gap="card" wrap="wrap" justify="space-between">
            <Stack gap="0.5" minW="0">
              <Flex align="center" gap="2" wrap="wrap">
                {/* One step larger, as the items card's title is — it holds the order's goods in its place. */}
                <Card.Title textStyle="xl">{t("orderForm.bundles.title")}</Card.Title>
                <NotImplemented list={ORDER_FORM_PENDING} id="bundle" />
              </Flex>
              <Card.Description>{t("orderForm.bundles.help")}</Card.Description>
            </Stack>

            <Flex align="center" gap="card" wrap="wrap">
              <BundlePicker bundles={BUNDLES} disabled={noWarehouse} onAdd={(ids) => ids.forEach(onAdd)} />

              {/* WHY it is disabled, beside the disabled thing — with no warehouse every figure on a slot is blank. */}
              {noWarehouse && (
                <Text fontSize="sm" color="warning.fg" data-testid="bundle-need-warehouse">
                  {t("orders.pickWarehouseFirst")}
                </Text>
              )}
            </Flex>
          </Flex>

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

// ── One slot ────────────────────────────────────────────────────────────────────────────────────

// Its own component — one slot, the box a bundle's line is filled in.
export function SlotBox({
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
