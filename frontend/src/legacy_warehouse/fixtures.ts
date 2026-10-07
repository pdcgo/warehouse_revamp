import type { MovementStatus } from "./status";

// ⚠ EVERY VALUE HERE IS INVENTED, AND NONE OF IT IS A DESIGN COMMITMENT.
//
// These exist so the ported screens can be reviewed without a backend. Names, SKUs, racks and
// couriers are made up; they are not a schema proposal and they are not this system's vocabulary.
//
// What IS deliberate is the SHAPE of the awkward cases. A fixture of tidy rows makes every screen
// look finished, so each list below carries the case that actually bites on the floor:
//
//   · stock sitting unshelved (rack = null)
//   · a return whose reason is the customer's, not the warehouse's
//   · an order that has been picked but not packed — the one the scanner must refuse
//   · a problem item nobody has decided about for six weeks
//   · a team with more damaged units than sold ones

function daysAgo(n: number): number {
  return Math.floor(Date.now() / 1000) - n * 86_400;
}

function hoursAgo(n: number): number {
  return Math.floor(Date.now() / 1000) - n * 3_600;
}

// ── PEOPLE ──────────────────────────────────────────────────────────────────────────────────────

export interface FloorMember {
  id: number;
  name: string;
  email: string;
  roles: string[];
  // Whether they are on shift right now. The floor app calls this "rolling" — see the team-members
  // screen for why it is a per-shift thing and not a per-account one.
  onShift: boolean;
  shiftStartedAt?: number;
}

export const MEMBERS: FloorMember[] = [
  { id: 1, name: "Ani Rahmawati", email: "ani@example.test", roles: ["admin"], onShift: true, shiftStartedAt: hoursAgo(3) },
  { id: 2, name: "Budi Santoso", email: "budi@example.test", roles: ["packer"], onShift: true, shiftStartedAt: hoursAgo(3) },
  { id: 3, name: "Citra Dewi", email: "citra@example.test", roles: ["picker"], onShift: true, shiftStartedAt: hoursAgo(1) },
  { id: 4, name: "Dedi Kurniawan", email: "dedi@example.test", roles: ["picker", "packer"], onShift: false },
  // Never been on shift. A member who exists but has never worked is a real state — somebody was
  // added and then nobody showed them the app.
  { id: 5, name: "Eka Putri", email: "eka@example.test", roles: ["picker"], onShift: false },
];

// ── MOVEMENT ────────────────────────────────────────────────────────────────────────────────────

export interface MovementRow {
  id: number;
  ref: string;
  team: string;
  handler: string;
  sku: string;
  product: string;
  units: number;
  awb: string;
  courier: string;
  status: MovementStatus;
  createdAt: number;
  arrivedAt?: number;
}

export const INBOUND_ROWS: MovementRow[] = [
  {
    id: 8801, ref: "IN-8801", team: "Toko Melati", handler: "Ani Rahmawati",
    sku: "MLT-KAOS-M-NVY", product: "Kaos polos navy — M", units: 48,
    awb: "JX7781203344", courier: "JNE", status: "completed",
    createdAt: daysAgo(3), arrivedAt: daysAgo(1),
  },
  {
    id: 8802, ref: "IN-8802", team: "Toko Melati", handler: "Ani Rahmawati",
    sku: "MLT-KAOS-L-NVY", product: "Kaos polos navy — L", units: 36,
    awb: "JX7781203345", courier: "JNE", status: "ongoing",
    createdAt: daysAgo(1),
  },
  {
    id: 8803, ref: "IN-8803", team: "Toko Kenanga", handler: "Budi Santoso",
    sku: "KNG-TAS-01", product: "Tas selempang kanvas", units: 12,
    awb: "SC0099213", courier: "SiCepat", status: "ongoing",
    createdAt: hoursAgo(20),
  },
  // ⚠ Cancelled after it had already been sent. The goods are in transit to a warehouse that is no
  // longer expecting them — the case that produces an unlabelled box on the receiving bench.
  {
    id: 8804, ref: "IN-8804", team: "Toko Anggrek", handler: "Dedi Kurniawan",
    sku: "AGK-SEPATU-40", product: "Sepatu lari — 40", units: 6,
    awb: "AJ55120099", courier: "AnterAja", status: "cancel",
    createdAt: daysAgo(5),
  },
];

export const RETURN_ROWS: MovementRow[] = [
  {
    id: 9101, ref: "RT-9101", team: "Toko Melati", handler: "Citra Dewi",
    sku: "MLT-KAOS-M-NVY", product: "Kaos polos navy — M", units: 2,
    awb: "JX7790011223", courier: "JNE", status: "completed",
    createdAt: daysAgo(6), arrivedAt: daysAgo(4),
  },
  {
    id: 9102, ref: "RT-9102", team: "Toko Kenanga", handler: "Citra Dewi",
    sku: "KNG-TAS-01", product: "Tas selempang kanvas", units: 1,
    awb: "SC0099444", courier: "SiCepat", status: "ongoing",
    createdAt: daysAgo(2),
  },
];

export const OUTBOUND_ROWS: MovementRow[] = [
  {
    id: 7701, ref: "OUT-7701", team: "Toko Melati", handler: "Budi Santoso",
    sku: "MLT-KAOS-M-NVY", product: "Kaos polos navy — M", units: 3,
    awb: "JX0001", courier: "JNE", status: "packing_completed",
    createdAt: hoursAgo(4),
  },
  {
    id: 7702, ref: "OUT-7702", team: "Toko Melati", handler: "Budi Santoso",
    sku: "MLT-KAOS-L-NVY", product: "Kaos polos navy — L", units: 1,
    awb: "JX0002", courier: "JNE", status: "packing_completed",
    createdAt: hoursAgo(4),
  },
  // ⚠ THE ONE THE SCANNER MUST REFUSE. Picked but not packed: it is a legitimate order in today's
  // batch, so "not found" would be a lie, and handing it to the courier loses an unfinished parcel.
  {
    id: 7703, ref: "OUT-7703", team: "Toko Kenanga", handler: "Citra Dewi",
    sku: "KNG-TAS-01", product: "Tas selempang kanvas", units: 2,
    awb: "JX0900", courier: "JNE", status: "picked",
    createdAt: hoursAgo(2),
  },
  {
    id: 7704, ref: "OUT-7704", team: "Toko Anggrek", handler: "Citra Dewi",
    sku: "AGK-SEPATU-40", product: "Sepatu lari — 40", units: 1,
    awb: "SC0102277", courier: "SiCepat", status: "picking",
    createdAt: hoursAgo(1),
  },
  {
    id: 7705, ref: "OUT-7705", team: "Toko Melati", handler: "Dedi Kurniawan",
    sku: "MLT-TOPI-01", product: "Topi baseball hitam", units: 4,
    awb: "AJ77220011", courier: "AnterAja", status: "completed",
    createdAt: hoursAgo(9),
  },
  {
    id: 7706, ref: "OUT-7706", team: "Toko Kenanga", handler: "Budi Santoso",
    sku: "KNG-DOMPET-02", product: "Dompet kulit coklat", units: 1,
    awb: "JX0003", courier: "JNE", status: "waiting",
    createdAt: hoursAgo(1),
  },
  // A second courier with something packed, so the handover breakdown is genuinely more than one
  // pile. A single-courier fixture makes a per-courier grouping look like pointless ceremony.
  {
    id: 7707, ref: "OUT-7707", team: "Toko Anggrek", handler: "Budi Santoso",
    sku: "AGK-SEPATU-40", product: "Sepatu lari — 40", units: 1,
    awb: "SC0102299", courier: "SiCepat", status: "packing_completed",
    createdAt: hoursAgo(3),
  },
];

// ── STOCK ───────────────────────────────────────────────────────────────────────────────────────

export interface InventoryRow {
  sku: string;
  product: string;
  team: string;
  // Where it sits. `null` means genuinely unshelved — see RackChip.
  rack: string | null;
  onHand: number;
  reserved: number;
  damaged: number;
  lastCountedAt?: number;
}

export const INVENTORY_ROWS: InventoryRow[] = [
  { sku: "MLT-KAOS-M-NVY", product: "Kaos polos navy — M", team: "Toko Melati", rack: "A-03-2", onHand: 142, reserved: 12, damaged: 0, lastCountedAt: daysAgo(2) },
  { sku: "MLT-KAOS-L-NVY", product: "Kaos polos navy — L", team: "Toko Melati", rack: "A-03-3", onHand: 96, reserved: 4, damaged: 2, lastCountedAt: daysAgo(2) },
  // ⚠ RECEIVED BUT NOT SHELVED. It counts as on hand — the numbers balance — but no picker can find
  // it, so an order for it will read as "in stock" and then fail at the shelf.
  { sku: "KNG-TAS-01", product: "Tas selempang kanvas", team: "Toko Kenanga", rack: null, onHand: 12, reserved: 2, damaged: 0 },
  { sku: "AGK-SEPATU-40", product: "Sepatu lari — 40", team: "Toko Anggrek", rack: "C-01-1", onHand: 0, reserved: 0, damaged: 3, lastCountedAt: daysAgo(11) },
  { sku: "MLT-TOPI-01", product: "Topi baseball hitam", team: "Toko Melati", rack: "B-07-4", onHand: 58, reserved: 0, damaged: 1, lastCountedAt: daysAgo(30) },
  { sku: "KNG-DOMPET-02", product: "Dompet kulit coklat", team: "Toko Kenanga", rack: "B-02-1", onHand: 7, reserved: 6, damaged: 0, lastCountedAt: daysAgo(1) },
];

// ── PROBLEMS ────────────────────────────────────────────────────────────────────────────────────

export type ProblemKind = "damaged" | "lost" | "wrong_item" | "expired";

export interface ProblemRow {
  id: number;
  sku: string;
  product: string;
  team: string;
  kind: ProblemKind;
  units: number;
  note?: string;
  reportedBy: string;
  reportedAt: number;
  // Nobody has decided what happens to it yet. This is the state that accumulates.
  resolved: boolean;
}

export const PROBLEM_ROWS: ProblemRow[] = [
  { id: 501, sku: "MLT-KAOS-L-NVY", product: "Kaos polos navy — L", team: "Toko Melati", kind: "damaged", units: 2, note: "Water damage on the top layer of the carton", reportedBy: "Budi Santoso", reportedAt: daysAgo(4), resolved: false },
  { id: 502, sku: "AGK-SEPATU-40", product: "Sepatu lari — 40", team: "Toko Anggrek", kind: "damaged", units: 3, note: "Box crushed in transit", reportedBy: "Ani Rahmawati", reportedAt: daysAgo(9), resolved: false },
  // ⚠ SIX WEEKS OLD AND STILL OPEN. Small enough that nobody chases it, old enough that nobody
  // remembers it — this is what a problem list fills up with, and why age has to be visible.
  { id: 503, sku: "MLT-TOPI-01", product: "Topi baseball hitam", team: "Toko Melati", kind: "lost", units: 1, note: "Counted short, not found on the rack", reportedBy: "Citra Dewi", reportedAt: daysAgo(43), resolved: false },
  { id: 504, sku: "KNG-TAS-01", product: "Tas selempang kanvas", team: "Toko Kenanga", kind: "wrong_item", units: 4, note: "Supplier sent the black variant", reportedBy: "Dedi Kurniawan", reportedAt: daysAgo(12), resolved: true },
];

// ── DAILY STOCK HISTORY ─────────────────────────────────────────────────────────────────────────

export interface StockDayRow {
  day: number;
  sku: string;
  product: string;
  team: string;
  opening: number;
  inbound: number;
  outbound: number;
  adjustment: number;
  closing: number;
}

export const STOCK_DAYS: StockDayRow[] = [
  { day: daysAgo(0), sku: "MLT-KAOS-M-NVY", product: "Kaos polos navy — M", team: "Toko Melati", opening: 150, inbound: 0, outbound: 8, adjustment: 0, closing: 142 },
  { day: daysAgo(1), sku: "MLT-KAOS-M-NVY", product: "Kaos polos navy — M", team: "Toko Melati", opening: 110, inbound: 48, outbound: 8, adjustment: 0, closing: 150 },
  // ⚠ AN ADJUSTMENT THAT DOES NOT BALANCE against anything else on the row. Somebody corrected the
  // count by hand, and the row is the only trace of it — the reason lives in the problem list, on a
  // different screen, which is exactly the seam where an unexplained shortfall hides.
  { day: daysAgo(2), sku: "MLT-KAOS-M-NVY", product: "Kaos polos navy — M", team: "Toko Melati", opening: 114, inbound: 0, outbound: 2, adjustment: -2, closing: 110 },
  { day: daysAgo(0), sku: "KNG-TAS-01", product: "Tas selempang kanvas", team: "Toko Kenanga", opening: 12, inbound: 0, outbound: 0, adjustment: 0, closing: 12 },
  { day: daysAgo(1), sku: "KNG-TAS-01", product: "Tas selempang kanvas", team: "Toko Kenanga", opening: 0, inbound: 12, outbound: 0, adjustment: 0, closing: 12 },
];

// ── DASHBOARD ───────────────────────────────────────────────────────────────────────────────────

export const INBOUND_TODAY = [
  { state: "Sent to warehouse", orders: 6, units: 118 },
  { state: "Received by warehouse", orders: 14, units: 302 },
  { state: "Cancelled", orders: 1, units: 6, cancelled: true },
];

export const OUTBOUND_TODAY = [
  { state: "Awaiting processing", orders: 34, units: 71 },
  { state: "Being picked", orders: 12, units: 28 },
  { state: "Packed", orders: 51, units: 130 },
  { state: "Handed to courier", orders: 103, units: 244 },
  { state: "Cancelled", orders: 9, units: 17, cancelled: true },
];

export const INVOICE_TODAY = [
  { state: "Draft", orders: 3, units: 3 },
  { state: "Issued", orders: 11, units: 11 },
  { state: "Paid", orders: 8, units: 8 },
];

// How long orders sat in each state before moving on, today. The dashboard's third card.
export interface DwellRow {
  state: string;
  medianMinutes: number;
  worstMinutes: number;
  count: number;
}

export const DWELL_TODAY: DwellRow[] = [
  { state: "Awaiting processing → Being picked", medianMinutes: 24, worstMinutes: 190, count: 88 },
  { state: "Being picked → Packed", medianMinutes: 11, worstMinutes: 47, count: 74 },
  // ⚠ THE MEDIAN IS FINE AND THE WORST IS FOUR HOURS. A single number would have hidden this, and
  // it is the only row on the card that anybody can act on.
  { state: "Packed → Handed to courier", medianMinutes: 38, worstMinutes: 241, count: 103 },
];

// ── INSIGHT ─────────────────────────────────────────────────────────────────────────────────────

export interface TeamThroughputRow {
  team: string;
  inbound: number;
  outbound: number;
  damaged: number;
  returns: number;
}

export const TEAM_THROUGHPUT: TeamThroughputRow[] = [
  { team: "Toko Melati", inbound: 412, outbound: 1_204, damaged: 6, returns: 22 },
  { team: "Toko Kenanga", inbound: 188, outbound: 640, damaged: 4, returns: 11 },
  // ⚠ MORE DAMAGE THAN THIS TEAM SHIPS. A ratio table sorted by volume buries this at the bottom;
  // it is the only row on the screen worth a phone call.
  { team: "Toko Anggrek", inbound: 96, outbound: 41, damaged: 58, returns: 9 },
];

export const DAILY_TRAFFIC = [
  { day: "Mon", inbound: 42, outbound: 180 },
  { day: "Tue", inbound: 61, outbound: 210 },
  { day: "Wed", inbound: 38, outbound: 166 },
  { day: "Thu", inbound: 74, outbound: 232 },
  { day: "Fri", inbound: 55, outbound: 261 },
  { day: "Sat", inbound: 12, outbound: 98 },
  { day: "Sun", inbound: 0, outbound: 24 },
];

// ── CASH BOOK ───────────────────────────────────────────────────────────────────────────────────

export interface CashEntry {
  id: number;
  at: number;
  kind: "in" | "out";
  category: string;
  amount: number;
  note?: string;
  by: string;
}

export const CASH_ENTRIES: CashEntry[] = [
  { id: 301, at: daysAgo(0), kind: "out", category: "Packaging", amount: 480_000, note: "Bubble wrap, 4 rolls", by: "Ani Rahmawati" },
  { id: 302, at: daysAgo(0), kind: "in", category: "Courier refund", amount: 125_000, note: "Lost parcel claim", by: "Ani Rahmawati" },
  { id: 303, at: daysAgo(1), kind: "out", category: "Meals", amount: 210_000, note: "Overtime shift", by: "Budi Santoso" },
  { id: 304, at: daysAgo(2), kind: "out", category: "Transport", amount: 90_000, by: "Dedi Kurniawan" },
  // ⚠ NO CATEGORY AND NO NOTE. The entry that a monthly report cannot explain, and the reason a
  // cash book needs the note field to be hard to skip.
  { id: 305, at: daysAgo(3), kind: "out", category: "Uncategorised", amount: 1_500_000, by: "Budi Santoso" },
];

// ── INVOICES (the floor's view) ─────────────────────────────────────────────────────────────────

export interface FloorInvoiceRow {
  id: number;
  number: string;
  team: string;
  issuedAt: number;
  dueAt: number;
  amount: number;
  paid: number;
  status: "draft" | "issued" | "paid" | "overdue";
}

export const FLOOR_INVOICES: FloorInvoiceRow[] = [
  { id: 1201, number: "INV-2026-1201", team: "Toko Melati", issuedAt: daysAgo(12), dueAt: daysAgo(-18), amount: 14_200_000, paid: 14_200_000, status: "paid" },
  { id: 1202, number: "INV-2026-1202", team: "Toko Kenanga", issuedAt: daysAgo(8), dueAt: daysAgo(-22), amount: 6_400_000, paid: 2_000_000, status: "issued" },
  // Part-paid AND past due. Two states at once, and a single status column can only show one.
  { id: 1203, number: "INV-2026-1203", team: "Toko Anggrek", issuedAt: daysAgo(46), dueAt: daysAgo(16), amount: 3_100_000, paid: 900_000, status: "overdue" },
  { id: 1204, number: "INV-2026-1204", team: "Toko Melati", issuedAt: daysAgo(0), dueAt: daysAgo(-30), amount: 2_750_000, paid: 0, status: "draft" },
];

// ── THE APK LIST ────────────────────────────────────────────────────────────────────────────────
//
// The floor app ships an Android build, and the download screen is how it reaches the handhelds —
// there is no store listing. See the downloads screen for why that is a design decision and not an
// accident.
export interface AppBuild {
  name: string;
  version: string;
  sizeMb: number;
  releasedAt: number;
  notes: string;
  current: boolean;
}

export const APP_BUILDS: AppBuild[] = [
  { name: "Warehouse Scanner", version: "2.4.1", sizeMb: 18.4, releasedAt: daysAgo(6), notes: "Duplicate scans now sound different from errors", current: true },
  { name: "Warehouse Scanner", version: "2.3.0", sizeMb: 18.1, releasedAt: daysAgo(34), notes: "Bulk pick by product", current: false },
  { name: "Label Printer Bridge", version: "1.1.2", sizeMb: 4.2, releasedAt: daysAgo(61), notes: "Fixes 58mm label alignment", current: true },
];

// ── PRINTING ────────────────────────────────────────────────────────────────────────────────────

export interface BarcodeLabel {
  code: string;
  sku: string;
  product: string;
  variant?: string;
  rack?: string | null;
}

export const BARCODE_LABELS: BarcodeLabel[] = [
  { code: "MLT-KAOS-M-NVY", sku: "MLT-KAOS-M-NVY", product: "Kaos polos navy", variant: "M / Navy", rack: "A-03-2" },
  { code: "MLT-KAOS-L-NVY", sku: "MLT-KAOS-L-NVY", product: "Kaos polos navy", variant: "L / Navy", rack: "A-03-3" },
  { code: "KNG-TAS-01", sku: "KNG-TAS-01", product: "Tas selempang kanvas", variant: "Kanvas", rack: null },
  { code: "MLT-TOPI-01", sku: "MLT-TOPI-01", product: "Topi baseball", variant: "Hitam", rack: "B-07-4" },
];

export interface ReceiptJob {
  awb: string;
  courier: string;
  team: string;
  recipient: string;
  city: string;
  items: number;
  printed: boolean;
}

export const RECEIPT_JOBS: ReceiptJob[] = [
  { awb: "JX0001", courier: "JNE", team: "Toko Melati", recipient: "Sari W.", city: "Bandung", items: 3, printed: true },
  { awb: "JX0002", courier: "JNE", team: "Toko Melati", recipient: "Rudi H.", city: "Surabaya", items: 1, printed: true },
  { awb: "JX0003", courier: "JNE", team: "Toko Kenanga", recipient: "Maya P.", city: "Medan", items: 1, printed: false },
  { awb: "SC0102277", courier: "SiCepat", team: "Toko Anggrek", recipient: "Joko S.", city: "Semarang", items: 1, printed: false },
];

// ── TRACKING BEFORE HANDOVER ────────────────────────────────────────────────────────────────────

export interface TrackedParcel {
  awb: string;
  courier: string;
  team: string;
  status: "not_scanned" | "scanned" | "handed_over" | "missing";
  scannedAt?: number;
}

export const TRACKED_PARCELS: TrackedParcel[] = [
  { awb: "JX0001", courier: "JNE", team: "Toko Melati", status: "handed_over", scannedAt: hoursAgo(2) },
  { awb: "JX0002", courier: "JNE", team: "Toko Melati", status: "scanned", scannedAt: hoursAgo(1) },
  { awb: "JX0003", courier: "JNE", team: "Toko Kenanga", status: "not_scanned" },
  // ⚠ PACKED, ON THE MANIFEST, AND NOT IN THE PILE. The whole reason this screen exists: it is
  // found BEFORE the courier leaves, not the next morning from a customer complaint.
  { awb: "AJ77220011", courier: "AnterAja", team: "Toko Melati", status: "missing" },
];

export const WAREHOUSE = {
  name: "Gudang Cikarang 1",
  address: "Jl. Industri Raya No. 42, Cikarang, Bekasi",
  phone: "+62 21 5550 0142",
  capacityRacks: 480,
  usedRacks: 391,
};
