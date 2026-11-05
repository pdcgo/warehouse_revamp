import { useEffect, useState } from "react";
import { Combobox, Portal, Span, Stack, useListCollection } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

import { type OwnedSupplier, useSupplierSearch } from "../../features/suppliers/discover";
import { useDebounced } from "../../lib/useDebounced";

export interface SupplierSearchSelectProps {
  /** The caller's team — it only authorizes the request; the answer spans every team's live suppliers. */
  teamId: bigint;
  /** Selected supplier id (for the checkmark); 0n = none. */
  value?: bigint;
  onChange?: (supplier: OwnedSupplier) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Render the list in a portal (the default) or inline — pass `false` inside a modal Dialog or a Drawer. */
  portalled?: boolean;
  testId?: string;
}

// SupplierSearchSelect — the supplier picker for a team that keeps NO suppliers of its own (a warehouse, root): every
// team's live suppliers, searched on the server the way ProductSelect searches products (SupplierList EVERY_TEAM `q`,
// min 2 chars), each option naming the team that keeps it, since two sellers may each buy from a "CV Maju". A seller
// picks from its own with SupplierSelect.
export const description =
  "Searchable supplier picker across every team (Chakra Combobox over SupplierList's EVERY_TEAM scope, server-side, at least 2 characters). Each option names the team that keeps the supplier. For a reader with no suppliers of its own, such as a warehouse; a seller uses SupplierSelect.";

export function SupplierSearchSelect({
  teamId,
  value,
  onChange,
  placeholder,
  disabled,
  portalled = true,
  testId = "supplier-search-select",
}: SupplierSearchSelectProps) {
  const { t } = useTranslation();
  const [input, setInput] = useState("");

  const { collection, set } = useListCollection<OwnedSupplier>({
    initialItems: [],
    itemToString: (s) => s.name,
    itemToValue: (s) => s.id.toString(),
  });

  const q = useDebounced(input.trim());
  const results = useSupplierSearch({ teamId, q });

  useEffect(() => {
    set(q.length >= 2 && teamId > 0n ? (results.data ?? []) : []);
  }, [q, teamId, results.data, set]);

  return (
    <Combobox.Root
      collection={collection}
      disabled={disabled}
      value={value !== undefined && value > 0n ? [value.toString()] : []}
      onValueChange={(e) => {
        const picked = collection.items.find((s) => s.id.toString() === e.value[0]);
        if (picked) onChange?.(picked);
      }}
      onInputValueChange={(e) => setInput(e.inputValue)}
      data-testid={testId}
    >
      <Combobox.Control>
        <Combobox.Input placeholder={placeholder ?? t("suppliers.searchSelect.placeholder")} />
        <Combobox.IndicatorGroup>
          <Combobox.ClearTrigger />
          <Combobox.Trigger />
        </Combobox.IndicatorGroup>
      </Combobox.Control>

      <Portal disabled={!portalled}>
        <Combobox.Positioner>
          <Combobox.Content>
            <Combobox.Empty>
              {results.isError
                ? t("suppliers.select.unavailable")
                : input.trim().length < 2
                  ? t("suppliers.searchSelect.typeMore")
                  : t("suppliers.select.empty")}
            </Combobox.Empty>
            {collection.items.map((s) => (
              <Combobox.Item item={s} key={s.id.toString()} data-testid={`${testId}-option-${s.id}`}>
                <Stack gap="0">
                  <Span fontWeight="medium">{s.name}</Span>
                  {s.teamName && (
                    <Span fontSize="xs" color="fg.muted">
                      {s.teamName}
                    </Span>
                  )}
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
