import { useEffect, useState } from "react";
import { Combobox, Portal, Spinner, useListCollection } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { rpcError, supplierClient } from "../api/clients";
import type { Supplier } from "../gen/warehouse/inventory/v1/supplier_pb";

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
  /** The team whose suppliers to list — a supplier is team-scoped, so this is required. */
  teamId: bigint;
  /** Selected supplier id (0n = none). */
  value?: bigint;
  onChange?: (supplierId: bigint) => void;
  placeholder?: string;
  disabled?: boolean;
}

// SupplierSelect is the shared supplier picker for a team (#109). A Chakra Combobox so the list is
// searchable, matching on NAME or CODE — people type either, and two suppliers with similar names
// stay distinguishable by the code beside them.
export const description =
  'Searchable supplier picker for a team (Chakra Combobox over SupplierList) — matches on name or code. Emits a supplier id, and clears to 0 because "no supplier" is a real value.';

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

  const { collection, filter, set } = useListCollection<Supplier>({
    initialItems: [],
    itemToString: (s) => (s.code ? `${s.name} (${s.code})` : s.name),
    itemToValue: (s) => s.id.toString(),
    // Match on name OR code — the combobox's default matcher only sees itemToString, and while that
    // happens to contain both today, spelling the rule out keeps it true if the label ever changes.
    filter: (_itemText, filterText, supplier) => {
      const q = filterText.trim().toLowerCase();
      if (!q) return true;

      return supplier.name.toLowerCase().includes(q) || supplier.code.toLowerCase().includes(q);
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
      .supplierList({ teamId, q: "", page: { page: 1, limit: SUPPLIER_LIMIT } })
      .then((res) => {
        if (alive) set(res.suppliers);
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
                    {supplier.code ? `${supplier.name} (${supplier.code})` : supplier.name}
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
