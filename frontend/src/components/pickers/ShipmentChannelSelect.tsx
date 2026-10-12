import { useEffect, useState } from "react";
import { Combobox, Portal, Spinner, useListCollection } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import type { ShipmentChannel } from "../../gen/warehouse/shipment/v1/shipment_pb";
import { useShipmentChannelOptions } from "../../features/shipment/queries";
import { ShipmentChannelBadge } from "../badges/ShipmentChannelBadge";

export interface ShipmentChannelSelectProps {
  /** Selected channel ID — what orders.shipment_channel_id stores. 0n / undefined = none. */
  value?: bigint;
  onChange?: (channelId: bigint) => void;
  placeholder?: string;
  disabled?: boolean;
}

// ShipmentChannelSelect picks a courier for an order or a draft.
//
// Emits the channel ID, never a code or a name — the order stores the id
// (shipment-channel-is-an-id-into-shipment-service). Offers LIVE channels only: a deleted courier cannot
// be chosen for new work, though an old order still names it through ShipmentChannelBadge.
//
// For records that store the channel ID. Records still storing a courier CODE use ShippingSelect, which
// reads the same catalogue (the-old-catalogue-bridges-by-code). The interaction rules are shared: opens on click, matches name OR code, clearing
// emits "none", and the root remounts when the options land so a pre-set value shows its name.
export const description =
  "Searchable courier picker over live shipment channels — matches name or code, renders each option as its ShipmentChannelBadge (the courier's standard colour), emits the channel id, and can be cleared back to none.";

export function ShipmentChannelSelect({ value, onChange, placeholder, disabled }: ShipmentChannelSelectProps) {
  const { t } = useTranslation();
  const query = useShipmentChannelOptions();
  const channels = query.data ?? [];
  const loading = query.isPending;
  const error = query.isError;

  const { collection, filter, set } = useListCollection<ShipmentChannel>({
    initialItems: channels,
    itemToString: (channel) => channel.name,
    itemToValue: (channel) => channel.id.toString(),
    filter: (_itemText, filterText, channel) => {
      const q = filterText.trim().toLowerCase();
      if (!q) return true;
      return channel.name.toLowerCase().includes(q) || channel.code.toLowerCase().includes(q);
    },
  });

  // Flips once, in the same effect that fills the collection — so the remount below happens only after
  // the items are really in it.
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    set(channels);
    if (query.data) setSeeded(true);
    // `channels` is a fresh [] while pending; key on the data identity instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set, query.data]);

  return (
    <Combobox.Root
      // Remounted once the collection is SEEDED — not when the query finishes, and not on its length.
      //  - on `loading`: the collection fills one render after the data lands, so the remount sees an
      //    empty one and a pre-set id resolves to "" forever (APresetIdShowsItsName).
      //  - on `items.length`: a search matching nothing empties it too, and the remount wipes the typing.
      key={seeded ? "ready" : "seeding"}
      openOnClick
      collection={collection}
      disabled={disabled}
      value={value && value > 0n ? [value.toString()] : []}
      onValueChange={(e) => {
        const picked = e.value[0];
        onChange?.(picked ? BigInt(picked) : 0n);
      }}
      onInputValueChange={(e) => filter(e.inputValue)}
      data-testid="shipment-channel-select"
    >
      <Combobox.Control>
        <Combobox.Input
          placeholder={error ? t("shipmentChannels.select.unavailable") : (placeholder ?? t("shipmentChannels.select.placeholder"))}
        />
        <Combobox.IndicatorGroup>
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
                  {error ? t("shipmentChannels.select.unavailable") : t("shipmentChannels.select.empty")}
                </Combobox.Empty>
                {collection.items.map((channel) => (
                  <Combobox.Item
                    item={channel}
                    key={channel.id.toString()}
                    data-testid={`shipment-channel-option-${channel.code}`}
                  >
                    {/* The BADGE, not the bare name — the courier looks the same here as on the order
                        it ends up on. The row is passed along, so the badge needs no second lookup and
                        keeps its treatment for a channel that has since been deleted. */}
                    <ShipmentChannelBadge channelId={channel.id} channel={channel} />
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
