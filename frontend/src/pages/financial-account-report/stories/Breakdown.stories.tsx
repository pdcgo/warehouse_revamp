import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import {
  FinancialAccountChangeType as T,
  FinancialAccountProvider as P,
} from "../../../gen/warehouse/financial_account/v1/financial_account_pb";
import { formatRupiahBare } from "../../../lib/money";
import { BCA_OPS, BNI, REPORT_META, loaded, pickAccount, rp, signed } from "./kit";

// ACCOUNT REPORT — the Rincian view — where the money is, what changed the balance, one account, on a phone. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/FinancialAccount/Report/Breakdown",
  ...REPORT_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// ── Periode and Rincian (`the-report-is-two-views-periode-and-rincian`, `rincian-answers-two-questions`) ───────────

async function openBreakdown(canvas: ReturnType<typeof within>) {
  await userEvent.click(canvas.getByTestId("account-report-view-breakdown"));
  await waitFor(() => expect(canvas.getByTestId("account-report-view-breakdown")).toHaveAttribute("aria-selected", "true"));
  return canvas.findByTestId("account-report-breakdown", {}, { timeout: 3000 });
}

// TWO VIEWS, PICKED OVER THE FILTERS — Periode first; Rincian is two cards, each titled by what it groups
// (rincian-cards-are-named-by-what-they-group) with a line saying what it holds. The grain cuts a series, so it is Periode's only; Rincian's cards are the three
// balances alone (the-rincian-view-has-three-plain-cards).
export const TheBreakdownIsItsOwnView: Story = {
  name: "Its own view",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const views = canvas.getByTestId("account-report-views");
    await expect(canvas.getByTestId("account-report-view-period")).toHaveAttribute("aria-selected", "true");
    await expect(views.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      canvas.getByTestId("account-report-filters").getBoundingClientRect().top,
    );
    await expect(canvas.getByTestId("account-report-grain")).toBeVisible();

    const breakdown = await openBreakdown(canvas);
    await expect(canvas.queryByTestId("account-report-grain")).toBeNull();
    await expect(within(breakdown).getByTestId("account-report-breakdown-where")).toHaveTextContent("Balance by Provider and Account");
    await expect(within(breakdown).getByTestId("account-report-breakdown-what")).toHaveTextContent("Movements by Type");

    await expect(canvas.queryByTestId("account-report-change-detail")).toBeNull();
    await expect(canvas.queryByTestId("account-report-by-account")).toBeNull();
    await expect(canvas.queryByTestId("account-report-by-provider")).toBeNull();
    await userEvent.click(canvas.getByTestId("account-report-view-period"));
    await waitFor(() => expect(canvas.getByTestId("account-report-by-account")).toBeVisible());
    await expect(canvas.getByTestId("account-report-change-detail")).toBeVisible();
  },
};

// Saldo per Penyedia dan Akun says "Rp" once, over its figures (the-rincian-says-rp-once).
const bare = (n: number) => formatRupiahBare(n);
const signedBare = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${formatRupiahBare(Math.abs(n))}`;

// WHERE THE MONEY IS — one table: each provider's row its subtotal, its accounts under it; an archived account marked,
// not dropped; a Total that is the whole team. The figures are the cards' dialogs' — one ranking, two ways to read it.
export const WhereTheMoneyIs: Story = {
  name: "Where the money is",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const breakdown = await openBreakdown(canvas);

    const table = await within(breakdown).findByTestId("breakdown-table-where");
    await expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Provider · account",
      "Opening balance",
      "Net change",
      "Closing balance",
    ]);
    await expect(within(table).getAllByTestId(/^breakdown-row-accountId-/)).toHaveLength(7);

    // The closing balance reads from the left — its heading and every figure (the-rincian-close-is-left-aligned).
    await expect(getComputedStyle(within(table).getAllByRole("columnheader")[3]).textAlign).toBe("start");
    for (const cell of within(table).getAllByTestId("breakdown-close-cell")) {
      await expect(getComputedStyle(cell).textAlign).toBe("start");
    }

    // The currency is said once, at the card's title — no figure in the table carries "Rp" (the-rincian-says-rp-once).
    await expect(within(breakdown).getByTestId("account-report-breakdown-where-unit")).toHaveTextContent("Amounts in rupiah (Rp)");
    await expect(table.textContent).not.toContain("Rp");

    // BCA's row is its two accounts summed, and both sit under it.
    const bca = within(table).getByTestId(`breakdown-row-provider-${P.BCA}`);
    await expect(bca).toHaveTextContent(signedBare(1_293_500));
    await expect(bca).toHaveTextContent(bare(12_043_500));
    const ops = within(table).getByTestId(`breakdown-row-accountId-${BCA_OPS.id}`);
    await expect(ops).toHaveTextContent(bare(11_443_500));
    await expect(ops.getBoundingClientRect().top).toBeGreaterThan(bca.getBoundingClientRect().top);

    await expect(within(table).getByTestId(`breakdown-row-accountId-${BNI.id}`)).toHaveTextContent("Archived");
    const total = within(table).getByTestId("breakdown-total-where");
    await expect(total).toHaveTextContent(signedBare(5_143_500));
    await expect(total).toHaveTextContent(bare(16_443_500));

    // An account row opens the account.
    await userEvent.click(ops);
    await expect(await canvas.findByTestId("at-account-detail")).toBeVisible();
  },
};

// WHAT CHANGED THE BALANCE — the bridge: from the opening balance, money in, then money out, to the closing balance —
// its two ends the cards' own; each group's subtotal on its heading; a bar per type in its group's tone.
export const WhatChangedTheBalance: Story = {
  name: "What changed it",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const breakdown = await openBreakdown(canvas);

    const bridge = await within(breakdown).findByTestId("breakdown-bridge");
    await expect(within(bridge).getByTestId("breakdown-open")).toHaveTextContent(rp(11_300_000));
    await expect(within(bridge).getByTestId("breakdown-close")).toHaveTextContent(rp(16_443_500));
    await expect(within(bridge).getByTestId("breakdown-in-total")).toHaveTextContent(signed(12_000_000));
    await expect(within(bridge).getByTestId("breakdown-out-total")).toHaveTextContent(signed(-6_856_500));

    // The opening, then in, then out, then the closing — top to bottom.
    const order = ["breakdown-open", "breakdown-in", "breakdown-out", "breakdown-close"].map(
      (id) => within(bridge).getByTestId(id).getBoundingClientRect().top,
    );
    await expect([...order].sort((a, b) => a - b)).toEqual(order);

    await expect(within(bridge).getByTestId(`breakdown-bar-${T.WITHDRAWAL}`)).toHaveAttribute("data-direction", "in");
    await expect(within(bridge).getByTestId(`breakdown-bar-${T.EXPENSE}`)).toHaveAttribute("data-direction", "out");
  },
};

// ONE ACCOUNT PICKED — where the money is, by provider and account, is the team's ranking, so it says so; what changed
// the balance is that account's.
export const RincianForOneAccount: Story = {
  name: "One account",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await pickAccount(canvas, BCA_OPS.id);
    const breakdown = await openBreakdown(canvas);

    await expect(within(breakdown).getByTestId("account-report-breakdown-where")).toHaveTextContent("One account is picked");
    await expect(within(breakdown).queryByTestId("breakdown-table-where")).toBeNull();
    await waitFor(() => expect(within(breakdown).getByTestId("breakdown-bridge")).toBeVisible());
  },
};

// …and on a phone the two cards stack, the table a list — a provider's line, its accounts indented under it.
export const MobileRincian: Story = {
  name: "Phone · cards stack",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const breakdown = await openBreakdown(canvas);

    await expect(within(breakdown).queryByRole("table")).toBeNull();
    const bca = await within(breakdown).findByTestId(`breakdown-row-accountId-${BCA_OPS.id}`);
    await expect(bca).toHaveTextContent(bare(11_443_500));
    await expect(bca.textContent).not.toContain("Rp");
    await expect(within(breakdown).getByTestId("account-report-breakdown-where-unit")).toBeVisible();
    const where = within(breakdown).getByTestId("account-report-breakdown-where").getBoundingClientRect();
    const what = within(breakdown).getByTestId("account-report-breakdown-what").getBoundingClientRect();
    await expect(what.top).toBeGreaterThanOrEqual(where.bottom);
  },
};

// …and Rincian's rows on a phone carry the opening balance under the name (a-phone-breakdown-row-shows-its-opening) —
// the desktop's Saldo awal column, which the two figures on the right had left out.
export const MobileRincianShowsTheOpening: Story = {
  name: "Phone · opening balance",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const breakdown = await openBreakdown(canvas);

    const open = await within(breakdown).findByTestId(`breakdown-row-accountId-${BCA_OPS.id}-open`);
    await expect(open).toHaveTextContent(`Opening balance ${bare(10_750_000)}`);
    await expect(within(breakdown).getByTestId(`breakdown-row-provider-${P.BCA}-open`)).toHaveTextContent(bare(10_750_000));
    await expect(within(breakdown).getByTestId("breakdown-total-where-open")).toHaveTextContent(bare(11_300_000));
  },
};
