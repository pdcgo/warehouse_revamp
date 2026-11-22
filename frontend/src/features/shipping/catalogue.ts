import { rpcError } from "../../api/clients";
import type { ShipmentChannel } from "../../gen/warehouse/shipment/v1/shipment_pb";
import { fetchChannelCatalogue, useShipmentChannelCatalogue } from "../shipment/queries";

// The courier catalogue as the screens read it (#126) — through ONE query, shared by every component that needs it.
//
// ⚠ THE CODE BRIDGE (the-old-catalogue-bridges-by-code, docs/business/shipment). Selling orders and
// restocks still store a courier CODE, so ShippingSelect and ShippingBadge match on code — but the
// catalogue itself is shipment_service's now. It loads DELETED channels too: a badge must still name the
// courier an old order used, and ShippingSelect filters them out for new work.
//
// Why one shared read and not one per component: a courier is rendered per table ROW (ShippingBadge), so
// a per-instance fetch would fire one ShipmentChannelList per row — ~20 for a single page of restock
// requests. It used to be a module-level session cache here (`cache` / `inflight` / `generation`); since
// #121 it is `useShipmentChannelCatalogue` (features/shipment/queries.ts), and the one-request property is
// the query cache's own: every row's hook reads the same entry, and N components mounting in the same tick
// share ONE request. The catalogue changes in one place — ShipmentChannelsPage, where root curates it — and
// every write hook there invalidates the `shipmentChannels` prefix this entry sits under, so a renamed
// courier is renamed in every badge already on screen, not only after a reload.

/**
 * The catalogue's one read, uncached on its own — the query's function. A caller holding no component (a story
 * waiting for the stub to have answered) awaits it; a screen reads `useShippingCatalogue` instead.
 */
export const loadShippingCatalogue: () => Promise<ShipmentChannel[]> = fetchChannelCatalogue;

export interface ShippingCatalogue {
  /** Every channel, DELETED ones included — a picker must filter on isDeleted itself. */
  couriers: ShipmentChannel[];
  loading: boolean;
  error: string;
}

// One empty list for every render while nothing has landed, so a memo keyed on `couriers` is not re-run by a fresh
// `[]` each time.
const NO_COURIERS: ShipmentChannel[] = [];

// useShippingCatalogue subscribes a component to the shared catalogue: it renders from the cache on
// the first paint if the catalogue is already loaded, and otherwise re-renders when the one shared
// request resolves.
export function useShippingCatalogue(): ShippingCatalogue {
  const query = useShipmentChannelCatalogue();

  return {
    couriers: query.data ?? NO_COURIERS,
    loading: query.isPending,
    error: query.isError ? rpcError(query.error) : "",
  };
}

// courierName maps a stored courier CODE to its human name. It falls back to the raw code when the
// courier is unknown or the catalogue has not loaded yet — a courier always renders as *something*,
// never as a blank.
export function courierName(couriers: ShipmentChannel[], code: string): string {
  const match = couriers.find((courier) => courier.code === code);
  return match?.name ?? code;
}

// courierCodeOf is an ORDER's courier code, from the `shipment_channel_id` it stores
// (shipment-channel-is-an-id-into-shipment-service) — for the screens that print the courier as its code. "" for no
// courier, and for any id while the catalogue is still loading; `#id` for an id the catalogue does not hold — never a
// borrowed code.
export function courierCodeOf(couriers: ShipmentChannel[], channelId: bigint, loading = false): string {
  if (channelId === 0n || loading) return "";
  return couriers.find((courier) => courier.id === channelId)?.code ?? `#${channelId}`;
}
