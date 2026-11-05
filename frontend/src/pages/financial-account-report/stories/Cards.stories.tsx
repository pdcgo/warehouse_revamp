import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { FinancialAccountChangeType as T } from "../../../gen/warehouse/financial_account/v1/financial_account_pb";
import { MELATI_TIKTOK, REPORT_META, loaded, pickAccount, rp, signed } from "./kit";

// ACCOUNT REPORT — the five cards — what each says, the net change's breakdown, and what moved it. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/FinancialAccount/Report/Cards",
  ...REPORT_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// The window in its numbers: opening + net change = closing — and the close is the accounts page's total, because
// the daily row is written with the log row (the-daily-row-is-written-with-the-log-row).
export const TheWindowAddsUp: Story = {
  name: "Window adds up",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("account-report-open-value")).toHaveTextContent(rp(11_300_000));
    await expect(canvas.getByTestId("account-report-change-value")).toHaveTextContent(signed(5_143_500));
    await expect(canvas.getByTestId("account-report-close")).toHaveAttribute("data-emphasis");
  },
};

// Each card says what its figure is (owner): the opening's day, the move against it, the close as their sum.
export const EachCardSaysWhatItIs: Story = {
  name: "What each card is",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("account-report-open")).toHaveTextContent("At the start of");
    await expect(canvas.getByTestId("account-report-change")).toHaveTextContent("+45.5% of the opening balance");
    await expect(canvas.getByTestId("account-report-close")).toHaveTextContent("At the end of");
    await expect(canvas.getByTestId("account-report-close-note")).toHaveTextContent("Opening balance + net change");
  },
};

// What the net change is made of (owner: *"perubahan bersih, kasih modal detail, penarikan modal restock dsb itu"*) —
// "Details ›" on the card: in first, largest first, then out, summing to the net change. A transfer between the team's
// own accounts nets to nothing, so it is not a line of the team's breakdown.
export const TheNetChangeOpensItsBreakdown: Story = {
  name: "Net change details",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("account-report-change-detail"));
    const dialog = await screen.findByTestId("change-detail");
    await waitFor(() => expect(dialog).toBeVisible());

    const rows = within(dialog).getAllByTestId(/^change-detail-\d+$/);
    await expect(rows[0]).toHaveTextContent("Withdrawal");
    await expect(rows[0]).toHaveTextContent(signed(11_000_000));
    await expect(within(dialog).getByTestId(`change-detail-${T.RESTOCK}`)).toHaveTextContent(signed(-850_000));
    await expect(within(dialog).queryByTestId(`change-detail-${T.TRANSFER}`)).toBeNull();
    await expect(within(dialog).getByTestId("change-detail-total")).toHaveTextContent(signed(5_143_500));
    await expect(within(dialog).getByTestId("change-detail-bridge")).toHaveTextContent(rp(11_300_000));
    await expect(within(dialog).getByTestId("change-detail-bridge")).toHaveTextContent(rp(16_443_500));
  },
};

// What moved it, as two cards (owner, account first): the one that moved most, out of how many — Melati TikTok's
// account, the Lainnya provider as its coloured badge — after the three balances.
export const WhatMovedItByAccountAndProvider: Story = {
  name: "What moved it",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("account-report-by-account-value")).toHaveTextContent(signed(4_200_000)));
    await expect(canvas.getByTestId("account-report-by-account")).toHaveTextContent("Melati TikTok");
    await expect(canvas.getByTestId("account-report-by-account")).toHaveTextContent("Biggest of 7 accounts");
    await expect(canvas.getByTestId("account-report-by-provider-value")).toHaveTextContent(signed(4_200_000));
    await expect(canvas.getByTestId("account-report-by-provider")).toHaveTextContent("Biggest of 5 providers");
    await expect(within(canvas.getByTestId("account-report-by-provider")).getByText("Other").closest(".chakra-badge")).not.toBeNull();

    const cards = Array.from(canvas.getByTestId("account-report-totals").children).map((el) => el.getAttribute("data-testid"));
    await expect(cards).toEqual([
      "account-report-open",
      "account-report-change",
      "account-report-close",
      "account-report-by-account",
      "account-report-by-provider",
    ]);
  },
};

// Both go while one account is picked (owner: *"keduanya jadi tidak perlu muncul kalau ada filter akun"*) — one account
// has nothing to rank, and the contract's ranking is always the team's.
export const OneAccountHasNothingToRank: Story = {
  name: "One account, no ranking",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("account-report-by-provider")).toBeVisible());

    await pickAccount(canvas, MELATI_TIKTOK.id);
    await waitFor(() => expect(canvas.getByTestId("account-report-close-value")).toHaveTextContent(rp(4_200_000)));
    await expect(canvas.queryByTestId("account-report-by-account")).toBeNull();
    await expect(canvas.queryByTestId("account-report-by-provider")).toBeNull();
    await expect(canvas.getByTestId("account-report-totals").children).toHaveLength(3);
  },
};
