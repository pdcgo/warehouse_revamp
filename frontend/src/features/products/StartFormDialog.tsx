import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, CloseButton, Dialog, Field, Icon, Portal, RadioCard, Spinner, Stack, Text } from "@chakra-ui/react";
import { ArrowRight } from "lucide-react";

import { QuantityInput } from "../../components/inputs/QuantityInput";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { parseQuantity } from "../../lib/quantity";
import { useAvailabilityByWarehouse } from "../inventory/queries";
import { useTeams } from "../teams/queries";

// THE FIRST STEP OF AN ORDER OR A RESTOCK, ON THE PRODUCT'S OWN PAGE (owner: *"untuk buat order maupun restok lebih baik
// bisa input valuenya sejak awal di halaman detail, untuk order ada pilih gudang dan cek stok dulu berarti"*,
// the-order-and-restock-start-on-the-page) — the warehouse and the quantity, chosen here, then the form opens with both
// on its first line (a-product-page-opens-the-order-and-restock-forms).
//
//   ┌ Buat Pesanan ──────────────────────────────┐
//   │ Gula Pasir 1kg · SKU-GULA-1K                │
//   │ Gudang   (●) Gudang Pusat     Siap 12 pcs   │   ← every warehouse, its ready stock: the stock check
//   │          ( ) Gudang Cabang    Habis          │   ← an order cannot ship from an empty one
//   │ Jumlah   [ − 2 + ]  dari 12 pcs siap         │
//   │                       [Batal] [Lanjutkan →] │
//   └─────────────────────────────────────────────┘
//
// ORDER: the warehouse it ships from — only one holding stock, the one with the most preselected unless the page's lens
// picked another that holds some — and a quantity no more than is ready there. RESTOCK: the warehouse it lands in — any,
// its current stock shown — and how many. Either way the form re-checks everything; this only starts it.

export type StartKind = "order" | "restock";

export function StartFormDialog({
  kind,
  open,
  onOpenChange,
  teamId,
  product,
  initialWarehouseId = 0n,
  onContinue,
}: {
  kind: StartKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamId: bigint | undefined;
  product: { id: bigint; name: string; sku: string };
  /** The page's warehouse lens — preselected when it can be used. */
  initialWarehouseId?: bigint;
  onContinue: (warehouseId: bigint, quantity: number) => void;
}) {
  const { t } = useTranslation();

  return (
    <Dialog.Root open={open} onOpenChange={(e) => onOpenChange(e.open)} size="sm" placement="center">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid={`start-${kind}-dialog`}>
            <Dialog.Header>
              <Dialog.Title>{kind === "order" ? t("products.newOrder") : t("products.newRestock")}</Dialog.Title>
            </Dialog.Header>
            {/* Mounted only while open, so the stock is read when somebody asks — and asked afresh each time. */}
            {open && (
              <StartBody
                kind={kind}
                teamId={teamId}
                product={product}
                initialWarehouseId={initialWarehouseId}
                onCancel={() => onOpenChange(false)}
                onContinue={onContinue}
              />
            )}
            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}

function StartBody({
  kind,
  teamId,
  product,
  initialWarehouseId,
  onCancel,
  onContinue,
}: {
  kind: StartKind;
  teamId: bigint | undefined;
  product: { id: bigint; name: string; sku: string };
  initialWarehouseId: bigint;
  onCancel: () => void;
  onContinue: (warehouseId: bigint, quantity: number) => void;
}) {
  const { t } = useTranslation();
  const warehouses = useTeams({ teamType: TeamType.WAREHOUSE, page: 1, pageSize: 100, reference: true });
  const list = warehouses.data?.teams ?? [];
  const availability = useAvailabilityByWarehouse({ teamId, productId: product.id, warehouseIds: list.map((w) => w.id) });
  const readyAt = (id: bigint) => availability.data?.get(id.toString());

  const [picked, setPicked] = useState<bigint | undefined>(undefined);
  const [quantity, setQuantity] = useState("1");

  const loading = warehouses.isPending || availability.isPending;
  const usable = (id: bigint) => kind === "restock" || (readyAt(id) ?? 0n) > 0n;

  // THE PRESELECTION, until somebody picks: the page's lens when it can be used; for an order otherwise the warehouse
  // holding the most, so the common case is one click.
  const fallback =
    initialWarehouseId > 0n && list.some((w) => w.id === initialWarehouseId) && usable(initialWarehouseId)
      ? initialWarehouseId
      : kind === "order"
        ? list
            .filter((w) => usable(w.id))
            .reduce<bigint | undefined>(
              (best, w) => (best === undefined || (readyAt(w.id) ?? 0n) > (readyAt(best) ?? 0n) ? w.id : best),
              undefined,
            )
        : undefined;
  const warehouseId = picked ?? (loading ? undefined : fallback);

  const qty = parseQuantity(quantity);
  const ready = warehouseId !== undefined ? readyAt(warehouseId) : undefined;
  const over = kind === "order" && qty !== null && ready !== undefined && BigInt(qty) > ready;
  const canContinue = warehouseId !== undefined && qty !== null && qty >= 1 && !over;

  return (
    <>
      <Dialog.Body>
        <Stack gap="field">
          <Stack gap="0">
            <Text fontWeight="bold">{product.name}</Text>
            <Text fontSize="sm" color="fg.muted">
              {product.sku}
            </Text>
          </Stack>

          <Field.Root>
            <Field.Label>{t("products.start.warehouse")}</Field.Label>
            {loading ? (
              <Spinner colorPalette="brand" size="sm" />
            ) : (
              <RadioCard.Root
                size="sm"
                value={warehouseId?.toString() ?? null}
                onValueChange={(e) => e.value && setPicked(BigInt(e.value))}
                w="full"
                data-testid="start-warehouse"
              >
                <Stack gap="2">
                  {list.map((w) => {
                    const n = readyAt(w.id);

                    return (
                      <RadioCard.Item
                        key={w.id.toString()}
                        value={w.id.toString()}
                        disabled={!usable(w.id)}
                        data-testid={`start-warehouse-${w.id}`}
                      >
                        <RadioCard.ItemHiddenInput />
                        <RadioCard.ItemControl alignItems="center" gap="3">
                          <RadioCard.ItemIndicator />
                          <RadioCard.ItemText flex="1">{w.name}</RadioCard.ItemText>
                          <Text
                            fontSize="sm"
                            color={n === 0n ? "error.fg" : "fg.muted"}
                            data-testid={`start-warehouse-ready-${w.id}`}
                          >
                            {n === undefined
                              ? "—"
                              : n === 0n
                                ? t("products.detail.highlight.status.out")
                                : t("products.start.ready", { n: n.toString() })}
                          </Text>
                        </RadioCard.ItemControl>
                      </RadioCard.Item>
                    );
                  })}
                </Stack>
              </RadioCard.Root>
            )}
          </Field.Root>

          <Field.Root invalid={over}>
            <Field.Label>{t("products.start.quantity")}</Field.Label>
            <QuantityInput
              value={quantity}
              onChange={setQuantity}
              min={1}
              width="32"
              placeholder="1"
              aria-label={t("products.start.quantity")}
              testId="start-quantity"
            />
            {kind === "order" && ready !== undefined && (
              over ? (
                <Field.ErrorText data-testid="start-quantity-over">
                  {t("products.start.overReady", { n: ready.toString() })}
                </Field.ErrorText>
              ) : (
                <Field.HelperText>{t("products.start.ofReady", { n: ready.toString() })}</Field.HelperText>
              )
            )}
          </Field.Root>
        </Stack>
      </Dialog.Body>
      <Dialog.Footer gap="2">
        <Button variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button
          colorPalette="brand"
          disabled={!canContinue}
          data-testid={`start-${kind}-continue`}
          onClick={() => canContinue && onContinue(warehouseId!, qty!)}
        >
          {t("products.start.continue")}
          <Icon as={ArrowRight} boxSize="4" />
        </Button>
      </Dialog.Footer>
    </>
  );
}
