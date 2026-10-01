import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Field } from "@chakra-ui/react";
import { expect, fn, userEvent, within } from "storybook/test";

import {
  DateTimePicker,
  dateTimeInputToUnix,
  description,
  unixToDateTimeInput,
} from "./DateTimePicker";

const meta = {
  title: "Components/Date & Time/DateTimePicker",
  component: DateTimePicker,
  parameters: {
    docs: { description: { component: description } },
  },
  args: { value: "", onChange: fn(), testId: "datetime" },
} satisfies Meta<typeof DateTimePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const WithValue: Story = { args: { value: "2026-08-15T09:30" } };

export const Clearable: Story = { args: { value: "2026-08-15T09:30", clearable: true } };

export const Disabled: Story = { args: { value: "2026-08-15T09:30", disabled: true } };

export const InsideAField: Story = {
  render: (args) => {
    const [value, setValue] = useState("2026-08-15T09:30");

    return (
      <Field.Root w="72">
        <Field.Label>Received at</Field.Label>
        <DateTimePicker {...args} value={value} onChange={setValue} clearable />
        <Field.HelperText>Minute precision, local time.</Field.HelperText>
      </Field.Root>
    );
  },
};

export const ClearEmitsTheEmptyString: Story = {
  args: { value: "2026-08-15T09:30", clearable: true },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("datetime-clear"));

    await expect(args.onChange).toHaveBeenCalledWith("");
  },
};

// ⚠ LOCAL TIME, never UTC. The value maps to the same wall clock the person is looking at — a
// warehouse records "the lorry came at 09:30", and 09:30 has to keep meaning 09:30. A UTC round
// trip would silently shift every recorded time by the offset.
export const UnitConversionIsLocalTime: Story = {
  render: () => {
    const iso = "2026-08-15T09:30";
    const unix = dateTimeInputToUnix(iso);

    return (
      <dl data-testid="conv">
        <dt>dateTimeInputToUnix("{iso}")</dt>
        <dd>{unix.toString()}</dd>
        <dt>round trip</dt>
        <dd>{unixToDateTimeInput(unix)}</dd>
        <dt>unixToDateTimeInput(0n)</dt>
        <dd>{JSON.stringify(unixToDateTimeInput(0n))}</dd>
      </dl>
    );
  },
  play: async () => {
    await expect(unixToDateTimeInput(dateTimeInputToUnix("2026-08-15T09:30"))).toBe("2026-08-15T09:30");
    // 0 is UNSET, not the epoch.
    await expect(unixToDateTimeInput(0n)).toBe("");
    await expect(dateTimeInputToUnix("")).toBe(0n);
  },
};
