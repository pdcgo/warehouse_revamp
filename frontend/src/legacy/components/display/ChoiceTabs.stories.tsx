import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "@chakra-ui/react";
import { expect, userEvent, within } from "storybook/test";

import { ChoiceTabs, description } from "./ChoiceTabs";

type Status = "all" | "unpaid" | "paid";

const ITEMS = [
  { value: "all" as Status, name: "All" },
  { value: "unpaid" as Status, name: "Unpaid", badge: <Badge size="sm">12</Badge> },
  { value: "paid" as Status, name: "Paid" },
];

const meta = {
  title: "Legacy/Components/Display/ChoiceTabs",
  component: ChoiceTabs,
  parameters: { docs: { description: { component: description } } },
  args: { items: ITEMS, value: "all" as Status },
} satisfies Meta<typeof ChoiceTabs<Status>>;

export default meta;
type Story = StoryObj<typeof meta>;

function Harness(props: { clearable?: boolean }) {
  const [value, setValue] = useState<Status | undefined>("all");

  return (
    <>
      <ChoiceTabs items={ITEMS} value={value} onChange={setValue} clearable={props.clearable} />
      <span data-testid="value">{value ?? "none"}</span>
    </>
  );
}

export const Picking: Story = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("choice-tab-unpaid"));
    await expect(canvas.getByTestId("value")).toHaveTextContent("unpaid");
  },
};

// Clicking the ACTIVE tab does nothing when not clearable. Re-emitting the value it already has
// would make every list on the screen refetch for no change.
export const ClickingTheActiveTabIsANoOp: Story = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("choice-tab-all"));
    await expect(canvas.getByTestId("value")).toHaveTextContent("all");
  },
};

// Clearable lets the filter be turned OFF — which is coherent for a filter and meaningless for
// navigation, and is one of the reasons this is a separate component from NavTabs.
export const ClearableTurnsTheFilterOff: Story = {
  render: () => <Harness clearable />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("choice-tab-all"));
    await expect(canvas.getByTestId("value")).toHaveTextContent("none");
  },
};

// The selected tab is announced via aria-pressed, not only by its fill.
export const SelectionIsAnnounced: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("choice-tab-all")).toHaveAttribute("aria-pressed", "true");
    await expect(canvas.getByTestId("choice-tab-paid")).toHaveAttribute("aria-pressed", "false");
  },
};
