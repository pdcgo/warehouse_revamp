import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { A_01_1, A_01_2, ACCEPT_META, B_02_1, COFFEE, RICE, count, countWhole, expectAccept, lineOf, place, typeInto } from "./kit";

// RESTOCK ACCEPT — a line's third column: the good units onto placements, adding up to exactly what is good.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockAccept/PutAway",
  ...ACCEPT_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * PUT-AWAY WAITS FOR THE COUNT (owner: *"disabled penempatan jika diterima belum di set, maksimalnya ikut ke diterima"*,
 * putaway-waits-for-the-count) — before Diterima, the panel's picker, count and buttons are off; once it is set they
 * open, and a good row holds at most what Diterima leaves good: 12 received, 2 broken — 10, so 20 typed settles on 10.
 */
export const PutAwayWaitsForTheCount: Story = {
  name: "Locked until counted",
  play: async ({ canvasElement }) => {
    const id = COFFEE.productId;
    const line = await lineOf(canvasElement, id);

    const picker = within(line.getByTestId(`accept-placement-${id}-0`)).getByTestId("rack-select");
    const qty = line.getByTestId(`accept-placement-qty-${id}-0`);
    await expect(picker).toBeDisabled();
    await expect(qty).toBeDisabled();
    await expect(line.getByTestId(`accept-add-placement-${id}`)).toBeDisabled();

    await count(canvasElement, id, "12", "2");
    await waitFor(() => expect(picker).toBeEnabled());
    await expect(qty).toBeEnabled();
    await expect(line.getByTestId(`accept-add-placement-${id}`)).toBeEnabled();

    // At most what is good — the box clamps back as it is left.
    await typeInto(qty, "20");
    await userEvent.tab();
    await waitFor(() => expect(qty).toHaveValue("10"));
  },
};

/**
 * there-is-no-unplaced-pile — every good unit goes onto a placement, and the placements hold EXACTLY received −
 * broken. 12 with 2 broken is 10 good: 6 on one placement leaves 4 to place, and Accept waits for them.
 */
export const GoodUnitsMustBeFullyPlaced: Story = {
  name: "Every good unit placed, a rack once",
  play: async ({ canvasElement }) => {
    const id = COFFEE.productId;
    await count(canvasElement, id, "12", "2");
    await countWhole(canvasElement, RICE.productId, A_01_2);
    const line = await lineOf(canvasElement, id);

    // Counted, nothing placed yet — and the ready line names this line's placement as what Terima waits for.
    await expect(line.getByTestId(`accept-good-${id}`)).toHaveTextContent("10");
    // 2 × the landed price 34.215,69, filled by the system.
    await expect(line.getByTestId(`accept-broken-value-${id}`)).toHaveTextContent("68.431");
    await expect(line.getByTestId(`accept-unbalanced-${id}`)).toBeInTheDocument();
    await expect(within(canvasElement).getByTestId(`accept-ready-line-missing-line-${id}`)).toHaveTextContent(
      "placement · Kopi Arabika 250g",
    );
    await expectAccept(canvasElement, false);

    // There is no "unplaced" choice in the picker.
    const field = within(line.getByTestId(`accept-placement-${id}-0`));
    await userEvent.click(field.getByTestId("rack-select"));
    // The real options render first, so the unplaced pile's absence is not just the list still loading.
    await field.findByTestId(`rack-select-option-${A_01_1}`);
    await expect(field.queryByTestId("rack-select-option-unplaced")).toBeNull();
    await userEvent.keyboard("{Escape}");

    // 6 onto A-01-1 — 4 still to place.
    await place(canvasElement, id, 0, A_01_1);
    await typeInto(line.getByTestId(`accept-placement-qty-${id}-0`), "6");
    await waitFor(() => expect(line.getByTestId(`accept-unbalanced-${id}`)).toHaveTextContent("4"));
    await expectAccept(canvasElement, false);

    // The other 4 onto another rack — the second row's picker shows A-01-1, which the first row holds, DISABLED
    // (one-rack-once-per-line): a line names a rack once.
    await userEvent.click(line.getByTestId(`accept-add-placement-${id}`));
    const second = within(line.getByTestId(`accept-placement-${id}-1`));
    await userEvent.click(second.getByTestId("rack-select"));
    const held = await second.findByTestId(`rack-select-option-${A_01_1}`);
    await waitFor(() => expect(held).toBeVisible());
    await expect(held).toHaveAttribute("data-disabled");
    await userEvent.keyboard("{Escape}");
    await place(canvasElement, id, 1, B_02_1);
    await typeInto(line.getByTestId(`accept-placement-qty-${id}-1`), "4");
    await waitFor(() => expect(line.getByTestId(`accept-balanced-${id}`)).toBeInTheDocument());
    await expectAccept(canvasElement, true);
  },
};
