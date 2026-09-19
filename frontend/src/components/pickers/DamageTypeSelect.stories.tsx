import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { RestockDamageType } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { DAMAGE_TYPES, DamageTypeSelect, description } from "./DamageTypeSelect";

const meta = {
  title: "Components/Pickers/DamageTypeSelect",
  component: DamageTypeSelect,
  parameters: {
    docs: { description: { component: description } },
  },
  args: { value: RestockDamageType.BROKEN, onChange: fn() },
} satisfies Meta<typeof DamageTypeSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Broken: Story = {};

export const Lost: Story = { args: { value: RestockDamageType.LOST } };

export const Disabled: Story = { args: { disabled: true } };

// The two are a DELIBERATE PAIR, not a severity scale: "how much did they send us broken" and "how
// much did they short us" are different questions a supplier report keeps apart. Neither is the
// other's lesser case, and both are excluded from stock entirely.
export const OffersExactlyTwoAnswers: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("damage-type-select"));

    // Inline, not portalled — the accept screen can render this inside a modal Dialog.
    for (const type of DAMAGE_TYPES) {
      await expect(await canvas.findByTestId(`damage-type-option-${type}`)).toBeInTheDocument();
    }

    // No "none": the proto refuses type 0, and the person at the door always knows which it was.
    await expect(canvas.queryByTestId(`damage-type-option-${RestockDamageType.UNSPECIFIED}`)).toBeNull();
  },
};

export const EmitsTheEnum: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("damage-type-select"));
    await userEvent.click(await canvas.findByTestId(`damage-type-option-${RestockDamageType.LOST}`));

    await expect(args.onChange).toHaveBeenCalledWith(RestockDamageType.LOST);
  },
};

export const Interactive: Story = {
  render: (args) => {
    const [value, setValue] = useState(RestockDamageType.BROKEN);

    return <DamageTypeSelect {...args} value={value} onChange={setValue} />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("damage-type-select"));
    await userEvent.click(await canvas.findByTestId(`damage-type-option-${RestockDamageType.LOST}`));

    await expect(canvas.getByTestId("damage-type-select")).toHaveTextContent(/lost|hilang/i);
  },
};
