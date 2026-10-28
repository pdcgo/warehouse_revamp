import type { Costs, LineDraft } from "../lines";
import { lineTotal } from "../lines";
import type { CreditFigures, CreditRole, CreditRow } from "./CreditLimitPanel";
import type { InvoiceRow } from "./TotalsInvoicePanel";

// WHAT AN ORDER WOULD PUT US IN DEBT FOR — shared by the two screens that draw the order form, so a new
// order and a draft being finished cannot compute the invoice or the credit rows two ways.
//
// THE INVOICE IS REAL. Each borrowed line is charged at its PRODUCT's own markup — `products.cross_markup_bps`,
// read off the same by-ids row that names the line's owner (the-cross-markup-belongs-to-the-product) — and the
// warehouse fee is the one the warehouse prices (WarehouseFeeCalculate). One owner's lines can carry different rates,
// so the markup is applied per LINE and the row sums the results, the shape the take freezes and the ledger posts
// (the-ledger-charges-the-frozen-line-total).
//
// THE CREDIT FIGURES ARE REAL TOO: each creditor's limit on this team and the debt it already carries come from
// LiabilityCreditByIds (the-debtor-sees-the-limits-set-on-it) — the same reading the create's credit check makes.

/** Who owns what, and at what markup — the by-ids read's rows, keyed by product id. */
export type Owners = Map<string, { teamId: bigint; crossMarkupBps: number }> | undefined;

/**
 * WHAT WE OWE, per creditor: the goods of each other team at HPP, each line with its own product's markup on top,
 * then the warehouse's fee.
 */
export function invoiceRows(args: {
  lines: LineDraft[];
  owners: Owners;
  costs: Costs | undefined;
  teamId: bigint | undefined;
  warehouseId: bigint;
  warehouseFee: bigint;
  teamName: (id: bigint) => string;
}): InvoiceRow[] {
  const { lines, owners, costs, teamId, warehouseId, warehouseFee, teamName } = args;
  const byOwner = new Map<string, { base: bigint; owed: bigint; rates: Set<number> }>();

  for (const line of lines) {
    const owner = owners?.get(line.productId.toString());
    const ownerTeamId = owner?.teamId ?? 0n;
    if (ownerTeamId === 0n || ownerTeamId === teamId) continue;

    const key = ownerTeamId.toString();
    const row = byOwner.get(key) ?? { base: 0n, owed: 0n, rates: new Set<number>() };
    const base = lineTotal(line, costs);
    const rate = owner?.crossMarkupBps ?? 0;

    row.base += base;
    row.owed += withMarkup(base, rate);
    row.rates.add(rate);
    byOwner.set(key, row);
  }

  const rows: InvoiceRow[] = [...byOwner.entries()].map(([key, row]) => {
    const ownerTeamId = BigInt(key);
    // ONE RATE is shown only when every line of this owner carries it. Mixed rates have no single figure that is
    // true of the row, so the panel shows the markup in rupiah instead.
    const [only] = row.rates;

    return {
      teamId: ownerTeamId,
      name: teamName(ownerTeamId),
      base: row.base,
      markupBp: row.rates.size === 1 && only !== undefined ? BigInt(only) : undefined,
      owed: row.owed,
      kind: "product",
    };
  });

  if (warehouseId > 0n && warehouseFee > 0n) {
    rows.push({
      teamId: warehouseId,
      name: teamName(warehouseId),
      base: 0n,
      markupBp: 0n,
      owed: warehouseFee,
      kind: "fee",
    });
  }

  return rows;
}

/**
 * One line at its owner's markup. Integer maths, per line: basis points over the line's cost, rounded down by the
 * division — then summed, as the frozen line totals are.
 */
function withMarkup(base: bigint, rateBps: number): bigint {
  return (base * (10_000n + BigInt(rateBps))) / 10_000n;
}

/**
 * THE GOODS' COST AS THE ORDER WILL FREEZE IT — the owner's `goods_cost`: each line at what it costs the SELLER, an own
 * line at its HPP and a borrowed line WITH its product's own markup (the-cross-charge-lives-on-the-line). The warehouse
 * prices its fee on this (the-fee-is-priced-on-goods-cost) and total beli is this plus that fee, so the form asks the
 * fee on it and shows it as the products' total — the same per-line arithmetic as the invoice, so the preview, the
 * fee's basis and the frozen order cannot be three different sums.
 */
export function goodsCostOf(args: {
  lines: LineDraft[];
  owners: Owners;
  costs: Costs | undefined;
  teamId: bigint | undefined;
}): bigint {
  const { lines, owners, costs, teamId } = args;
  let sum = 0n;

  for (const line of lines) {
    const owner = owners?.get(line.productId.toString());
    const ownerTeamId = owner?.teamId ?? 0n;
    const borrowed = ownerTeamId !== 0n && ownerTeamId !== teamId;
    const base = lineTotal(line, costs);

    sum += borrowed ? withMarkup(base, owner?.crossMarkupBps ?? 0) : base;
  }

  return sum;
}

/** One creditor's figures as LiabilityCreditByIds answers them. `creditLimit` undefined = unlimited, 0n = frozen. */
export interface CreditStanding {
  creditLimit?: bigint;
  debt: bigint;
}

/**
 * WHERE THE CREDIT READ STANDS — answered, still reading, or failed.
 *
 * ⚠ THREE STATES, because "no figure yet" must never read as "no limit". A row whose read is in flight or failed is
 * marked as such; it is never drawn as unlimited.
 */
export type CreditRead =
  | { status: "ready"; byTeam: Map<string, CreditStanding> }
  | { status: "loading" }
  | { status: "failed" };

/** The query's state as a CreditRead. A failed refetch is failed even with an older answer cached — this decides. */
export function creditReadOf(query: {
  data: Map<string, CreditStanding> | undefined;
  isError: boolean;
}): CreditRead {
  if (query.isError) return { status: "failed" };
  if (query.data) return { status: "ready", byTeam: query.data };
  return { status: "loading" };
}

/** Every creditor the order would draw on — what `useLiabilityCredit` is asked about. Same set as `creditRows`. */
export function creditorIds(invoice: InvoiceRow[], warehouseId: bigint): bigint[] {
  const ids = invoice.filter((row) => row.kind === "product").map((row) => row.teamId);
  return warehouseId > 0n ? [warehouseId, ...ids] : ids;
}

/**
 * One row per creditor — the building that ships it, and every team whose goods are on it.
 *
 * ⚠ KEYED BY TEAM, NOT BY REASON: a warehouse that also owns goods on the order is ONE creditor with ONE
 * limit, and listing its fee and its goods apart would hide a ceiling the two cross together.
 *
 * ⚠ THE ORDERING TEAM IS NEVER ITS OWN CREDITOR — a building shipping its own order owes nobody, and the credit check
 * drops it the same way, so it gets no row.
 */
export function creditRows(args: {
  invoice: InvoiceRow[];
  teamId: bigint | undefined;
  warehouseId: bigint;
  warehouseFee: bigint;
  teamName: (id: bigint) => string;
  credit: CreditRead;
}): CreditRow[] {
  const { invoice, teamId, warehouseId, warehouseFee, teamName, credit } = args;
  const byTeam = new Map<string, CreditRow>();

  function figuresOf(key: string): CreditFigures {
    if (credit.status !== "ready") return { state: credit.status };

    // A creditor missing from a READY answer was not asked or not answered — never "unlimited", which the server
    // states as an item with no limit.
    const standing = credit.byTeam.get(key);
    if (!standing) return { state: "failed" };

    return { state: "ready", debt: standing.debt, limit: standing.creditLimit };
  }

  function owe(id: bigint, role: CreditRole, amount: bigint) {
    if (id === teamId) return;

    const key = id.toString();
    const row = byTeam.get(key);

    if (row) {
      row.adds += amount;
      if (!row.roles.includes(role)) row.roles.push(role);
      return;
    }

    byTeam.set(key, {
      teamId: id,
      name: teamName(id),
      roles: [role],
      figures: figuresOf(key),
      adds: amount,
    });
  }

  // The warehouse first — the creditor every order has.
  if (warehouseId > 0n) owe(warehouseId, "warehouse", warehouseFee);
  for (const row of invoice) {
    if (row.kind === "product") owe(row.teamId, "owner", row.owed);
  }

  return [...byTeam.values()];
}
