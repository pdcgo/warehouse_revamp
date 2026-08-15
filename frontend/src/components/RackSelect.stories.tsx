import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { racks } from "../../.storybook/fixtures";
import { RackSelect, UNPLACED, description } from "./RackSelect";

const meta = {
  title: "Components/RackSelect",
  component: RackSelect,
  parameters: {
    docs: { description: { component: description } },
  },
  args: {
    // The fixture warehouse — its racks come back from the stubbed RackList.
    warehouseId: 11n,
    value: "",
    onChange: fn(),
  },
} satisfies Meta<typeof RackSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Unanswered: Story = {};

export const RackSelected: Story = {
  args: { value: racks[0]!.id.toString() },
};

export const Unplaced: Story = {
  args: { value: UNPLACED },
};

export const Disabled: Story = {
  args: { value: racks[0]!.id.toString(), disabled: true },
};

// The rule this picker exists to enforce (#136/#139), and the one a fresh `<select>` always gets
// wrong: "Unplaced" is a PLACE — a real pile that can be counted — so it must be PICKABLE. Only
// "not answered yet" is the placeholder.
export const UnplacedIsSelectable: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("rack-select"));

    // Inline, not portalled — this picker renders its listbox in place so it still works inside a
    // modal Dialog. If that ever changes, this query is where it will be noticed.
    const unplaced = await canvas.findByTestId(`rack-select-option-${UNPLACED}`);
    await userEvent.click(unplaced);

    await expect(args.onChange).toHaveBeenCalledWith(UNPLACED);
  },
};

// Proves the component actually reads RackList: the options below are the stub's rows, in the aisle
// order the server sent, not anything this story typed in.
export const ListsTheWarehousesRacks: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("rack-select"));

    const first = await canvas.findByTestId(`rack-select-option-${racks[0]!.id}`);
    await expect(first).toHaveTextContent(racks[0]!.code);

    await userEvent.click(first);

    await expect(args.onChange).toHaveBeenCalledWith(racks[0]!.id.toString());
  },
};

// Picking has to survive the round trip — the caller stores the string and hands it straight back.
export const Interactive: Story = {
  render: (args) => {
    const [value, setValue] = useState("");

    return <RackSelect {...args} value={value} onChange={setValue} />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("rack-select"));
    await userEvent.click(await canvas.findByTestId(`rack-select-option-${racks[2]!.id}`));

    await expect(canvas.getByTestId("rack-select")).toHaveTextContent(racks[2]!.code);
  },
};
