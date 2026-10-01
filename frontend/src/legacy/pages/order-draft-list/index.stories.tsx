import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { ORDERS } from "../../fixtures";
import { OrderDraftListPage, description } from "./index";

const DRAFTS = ORDERS.slice(0, 3).map((o) => ({ ...o, status: "draft" as const }));

const meta = {
  title: "Legacy/Pages/Orders/OrderDraftList",
  component: OrderDraftListPage,
  parameters: { docs: { description: { component: description } } },
  args: { drafts: DRAFTS },
} satisfies Meta<typeof OrderDraftListPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// THE column that makes this screen worth having: what is missing, on the row. Without it the
// operator opens every draft just to find out why it is one.
export const SaysWhatIsMissingOnTheRow: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("What is missing")).toBeVisible();
    await expect(canvas.getAllByText(/no courier|unmatched product/i).length).toBeGreaterThan(0);
  },
};

// Only two actions — there is nothing else you can usefully do to a record that is missing the very
// fields the other order actions operate on. Two, so they stay INLINE rather than behind a kebab.
export const OnlyFinishAndDiscard: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getAllByTestId("action-cell")[0]).toHaveAttribute("data-mode", "inline");
    await expect(canvas.getAllByTestId("action-Finish").length).toBeGreaterThan(0);
  },
};

// An empty draft pile is GOOD news, and the copy says so rather than reading as a failure to load.
export const Empty: Story = {
  args: { drafts: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("empty-hint")).toHaveTextContent("No drafts");
  },
};

export const Loading: Story = { args: { drafts: [], loading: true } };
