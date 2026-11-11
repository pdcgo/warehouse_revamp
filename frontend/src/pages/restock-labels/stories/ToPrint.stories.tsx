import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { restockRequestService } from "../../../../.storybook/restockStub";
import { At503And502, LABELS_META, printedLabels, sheet, typeMeasure } from "./kit";

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

/**
 * A COUNT FOLLOWS ITS LABEL, NOT ITS PLACE (owner: *"oke, no. 1 semuanya"*, a-label-count-follows-its-label) — 502 is at
 * the door: its coffee, 12 ordered, is typed down to 3. Then the warehouse counts 502 in (coffee on A-01-1) and it is
 * read again: the coffee's label is now a batch on a placement — a different label — so it starts from its own 12, not
 * from the 3 typed for the uncounted one that sat in the same place.
 */
export const ACountFollowsItsLabel: Story = {
  name: "Count follows its label",
  render: () => <At503And502 />,
  play: async ({ canvasElement }) => {
    const canvas = await sheet(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("labels-restock-502-count")).toHaveTextContent("17 labels"));

    // 503's three labels, then 502's coffee — the fourth.
    await expect(canvas.getByTestId("labels-item-3-where")).toHaveTextContent("Ordered 12 pcs");
    await typeMeasure(canvas.getByTestId("labels-count-3"), "3");
    await waitFor(() => expect(canvas.getByTestId("labels-restock-502-count")).toHaveTextContent("8 labels"));

    // The box is counted in, elsewhere.
    await restockRequestService.restockRequestAccept!(
      {
        teamId: 11n,
        requestId: 502n,
        lines: [
          { itemId: 5021n, receivedCount: 12n, brokenCount: 0n, placements: [{ placementId: 41n, quantity: 12n }] },
          { itemId: 5022n, receivedCount: 5n, brokenCount: 0n, placements: [{ placementId: 42n, quantity: 5n }] },
        ],
        warehouseAdditionalCost: 0,
        warehouseAdditionalCostNote: "",
      } as never,
      {} as never,
    );

    // Read again — taken off and put back on.
    await userEvent.click(canvas.getByTestId("labels-restock-502-remove"));
    await waitFor(() => expect(canvas.queryByTestId("labels-restock-502")).toBeNull());
    await userEvent.click(canvas.getByRole("combobox", { name: "Add a restock" }));
    const option = await screen.findByTestId("labels-add-restock-option-502", {}, { timeout: 4000 });
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await waitFor(() => expect(canvas.getByTestId("labels-item-3-where")).toHaveTextContent("A-01-1"), { timeout: 4000 });
    await expect(canvas.getByTestId("labels-count-3")).toHaveValue("12");
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
