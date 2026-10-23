import { useState } from "react";

import { Field, Input } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { CharCount, description } from "./CharCount";

// A field with a limit, as a form writes it: the box's `maxLength` and the count's `max` are one number.
function Harness({ initial = "", max = 12 }: { initial?: string; max?: number }) {
  const [value, setValue] = useState(initial);

  return (
    <Field.Root maxW="sm">
      <Field.Label>SKU</Field.Label>
      <Input value={value} maxLength={max} data-testid="field" onChange={(e) => setValue(e.target.value)} />
      <CharCount value={value} max={max} testId="count" />
    </Field.Root>
  );
}

const meta = {
  title: "Components/Inputs/CharCount",
  component: Harness,
  parameters: { docs: { description: { component: description } } },
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const PartlyUsed: Story = { args: { initial: "KOPI-01" } };

export const AtTheLimit: Story = { args: { initial: "SKU-KOPI-250" } };

// The count follows the typing, and the box stops at the limit — the count says why.
export const CountsAndStopsAtTheLimit: Story = {
  args: { max: 8 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const count = canvas.getByTestId("count");
    await expect(count).toHaveTextContent("0/8");

    await userEvent.type(canvas.getByTestId("field"), "KOPI", { delay: 30 });
    await waitFor(() => expect(count).toHaveTextContent("4/8"));
    await expect(count).not.toHaveAttribute("data-full");

    await userEvent.type(canvas.getByTestId("field"), "-250-XL", { delay: 30 });
    await waitFor(() => expect(canvas.getByTestId("field")).toHaveValue("KOPI-250"));
    await expect(count).toHaveTextContent("8/8");
    await expect(count).toHaveAttribute("data-full", "true");
  },
};
