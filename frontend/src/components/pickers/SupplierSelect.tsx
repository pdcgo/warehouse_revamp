import { useEffect, useState } from "react";
import { Combobox, Portal, Spinner, useListCollection } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { rpcError, supplierClient } from "../../api/clients";
import { type SupplierRecord, suppliersFromList, supplierListRowData } from "../../features/suppliers/adapt";
import { SupplierListScope } from "../../gen/warehouse/supplier/v1/supplier_pb";

// How many suppliers are loaded. A team buys from a handful — dozens at most — so the whole list is
// fetched and filtered in the browser.
//
// Said plainly because it IS a cap: a team with more suppliers than this would find the surplus
// silently unselectable. That becomes the wrong trade the day it happens, and the fix then is
// SupplierList's `q` driving a server-side search the way ProductSelect does. It is not the right
// trade today, because a server-side search breaks the case #131 exists to protect — see the remount
// note below.
const SUPPLIER_LIMIT = 200;

export interface SupplierSelectProps {
  /** The team whose OWN suppliers to list — a deleted one is never offered (a-deleted-supplier-is-kept-for-its-figures). */
  teamId: bigint;
  /** Selected supplier id (0n = none). */
  value?: bigint;
  onChange?: (supplierId: bigint) => void;
  placeholder?: string;
  disabled?: boolean;
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
}: SupplierSelectProps) {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t("suppliers.select.placeholder");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

  useEffect(() => {
    if (teamId <= 0n) {
      set([]);
      setLoading(false);

      return;
    }

    let alive = true;

    setLoading(true);

    supplierClient
      .supplierList({
        teamId,
        // This team's own — another team's supplier is Discover's question, not this picker's.
        filter: { scope: SupplierListScope.OWN },
        dataRequest: supplierListRowData(),
        page: { page: 1, limit: SUPPLIER_LIMIT },
      })
      .then((res) => {
        if (alive) set(suppliersFromList(res.items, res.ids));
      })
      .catch((err) => {
        if (alive) {
          setError(rpcError(err));
          set([]);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [teamId, set]);

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
      onInputValueChange={(e) => filter(e.inputValue)}
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

      <Portal>
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
