import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Combobox, Flex, Portal, Stack, Text, useListCollection } from "@chakra-ui/react";

import type { RestockRequest } from "../../../gen/warehouse/inventory/v1/restock_request_pb";
import { RestockStatusBadge } from "../../../components/badges/RestockStatusBadge";
import { useLabelableRestocks } from "../../../features/restock/queries";
import { searchOnlyWhatIsTyped } from "../../../lib/comboboxSearch";
import { useDebounced } from "../../../lib/useDebounced";

// TAMBAH RESTOK — one more restock onto Cetak Label (labels-print-several-restocks).
//
// A SEARCH SELECT, because a warehouse's restocks grow without end: it opens on the newest Tiba and Diterima ones with
// nothing typed (every-combobox-reopens-whole) and searches the server as typed — the number, the resi, the Order ID,
// a line's SKU or name. Only those two statuses are offered: nothing else has labels. One already on the page is
// there, disabled, with no word about it (as Terima's taken racks).
//
// It is an ACTION, not a field: a pick adds the restock and the box starts over, empty, for the next one.
export function AddRestockSelect({
  teamId,
  taken,
  onAdd,
  disabled = false,
}: {
  teamId: bigint | undefined;
  /** The restocks already on the page. */
  taken: bigint[];
  onAdd: (id: bigint) => void;
  /** The print is full (at-most-fifty-restocks-a-print). */
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  // Each pick remounts the box, so it is empty again rather than holding the restock just added.
  const [round, setRound] = useState(0);

  const q = useDebounced(input.trim());
  const results = useLabelableRestocks({ teamId, q });
  // Read through a ref: the collection keeps the options it was built with, and a restock taken off the page must be
  // pickable again without waiting for the next search.
  const takenRef = useRef(taken);
  takenRef.current = taken;

  const { collection, set } = useListCollection<RestockRequest>({
    initialItems: [],
    itemToString: (r) => `#${r.id.toString()}`,
    itemToValue: (r) => r.id.toString(),
    isItemDisabled: (r) => takenRef.current.includes(r.id),
  });

  useEffect(() => {
    set(results.data ?? []);
  }, [results.data, set]);

  return (
    <Combobox.Root
      key={round}
      collection={collection}
      disabled={disabled}
      openOnClick
      value={[]}
      onValueChange={(e) => {
        const picked = e.value[0];
        if (picked === undefined) return;
        onAdd(BigInt(picked));
        setInput("");
        setRound((n) => n + 1);
      }}
      {...searchOnlyWhatIsTyped(setInput)}
      data-testid="labels-add-restock"
    >
      <Combobox.Control>
        <Combobox.Input placeholder={t("restock.labels.restocks.add")} aria-label={t("restock.labels.restocks.addLabel")} />
        <Combobox.IndicatorGroup>
          <Combobox.Trigger />
        </Combobox.IndicatorGroup>
      </Combobox.Control>

      <Portal>
        <Combobox.Positioner>
          <Combobox.Content>
            <Combobox.Empty>
              {results.isPending ? t("restock.labels.restocks.loading") : t("restock.labels.restocks.noMatch")}
            </Combobox.Empty>
            {collection.items.map((r) => (
              // Two lines: the number and its status; under it what is in the box and its resi.
              <Combobox.Item item={r} key={r.id.toString()} data-testid={`labels-add-restock-option-${r.id.toString()}`}>
                <Stack gap="0.5" minW="0" flex="1">
                  <Flex align="center" gap="2">
                    <Text fontWeight="bold">#{r.id.toString()}</Text>
                    <RestockStatusBadge status={r.status} />
                  </Flex>
                  <Text fontSize="xs" color="fg.muted" truncate>
                    {[r.items.map((l) => l.name).join(", "), r.receipt].filter(Boolean).join(" · ")}
                  </Text>
                </Stack>
              </Combobox.Item>
            ))}
          </Combobox.Content>
        </Combobox.Positioner>
      </Portal>
    </Combobox.Root>
  );
}
