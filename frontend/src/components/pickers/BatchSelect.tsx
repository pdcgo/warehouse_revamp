import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Combobox, HStack, Span, Stack, useListCollection } from "@chakra-ui/react";

import { useProductBatches } from "../../features/inventory/queries";
import { BatchOrigin, type StockBatch } from "../../gen/warehouse/inventory/v1/inventory_pb";
import { searchOnlyWhatIsTyped } from "../../lib/comboboxSearch";
import { formatUnixDateShort } from "../../lib/datetime";

export const description =
  "Searchable batch picker for one product in one warehouse (Chakra Combobox over BatchList) — only the batches that still hold stock. Each option is the batch's OWN number with its ready count, and where it came from (Restok #503, or Retur) with the day it arrived under it; typing searches the batch number or the restock number. Emits the batch id, and 0n when cleared. Never portalled, so it works inside a modal dialog (Koreksi's Damaged and Lost).";

interface BatchItem {
  value: string;
  /** What the field reads once picked — *#5031 · 7 siap*. */
  label: string;
  /** Where it came from, in words — *Restok #503*, *Retur*, or empty. */
  source: string;
  batch: StockBatch;
}

// One empty list for every render — a fresh `[]` is a new identity, and the fill effect keyed on it would loop.
const NO_BATCHES: StockBatch[] = [];

// BATCH SELECT (owner: *"batch selectnya"*, a-batch-is-picked-by-its-own-number) — what Koreksi's Damaged and Lost write
// units off from. A SEARCH SELECT, not a plain list: a product gains a batch with every restock, and a person holding a
// damaged box reads the number off its label — so they type it. The batches are loaded whole (only those still holding
// stock, a large first page — useProductBatches) and FILTERED IN THE FIELD, as ShopSelect does.
//
//   #5031                         Siap 7      ← the batch's own number, the one in a label's QR
//   Restok #503 · 1 Nov                       ← where it came from and when it arrived, to tell two apart
//
// It used to name each option by its RESTOCK's number, so two batches of one restock read alike (#503 · 7 siap,
// #503 · 17 siap) — the mistake the batch screens put right (the-batches-follow-the-screen-rules).
export function BatchSelect({
  warehouseId,
  productId,
  value,
  onChange,
  placeholder,
  testId = "batch-select",
}: {
  warehouseId: bigint | undefined;
  productId: bigint;
  /** The picked batch's id; 0n = none. */
  value: bigint;
  onChange: (batchId: bigint) => void;
  placeholder?: string;
  /** The input's test id; each option is `<testId>-option-<batchId>`. */
  testId?: string;
}) {
  const { t } = useTranslation();
  const query = useProductBatches({ warehouseId, productId });
  const batches = query.data ?? NO_BATCHES;

  const items: BatchItem[] = useMemo(
    () =>
      batches.map((b) => ({
        value: b.id.toString(),
        label: t("inventory.batchOption", { id: b.id.toString(), ready: b.ready.toString() }),
        source:
          b.origin === BatchOrigin.RETURN
            ? t("batches.fromReturn")
            : b.deliveryId > 0n
              ? t("batches.fromRestock", { id: b.deliveryId.toString() })
              : "",
        batch: b,
      })),
    [batches, t],
  );

  const { collection, filter, set } = useListCollection<BatchItem>({
    initialItems: [],
    itemToString: (item) => item.label,
    itemToValue: (item) => item.value,
    // The batch's number or its restock's — "#5031", "5031", "503" — never the ready count the label also carries.
    filter: (_itemText, filterText, item) => {
      const needle = filterText.trim().toLowerCase().replace(/^#/, "");
      if (!needle) return true;

      return item.value.includes(needle) || item.source.toLowerCase().includes(needle);
    },
  });

  // ⚠ REMOUNTED ONCE THE BATCHES LAND, BUT ONLY WHEN IT WAS PREFILLED (the `key` below) — a combobox whose collection
  // fills in late renders a prefilled value BLANK, since Zag derives the field's text at init and then only when the value
  // changes (ShopSelect's note). An EMPTY field has nothing to derive, so it keeps its mount: a remount would throw away
  // what somebody had already started typing.
  const [filled, setFilled] = useState(false);
  const mount = filled || value === 0n ? "ready" : "loading";

  useEffect(() => {
    if (!query.isSuccess) return;

    set(items);
    setFilled(true);
  }, [items, query.isSuccess, set]);

  return (
    <Combobox.Root
      key={mount}
      collection={collection}
      // Only a keystroke searches; a pick, a blur or a click-to-open starts over — so the list reopens whole.
      {...searchOnlyWhatIsTyped(filter)}
      selectionBehavior="replace"
      openOnClick
      value={value > 0n ? [value.toString()] : []}
      onValueChange={(e) => {
        // ⚠ CLEARING EMITS 0n — the none sentinel, never nothing (#131).
        const picked = e.value[0];
        onChange(picked ? BigInt(picked) : 0n);
      }}
    >
      <Combobox.Control>
        <Combobox.Input
          data-testid={testId}
          placeholder={query.isError ? t("inventory.batchSelectError") : (placeholder ?? t("inventory.batchSelectPlaceholder"))}
        />
        <Combobox.IndicatorGroup>
          <Combobox.ClearTrigger data-testid={`${testId}-clear`} />
          <Combobox.Trigger />
        </Combobox.IndicatorGroup>
      </Combobox.Control>

      {/* No Portal on purpose: it is used inside a modal Dialog, where a portalled listbox lands outside the dialog —
          inert and unclickable (RackSelect's and ShopSelect's reason). */}
      <Combobox.Positioner>
        <Combobox.Content>
          <Combobox.Empty>
            {batches.length === 0 ? t("inventory.batchSelectNoStock") : t("inventory.batchSelectNone")}
          </Combobox.Empty>
          {collection.items.map((item) => (
            <Combobox.Item item={item} key={item.value} data-testid={`${testId}-option-${item.value}`}>
              <Stack gap="0" flex="1" minW="0">
                <HStack justify="space-between" gap="3">
                  <Span fontWeight="bold">#{item.value}</Span>
                  <Span fontSize="sm" color="fg.muted" flexShrink={0}>
                    {t("batchDetail.ready")} {item.batch.ready.toString()}
                  </Span>
                </HStack>
                {(item.source || item.batch.createdAtUnix > 0n) && (
                  <Span fontSize="xs" color="fg.muted">
                    {[item.source, item.batch.createdAtUnix > 0n ? formatUnixDateShort(item.batch.createdAtUnix) : ""]
                      .filter(Boolean)
                      .join(" · ")}
                  </Span>
                )}
              </Stack>
              <Combobox.ItemIndicator />
            </Combobox.Item>
          ))}
        </Combobox.Content>
      </Combobox.Positioner>
    </Combobox.Root>
  );
}
