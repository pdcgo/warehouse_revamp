import {
  type Supplier,
  SupplierByIdsDataType,
  type SupplierByIdsResponse,
  SupplierListDataType,
  type SupplierListResponseItem,
} from "../../gen/warehouse/inventory/v1/supplier_pb";
import {
  type SupplierChannel,
  SupplierChannelListDataType,
  type SupplierChannelListResponseItem,
  SupplierChannelType,
} from "../../gen/warehouse/inventory/v1/supplier_channel_pb";
import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";

// ⚠ THE TRANSLATION STEP — temporary, and deleted when supplier_service lands.
//
// The screens speak the DECIDED shape (docs/business/supplier/context_decision.md): a supplier is a name, a
// contact, an address and a description (the-supplier-has-no-code, no-province-city-or-soft-delete), and a
// channel is one store — a channel type off the shared marketplace list, a name, a link and a description
// (the-supplier-lists-only-its-online-stores, channel-type-is-the-marketplace-list).
//
// The server still speaks warehouse.inventory.v1, which REQUIRES a code and an online/offline type. Rather than
// let that leak into every screen, the whole difference lives here, at the query boundary: pages read and write
// `SupplierRecord` / `SupplierChannelRecord` and never see the proto. When supplier_service lands, these
// functions change and the pages do not.
//
// What the old server cannot hold is marked on screen, not hidden — see pages/supplier-detail/pending.ts.

/** A supplier as the screens see it — the decided fields, nothing else. */
export interface SupplierRecord {
  id: bigint;
  teamId: bigint;
  name: string;
  contact: string;
  address: string;
  description: string;
}

/** One store a supplier sells through. */
export interface SupplierChannelRecord {
  id: bigint;
  supplierId: bigint;
  /** Off the shared marketplace list; `OTHER` is the owner's `custom`. */
  channelType: Marketplace;
  name: string;
  uri: string;
  description: string;
}

// ── Reads ───────────────────────────────────────────────────────────────────────────────────────

export const supplierListRowData = (): SupplierListDataType[] => [SupplierListDataType.SUPPLIER];
export const supplierChannelRowData = (): SupplierChannelListDataType[] => [
  SupplierChannelListDataType.SUPPLIER_CHANNEL,
];
export const supplierByIdsRowData = (): SupplierByIdsDataType[] => [SupplierByIdsDataType.SUPPLIER];

/**
 * The code is not carried. City and province are FOLDED into the address — the same fold the move to
 * supplier_service makes (no-province-city-or-soft-delete), so what is on screen now is what the moved row
 * will hold.
 */
export function supplierRecord(s: Supplier): SupplierRecord {
  return {
    id: s.id,
    teamId: s.teamId,
    name: s.name,
    contact: s.contact,
    address: [s.address, s.city, s.province].filter(Boolean).join(", "),
    description: s.description,
  };
}

/**
 * An old OFFLINE row has no marketplace, so it reads as `OTHER`, with its contact and location as its
 * description — the move's fold again (the-supplier-lists-only-its-online-stores). An online row's link is
 * its `url`.
 */
export function channelRecord(c: SupplierChannel): SupplierChannelRecord {
  return {
    id: c.id,
    supplierId: c.supplierId,
    channelType: c.marketplace === Marketplace.UNSPECIFIED ? Marketplace.OTHER : c.marketplace,
    name: c.name,
    uri: c.url,
    description: [c.contact, c.location].filter(Boolean).join(" · "),
  };
}

export function suppliersFromList(items: SupplierListResponseItem[], ids: bigint[]): SupplierRecord[] {
  let m: { [key: string]: Supplier } = {};
  for (const it of items) {
    if (it.d.case === "supplier") m = it.d.value.mapData;
  }
  return ids
    .map((id) => m[id.toString()])
    .filter((s): s is Supplier => !!s)
    .map(supplierRecord);
}

// A by-ids response is keyed PER ID, not one map across a page, so this flattens it to id → supplier.
// An id the server had nothing for is simply missing from the map — that is the contract, and the
// caller decides what "unknown" looks like rather than getting a fabricated blank.
export function suppliersFromByIds(res: SupplierByIdsResponse): Map<string, SupplierRecord> {
  const out = new Map<string, SupplierRecord>();

  for (const [id, list] of Object.entries(res.items)) {
    for (const item of list.items) {
      if (item.d.case !== "supplier") continue;

      const supplier = item.d.value.mapData[id];
      if (supplier) out.set(id, supplierRecord(supplier));
    }
  }

  return out;
}

export function channelsFromList(
  items: SupplierChannelListResponseItem[],
  ids: bigint[],
): SupplierChannelRecord[] {
  let m: { [key: string]: SupplierChannel } = {};
  for (const it of items) {
    if (it.d.case === "supplierChannel") m = it.d.value.mapData;
  }
  return ids
    .map((id) => m[id.toString()])
    .filter((c): c is SupplierChannel => !!c)
    .map(channelRecord);
}

// ── Writes ──────────────────────────────────────────────────────────────────────────────────────

export type SupplierFields = Pick<SupplierRecord, "name" | "contact" | "address" | "description">;
export type ChannelFields = Pick<SupplierChannelRecord, "channelType" | "name" | "uri" | "description">;

/**
 * The old server refuses a supplier without a code, and the screens no longer ask for one
 * (the-supplier-has-no-code). So one is made up — unique enough within a team, under its 32-character cap,
 * and never shown. The move to supplier_service drops the column.
 */
export function generatedSupplierCode(): string {
  const time = Date.now().toString(36);
  const salt = Math.random().toString(36).slice(2, 6);

  return `S${time}${salt}`.toUpperCase();
}

export function supplierCreateRequest(teamId: bigint, fields: SupplierFields) {
  return { teamId, code: generatedSupplierCode(), ...fields };
}

/**
 * The address on the form is the FOLDED one, so city and province are cleared as it is saved — otherwise the
 * next read would fold them in a second time. The code is left alone.
 */
export function supplierUpdateRequest(teamId: bigint, supplierId: bigint, fields: SupplierFields) {
  return { teamId, supplierId, ...fields, province: "", city: "" };
}

/**
 * Every channel is a store, so it is sent as ONLINE with its channel type as the marketplace. ⚠ The
 * description has nowhere to go on the old server — it is DROPPED, and the screen says so.
 */
export function channelCreateRequest(teamId: bigint, supplierId: bigint, fields: ChannelFields) {
  return {
    teamId,
    supplierId,
    type: SupplierChannelType.ONLINE,
    marketplace: fields.channelType,
    name: fields.name,
    url: fields.uri,
  };
}

/**
 * `contact` and `location` are left ABSENT, so an old offline row keeps what it held — its description on
 * screen is made of them, and sending them blank would erase it.
 */
export function channelUpdateRequest(teamId: bigint, channelId: bigint, fields: ChannelFields) {
  return {
    teamId,
    channelId,
    type: SupplierChannelType.ONLINE,
    marketplace: fields.channelType,
    name: fields.name,
    url: fields.uri,
  };
}
