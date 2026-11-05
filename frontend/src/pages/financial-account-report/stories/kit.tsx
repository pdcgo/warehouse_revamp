import { expect, userEvent, waitFor, within } from "storybook/test";

import { account } from "../../../../.storybook/financialAccountFixtures";
import { asTeam, marker, routedPage } from "../../../../.storybook/pageStory";
import { formatRupiahNumber } from "../../../lib/money";
import { FinancialAccountReportPage } from "../index";

// WHAT EVERY ACCOUNT REPORT STORY FILE SHARES — the page's stories are split by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen): `../index.stories.tsx` is the Overview, this folder one file per part.
// Each file keeps its own `title` literal — Storybook reads it statically — and spreads the rest from here.
//
// The account report — five cards and one table of periods (owner, `the-report-is-five-cards-and-one-table`), the
// owner's six metrics (context.md lines 126–131) delivered the settlement way (analytics-are-delivered-the-settlement-way).
//
// Toko Melati over the last month — the report's default (LAST_MONTH) — from .storybook/financialAccountFixtures.ts,
// which keeps every row either 27 days back or less, or 32 or more, so a 28- to 31-day month holds the same rows:
//   opened at 11.300.000 · withdrawals +11.000.000 · expenses −3.600.000 · team payment −1.500.000 ·
//   capital +1.000.000 · ads −900.000 · restocks −850.000 · the bank fee −6.500 · transfers net 0
//   → +5.143.500 → closed at 16.443.500 — exactly what the accounts page's total says.

export const BCA_OPS = account("BCA Operasional");
export const BNI = account("BNI Lama");
export const MELATI_TIKTOK = account("Unknown — shop #25");

export const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${formatRupiahNumber(Math.abs(n))}`.replace(/\s/g, " ");
export const rp = (n: number) => formatRupiahNumber(n).replace(/\s/g, " ");

const Routed = routedPage(
  [{ path: "/financial-accounts/report", element: <FinancialAccountReportPage /> }, marker("/financial-accounts/:accountId", "at-account-detail")],
  "/financial-accounts/report",
);

/** Everything in a file's meta but its title. */
export const REPORT_META = {
  component: Routed,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: asTeam(12n),
};

export async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await waitFor(() => expect(canvas.getByTestId("account-report-close-value")).toHaveTextContent(rp(16_443_500)), {
    timeout: 4000,
  });

  return canvas;
}

export async function pickAccount(canvas: ReturnType<typeof within>, id: bigint) {
  await userEvent.click(canvas.getByTestId("account-report-account"));
  const option = await canvas.findByTestId(`account-report-account-option-${id}`);
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option);
}
