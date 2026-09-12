import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { ALL_DAY, TimeRangePicker, description, wrapsMidnight, type TimeRange } from "./TimeRangePicker";

const meta = {
  title: "Legacy/Components/Date & Time/TimeRangePicker",
  component: TimeRangePicker,
  parameters: { docs: { description: { component: description } } },
  args: { value: ALL_DAY, onChange: () => {} },
} satisfies Meta<typeof TimeRangePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

function Harness(props: { initial?: TimeRange }) {
  const [value, setValue] = useState<TimeRange>(props.initial ?? ALL_DAY);
  return <TimeRangePicker value={value} onChange={setValue} />;
}

export const DayShift: Story = {
  render: () => <Harness initial={{ from: "08:00", to: "17:00" }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("time-range-from")).toHaveValue("08:00");
    await expect(canvas.queryByTestId("time-range-overnight")).toBeNull();
  },
};

// ⚠ THE RULE. A warehouse runs a night shift: 22:00–06:00 is a real, common window, and a picker
// that rejected it would make the shift it describes unrepresentable. It is LABELLED, not corrected
// — the reader needs to know the window crosses a date boundary.
export const NightShiftWrapsAndIsLabelled: Story = {
  render: () => <Harness initial={{ from: "22:00", to: "06:00" }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("time-range")).toHaveAttribute("data-overnight", "true");
    await expect(canvas.getByTestId("time-range-overnight")).toBeVisible();
    // The exported predicate is what a caller uses to add the day when resolving to timestamps.
    await expect(wrapsMidnight({ from: "22:00", to: "06:00" })).toBe(true);
  },
};

// An open end is not overnight — a half-specified window has no wrap to report.
export const OpenEndIsNotOvernight: Story = {
  render: () => <Harness initial={{ from: "22:00", to: "" }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("time-range-overnight")).toBeNull();
  },
};
