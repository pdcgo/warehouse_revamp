import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { REPORT_META, loaded, rp } from "./kit";

// ACCOUNT REPORT — the Periode table — every type, newest first, sorted from its heading, a type a line on a phone. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/FinancialAccount/Report/Periods",
  ...REPORT_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// The table holds every type (owner: *"full data untuk tabelnya saja"*): Periode held on the left, Saldo akhir on the
// right, and a row lights up under the pointer, its held cells with it (owner: *"tabel report kasih hover per row"*).
//
// ⚠ HOVER IS DRIVEN BY `data-hover`, which Chakra's `_hover` honours — a synthetic pointer event sets no CSS `:hover`,
// so `userEvent.hover` alone would assert nothing.
export const TheTableHoldsEveryType: Story = {
  name: "Every type",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const table = canvas.getByTestId("account-report-series");
    const headers = within(table).getAllByRole("columnheader");
    await expect(headers).toHaveLength(12);
    await expect(getComputedStyle(headers[0]!).position).toBe("sticky");
    await expect(getComputedStyle(headers[11]!).position).toBe("sticky");

    const row = within(table).getAllByRole("row")[1]!;
    const cells = within(row).getAllByRole("cell");
    const resting = getComputedStyle(cells[11]!).backgroundColor;
    row.setAttribute("data-hover", "");
    await waitFor(() => expect(getComputedStyle(cells[11]!).backgroundColor).not.toBe(resting));
    await expect(getComputedStyle(cells[11]!).backgroundColor).toBe(getComputedStyle(cells[5]!).backgroundColor);
    await expect(getComputedStyle(cells[0]!).backgroundColor).toBe(getComputedStyle(cells[5]!).backgroundColor);
  },
};

// Daily, newest first, every day a row — today's is quiet and still carries the balance.
export const DailyNewestFirst: Story = {
  name: "Daily, newest first",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const rows = within(canvas.getByTestId("account-report-series")).getAllByRole("row");
    await expect(rows).toHaveLength(1 + 20);
    await expect(rows[1]).toHaveTextContent(rp(16_443_500));
    await expect(canvas.getByTestId("account-report-pager")).toBeVisible();
  },
};

// SORTED FROM THE HEADING (`a-table-sorts-from-its-headings`) — newest first, flipped from Periode by the server.
export const SortsFromItsHeading: Story = {
  name: "Sort from heading",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const byPeriod = canvas.getByTestId("account-report-sort-period");
    await expect(byPeriod).toHaveAttribute("data-sort", "desc");
    const firstBefore = within(canvas.getByTestId("account-report-series")).getAllByRole("row")[1]!.textContent;
    await userEvent.click(byPeriod);
    await expect(byPeriod).toHaveAttribute("data-sort", "asc");
    await waitFor(() =>
      expect(within(canvas.getByTestId("account-report-series")).getAllByRole("row")[1]!.textContent).not.toBe(firstBefore),
    );
  },
};

// A PHONE'S PERIOD LISTS ONE TYPE A LINE (a-phone-period-lists-a-type-a-line) — a badge and its amount together, each
// type on a line of its own; wrapped side by side, an amount could land on the next line away from its badge.
export const MobilePeriodListsATypeALine: Story = {
  name: "Phone · a type a line",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const lists = await canvas.findAllByTestId(/^account-report-series-types-/);
    const busy = lists.find((l) => l.children.length > 1)!;
    const tops = [...busy.children].map((c) => c.getBoundingClientRect().top);
    await expect(new Set(tops).size).toBe(tops.length);
  },
};
