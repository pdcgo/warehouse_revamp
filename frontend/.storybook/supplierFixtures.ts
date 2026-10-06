// The suppliers and their channels — the CRUD prototype of docs/business/supplier.
//
// ⚠ IN TODAY'S WIRE SHAPE (warehouse.inventory.v1), on purpose: the stub plays the server as it is, so a
// story runs the translation step in features/suppliers/adapt.ts for real — the made-up code, the city and
// province folded into the address, the old offline shop read as Other. When supplier_service lands, these
// become the decided shape and the translation step goes.
//
// Ids follow fixtures.ts — suppliers 3x, their channels 3xx. APPEND, never reorder: stories index these.

import { SupplierChannelType } from "../src/gen/warehouse/inventory/v1/supplier_channel_pb";
import { Marketplace } from "../src/gen/warehouse/marketplace/v1/marketplace_pb";

export interface SupplierFixture {
  id: bigint;
  teamId: bigint;
  code: string;
  name: string;
  contact: string;
  province: string;
  city: string;
  address: string;
  description: string;
  deleted: boolean;
}

export interface ChannelFixture {
  id: bigint;
  supplierId: bigint;
  type: SupplierChannelType;
  marketplace: Marketplace;
  name: string;
  url: string;
  contact: string;
  location: string;
}

export const supplierFixtures: SupplierFixture[] = [
  // An old row with a city and a province — the page shows them folded into the address.
  {
    id: 31n,
    teamId: 12n,
    code: "SUP-A",
    name: "PT Sumber Makmur",
    contact: "0812-1111-2222",
    province: "Jawa Barat",
    city: "Bandung",
    address: "Jl. Soekarno-Hatta 112",
    description: "Grosir kain dan benang, minimal order 1 rol.",
    deleted: false,
  },
  { id: 32n, teamId: 12n, code: "SUP-B", name: "CV Cahaya Abadi", contact: "0812-2222-3333", province: "", city: "", address: "Jl. Raya Darmo 45, Surabaya", description: "", deleted: false },
  // No channels at all — the empty state.
  { id: 33n, teamId: 12n, code: "SUP-C", name: "Toko Grosir Sinar", contact: "", province: "", city: "", address: "", description: "", deleted: false },
  // ANOTHER selling team's supplier — never on team 12's list.
  { id: 34n, teamId: 13n, code: "SUP-D", name: "UD Makmur Jaya", contact: "0813-4444-5555", province: "", city: "", address: "Jl. Pasar Baru 3, Jakarta", description: "", deleted: false },
];

export const channelFixtures: ChannelFixture[] = [
  { id: 311n, supplierId: 31n, type: SupplierChannelType.ONLINE, marketplace: Marketplace.SHOPEE, name: "Sumber Makmur Official", url: "https://shopee.co.id/sumbermakmur", contact: "", location: "" },
  { id: 312n, supplierId: 31n, type: SupplierChannelType.ONLINE, marketplace: Marketplace.TOKOPEDIA, name: "Sumber Makmur Store", url: "https://www.tokopedia.com/sumbermakmur", contact: "", location: "" },
  // An OLD offline shop — no marketplace. The page reads it as Other, its contact and location as its
  // description (the-supplier-lists-only-its-online-stores).
  { id: 313n, supplierId: 31n, type: SupplierChannelType.OFFLINE, marketplace: Marketplace.UNSPECIFIED, name: "Gudang Cigondewah", url: "", contact: "0812-1111-9999", location: "Jl. Cigondewah Kaler 7, Bandung" },
  // A plain website — the owner's `custom`, the shared list's Other.
  { id: 321n, supplierId: 32n, type: SupplierChannelType.ONLINE, marketplace: Marketplace.OTHER, name: "cahayaabadi.co.id", url: "https://cahayaabadi.co.id", contact: "", location: "" },
];

/** A fixture supplier by name — stories read better by name than by position. */
export function supplierFixture(name: string): SupplierFixture {
  const found = supplierFixtures.find((s) => s.name === name);
  if (!found) {
    throw new Error(`no supplier fixture named ${name}`);
  }
  return found;
}
