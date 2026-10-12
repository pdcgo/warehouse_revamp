import {
  type Supplier,
  SupplierByIdsDataType,
  type SupplierByIdsResponse,
  SupplierListDataType,
  type SupplierListResponseItem,
} from "../../gen/warehouse/supplier/v1/supplier_pb";
import {
  type SupplierChannel,
  SupplierChannelListDataType,
  type SupplierChannelListResponseItem,
} from "../../gen/warehouse/supplier/v1/supplier_channel_pb";
import type { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";

// The supplier domain's proto → record mapper, the same job every feature folder's adapt.ts does: pages read
// and write `SupplierRecord` / `SupplierChannelRecord` and never touch the generated messages.
//
// It is a PLAIN mapper now — fields cross one to one. It used to be a translation step between the decided
// shape and the old warehouse.inventory.v1 server (a made-up code, city and province folded into the address,
// an offline shop read as Other, the channel list searched and paged in the browser). That server is gone:
// supplier_service landed and speaks the decided shape itself (the-crud-prototype-is-accepted,
// the-supplier-gets-its-own-service in docs/business/supplier/context_decision.md).

/** A supplier as the screens see it. */
export interface SupplierRecord {
  id: bigint;
  /** The team that keeps it — always a selling team (only-a-selling-team-has-suppliers). */
  teamId: bigint;
  name: string;
  contact: string;
  address: string;
  description: string;
  /** Soft-deleted. Only SupplierByIds ever returns one (a-deleted-supplier-is-kept-for-its-figures). */
  deleted: boolean;
}

/** One store a supplier sells through. */
export interface SupplierChannelRecord {
  id: bigint;
  supplierId: bigint;
  /** Off the shared marketplace list; `OTHER` is the owner's `custom` (custom-is-labelled-other). */
  channelType: Marketplace;
  name: string;
  uri: string;
  description: string;
}

// ── Reads ───────────────────────────────────────────────────────────────────────────────────────

export const supplierListRowData = (): SupplierListDataType[] => [SupplierListDataType.SUPPLIER];
/** The rows AND each supplier's live stores — Discover's badge per channel type. */
export const supplierListWithChannelsData = (): SupplierListDataType[] => [
  SupplierListDataType.SUPPLIER,
  SupplierListDataType.CHANNELS,
];
export const supplierChannelRowData = (): SupplierChannelListDataType[] => [
  SupplierChannelListDataType.SUPPLIER_CHANNEL,
];
export const supplierByIdsRowData = (): SupplierByIdsDataType[] => [SupplierByIdsDataType.SUPPLIER];

export function supplierRecord(s: Supplier): SupplierRecord {
  return {
    id: s.id,
    teamId: s.teamId,
    name: s.name,
    contact: s.contact,
    address: s.address,
    description: s.description,
    deleted: s.deleted,
  };
}

export function channelRecord(c: SupplierChannel): SupplierChannelRecord {
  return {
    id: c.id,
    supplierId: c.supplierId,
    channelType: c.channelType,
    name: c.name,
    uri: c.uri,
    description: c.description,
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

/**
 * The CHANNELS slice — supplier id → its live stores. Every supplier on the page has an entry, an empty set
 * included; a supplier absent from the map (the slice was not asked for) reads as no stores.
 */
export function supplierChannelsFromList(items: SupplierListResponseItem[]): Map<string, SupplierChannelRecord[]> {
  const out = new Map<string, SupplierChannelRecord[]>();
  for (const it of items) {
    if (it.d.case !== "channels") continue;

    for (const [id, set] of Object.entries(it.d.value.mapData)) {
      out.set(id, set.channels.map(channelRecord));
    }
  }
  return out;
}

// A by-ids response is keyed PER ID, not one map across a page, so this flattens it to id → supplier.
// An id the server had nothing for is simply missing from the map — that is the contract, and the
// caller decides what "unknown" looks like rather than getting a fabricated blank. A DELETED supplier is
// present, with `deleted: true` — a past restock still names its vendor.
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

export function supplierCreateRequest(teamId: bigint, fields: SupplierFields) {
  return { teamId, ...fields };
}

/** Every field is sent, so the form's values are what the row holds afterwards. */
export function supplierUpdateRequest(teamId: bigint, supplierId: bigint, fields: SupplierFields) {
  return { teamId, supplierId, ...fields };
}

export function channelCreateRequest(teamId: bigint, supplierId: bigint, fields: ChannelFields) {
  return { teamId, supplierId, ...fields };
}

export function channelUpdateRequest(teamId: bigint, channelId: bigint, fields: ChannelFields) {
  return { teamId, channelId, ...fields };
}
