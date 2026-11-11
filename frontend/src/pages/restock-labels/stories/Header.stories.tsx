import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, waitFor } from "storybook/test";

import { FromTheList, LABELS_META, sheet, typeMeasure } from "./kit";

// RESTOCK LABELS — the title's row: back to where the page was opened, and Cetak, which Ctrl+P is too. The page's stories
// are grouped by the part of the screen they are about (stories-are-grouped-by-the-part-of-the-screen); what they share
// is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockLabels/Header",
  ...LABELS_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * CTRL+P IS OUR PRINT (owner: *"detect ctrl+P jadi cetak kita"*, ctrl-p-prints-the-labels) — the shortcut does what
 * Cetak does: the run's papers, through the print dialog. With every count at 0 there is nothing to print, and it says
 * so instead of sending a blank page.
 */
export const CtrlPPrintsTheLabels: Story = {
  name: "Ctrl+P prints",
  play: async ({ canvasElement }) => {
    const canvas = await sheet(canvasElement);
    const original = window.print;
    const print = fn();
    window.print = print;

    try {
      await expect(canvas.getByTestId("labels-print")).toHaveAttribute("title", "Print (Ctrl+P)");
      await userEvent.keyboard("{Control>}p{/Control}");
      await expect(print).toHaveBeenCalledTimes(1);

      // Every count to 0 — nothing to print: said, not printed.
      for (const i of [0, 1, 2]) await typeMeasure(canvas.getByTestId(`labels-count-${i}`), "0");
      await waitFor(() => expect(canvas.getByTestId("labels-to-print-total")).toHaveTextContent("0 labels of 3 kinds"));
      await userEvent.keyboard("{Control>}p{/Control}");
      await expect(await screen.findByText("No labels to print — every count is 0.")).toBeInTheDocument();
      await expect(print).toHaveBeenCalledTimes(1);
    } finally {
      window.print = original;
    }
  },
};

// OPENED FROM THE LIST, BACK TO THE LIST (a-form-returns-where-it-was-opened) — the list with its filter.
export const FromTheListBackGoesToTheList: Story = {
  name: "From the list · back",
  render: () => <FromTheList />,
  play: async ({ canvasElement }) => {
    const canvas = await sheet(canvasElement);

    await userEvent.click(canvas.getByTestId("labels-back"));
    await canvas.findByTestId("at-restock-list");
  },
};
