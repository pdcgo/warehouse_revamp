import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Field } from "@chakra-ui/react";
import { expect, fn, userEvent, within } from "storybook/test";

import { DatePicker, dateInputToUnix, description, unixToDateInput } from "./DatePicker";

const meta = {
  title: "Components/Date & Time/DatePicker",
  component: DatePicker,
  parameters: {
    docs: { description: { component: description } },
  },
  args: { value: "", onChange: fn(), testId: "date" },
} satisfies Meta<typeof DatePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const WithValue: Story = { args: { value: "2026-08-15" } };

export const Clearable: Story = { args: { value: "2026-08-15", clearable: true } };

export const Bounded: Story = {
  args: { value: "2026-08-15", min: "2026-08-01", max: "2026-08-31" },
};

export const Disabled: Story = { args: { value: "2026-08-15", disabled: true } };

// Like PasswordInput, it wraps a BARE Input and overlays the clear button rather than nesting an
// InputGroup — so the surrounding Field's label/required/aria wiring survives.
export const InsideAField: Story = {
  render: (args) => {
    const [value, setValue] = useState("2026-08-15");

    return (
      <Field.Root required w="64">
        <Field.Label>
          Arrival date <Field.RequiredIndicator />
        </Field.Label>
        <DatePicker {...args} value={value} onChange={setValue} clearable />
      </Field.Root>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByLabelText(/^Arrival date/, { selector: "input" })).toBeInTheDocument();
  },
};

// The clear button only appears once there IS something to clear — and never while disabled, where
// it would offer an edit the field is refusing.
export const ClearOnlyShowsWhenSet: Story = {
  args: { value: "", clearable: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("date-clear")).toBeNull();
  },
};

export const ClearEmitsTheEmptyString: Story = {
  args: { value: "2026-08-15", clearable: true },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("date-clear"));

    // "" is the unset sentinel throughout the picker family — not null, not undefined.
    await expect(args.onChange).toHaveBeenCalledWith("");
  },
};

// The unit convention the whole picker family shares: seconds, LOCAL time, and 0 = unset. It is
// re-exported from the picker so a caller imports the control and its converter from one place.
//
// ⚠ `atEndOfDay` is REQUIRED, and it is not a formatting detail. A calendar date is a whole day, but
// a range bound is an instant — so the same "2026-08-15" means 00:00:00 as a lower bound and
// 23:59:59 as an upper one. Pass `false` on both ends of a range and every record made later that
// day falls outside it, which reads as data going missing rather than as an off-by-one.
export const UnitConversion: Story = {
  render: () => {
    const iso = "2026-08-15";

    return (
      <dl data-testid="conv">
        <dt>dateInputToUnix("{iso}", false) — a lower bound</dt>
        <dd>{dateInputToUnix(iso, false).toString()}</dd>
        <dt>dateInputToUnix("{iso}", true) — an upper bound</dt>
        <dd>{dateInputToUnix(iso, true).toString()}</dd>
        <dt>unixToDateInput(either)</dt>
        <dd>{unixToDateInput(dateInputToUnix(iso, true))}</dd>
        <dt>unixToDateInput(0n)</dt>
        <dd>{JSON.stringify(unixToDateInput(0n))}</dd>
      </dl>
    );
  },
  play: async () => {
    const start = dateInputToUnix("2026-08-15", false);
    const end = dateInputToUnix("2026-08-15", true);

    // One calendar date, two instants — a whole day apart, less a second.
    await expect(end - start).toBe(86_399n);

    // Either way it round-trips back to the same date a person sees.
    await expect(unixToDateInput(start)).toBe("2026-08-15");
    await expect(unixToDateInput(end)).toBe("2026-08-15");

    // 0 is UNSET, not the epoch.
    await expect(unixToDateInput(0n)).toBe("");
    await expect(dateInputToUnix("", false)).toBe(0n);
  },
};
