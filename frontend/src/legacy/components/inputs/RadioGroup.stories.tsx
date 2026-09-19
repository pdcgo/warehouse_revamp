import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { PackageCheck, PackageX, Scale } from "lucide-react";
import { expect, userEvent, within } from "storybook/test";

import { RadioGroup, description, type RadioGroupProps } from "./RadioGroup";

type Adjustment = "recount" | "damage" | "shrinkage";

const ITEMS = [
  {
    value: "recount" as Adjustment,
    label: "Recount",
    icon: Scale,
    description: "The shelf was counted again and the number was wrong. No stock moved.",
  },
  {
    value: "damage" as Adjustment,
    label: "Damage",
    icon: PackageX,
    description: "The item exists but cannot be sold. It leaves sellable stock.",
  },
  {
    value: "shrinkage" as Adjustment,
    label: "Shrinkage",
    icon: PackageCheck,
    description: "The item is gone and nobody knows where. Written off.",
  },
];

// Named prop type rather than `typeof RadioGroup`: inferring from a GENERIC component collapses T
// to `string`, which then rejects the typed onChange the stories pass. Same reason as DataTable.
const meta: Meta<RadioGroupProps<Adjustment>> = {
  title: "Legacy/Components/Inputs/RadioGroup",
  component: RadioGroup,
  parameters: { docs: { description: { component: description } } },
  args: { items: ITEMS, value: "recount" as Adjustment },
};

export default meta;
type Story = StoryObj<RadioGroupProps<Adjustment>>;

// THE case for a radio group over a Select: three options where choosing wrongly produces an
// incorrect stock record, and the label alone does not say which is which. If the options need
// explaining, a dropdown was the wrong control.
export const OptionsThatNeedExplaining: Story = {
  render: (args) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [value, setValue] = useState<Adjustment>("recount");
    return <RadioGroup<Adjustment> {...args} value={value} onChange={setValue} />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("radio-damage"));
    await expect(canvas.getByTestId("radio-damage")).toHaveAttribute("data-state", "checked");
  },
};

// The explanation is INSIDE the label, so clicking the sentence selects the option. A description
// rendered as a sibling is a click target that looks selectable and is not.
export const ClickingTheDescriptionSelects: Story = {
  render: (args) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [value, setValue] = useState<Adjustment>("recount");
    return <RadioGroup<Adjustment> {...args} value={value} onChange={setValue} />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByText(/written off/i));
    await expect(canvas.getByTestId("radio-shrinkage")).toHaveAttribute("data-state", "checked");
  },
};

export const HorizontalShortLabels: Story = {
  args: {
    horizontal: true,
    items: [
      { value: "recount" as Adjustment, label: "Recount" },
      { value: "damage" as Adjustment, label: "Damage" },
    ],
  },
};
