import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { RefIdBadge, description } from "./RefIdBadge";

const meta = {
  title: "Legacy/Components/Badges/RefIdBadge",
  component: RefIdBadge,
  parameters: { docs: { description: { component: description } } },
  args: { refId: "SKU-8842-BLK-L" },
} satisfies Meta<typeof RefIdBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("refid-badge")).toHaveTextContent("SKU-8842-BLK-L");
  },
};

// RULE 1: no ref id, NO badge. An empty chip in a table cell reads as "this product's SKU is
// unknown" when the truth is that it has none.
export const NoRefId: Story = {
  args: { refId: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("refid-badge")).toBeNull();
  },
};

// RULE 2: the click must NOT reach the row. Product rows are links, and copying a SKU must never
// also navigate away from the table you were scanning.
export const ClickDoesNotBubble: Story = {
  render: (args) => (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div data-testid="row" onClick={() => { (window as unknown as { __rowClicked?: boolean }).__rowClicked = true; }}>
      <RefIdBadge {...args} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    (window as unknown as { __rowClicked?: boolean }).__rowClicked = false;

    await userEvent.click(canvas.getByTestId("refid-badge"));

    await expect((window as unknown as { __rowClicked?: boolean }).__rowClicked).toBe(false);
  },
};
