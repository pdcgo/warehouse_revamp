import { useQuery } from "@tanstack/react-query";
import { key, listQuery } from "../../api/queryClient";
import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";
import type { SupplierChannelRecord, SupplierRecord } from "./adapt";

// DISCOVER SUPPLIERS — every selling team's suppliers, searched across teams (manage-and-discover-are-two-pages,
// another-team-sees-everything-of-a-supplier). The manage page lists the suppliers a team keeps; this is the
// other question — "who sells this, anywhere in the company?".
//
// ⚠ SAMPLE DATA. No server can answer a cross-team supplier search yet: today's SupplierList answers the
// caller's own team only, and the cross-team read is supplier_service's to build. So these hooks serve
// invented suppliers through the ordinary query path — same keys, same loading and refetch — and each page
// that shows them carries a `sample` mark. When the read exists, the two queryFns change and the pages do not.

/** A supplier as discover shows it: the record, the team that keeps it, and its stores. */
export interface DiscoverSupplier extends SupplierRecord {
  teamName: string;
  channels: SupplierChannelRecord[];
}

export interface DiscoverQuery {
  /** Matched against the supplier's name, address and contact, its team, and its stores' names. */
  q: string;
  /** `UNSPECIFIED` = any; otherwise suppliers with at least one store of this type. */
  channelType: Marketplace;
  page: number;
  pageSize: number;
}

// ── The sample ─────────────────────────────────────────────────────────────────────────────────

type SampleStore = [type: Marketplace, name: string];

const SAMPLE_ROWS: [id: number, team: [id: number, name: string], name: string, contact: string, address: string, stores: SampleStore[]][] = [
  [901, [12, "Toko Melati"], "PT Sumber Makmur", "0812-1111-2222", "Jl. Soekarno-Hatta 112, Bandung", [[Marketplace.SHOPEE, "Sumber Makmur Official"], [Marketplace.TOKOPEDIA, "Sumber Makmur Store"]]],
  [902, [12, "Toko Melati"], "CV Cahaya Abadi", "0812-2222-3333", "Jl. Raya Darmo 45, Surabaya", [[Marketplace.OTHER, "cahayaabadi.co.id"]]],
  [903, [13, "Toko Kenanga"], "UD Makmur Jaya", "0813-4444-5555", "Jl. Pasar Baru 3, Jakarta", [[Marketplace.SHOPEE, "Makmur Jaya Grosir"], [Marketplace.TIKTOK, "makmurjaya.id"]]],
  [904, [13, "Toko Kenanga"], "Konveksi Sinar Terang", "0815-1212-3434", "Jl. Cigondewah Kaler 7, Bandung", [[Marketplace.TOKOPEDIA, "Sinar Terang Konveksi"]]],
  [905, [14, "Toko Anggrek"], "PT Tekstil Nusantara", "021-555-0101", "Kawasan Industri Pulogadung, Jakarta", [[Marketplace.LAZADA, "Tekstil Nusantara"], [Marketplace.BLIBLI, "Nusantara Official"], [Marketplace.SHOPEE, "Tekstil Nusantara ID"]]],
  [906, [14, "Toko Anggrek"], "Grosir Benang Jaya", "0817-8888-1212", "Pasar Tanah Abang Blok A, Jakarta", [[Marketplace.SHOPEE, "Benang Jaya"]]],
  [907, [14, "Toko Anggrek"], "CV Kancing Mas", "0818-2323-4545", "Jl. Pekojan 21, Semarang", [[Marketplace.BUKALAPAK, "Kancing Mas"], [Marketplace.TOKOPEDIA, "Kancing Mas Official"]]],
  [908, [15, "Toko Mawar"], "Resleting Prima", "0819-6767-8989", "Jl. Gajah Mada 88, Medan", [[Marketplace.TIKTOK, "resletingprima"]]],
  [909, [15, "Toko Mawar"], "PT Kain Indah", "022-6011-777", "Jl. Moh. Toha 200, Bandung", [[Marketplace.SHOPEE, "Kain Indah Official"], [Marketplace.LAZADA, "Kain Indah"]]],
  [910, [15, "Toko Mawar"], "Batik Pekalongan Asli", "0285-422-911", "Jl. Hayam Wuruk 5, Pekalongan", [[Marketplace.OTHER, "batikpekalonganasli.com"], [Marketplace.TOKOPEDIA, "Batik Pekalongan Asli"]]],
  [911, [12, "Toko Melati"], "Toko Grosir Sinar", "", "", []],
  [912, [13, "Toko Kenanga"], "Linen House", "0812-9090-1010", "Jl. Kemang Raya 10, Jakarta", [[Marketplace.SHOPEE, "Linen House"], [Marketplace.TIKTOK, "linenhouse"]]],
];

const SAMPLE: DiscoverSupplier[] = SAMPLE_ROWS.map(([id, [teamId, teamName], name, contact, address, stores]) => ({
  id: BigInt(id),
  teamId: BigInt(teamId),
  teamName,
  name,
  contact,
  address,
  description: "",
  channels: stores.map(([channelType, storeName], i) => ({
    id: BigInt(id * 10 + i),
    supplierId: BigInt(id),
    channelType,
    name: storeName,
    uri: "",
    description: "",
  })),
}));

/** Search, filter and page the sample — what the cross-team read will do on the server. */
export function discoverPage(all: DiscoverSupplier[], query: DiscoverQuery) {
  const q = query.q.trim().toLowerCase();
  const matching = all
    .filter(
      (s) => query.channelType === Marketplace.UNSPECIFIED || s.channels.some((c) => c.channelType === query.channelType),
    )
    .filter(
      (s) =>
        !q ||
        [s.name, s.address, s.contact, s.teamName, ...s.channels.map((c) => c.name)].some((field) =>
          field.toLowerCase().includes(q),
        ),
    );
  const start = (query.page - 1) * query.pageSize;

  return { suppliers: matching.slice(start, start + query.pageSize), totalItems: matching.length };
}

// ── The reads ──────────────────────────────────────────────────────────────────────────────────

export function useDiscoverSuppliers(args: { teamId: bigint | undefined } & DiscoverQuery) {
  const { teamId, q, channelType, page, pageSize } = args;

  return useQuery({
    // A search, a filter and a page refine the same question (HARD RULE 10).
    ...listQuery,
    // ⚠ The CALLER's team stays in the key even though the answer spans every team — it is the scope the
    // request is authorised in, and two callers must never share a cached answer.
    queryKey: key.suppliers(teamId, { discover: true, q, channelType, page, pageSize }),
    enabled: teamId !== undefined,
    queryFn: async () => discoverPage(SAMPLE, { q, channelType, page, pageSize }),
  });
}

export function useDiscoverSupplier(args: { teamId: bigint | undefined; supplierId: bigint }) {
  const { teamId, supplierId } = args;

  return useQuery({
    queryKey: key.suppliers(teamId, { discover: supplierId.toString() }),
    enabled: teamId !== undefined && supplierId > 0n,
    queryFn: async () => SAMPLE.find((s) => s.id === supplierId) ?? null,
  });
}
