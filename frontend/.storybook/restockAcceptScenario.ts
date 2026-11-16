// WHAT THE RESTOCK ACCEPT SENT, in Storybook — each accept's line expiries by restock line id (`yyyy-mm-dd`, "" for none;
// the-warehouse-types-the-expiry-at-the-accept), recorded by restockStub.ts's `restockRequestAccept` and reset with it.
//
// ⚠ ITS OWN MODULE (as sessionScenario.ts): a story imports it, and importing stubTransport.ts would pull the whole stub
// into `npm run typecheck`.

export const restockAcceptScenario: { expiries: Record<string, string>[] } = { expiries: [] };

export function resetRestockAcceptScenario() {
  restockAcceptScenario.expiries = [];
}
