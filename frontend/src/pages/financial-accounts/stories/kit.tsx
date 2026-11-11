import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { account, expectedBalance } from "../../../../.storybook/financialAccountFixtures";
import { asTeam, marker, routedPage } from "../../../../.storybook/pageStory";
import { asRole } from "../../../../.storybook/sessionScenario";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { formatRupiahNumber } from "../../../lib/money";
import { FinancialAccountsPage } from "../index";

// WHAT EVERY ACCOUNTS STORY FILE SHARES — the page's stories are split by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen): `../index.stories.tsx` is the Overview, this folder one file per part.
// Each file keeps its own `title` literal — Storybook reads it statically — and spreads the rest from here.
//
// The accounts page — docs/business/financial_account/context_decision.md. Accepted at design_accept
// (the-prototype-and-its-contract-are-accepted); the stub plays the rules the server enforces.
//
// Toko Melati's accounts, from ONE consistent book (.storybook/financialAccountFixtures.ts): BCA
// Operasional 11.443.500, BCA Gaji 600.000, ShopeePay Melati −150.000 (below zero), an unknown account
// holding Melati TikTok's 4.200.000, Kas Melati 350.000 in the cash box, and BNI Lama archived at zero. Every play() is one decided rule.

export const BCA_OPS = account("BCA Operasional");
export const BCA_GAJI = account("BCA Gaji");
export const SHOPEEPAY = account("ShopeePay Melati");
export const UNKNOWN = account("Unknown — shop #25");

export const rp = (n: number) => formatRupiahNumber(n).replace(/\s/g, " ");

const Routed = routedPage(
  [
    { path: "/financial-accounts", element: <FinancialAccountsPage /> },
    marker("/financial-accounts/report", "at-account-report"),
    marker("/financial-accounts/:accountId", "at-account-detail"),
  ],
  "/financial-accounts",
);

/** Everything in a file's meta but its title. */
export const ACCOUNTS_META = {
  component: Routed,
  parameters: { signedIn: true, dataRouter: true },
  // Toko Melati's Admin — a selling team's, who moves its money.
  beforeEach: () => {
    asTeam(12n)();
    asRole(Role.SELLING_ADMIN)();
  },
};

export async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await waitFor(() => expect(canvas.getByTestId(`account-balance-${BCA_OPS.id}`)).toHaveTextContent(rp(expectedBalance["1301"]!)), {
    timeout: 4000,
  });

  return canvas;
}

export async function openMenu(canvas: ReturnType<typeof within>, id: bigint) {
  await userEvent.click(canvas.getByTestId(`account-actions-${id}`));
  const first = await screen.findAllByRole("menuitem");
  await waitFor(() => expect(first[0]).toBeVisible());
}

/** The rows on screen, in order, by id. */
export function rowIds(canvas: ReturnType<typeof within>): string[] {
  return canvas
    .getAllByTestId(/^account-row-\d+$/)
    .map((r: HTMLElement) => r.getAttribute("data-testid")!.replace("account-row-", ""));
}
