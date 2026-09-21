import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { SegmentedRadio, description, type SegmentedRadioProps } from "./SegmentedRadio";

type Grain = "day" | "week" | "month";

const ITEMS = [
  { value: "day" as Grain, label: "Day" },
  { value: "week" as Grain, label: "Week" },
  { value: "month" as Grain, label: "Month" },
];

// Named prop type, not `typeof SegmentedRadio` — see the note in RadioGroup.stories.tsx.
const meta: Meta<SegmentedRadioProps<Grain>> = {
  title: "Legacy/Components/Inputs/SegmentedRadio",
  component: SegmentedRadio,
  parameters: { docs: { description: { component: description } } },
  args: { items: ITEMS, value: "week" as Grain },
};

export default meta;
type Story = StoryObj<SegmentedRadioProps<Grain>>;

// The shape it is for: two to four short options that read as a VIEW, sitting in a toolbar where a
// stack of radio buttons would not fit.
export const PickingAView: Story = {
  render: (args) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [value, setValue] = useState<Grain>("week");
    return <SegmentedRadio<Grain> {...args} value={value} onChange={setValue} />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("segment-month"));
    await expect(canvas.getByTestId("segment-month")).toHaveAttribute("data-state", "checked");
  },
};

// It is a real radio group underneath — same semantics, same keyboard behaviour — not a row of
// buttons that happen to look joined.
export const IsARealRadioGroup: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getAllByRole("radio")).toHaveLength(3);
  },
};

export const Disabled: Story = { args: { disabled: true } };
