import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Field, Stack, Text } from "@chakra-ui/react";
import { expect, fireEvent, fn, userEvent, within } from "storybook/test";

import { QuantityInput, description } from "./QuantityInput";

const meta = {
  title: "Components/Inputs/QuantityInput",
  component: QuantityInput,
  parameters: {
    docs: { description: { component: description } },
  },
  args: { value: "3", onChange: fn(), testId: "qty" },
} satisfies Meta<typeof QuantityInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = { args: { value: "" } };

export const Disabled: Story = { args: { value: "3", disabled: true } };

export const Bounded: Story = { args: { value: "3", min: 1, max: 5 } };

export const InsideAField: Story = {
  render: function Render(args) {
    const [value, setValue] = useState("2");

    return (
      <Field.Root w="40">
        <Field.Label>Quantity</Field.Label>
        <QuantityInput {...args} value={value} onChange={setValue} min={1} />
        <Field.HelperText>Whole units.</Field.HelperText>
      </Field.Root>
    );
  },
};

// THE STEPPERS ARE OURS, and that is the whole reason this component exists: a native
// `type="number"` draws two 8px arrows in Chrome, a different pair in Safari and NOTHING on a phone —
// so on a table of quantities, ±1 was a thing you typed.
export const TheSteppersStep: Story = {
  render: function Render(args) {
    const [value, setValue] = useState("3");

    return (
      <Stack gap="2" w="40">
        <QuantityInput {...args} value={value} onChange={setValue} min={0} />
        <Text data-testid="readout">{value}</Text>
      </Stack>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // The buttons are labelled in the app's own words (they are read out loud), so that is what this
    // asserts on rather than a class or a position.
    await userEvent.click(canvas.getByRole("button", { name: /increase/i }));
    await expect(canvas.getByTestId("readout")).toHaveTextContent("4");

    await userEvent.click(canvas.getByRole("button", { name: /decrease/i }));
    await userEvent.click(canvas.getByRole("button", { name: /decrease/i }));
    await expect(canvas.getByTestId("readout")).toHaveTextContent("2");
  },
};

// ⚠ THE BUG THIS PINS, and it is the reason the native control had to go: a wheel over a FOCUSED
// number input edits it. On a long order that is a silent change to a line somebody was scrolling
// past, and nothing on screen says it happened.
export const ScrollingOverItChangesNothing: Story = {
  render: function Render(args) {
    const [value, setValue] = useState("3");

    return (
      <Stack gap="2" w="40">
        <QuantityInput {...args} value={value} onChange={setValue} min={0} />
        <Text data-testid="readout">{value}</Text>
      </Stack>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByTestId("qty");

    await userEvent.click(input);
    fireEvent.wheel(input, { deltaY: -120 });
    fireEvent.wheel(input, { deltaY: 120 });

    await expect(canvas.getByTestId("readout")).toHaveTextContent("3");
  },
};

// A VALUE IS A STRING, and the empty one is not zero: a box somebody cleared is a box waiting for a
// number, and a form holding `0` there would place an order for none of something.
export const ClearingLeavesItEmptyNotZero: Story = {
  args: { value: "3" },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.clear(canvas.getByTestId("qty"));

    await expect(args.onChange).toHaveBeenLastCalledWith("");
  },
};
