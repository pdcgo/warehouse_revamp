import type { Costs, LineDraft } from "../lines";
import { lineTotal } from "../lines";
import { mockTerms } from "./mockData";
import type { CreditRole, CreditRow } from "./CreditLimitPanel";
import type { InvoiceRow } from "./TotalsInvoicePanel";

// WHAT AN ORDER WOULD PUT US IN DEBT FOR — shared by the two screens that draw the order form, so a new
// order and a draft being finished cannot compute the invoice or the credit rows two ways.
//
// ⚠ THE TERMS ARE SAMPLES (`mockTerms`): a debtor cannot read another team's markup or credit limit yet.
// That is the form's `creditLimit`, `warehouseFee` and `invoice` marks.

/** Who owns what — the by-ids read's rows, keyed by product id. */
export type Owners = Map<string, { teamId: bigint }> | undefined;

/**
 * WHAT WE OWE, per creditor: the goods of each other team at HPP with their markup on top, then the
 * warehouse's flat fee — the same shape `liability` posts, so the preview and the recorded debt agree.
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
  const base = new Map<string, bigint>();

  for (const line of lines) {
    const ownerTeamId = owners?.get(line.productId.toString())?.teamId ?? 0n;
    if (ownerTeamId === 0n || ownerTeamId === teamId) continue;

    const key = ownerTeamId.toString();
    base.set(key, (base.get(key) ?? 0n) + lineTotal(line, costs));
  }

  const rows: InvoiceRow[] = [...base.entries()].map(([key, amount]) => {
    const ownerTeamId = BigInt(key);
    const markupBp = mockTerms(ownerTeamId).markupBp;

    return {
      teamId: ownerTeamId,
      name: teamName(ownerTeamId),
      base: amount,
      markupBp,
      // Integer maths: basis points over the cost, rounded down by the division.
      owed: (amount * (10_000n + markupBp)) / 10_000n,
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
 * One row per creditor — the building that ships it, and every team whose goods are on it.
 *
 * ⚠ KEYED BY TEAM, NOT BY REASON: a warehouse that also owns goods on the order is ONE creditor with ONE
 * limit, and listing its fee and its goods apart would hide a ceiling the two cross together.
 */
export function creditRows(args: {
  invoice: InvoiceRow[];
  warehouseId: bigint;
  warehouseFee: bigint;
  teamName: (id: bigint) => string;
}): CreditRow[] {
  const { invoice, warehouseId, warehouseFee, teamName } = args;
  const byTeam = new Map<string, CreditRow>();

  function owe(id: bigint, role: CreditRole, amount: bigint) {
    const key = id.toString();
    const row = byTeam.get(key);

    if (row) {
      row.adds += amount;
      if (!row.roles.includes(role)) row.roles.push(role);
      return;
    }

    const terms = mockTerms(id);
    byTeam.set(key, {
      teamId: id,
      name: teamName(id),
      roles: [role],
      debt: terms.debt,
      limit: terms.creditLimit,
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
