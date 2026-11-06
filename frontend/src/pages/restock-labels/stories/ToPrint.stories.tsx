import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { LABELS_META, printedLabels, sheet, typeMeasure } from "./kit";

// RESTOCK LABELS — Yang Dicetak: each label once with its count, typed over, and what was left out
// (the-print-list-is-each-label-and-its-count). The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockLabels/ToPrint",
  ...LABELS_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// there-is-no-unplaced-pile — one label per placement, each with its placement code; no holding pile. Per placement,
// each count starts at 1: three labels to print.
export const EveryLabelHasAPlacement: Story = {
  name: "Every label placed",
  play: async ({ canvasElement }) => {
    const canvas = await sheet(canvasElement);
    const list = within(canvas.getByTestId("labels-sheet"));

    await expect(list.getAllByTestId("label-placement").map((el) => el.textContent)).toEqual(["A-01-1", "B-02-1", "A-01-2"]);
    await userEvent.click(within(canvas.getByTestId("labels-mode")).getByText("Shelf"));
    await waitFor(() => expect(canvas.getByTestId("labels-to-print-total")).toHaveTextContent("3 labels of 3 kinds"));
  },
};

/**
 * PRATINJAU ON TOP, THEN WHAT PRINTS (owner: *"kasih pratinjau di atas qrcodenya dan jumlahnya, bisa diedit jumlahnya,
 * semua qrcode yang sekarang bukan pratinjau jadi yang di print"*, the-print-list-is-each-label-and-its-count) — one
 * paper to look at; under it each label once, with its count: the rice on A-01-1 is 5 pieces, typed down to 2, so 24
 * labels print, and the printed run follows. Per placement starts every count over at 1.
 */
export const EditTheCount: Story = {
  name: "Edit the count",
  play: async ({ canvasElement }) => {
    const canvas = await sheet(canvasElement);

    // The preview comes first — one paper.
    await expect(
      canvas.getByTestId("labels-preview").compareDocumentPosition(canvas.getByTestId("labels-to-print")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await expect(within(canvas.getByTestId("labels-preview")).getAllByTestId("label-sku")).toHaveLength(1);

    // Each label once, its count from its units on the rack.
    await expect(canvas.getByTestId("labels-count-0")).toHaveValue("5");
    await expect(canvas.getByTestId("labels-to-print-total")).toHaveTextContent("27 labels of 3 kinds");
    await expect(printedLabels()).toBe(27);

    await typeMeasure(canvas.getByTestId("labels-count-0"), "2");
    await waitFor(() => expect(canvas.getByTestId("labels-to-print-total")).toHaveTextContent("24 labels of 3 kinds"));
    await expect(printedLabels()).toBe(24);
    await expect(canvas.getByTestId("labels-run")).toHaveTextContent("labels 1–24 of 24");

    // Per placement — every count back to 1.
    await userEvent.click(within(canvas.getByTestId("labels-mode")).getByText("Shelf"));
    await waitFor(() => expect(canvas.getByTestId("labels-count-0")).toHaveValue("1"));
    await expect(printedLabels()).toBe(3);
  },
};

// Broken and missing units never became stock, so they get no label — and the page says how many were left out.
export const BrokenAndMissingGetNoLabel: Story = {
  name: "Broken and missing, no label",
  play: async ({ canvasElement }) => {
    const canvas = await sheet(canvasElement);

    await expect(canvas.getByTestId("labels-excluded")).toHaveTextContent("3 units arrived broken or missing");
  },
};
