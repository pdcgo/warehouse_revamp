import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { lastRackWrite, rackShelf } from "../../../../.storybook/rackStub";
import { At42, RACK_DETAIL_META, openSample, stock, type } from "./kit";

// RACK DETAIL — Record Sample: what it takes, who received it, and a counted product it cannot take. The page's stories
// are grouped by the part of the screen they are about (stories-are-grouped-by-the-part-of-the-screen); what they share is
// ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Racks/RackDetail/Sample",
  ...RACK_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// A SAMPLE (a-sample-is-handed-over-at-the-warehouse): staff take it off this rack — never chosen
// (a-sample-names-the-rack-it-was-taken-from) — and say who received it. It lands in the rack's Riwayat, which is on the
// same page (a-rack-page-is-one-page-of-sections).
export const RecordSample: Story = {
  name: "Record sample",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openSample();
    // ON A DESKTOP IT IS A DIALOG, NOT A SHEET — as tall as its lines, never held to the window's height (full screen
    // is the phone's, by the JS breakpoint; a responsive `size` once kept full's min-height here).
    await waitFor(() => {
      const box = screen.getByTestId("record-sample-dialog");
      expect(box.getBoundingClientRect().height).toBeLessThan(window.innerHeight * 0.95);
      expect(parseFloat(getComputedStyle(box).minHeight) || 0).toBeLessThan(window.innerHeight * 0.5);
    });

    await expect(screen.getByTestId("sample-final")).toHaveTextContent(/final/i);
    await type(await screen.findByTestId("sample-qty-71"), "2");
    await expect(screen.getByTestId("sample-submit")).toBeDisabled();

    await type(screen.getByTestId("sample-recipient"), "Pak Budi");
    await userEvent.click(screen.getByTestId("sample-submit"));

    await waitFor(() => expect(screen.queryByTestId("record-sample-dialog")).toBeNull());
    await expect(rackShelf(41n, 71n)).toBe(10n);
    await expect(lastRackWrite()).toMatchObject({ kind: "sample" });
    await expect(lastRackWrite()?.transactions.map((t) => t.teamId)).toEqual([11n]);

    await waitFor(() => expect(stock(canvas).getByTestId("rack-stock-onhand-71")).toHaveTextContent("10"));
    await waitFor(() => expect(canvas.getByTestId("rack-history-table")).toHaveTextContent(/sample/i));
  },
};

// A sample cannot take a product a count is holding, either.
export const ASampleOfACountedProductIsLocked: Story = {
  name: "Sample of a counted product",
  render: () => <At42 />,
  play: async () => {
    await openSample();

    await expect(await screen.findByTestId("sample-counting-72")).toHaveTextContent(/being counted/i);
    await expect(screen.queryByTestId("sample-qty-72")).toBeNull();
  },
};
