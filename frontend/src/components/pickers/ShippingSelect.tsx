import { useEffect, useMemo, useState } from "react";
import { Combobox, Portal, Spinner, useListCollection } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import type { ShipmentChannel } from "../../gen/warehouse/shipment/v1/shipment_pb";
import { useShippingCatalogue } from "../../features/shipping/catalogue";
import { ShippingBadge } from "../badges/ShippingBadge";

export interface ShippingSelectProps {
  /** Selected courier CODE (Shipping.code — the stable key a shipment stores, not the name). */
  value?: string;
  onChange?: (code: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

// ShippingSelect is a reusable courier picker backed by the shared courier catalogue (#126) — it does
// not fetch for itself, so a screen with a picker AND badges makes ONE ShippingList call. The value it
// emits is a courier CODE, so callers persist a stable key rather than a display label.
//
// A Chakra Combobox (#146) rather than a NativeSelect: the courier catalogue is curated but it is a
// list of dozens, and a searchable field beats scrolling a native dropdown to find "JNE REG".
export const description = "Searchable courier picker (Chakra Combobox) backed by the shipping catalogue — matches on name or code, and each option renders as its ShippingBadge, the same colour the courier wears everywhere else. Emits a courier code, and can be cleared back to none.";

export function ShippingSelect({
  value,
  onChange,
  placeholder,
  disabled,
}: ShippingSelectProps) {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t("catalog.shippingSelect.placeholder");
  const { couriers: catalogue, loading, error } = useShippingCatalogue();
  // A deleted channel is never offered for NEW work — the shared catalogue carries them for the badges.
  const couriers = useMemo(() => catalogue.filter((c) => !c.isDeleted), [catalogue]);

  const { collection, filter, set } = useListCollection<ShipmentChannel>({
    initialItems: couriers,
    itemToString: (courier) => courier.name,
    itemToValue: (courier) => courier.code,
    // Match on name OR code — the combobox's default matcher only sees itemToString (the name), and
    // people type the code ("JNE") as often as the label.
    filter: (_itemText, filterText, courier) => {
      const q = filterText.trim().toLowerCase();
      if (!q) return true;
      return courier.name.toLowerCase().includes(q) || courier.code.toLowerCase().includes(q);
    },
  });

  // The catalogue is shared and may already be cached, or may land after this mounts. Either way the
  // collection has to follow it — in an effect, never during render.
  //
  // `seeded` flips in the SAME effect that fills the collection, and the remount below keys on it.
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    set(couriers);
    if (!loading) setSeeded(true);
  }, [set, couriers, loading]);

  return (
    <Combobox.Root
      // Remounted once, the moment the catalogue lands — load-bearing, and the same trap TeamSelect
      // documents (#131). Zag derives the input's DISPLAY TEXT when the machine initialises and
      // thereafter only when `value` changes; a collection that fills in LATER does not re-derive it.
      // An edit form that mounts this with a courier ALREADY set, while the catalogue is still in
      // flight, would look the code up in an empty collection, resolve to "", and never recover — the
      // field would read blank while a courier is in fact selected.
      //
      // ⚠ Keyed on `seeded`, NOT on `loading`. The collection is filled by the effect above, one render
      // AFTER loading flips — so a `loading` key remounted into a still-empty collection and hit exactly
      // the blank field described above (PresetCourierShowsItsName). Not on items.length either: a search
      // matching nothing empties the collection too, and remounting would wipe the typing.
      key={seeded ? "ready" : "seeding"}
      // OPEN ON CLICK (#146, owner: "show few item first before search"). Without it, clicking the
      // field shows nothing until you type — reasonable for a picker over a catalogue too large to
      // display (ProductSelect searches the server and needs 2 characters), and wrong for a bounded
      // list somebody could simply pick from. The couriers are already loaded; there is nothing to
      // wait for, so make them visible.
      openOnClick
      collection={collection}
      disabled={disabled}
      // "" is NOT a selection. An empty array is what tells the combobox nothing is picked; passing
      // [""] would make it hunt for a courier whose code is the empty string.
      value={value ? [value] : []}
      onValueChange={(e) => {
        // CLEARING EMITS "" (#131), it does not do nothing.
        //
        // No courier is a legitimate value — neither a restock nor an order requires one — so the
        // field must be un-settable. Swallowing the empty case here is what made the NativeSelect
        // version's predecessor WRITE-ONCE: a courier picked by mistake could never be removed, though
        // the contract allowed it. The same mistake is one `if (picked !== undefined)` away.
        onChange?.(e.value[0] ?? "");
      }}
      onInputValueChange={(e) => filter(e.inputValue)}
      data-testid="shipping-select"
    >
      <Combobox.Control>
        <Combobox.Input placeholder={error ? t("catalog.shippingSelect.unavailable") : resolvedPlaceholder} />
        <Combobox.IndicatorGroup>
          {/* The affordance that makes "no courier" reachable with the mouse. */}
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
                  {error ? t("catalog.shippingSelect.unavailable") : t("catalog.shippingSelect.empty")}
                </Combobox.Empty>
                {collection.items.map((courier) => (
                  <Combobox.Item
                    item={courier}
                    key={courier.code}
                    data-testid={`shipping-select-option-${courier.code}`}
                  >
                    {/* The BADGE, not the bare name — a courier is shown the same way here as in every
                        table and detail (the-courier-has-one-colour). It resolves the name from the same
                        catalogue this picker already loaded, so it costs no second read. */}
                    <ShippingBadge code={courier.code} />
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
