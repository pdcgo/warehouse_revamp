import { useEffect, useState } from "react";
import { Combobox, Portal, Spinner, useListCollection } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import type { SupplierRecord } from "../../features/suppliers/adapt";
import { useSupplierOptions } from "../../features/suppliers/queries";
import { searchOnlyWhatIsTyped } from "../../lib/comboboxSearch";

// The whole list is loaded and filtered in the browser — a team buys from a handful. The cap and why it is not a
// server-side search: `SUPPLIER_OPTIONS_LIMIT` in features/suppliers/queries.ts, and the remount note below.

// One empty list for every render, so "nothing loaded" is the SAME value each time and the fill effect below does not
// re-run on a fresh `[]` (ShopSelect's loop note).
const NO_SUPPLIERS: SupplierRecord[] = [];

export interface SupplierSelectProps {
  /** The team whose OWN suppliers to list — a deleted one is never offered (a-deleted-supplier-is-kept-for-its-figures). */
  teamId: bigint;
  /** Selected supplier id (0n = none). */
  value?: bigint;
  onChange?: (supplierId: bigint) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Render the list in a portal (the default) or inline — pass `false` inside a modal Dialog or a Drawer, where a
   * portalled listbox lands outside the modal and is inert. */
  portalled?: boolean;
}

// SupplierSelect is the shared supplier picker for a team (#109). A Chakra Combobox so the list is
// searchable, matching on the NAME — a supplier has no code (the-supplier-has-no-code).
export const description =
  'Searchable supplier picker for a team (Chakra Combobox over SupplierList) — matches on the name. Emits a supplier id, and clears to 0 because "no supplier" is a real value.';

export function SupplierSelect({
  teamId,
  value,
  onChange,
  placeholder,
  disabled,
  portalled = true,
}: SupplierSelectProps) {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t("suppliers.select.placeholder");

  // THE LIST THROUGH THE QUERY CACHE (#121), not a fetch of its own: the same entry for every SupplierSelect of the
  // team, so a second form (or the same form mounted again) asks nothing, and a supplier added on My Supplier is in
  // the list without a reload (its write invalidates `suppliers`). The effect version this replaces fetched once per
  // mount and, on a failure, stayed "unavailable" until the field was mounted again.
  const noTeam = teamId <= 0n;
  const query = useSupplierOptions({ teamId });
  const suppliers = noTeam ? NO_SUPPLIERS : (query.data ?? NO_SUPPLIERS);
  // A read that failed with nothing to show. A re-read that fails over a list already shown keeps that list.
  const error = !noTeam && query.isError && query.data === undefined;
  // Answered: the list landed, or the read failed (the list is then empty and says why). No team is answered at once —
  // there is nothing to read.
  const settled = noTeam || query.isSuccess || query.isError;

  const { collection, filter, set } = useListCollection<SupplierRecord>({
    initialItems: [],
    itemToString: (s) => s.name,
    itemToValue: (s) => s.id.toString(),
    // Match the item's OWN LABEL — which is now the bare name.
    //
    // ⚠ Keep matching `itemText` if the label ever grows again: on SELECTION the combobox writes
    // itemToString back into the input, which re-runs this filter with the WHOLE label as the query. When
    // the label was "PT Sumber Makmur (SUP-A)" and the filter looked only at the name and the code, the
    // collection emptied and the field went BLANK while a supplier was in fact selected — the same
    // symptom as #131, arrived at from the other direction.
    filter: (itemText, filterText) => {
      const q = filterText.trim().toLowerCase();
      if (!q) return true;

      return itemText.toLowerCase().includes(q);
    },
  });

  // THE COLLECTION FILLS FROM THE QUERY, and `filledFor` says whose list it now holds — set in the SAME effect as the
  // fill, so the remount below (`key`) happens on the render where the collection already has the suppliers, never one
  // render before it (the prefilled-blank trap). A team switch empties the claim, so the field shows the spinner and
  // remounts again on the new team's list rather than offering the old team's suppliers under the new team.
  const [filledFor, setFilledFor] = useState<bigint | null>(null);

  useEffect(() => {
    if (!settled) {
      return;
    }

    set(suppliers);
    setFilledFor(teamId);
  }, [settled, suppliers, set, teamId]);

  const loading = !settled || filledFor !== teamId;

  return (
    <Combobox.Root
      // Remounted once, the moment the list lands — load-bearing, and the same trap TeamSelect and
      // ShippingSelect document (#131). Zag derives the input's DISPLAY TEXT when the machine
      // initialises and thereafter only when `value` changes, so a collection that fills in LATER
      // never re-derives it. An edit form that mounts this with a supplier ALREADY set — the restock
      // edit form does exactly that — would look the id up in an empty collection, resolve to "", and
      // never recover: the field would read blank while a supplier is in fact selected.
      //
      // It is also why the whole list is loaded rather than searched server-side: a server-side search
      // starts empty by design, so the selected supplier would not be in the collection to resolve.
      key={loading ? "loading" : "ready"}
      // OPEN ON CLICK (#146's lesson, applied here too). Clicking the field shows the suppliers
      // straight away rather than demanding a search first — the whole list is already loaded, so
      // making somebody type to discover what exists is asking them to guess.
      openOnClick
      collection={collection}
      disabled={disabled}
      value={value !== undefined && value > 0n ? [value.toString()] : []}
      onValueChange={(e) => {
        // CLEARING EMITS 0n (#131), it does not do nothing.
        //
        // "No supplier" is a legitimate value — a restock need not name one — so the field must be
        // un-settable. Swallowing the empty case is what made this picker's predecessor WRITE-ONCE: a
        // supplier recorded by mistake could never be removed, though the contract, the handler and
        // its test all support clearing it.
        const picked = e.value[0];

        onChange?.(picked === undefined || picked === "" ? 0n : BigInt(picked));
      }}
      // Only a keystroke searches; a pick, a blur or a click-to-open starts over — so the list reopens whole.
      {...searchOnlyWhatIsTyped(filter)}
      data-testid="supplier-select"
    >
      <Combobox.Control>
        <Combobox.Input
          placeholder={error ? t("suppliers.select.unavailable") : resolvedPlaceholder}
        />
        <Combobox.IndicatorGroup>
          {/* The affordance that makes "no supplier" reachable with the mouse. */}
          <Combobox.ClearTrigger />
          <Combobox.Trigger />
        </Combobox.IndicatorGroup>
      </Combobox.Control>

      <Portal disabled={!portalled}>
        <Combobox.Positioner>
          <Combobox.Content>
            {loading ? (
              <Combobox.Empty>
                <Spinner size="sm" colorPalette="brand" />
              </Combobox.Empty>
            ) : (
              <>
                <Combobox.Empty>
                  {error ? t("suppliers.select.unavailable") : t("suppliers.select.empty")}
                </Combobox.Empty>
                {collection.items.map((supplier) => (
                  <Combobox.Item
                    item={supplier}
                    key={supplier.id.toString()}
                    data-testid={`supplier-select-option-${supplier.id}`}
                  >
                    {supplier.name}
                    <Combobox.ItemIndicator />
                  </Combobox.Item>
                ))}
              </>
            )}
          </Combobox.Content>
        </Combobox.Positioner>
      </Portal>
    </Combobox.Root>
  );
}
