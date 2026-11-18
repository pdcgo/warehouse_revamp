// WHAT THE RESTOCK ACCEPT SENT, in Storybook — each accept's line expiries by restock line id (`yyyy-mm-dd`, "" for none;
// the-warehouse-types-the-expiry-at-the-accept), and the door's photos it sent: each line's broken photo document by
// restock line id ("" for none; a-broken-product-carries-a-photo) and the courier's slip's ("" for none;
// the-courier-slip-has-an-optional-photo) — recorded by restockStub.ts's `restockRequestAccept` and reset with it.
//
// ⚠ ITS OWN MODULE (as sessionScenario.ts): a story imports it, and importing stubTransport.ts would pull the whole stub
// into `npm run typecheck`.

export const restockAcceptScenario: {
  expiries: Record<string, string>[];
  photos: { broken: Record<string, string>; slip: string }[];
} = { expiries: [], photos: [] };

export function resetRestockAcceptScenario() {
  restockAcceptScenario.expiries = [];
  restockAcceptScenario.photos = [];
}
