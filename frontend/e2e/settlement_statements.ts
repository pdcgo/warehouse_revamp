import { writeXlsx } from "./xlsx";

// PLATFORM STATEMENTS, BUILT IN THE SPEC — a Shopee "Transaction Report" and a TikTok settlement export, laid out as the
// importer's readers read them (backend/pkgs/san_excel_readers: shopee.go, tiktok.go; the same shapes the importer's own
// Go tests build in settlement_importer_v1/setup_test.go). Built per test because a row must name an order the test just
// placed, and a fixture file cannot know a run's order refs. Not a spec file — Playwright never runs it.
//
// ⚠ A ROW'S KEY IS ITS CONTENT (the-row-key-is-the-only-dedupe): Shopee hashes the whole row, TikTok its own columns —
// across every team. Every description and ref a caller passes must carry the run's SUFFIX, or a second spec's identical
// row reads "already there".

/** Today on the Jakarta clock, YYYY-MM-DD — the day every statement row is dated, so the report's day buckets it. */
export const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
/** Yesterday on the Jakarta clock — a period no row of this run falls in. */
export const yesterday = () => new Date(Date.now() - 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

const pad = (n: number) => String(n).padStart(2, "0");

export type ShopeeRow = {
  /** "Tipe Transaksi" — "Penghasilan dari Pesanan", "Penarikan Dana", … */
  kind: string;
  description: string;
  /** "No. Pesanan" — absent = "-", the movement names no order. */
  ref?: string;
  /** "Jumlah", signed: money toward the seller is positive. */
  amount: number;
  /** "Status" — "Transaksi Selesai" unless said. */
  status?: string;
  /** "Jenis Transaksi" — from the sign unless said. */
  direction?: string;
};

export const SHOPEE_INCOME = "Penghasilan dari Pesanan";
export const SHOPEE_WITHDRAWAL = "Penarikan Dana";

/** A Shopee Transaction Report: the preamble (Dari / Ke = today), the header on row 18, the rows dated today. */
export function shopeeStatement(rows: ShopeeRow[]): Buffer {
  const day = today();
  const grid: string[][] = Array.from({ length: 17 }, () => []);
  grid[5] = ["Username (Penjual)", "e2e.import"];
  grid[7] = ["Dari", day];
  grid[8] = ["Ke", day];
  grid.push(["Tanggal Transaksi", "Tipe Transaksi", "Deskripsi", "No. Pesanan", "Jenis Transaksi", "Jumlah", "Status", "Saldo Akhir"]);

  let balance = 1_000_000;
  rows.forEach((r, i) => {
    balance += r.amount;
    grid.push([
      `${day} 00:${pad(Math.floor(i / 60) % 60)}:${pad(i % 60)}`,
      r.kind,
      r.description,
      r.ref ?? "-",
      r.direction ?? (r.amount < 0 ? "Transaksi Keluar" : "Transaksi Masuk"),
      String(r.amount),
      r.status ?? "Transaksi Selesai",
      String(balance),
    ]);
  });

  return writeXlsx([{ name: "Sheet1", rows: grid }]);
}

export type TiktokRow = {
  /** "Order/adjustment ID" — an Order row's is its order's id; an adjustment's is its own (19 digits). */
  id: string;
  /** "Type" — "Order", "Logistics reimbursement", … */
  kind: string;
  /** "Related order ID" — the ref that finds the order; absent = "/". */
  related?: string;
  /** "Total settlement amount" — what TikTok paid for the row, the commission already taken. */
  amount: number;
  /** The two Affiliate columns, as written (negative = a charge). */
  affiliate?: number;
  shopAds?: number;
};

/** A TikTok settlement export: Order details (with its Affiliate columns), Reports (today, UTC+7, IDR), Withdrawal
 *  records (its header only). Every row settled today. */
export function tiktokStatement(rows: TiktokRow[]): Buffer {
  const day = today().replace(/-/g, "/");
  const orders: string[][] = [
    [
      "Order/adjustment ID",
      "Type",
      "Order created time",
      "Order settled time",
      "Currency",
      "Total settlement amount",
      "Total Revenue",
      "Total Fees",
      "Related order ID",
      "Order Source",
      "Affiliate Commission",
      "Affiliate Shop Ads commission",
    ],
    ...rows.map((r) => [
      r.id,
      r.kind,
      day,
      day,
      "IDR",
      String(r.amount),
      String(r.amount),
      "0",
      r.related ?? "/",
      "TikTok Shop",
      r.affiliate === undefined ? "" : String(r.affiliate),
      r.shopAds === undefined ? "" : String(r.shopAds),
    ]),
  ];

  return writeXlsx([
    { name: "Order details", rows: orders },
    {
      name: "Reports",
      rows: [
        ["Time period:", `${day}-${day}`],
        ["Timezone", "UTC+7"],
        ["Currency", "IDR"],
      ],
    },
    { name: "Withdrawal records", rows: [["Type", "Reference ID", "Request time", "Amount", "Status", "Success time"]] },
  ]);
}
