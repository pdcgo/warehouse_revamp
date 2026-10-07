// The suppliers and their stores — in supplier_service's shape (warehouse.supplier.v1): a supplier is a name, a
// contact, an address and a description; a store is a channel type off the shared marketplace list, a name, a
// link and a description. Both delete SOFT, so each row carries `deleted` — stub state the wire never shows for a
// store, and shows for a supplier only through SupplierByIds (a-deleted-supplier-is-kept-for-its-figures,
// a-store-delete-is-soft-too).
//
// Spread across THREE selling teams of fixtures.ts — 12 Toko Melati, 13 Toko Kenanga, 15 Toko Anggrek — because
// reads cross teams and writes do not, and Discover names the team that keeps each supplier.
//
// Ids follow fixtures.ts — suppliers 3x, their stores 3xx. APPEND, never reorder: stories index these.

import { Marketplace } from "../src/gen/warehouse/marketplace/v1/marketplace_pb";

export interface SupplierFixture {
  id: bigint;
  teamId: bigint;
  name: string;
  contact: string;
  address: string;
  description: string;
  deleted: boolean;
}

export interface ChannelFixture {
  id: bigint;
  supplierId: bigint;
  channelType: Marketplace;
  name: string;
  uri: string;
  description: string;
  deleted: boolean;
}

export const supplierFixtures: SupplierFixture[] = [
  { id: 31n, teamId: 12n, name: "PT Sumber Makmur", contact: "0812-1111-2222", address: "Jl. Soekarno-Hatta 112, Bandung", description: "Grosir kain dan benang, minimal order 1 rol.", deleted: false },
  { id: 32n, teamId: 12n, name: "CV Cahaya Abadi", contact: "0812-2222-3333", address: "Jl. Raya Darmo 45, Surabaya", description: "", deleted: false },
  // No stores at all — the empty state.
  { id: 33n, teamId: 12n, name: "Toko Grosir Sinar", contact: "", address: "", description: "", deleted: false },
  // ANOTHER selling team's supplier — never on team 12's own list, but on everyone's Discover.
  { id: 34n, teamId: 13n, name: "UD Makmur Jaya", contact: "0813-4444-5555", address: "Jl. Pasar Baru 3, Jakarta", description: "", deleted: false },
  // TWELVE stores — more than one page of ten, so the Channels and Products pagers have something to turn.
  { id: 35n, teamId: 12n, name: "PT Banyak Toko", contact: "0811-5555-6666", address: "Jl. Gatot Subroto 20, Jakarta", description: "", deleted: false },
  // A third team's — three stores on three marketplaces.
  { id: 36n, teamId: 15n, name: "PT Tekstil Nusantara", contact: "021-555-0101", address: "Kawasan Industri Pulogadung, Jakarta", description: "Kain tekstil grosir untuk konveksi.", deleted: false },
  { id: 37n, teamId: 15n, name: "Linen House", contact: "0812-9090-1010", address: "Jl. Kemang Raya 10, Jakarta", description: "", deleted: false },
  // DELETED — gone from every list, picker and detail; SupplierByIds still names it, marked.
  { id: 38n, teamId: 12n, name: "CV Lama Tutup", contact: "0812-0000-0000", address: "Jl. Lama 1, Bandung", description: "", deleted: true },
  // THE DISCOVER CROWD (90x) — other teams' suppliers that exist so Discover has more than a page of ten.
  { id: 901n, teamId: 13n, name: "Konveksi Sinar Terang", contact: "0815-1212-3434", address: "Jl. Cigondewah Kaler 7, Bandung", description: "", deleted: false },
  { id: 902n, teamId: 13n, name: "Grosir Benang Jaya", contact: "0817-8888-1212", address: "Pasar Tanah Abang Blok A, Jakarta", description: "", deleted: false },
  { id: 903n, teamId: 15n, name: "CV Kancing Mas", contact: "0818-2323-4545", address: "Jl. Pekojan 21, Semarang", description: "", deleted: false },
  { id: 904n, teamId: 15n, name: "Resleting Prima", contact: "0819-6767-8989", address: "Jl. Gajah Mada 88, Medan", description: "", deleted: false },
  { id: 905n, teamId: 15n, name: "Batik Pekalongan Asli", contact: "0285-422-911", address: "Jl. Hayam Wuruk 5, Pekalongan", description: "", deleted: false },
];

const store = (id: number, supplierId: number, channelType: Marketplace, name: string, uri = "", description = "", deleted = false): ChannelFixture => ({
  id: BigInt(id),
  supplierId: BigInt(supplierId),
  channelType,
  name,
  uri,
  description,
  deleted,
});

export const channelFixtures: ChannelFixture[] = [
  store(311, 31, Marketplace.SHOPEE, "Sumber Makmur Official", "https://shopee.co.id/sumbermakmur"),
  store(312, 31, Marketplace.TOKOPEDIA, "Sumber Makmur Store", "https://www.tokopedia.com/sumbermakmur"),
  // A plain website — the owner's `custom`, the shared list's Other (custom-is-labelled-other). Its description is
  // the only place "Cigondewah" appears, so a search for it proves the description is searched.
  store(313, 31, Marketplace.OTHER, "sumbermakmur.co.id", "https://sumbermakmur.co.id", "Katalog lengkap — gudang di Jl. Cigondewah Kaler 7, Bandung"),
  // A DELETED store — hidden from the Channels tab and from Discover's badges (a-store-delete-is-soft-too).
  store(314, 31, Marketplace.LAZADA, "Sumber Makmur Lazada Lama", "https://www.lazada.co.id/shop/sumbermakmur", "", true),
  store(321, 32, Marketplace.OTHER, "cahayaabadi.co.id", "https://cahayaabadi.co.id"),
  store(341, 34, Marketplace.SHOPEE, "Makmur Jaya Grosir", "https://shopee.co.id/makmurjaya"),
  store(342, 34, Marketplace.TIKTOK, "makmurjaya.id", "https://www.tiktok.com/@makmurjaya"),
  store(351, 35, Marketplace.SHOPEE, "Banyak Toko Shopee 1", "https://example.test/banyaktoko/1"),
  store(352, 35, Marketplace.SHOPEE, "Banyak Toko Shopee 2", "https://example.test/banyaktoko/2"),
  store(353, 35, Marketplace.SHOPEE, "Banyak Toko Shopee 3", "https://example.test/banyaktoko/3"),
  store(354, 35, Marketplace.TOKOPEDIA, "Banyak Toko Tokopedia 1", "https://example.test/banyaktoko/4"),
  store(355, 35, Marketplace.TOKOPEDIA, "Banyak Toko Tokopedia 2", "https://example.test/banyaktoko/5"),
  store(356, 35, Marketplace.LAZADA, "Banyak Toko Lazada", "https://example.test/banyaktoko/6"),
  store(357, 35, Marketplace.TIKTOK, "Banyak Toko TikTok 1", "https://example.test/banyaktoko/7"),
  store(358, 35, Marketplace.TIKTOK, "Banyak Toko TikTok 2", "https://example.test/banyaktoko/8"),
  store(359, 35, Marketplace.BLIBLI, "Banyak Toko Blibli", "https://example.test/banyaktoko/9"),
  store(360, 35, Marketplace.BUKALAPAK, "Banyak Toko Bukalapak", "https://example.test/banyaktoko/10"),
  store(361, 35, Marketplace.OTHER, "banyaktoko.id", "https://example.test/banyaktoko/11"),
  store(362, 35, Marketplace.OTHER, "banyaktoko.com", "https://example.test/banyaktoko/12"),
  // 36x would collide with PT Banyak Toko's twelfth, so the later suppliers' stores take 37x–39x.
  store(371, 36, Marketplace.LAZADA, "Tekstil Nusantara", "https://www.lazada.co.id/shop/tekstilnusantara"),
  store(372, 36, Marketplace.BLIBLI, "Nusantara Official", "https://www.blibli.com/merchant/nusantara"),
  store(373, 36, Marketplace.SHOPEE, "Tekstil Nusantara ID", "https://shopee.co.id/tekstilnusantara"),
  store(381, 37, Marketplace.SHOPEE, "Linen House", "https://shopee.co.id/linenhouse"),
  store(382, 37, Marketplace.TIKTOK, "linenhouse", "https://www.tiktok.com/@linenhouse"),
  // The deleted supplier's store — NOT marked itself: it hides with its supplier (a-store-delete-is-soft-too).
  store(391, 38, Marketplace.SHOPEE, "Lama Tutup Shopee", "https://shopee.co.id/lamatutup"),
  store(9011, 901, Marketplace.TOKOPEDIA, "Sinar Terang Konveksi"),
  store(9021, 902, Marketplace.SHOPEE, "Benang Jaya"),
  store(9031, 903, Marketplace.BUKALAPAK, "Kancing Mas"),
  store(9032, 903, Marketplace.TOKOPEDIA, "Kancing Mas Official"),
  store(9041, 904, Marketplace.TIKTOK, "resletingprima"),
  store(9051, 905, Marketplace.OTHER, "batikpekalonganasli.com", "https://batikpekalonganasli.com"),
  store(9052, 905, Marketplace.TOKOPEDIA, "Batik Pekalongan Asli"),
];

/** A fixture supplier by name — stories read better by name than by position. */
export function supplierFixture(name: string): SupplierFixture {
  const found = supplierFixtures.find((s) => s.name === name);
  if (!found) {
    throw new Error(`no supplier fixture named ${name}`);
  }
  return found;
}

/** A fixture store by id. */
export function channelFixture(id: bigint): ChannelFixture {
  const found = channelFixtures.find((c) => c.id === id);
  if (!found) {
    throw new Error(`no channel fixture ${id}`);
  }
  return found;
}
