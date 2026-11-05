import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { FinancialAccountProvider as P } from "../../../gen/warehouse/financial_account/v1/financial_account_pb";
import { BCA_OPS, BNI, REPORT_META, loaded, rp, signed } from "./kit";

// ACCOUNT REPORT — a ranking card's Details › — by account, by provider, and an account's row opening it. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/FinancialAccount/Report/Movers",
  ...REPORT_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// Mobile: a card's "Details ›" still opens its breakdown — by account here, every account and the Total — as a list,
// the net change right under the closing balance (owner: *"perubahan bersih taruh saja di bawah saldo akhir"*).
export const MobileBreakdownOpens: Story = {
  name: "Phone · as a list",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("account-report-by-account-detail")).toBeVisible());
    await userEvent.click(canvas.getByTestId("account-report-by-account-detail"));
    const dialog = await screen.findByTestId("movers-account");
    await waitFor(() => expect(dialog).toBeVisible());
    const rows = within(dialog).getAllByTestId(/^movers-row-/);
    await expect(rows).toHaveLength(7);
    await expect(within(dialog).queryAllByRole("columnheader")).toHaveLength(0);
    for (const row of rows) {
      const id = row.getAttribute("data-testid")!.replace("movers-row-", "");
      const close = within(row).getByTestId(`movers-close-${id}`).getBoundingClientRect();
      const change = within(row).getByTestId(`movers-change-${id}`).getBoundingClientRect();
      await expect(change.top).toBeGreaterThanOrEqual(close.bottom - 1);
      await expect(change.top - close.bottom).toBeLessThan(12);
      await expect(Math.abs(change.right - close.right)).toBeLessThan(2);
    }
    await expect(within(dialog).getByTestId("movers-total-account")).toHaveTextContent(rp(16_443_500));
  },
};

// account-grouped-joins-the-metrics: by account, the largest movement first — named by its shop, the server's
// "Unknown — shop #25" read as Melati TikTok — an archived account still listed and marked, because its past happened,
// and the Total row the team's own figures.
export const ByAccount: Story = {
  name: "By account",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("account-report-by-account-detail")).toBeVisible());
    await userEvent.click(canvas.getByTestId("account-report-by-account-detail"));
    const dialog = await screen.findByTestId("movers-account");
    await waitFor(() => expect(dialog).toBeVisible());

    const rows = within(dialog).getAllByTestId(/^movers-row-/);
    await expect(rows).toHaveLength(7);
    await expect(rows[0]).toHaveTextContent("Melati TikTok");
    await expect(rows[0]).not.toHaveTextContent("Unknown");
    await expect(within(dialog).getByTestId(`movers-row-accountId-${BNI.id}`)).toHaveTextContent("Archived");
    await expect(within(dialog).getByTestId(`movers-row-accountId-${BCA_OPS.id}`)).toHaveTextContent(rp(11_443_500));
    await expect(within(dialog).getByTestId("movers-total-account")).toHaveTextContent("Total");
    await expect(within(dialog).getByTestId("movers-total-account")).toHaveTextContent(signed(5_143_500));
    await expect(within(dialog).getByTestId("movers-total-account")).toHaveTextContent(rp(16_443_500));
  },
};

// By provider: BCA's two accounts are one line, the provider its coloured badge.
export const ByProvider: Story = {
  name: "By provider",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("account-report-by-provider-detail")).toBeVisible());
    await userEvent.click(canvas.getByTestId("account-report-by-provider-detail"));
    const dialog = await screen.findByTestId("movers-provider");
    await waitFor(() => expect(dialog).toBeVisible());

    const bca = within(dialog).getByTestId(`movers-row-provider-${P.BCA}`);
    await expect(bca).toHaveTextContent(signed(1_293_500));
    await expect(bca).toHaveTextContent(rp(12_043_500));
    await expect(within(bca).getByText("BCA").closest(".chakra-badge")).not.toBeNull();
  },
};

// An account's row in the breakdown opens that account's page — its statement.
export const AnAccountRowOpensTheAccount: Story = {
  name: "Row opens the account",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("account-report-by-account-detail")).toBeVisible());
    await userEvent.click(canvas.getByTestId("account-report-by-account-detail"));
    const dialog = await screen.findByTestId("movers-account");
    await waitFor(() => expect(dialog).toBeVisible());

    await userEvent.click(within(dialog).getByTestId(`movers-row-accountId-${BCA_OPS.id}`));
    await expect(await canvas.findByTestId("at-account-detail")).toBeVisible();
  },
};
