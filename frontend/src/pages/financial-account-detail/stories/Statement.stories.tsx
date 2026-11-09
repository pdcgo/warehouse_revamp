import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { expectedBalance } from "../../../../.storybook/financialAccountFixtures";
import { ACCOUNT_DETAIL_META, firstRow, loaded, rp } from "./kit";

// ACCOUNT DETAIL — the statement's rows — the balance explained, a row lighting up, which way in, a phone's row. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/FinancialAccount/Account/Statement",
  ...ACCOUNT_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// MOBILE STATEMENT (owner, `a-phone-statement-row-opens-its-detail`, `the-type-sits-under-the-date-on-a-phone`) — the
// headings stay, Tanggal · Saldo; the type right under the date, the change right under the balance; no description
// on the row — a tap opens it, with who and when it was typed.
export const MobileStatementRowOpensItsDetail: Story = {
  name: "Phone · row opens detail",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1301"]!);

    const log = canvas.getByTestId("account-log-table");
    await expect(within(log).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Date", "Balance"]);

    const row = canvas.getByTestId("account-log-row-1428");
    await expect(row).not.toHaveTextContent("Reconcile");
    const [left, right] = within(row).getAllByRole("cell");

    // The type sits right under the date, on the same left edge. The stub dates its rows from TODAY, so the date is read
    // as a date — a year in it — never as a month that stops being true when the calendar turns.
    const [date, type] = Array.from(left!.firstElementChild!.children);
    await expect(date).toHaveTextContent(/\b20\d\d\b/);
    await expect(type).toHaveTextContent("Adjustment");
    const d = date!.getBoundingClientRect();
    const ty = type!.getBoundingClientRect();
    await expect(ty.top).toBeGreaterThanOrEqual(d.bottom - 1);
    await expect(Math.abs(ty.left - d.left)).toBeLessThan(2);

    // The change sits right under the balance, on the same right edge.
    const [balance, change] = Array.from(right!.firstElementChild!.children);
    await expect(balance).toHaveTextContent(rp(11_443_500));
    await expect(change).toHaveTextContent(`−${rp(6_500)}`);
    const b = balance!.getBoundingClientRect();
    const c = change!.getBoundingClientRect();
    await expect(c.top).toBeGreaterThanOrEqual(b.bottom - 1);
    await expect(Math.abs(c.right - b.right)).toBeLessThan(2);

    // A tap opens the whole row.
    await userEvent.click(row);
    const detail = await screen.findByTestId("account-log-detail");
    await waitFor(() => expect(detail).toBeVisible());
    await expect(within(detail).getByTestId("account-log-detail-description")).toHaveTextContent("Reconcile — the app showed");
    await expect(within(detail).getByTestId("account-log-detail-way")).toHaveTextContent("by hand · Ani Rahayu");
    await expect(within(detail).getByTestId("account-log-detail-balance")).toHaveTextContent(rp(11_443_500));
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("account-log-detail")).toBeNull());
  },
};

// the-log-says-balance-after: newest first, and the top row's balance after IS the balance.
export const TheStatementExplainsTheBalance: Story = {
  name: "Explains the balance",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1301"]!);

    const top = firstRow(canvas);
    await expect(top).toHaveTextContent("Adjustment");
    await expect(top).toHaveTextContent(`−${rp(6_500)}`);
    await expect(top).toHaveTextContent(rp(11_443_500));
    await expect(canvas.getByTestId("account-detail-checked")).toHaveTextContent("yesterday");
  },
};

// A statement row lights up under the pointer, every cell of it (owner: *"hoverable juga"*, `a-statement-row-lights-up`);
// the last column reads Saldo (owner: *"saldo setelah jadi saldo saja"*).
//
// ⚠ HOVER IS DRIVEN BY `data-hover`, which Chakra's `_hover` honours — a synthetic pointer event sets no CSS `:hover`.
export const AStatementRowLightsUp: Story = {
  name: "Row lights up",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1301"]!);

    const headers = within(canvas.getByTestId("account-log-table")).getAllByRole("columnheader");
    await expect(headers.at(-1)).toHaveTextContent(/^Balance$/);

    const row = firstRow(canvas);
    const cells = within(row).getAllByRole("cell");
    const resting = getComputedStyle(cells[0]!).backgroundColor;
    row.setAttribute("data-hover", "");
    await waitFor(() => expect(getComputedStyle(cells[0]!).backgroundColor).not.toBe(resting));
    await expect(getComputedStyle(cells[4]!).backgroundColor).toBe(getComputedStyle(cells[0]!).backgroundColor);
  },
};

// one-way-in-per-type: each row says which way it came in — a listener's row is not corrected here.
export const EachRowSaysWhichWayItCameIn: Story = {
  name: "Which way in",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1301"]!);

    await expect(canvas.getByTestId("account-log-way-1425")).toHaveTextContent("automatic");
    // A listener writes the shop by id; the statement shows its name.
    await expect(canvas.getByTestId("account-log-row-1425")).toHaveTextContent("Withdrawal from Melati Official");
    await expect(canvas.getByTestId("account-log-way-1427")).toHaveTextContent("by hand · Ani Rahayu");
  },
};
