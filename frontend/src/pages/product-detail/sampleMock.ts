// ⚠ INVENTED ROWS FOR THREE PARTS NOTHING READS YET — Pemasok, Produk Turunan and Keluar Masuk Harian (owner:
// *"pemasok dan turunan yang masih kosong tolong diisi"*, then *"keluar masuk harian kasih juga data dummynya"*). They
// are here so the SHAPE of each part can be judged, and each carries its ⚠ (`sample` in pending.ts) for exactly this
// reason. Deterministic per product, so a story and a screenshot agree.
//
// Replace with the real read the day it exists: the suppliers grouped from the product's batches, the products a
// return to another team derived from this one (and the one this was derived from), and the movements summed per day.

const DAY = 86_400;

/** Unix seconds `days` ago, at a fixed hour so a sample never reads as "just now". */
function daysBack(days: number): bigint {
  const now = Math.floor(Date.now() / 1000);
  return BigInt(now - days * DAY - (now % DAY) + 9 * 3600);
}

export interface SampleSupplier {
  name: string;
  /** How many deliveries came from it. */
  deliveries: number;
  /** Units delivered in all. */
  units: number;
  /** The unit cost of its last delivery, in rupiah. */
  lastUnitCost: bigint;
  lastDeliveryUnix: bigint;
}

const SUPPLIERS = ["PT Sumber Makmur", "CV Tani Jaya", "UD Berkah Abadi", "PT Nusantara Pangan"];

/** Two or three suppliers, the latest delivery first. */
export function sampleSuppliers(productId: bigint): SampleSupplier[] {
  const n = Number(productId % 97n);
  const count = 2 + (n % 2);

  return Array.from({ length: count }, (_, i) => ({
    name: SUPPLIERS[(n + i) % SUPPLIERS.length]!,
    deliveries: 4 - i + (n % 3),
    units: (60 - i * 18) * (1 + (n % 2)),
    lastUnitCost: BigInt(45_000 + i * 1_500 + (n % 5) * 100),
    lastDeliveryUnix: daysBack(5 + i * 21 + (n % 7)),
  }));
}

export interface SampleDerived {
  /** The derived product's name — the owner's product as the receiving team now carries it. */
  name: string;
  sku: string;
  /** The team the return went to, which now owns the derived product. */
  teamName: string;
  /** Its stock ready on a shelf, in that team — not how many came back. */
  readyQty: number;
  /** Its picture — the sample lends it the product's own, as a derived product starts as the same goods. */
  imageUrl: string;
}

/**
 * The two directions of the link a return to another team makes (owner: *"barang yang retur ke team beda team, tapi
 * masalah lain bisa jadi yang sekarang itu juga turunan"*): what this product was derived FROM — at most one — and the
 * products other teams derived FROM IT.
 */
export function sampleDerived(
  productId: bigint,
  name: string,
  sku: string,
  imageUrl: string,
): { from?: SampleDerived; to: SampleDerived[] } {
  const n = Number(productId % 97n);

  return {
    // Every third product is itself derived — the case the owner raised.
    from:
      n % 3 === 0
        ? { name, sku: `${sku}-ASAL`, teamName: "Toko Kenanga", readyQty: 18, imageUrl }
        : undefined,
    // MANY, on purpose — a product sold through several teams comes back to several (owner: *"dia bisa banyak"*), so the
    // section is judged at the length that made it confusing.
    to: Array.from({ length: 5 + (n % 4) }, (_, i) => ({
      name: `${name} (Retur)`,
      sku: `${sku}-R${i + 1}`,
      teamName: TEAMS[(n + i) % TEAMS.length]!,
      readyQty: (n + i * 3) % 7,
      imageUrl,
    })),
  };
}

const TEAMS = ["Toko Melati", "Toko Kenanga", "Toko Anggrek", "Toko Dahlia"];

export interface SampleDay {
  dayUnix: bigint;
  /** Units that came in that day — receipts, returns, found. */
  inQty: number;
  /** Units that went out — picks, damage, lost. */
  outQty: number;
  /** On hand at the end of the day. */
  balance: number;
}

/** The last fourteen days, newest first, the balance walking back from today's. */
export function sampleDaily(productId: bigint, today: number): SampleDay[] {
  const n = Number(productId % 97n);
  const days: SampleDay[] = [];
  let balance = today;

  for (let i = 0; i < 14; i++) {
    const inQty = (i + n) % 4 === 0 ? 12 + ((n + i) % 3) * 6 : 0;
    const outQty = (i * 7 + n) % 5;
    days.push({ dayUnix: daysBack(i), inQty, outQty, balance });
    balance = Math.max(0, balance - inQty + outQty);
  }

  return days;
}
