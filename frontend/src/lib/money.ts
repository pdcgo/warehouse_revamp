// Money is stored as whole rupiah (int64 → bigint here). formatRupiah renders it with id-ID
// grouping, e.g. 25000n → "Rp 25.000".
export function formatRupiah(amount: bigint): string {
  return `Rp ${amount.toLocaleString("id-ID")}`;
}
