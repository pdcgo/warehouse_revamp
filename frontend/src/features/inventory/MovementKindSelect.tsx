import { useEffect, useMemo } from "react";
import { Badge, Combobox, Portal, useListCollection } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

import { MovementKind } from "../../gen/warehouse/inventory/v1/inventory_pb";
import { searchOnlyWhatIsTyped } from "../../lib/comboboxSearch";
import { kindLabel, kindPalette } from "./movementKind";

// The kinds a ledger can be narrowed to, in the order a stock's life reads: in, out, moved, set right. One list, so a kind
// added to the ledger is offered here by adding it once.
export const LEDGER_KINDS: MovementKind[] = [
  MovementKind.RECEIVE,
  MovementKind.TRANSFER_IN,
  MovementKind.RETURN,
  MovementKind.PICK,
  MovementKind.TRANSFER_OUT,
  MovementKind.SAMPLE,
  MovementKind.MOVE,
  MovementKind.ADJUST,
  MovementKind.REVALUATION,
];

interface KindItem {
  value: string;
  label: string;
  kind: MovementKind;
}

export const description =
  "A ledger's Kegiatan filter (Chakra Combobox). Emits a MovementKind — ONE at a time, as StockHistory's filter takes it — and UNSPECIFIED when empty, which reads *Semua kegiatan*. Each option is the kind's BADGE, in the colour it has in the ledger's rows (kindPalette); typing searches the kinds' words; its × empties it back to every kind.";

// MovementKindSelect narrows a stock ledger to ONE kind of movement (owner, on a batch's Riwayat: *"pakai kindnya"*, then
// *"selectnya pakai badge seperti sebelumnya, ada search juga, lalu ada closeable"*, riwayat-filters-by-one-kind).
//
// A SEARCH SELECT ON THE OWNER'S WORD, though the set is bounded by the code (nine kinds, never data) — the rule would
// make it a plain list; the owner asked for the search. Each option is drawn as the BADGE the kind has in the rows below
// (a-movement-kind-is-a-badge), so the filter and what it narrows read alike. Empty means every kind: no *Semua kegiatan*
// option to pick — the placeholder says it, and the × goes back to it.
export function MovementKindSelect({
  value,
  onChange,
  testId = "movement-kind-select",
}: {
  value: MovementKind;
  onChange: (kind: MovementKind) => void;
  testId?: string;
}) {
  const { t } = useTranslation();

  const items: KindItem[] = useMemo(
    () => LEDGER_KINDS.map((kind) => ({ value: String(kind), label: kindLabel(t, kind), kind })),
    [t],
  );

  const { collection, filter, set } = useListCollection<KindItem>({
    initialItems: items,
    itemToString: (item) => item.label,
    itemToValue: (item) => item.value,
    filter: (itemText, filterText) => itemText.toLowerCase().includes(filterText.trim().toLowerCase()),
  });

  // The words follow the language — a switch re-labels the options.
  useEffect(() => {
    set(items);
  }, [items, set]);

  return (
    <Combobox.Root
      collection={collection}
      // Only a keystroke searches; a pick, a blur or a click-to-open starts over — so the list reopens whole.
      {...searchOnlyWhatIsTyped(filter)}
      selectionBehavior="replace"
      openOnClick
      w="full"
      value={value === MovementKind.UNSPECIFIED ? [] : [String(value)]}
      onValueChange={(e) => {
        // ⚠ CLEARING EMITS UNSPECIFIED — every kind, the none sentinel, never nothing (#131).
        const picked = e.value[0];
        onChange(picked ? (Number(picked) as MovementKind) : MovementKind.UNSPECIFIED);
      }}
    >
      <Combobox.Control>
        <Combobox.Input
          data-testid={testId}
          placeholder={t("warehouseProduct.kind.all")}
          aria-label={t("inventory.movement.what")}
        />
        <Combobox.IndicatorGroup>
          <Combobox.ClearTrigger data-testid={`${testId}-clear`} />
          <Combobox.Trigger />
        </Combobox.IndicatorGroup>
      </Combobox.Control>

      <Portal>
        <Combobox.Positioner>
          <Combobox.Content>
            <Combobox.Empty>{t("warehouseProduct.kind.none")}</Combobox.Empty>
            {collection.items.map((item) => (
              <Combobox.Item item={item} key={item.value} data-testid={`${testId}-${item.value}`}>
                <Badge colorPalette={kindPalette(item.kind)} variant="subtle">
                  {item.label}
                </Badge>
                <Combobox.ItemIndicator />
              </Combobox.Item>
            ))}
          </Combobox.Content>
        </Combobox.Positioner>
      </Portal>
    </Combobox.Root>
  );
}
