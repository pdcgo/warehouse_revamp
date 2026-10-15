import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { type FigureRangePicks, NO_FIGURE_RANGES, SupplierRangeFilters, description } from "./SupplierRangeFilter";

// TERJUAL AND SIAP AS RANGE PILLS, A PANEL EACH — on the supplier list and on Discover alike
// (the-figure-filters-are-two-panels, discover-shows-the-same-figures-and-filters).

function Pair() {
  const [picks, setPicks] = useState<FigureRangePicks>(NO_FIGURE_RANGES);
  return <SupplierRangeFilters value={picks} onChange={setPicks} />;
}

const meta = {
  title: "Features/Suppliers/SupplierRangeFilter",
  component: Pair,
  parameters: { docs: { description: { component: description } } },
} satisfies Meta<typeof Pair>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Two triggers, each with its mark; its own narrow panel; a pick closes it and the trigger reads the band. */
export const TwoPanels: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByTestId("supplier-range-sold-trigger");
    await expect(within(canvas.getByTestId("supplier-range-sold")).getByTestId("not-implemented-soldRange")).toBeVisible();

    await userEvent.click(trigger);
    const panel = await screen.findByTestId("supplier-range-sold-panel");
    await waitFor(() => expect(panel).toBeVisible());
    await expect(panel.getBoundingClientRect().width).toBeLessThanOrEqual(320);

    await userEvent.click(within(panel).getByRole("button", { name: "≥ 5.000" }));
    await waitFor(() => expect(panel).not.toBeVisible());
    await expect(trigger).toHaveTextContent("Sold: ≥ 5.000");
    await expect(canvas.getByTestId("supplier-range-ready-trigger")).toHaveTextContent(/^Ready$/);
  },
};

/** A picked band carries an × attached to its trigger — it clears back to Semua without opening the panel
 * (every-filter-clears-from-its-own-x). Nothing picked, no ×. */
export const AnXClearsIt: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByTestId("supplier-range-sold-trigger");
    await expect(canvas.queryByTestId("supplier-range-sold-clear")).toBeNull();

    await userEvent.click(trigger);
    const panel = await screen.findByTestId("supplier-range-sold-panel");
    await waitFor(() => expect(panel).toBeVisible());
    await userEvent.click(within(panel).getByRole("button", { name: "≥ 5.000" }));
    await waitFor(() => expect(panel).not.toBeVisible());

    const clear = canvas.getByTestId("supplier-range-sold-clear");
    await expect(clear).toHaveAccessibleName("Clear Sold");
    await userEvent.click(clear);
    await expect(trigger).toHaveTextContent(/^Sold$/);
    await expect(canvas.queryByTestId("supplier-range-sold-clear")).toBeNull();
    await expect(screen.queryByTestId("supplier-range-sold-panel")).not.toBeVisible();
  },
};

/** On a phone each is a label over its pills — the Filter sheet holds them, so no panel inside a panel. */
export const OnAPhone: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByTestId("supplier-range-sold-trigger")).toBeNull();
    const ready = canvas.getByTestId("supplier-range-ready");
    await userEvent.click(within(ready).getByRole("button", { name: "< 50" }));
    await expect(within(ready).getByRole("button", { name: "< 50" })).toHaveAttribute("aria-pressed", "true");
  },
};
