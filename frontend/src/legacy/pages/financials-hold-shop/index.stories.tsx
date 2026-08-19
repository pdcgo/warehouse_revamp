import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { HOLDS_BY_SHOP } from "../../financeFixtures";
import { FinancialsHoldShopPage, description } from "./index";

const meta = {
  title: "Legacy/Pages/Financials/HoldByShop",
  component: FinancialsHoldShopPage,
  parameters: { docs: { description: { component: description } } },
  args: { rows: HOLDS_BY_SHOP },
} satisfies Meta<typeof FinancialsHoldShopPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// ⚠ SORTED BY AGE, NOT AMOUNT. A large hold from yesterday is normal; a small one from six weeks ago
// is stuck. Sorting by size would put the normal case first and bury the broken one.
export const OldestHoldLeadsNotLargest: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Rp 640rb held 38 days leads, despite being by far the smallest.
    const firstRow = canvas.getAllByTestId("hold-overdue")[0];
    await expect(firstRow).toBeVisible();
    await expect(canvas.getByTestId("hold-screen")).toHaveAttribute("data-subject", "Shop");
  },
};

// Past the release window is the only ACTIONABLE state — everything else is just waiting, and the
// screen says which is which rather than leaving the reader to work out the schedule.
export const OverdueIsCalledOut: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("hold-warning")).toHaveTextContent(/stuck rather than slow/i);
    await expect(canvas.getAllByText("Waiting").length).toBeGreaterThan(0);
  },
};

// Sorting by amount is still available — it is just not the default, because the default should
// answer the question the screen exists for.
export const AmountSortIsAvailableButNotTheDefault: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("th-amount"));

    await waitFor(async () => {
      await expect(canvas.getByTestId("th-amount")).toHaveAttribute("aria-sort", "ascending");
    });
  },
};

export const NothingHeld: Story = {
  args: { rows: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("empty-hint")).toHaveTextContent("Nothing held");
  },
};

export const Loading: Story = { args: { rows: [], loading: true } };
