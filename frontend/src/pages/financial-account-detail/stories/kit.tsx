import { expect, waitFor, within } from "storybook/test";

import { account } from "../../../../.storybook/financialAccountFixtures";
import { asTeam, routedPage } from "../../../../.storybook/pageStory";
import { asRole } from "../../../../.storybook/sessionScenario";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { formatRupiahNumber } from "../../../lib/money";
import { FinancialAccountDetailPage } from "../index";

// WHAT EVERY ACCOUNT DETAIL STORY FILE SHARES — the page's stories are split by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen): `../index.stories.tsx` is the Overview, this folder one file per part.
// Each file keeps its own `title` literal — Storybook reads it statically — and spreads the rest from here.
//
// One account's page — docs/business/financial_account/context_decision.md. Accepted at design_accept
// (the-prototype-and-its-contract-are-accepted); the stub plays the rules the server enforces.
//
// One account: its balance, the shops that withdraw into it, and its statement. BCA Operasional's book
// (.storybook/financialAccountFixtures.ts) ends at 11.443.500 with yesterday's reconcile — a 6.500 bank fee.

export const BCA_OPS = account("BCA Operasional");
export const BCA_GAJI = account("BCA Gaji");
const SHOPEEPAY = account("ShopeePay Melati");
export const UNKNOWN = account("Unknown — shop #25");
export const KAS = account("Kas Gudang");

export const rp = (n: number) => formatRupiahNumber(n).replace(/\s/g, " ");

function routedAt(accountId: bigint) {
  return routedPage(
    [{ path: "/financial-accounts/:accountId", element: <FinancialAccountDetailPage /> }],
    `/financial-accounts/${accountId}`,
  );
}

// Built ONCE, at module scope — a router built inside `render` is a fresh history on every re-render
// (pageStory.tsx).
export const AtShopeePay = routedAt(SHOPEEPAY.id);
export const AtUnknown = routedAt(UNKNOWN.id);
export const AtKasGudang = routedAt(KAS.id);
export const AtBcaGaji = routedAt(BCA_GAJI.id);

/** Everything in a file's meta but its title. */
export const ACCOUNT_DETAIL_META = {
  component: routedAt(BCA_OPS.id),
  parameters: { signedIn: true, dataRouter: true },
  // Toko Melati's Admin — a selling team's, who moves its money.
  beforeEach: () => {
    asTeam(12n)();
    asRole(Role.SELLING_ADMIN)();
  },
};

export async function loaded(canvasElement: HTMLElement, balance: number) {
  const canvas = within(canvasElement);
  await waitFor(() => expect(canvas.getByTestId("account-detail-balance")).toHaveTextContent(rp(balance)), { timeout: 4000 });
  await canvas.findByTestId("account-log-table");

  return canvas;
}

export const firstRow = (canvas: ReturnType<typeof within>) =>
  within(canvas.getByTestId("account-log-table")).getAllByRole("row")[1]!;
