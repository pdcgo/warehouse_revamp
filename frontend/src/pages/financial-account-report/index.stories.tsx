import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { account } from "../../../.storybook/financialAccountFixtures";
import { asTeam, routedPage } from "../../../.storybook/pageStory";
import {
  FinancialAccountChangeType as T,
  FinancialAccountProvider as P,
} from "../../gen/warehouse/financial_account/v1/financial_account_pb";
import { formatRupiahNumber } from "../../lib/money";
import { FinancialAccountReportPage } from "./index";

// The account report — the owner's six metrics (context.md lines 126–131), delivered the
// settlement way (analytics-are-delivered-the-settlement-way).
//
// Toko Melati over the last 30 days (today and the 29 before), from .storybook/financialAccountFixtures.ts:
//   opened at 10.950.000 · withdrawals +11.000.000 · expenses −3.600.000 · team payment −1.500.000 ·
//   capital +1.000.000 · ads −900.000 · restocks −850.000 · the bank fee −6.500 · transfers net 0
//   → +5.143.500 → closed at 16.093.500 — exactly what the accounts page's total says.

const BCA_OPS = account("BCA Operasional");
const BNI = account("BNI Lama");

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${formatRupiahNumber(Math.abs(n))}`.replace(/\s/g, " ");
const rp = (n: number) => formatRupiahNumber(n).replace(/\s/g, " ");

const Routed = routedPage([{ path: "/financial-accounts/report", element: <FinancialAccountReportPage /> }], "/financial-accounts/report");

const meta = {
  title: "Pages/FinancialAccount/Report",
  component: Routed,
  parameters: { signedIn: true, dataRouter: true, layout: "padded" },
  beforeEach: asTeam(12n),
} satisfies Meta<typeof Routed>;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await waitFor(() => expect(canvas.getByTestId("account-report-close-value")).toHaveTextContent(rp(16_443_500)), {
    timeout: 4000,
  });

  return canvas;
}

export const Default: Story = {};

// The window in its numbers: open + every type's movement = close — and the close is the accounts page's
// total, because the daily row is written with the log row (the-daily-row-is-written-with-the-log-row).
export const TheWindowAddsUp: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("account-report-open-value")).toHaveTextContent(rp(11_300_000));
    await expect(canvas.getByTestId("account-report-change-value")).toHaveTextContent(signed(5_143_500));
    await expect(canvas.getByTestId(`account-report-type-${T.WITHDRAWAL}`)).toHaveTextContent(signed(11_000_000));
    await expect(canvas.getByTestId(`account-report-type-${T.EXPENSE}`)).toHaveTextContent(signed(-3_600_000));
    // A transfer between the team's own accounts nets to zero, so the team view does not list it.
    await expect(canvas.queryByTestId(`account-report-type-${T.TRANSFER}`)).toBeNull();
  },
};

// One account: its own open and close, and its transfers show — they left IT, even if not the team.
export const OneAccount: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("account-report-account"));
    const option = await canvas.findByTestId(`account-report-account-option-${BCA_OPS.id}`);
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await waitFor(() => expect(canvas.getByTestId("account-report-close-value")).toHaveTextContent(rp(11_443_500)));
    await expect(canvas.getByTestId("account-report-open-value")).toHaveTextContent(rp(10_750_000));
    await expect(canvas.getByTestId(`account-report-type-${T.TRANSFER}`)).toHaveTextContent(signed(-3_500_000));
  },
};

// Daily, newest first, every day a row — today's is quiet and still carries the balance.
export const DailyNewestFirst: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const rows = within(canvas.getByTestId("account-report-series")).getAllByRole("row");
    await expect(rows).toHaveLength(1 + 20);
    await expect(rows[1]).toHaveTextContent(rp(16_443_500));
  },
};

// account-grouped-joins-the-metrics: by account, the largest movement first — Melati TikTok's unknown
// account moved most — and an archived account is still listed, marked, because its past happened.
export const GroupedByAccount: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const table = await canvas.findByTestId("account-report-groups");
    const rows = within(table).getAllByRole("row");
    // Named by its shop — the server writes "shop #25", the screen shows Melati TikTok.
    await expect(rows[1]).toHaveTextContent("Unknown — Melati TikTok");
    await expect(canvas.getByTestId(`account-report-group-accountId-${BNI.id}`)).toHaveTextContent("Archived");
  },
};

// By provider: BCA's two accounts are one line.
export const GroupedByProvider: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("account-report-group-by-provider"));
    const bca = await canvas.findByTestId(`account-report-group-provider-${P.BCA}`);
    await expect(bca).toHaveTextContent(signed(1_293_500));
    await expect(bca).toHaveTextContent(rp(12_043_500));
  },
};

// By change type: what moved the money — and no balance, which belongs to an account, not to a type.
export const GroupedByChangeType: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("account-report-group-by-changeType"));
    const table = await canvas.findByTestId("account-report-groups");
    await waitFor(() => expect(within(table).getAllByRole("row")[1]).toHaveTextContent("Withdrawal"));
    await expect(within(table).getAllByRole("columnheader")).toHaveLength(2);
  },
};
