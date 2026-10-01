import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { ALL_DATES } from "../../../components/datetime/DateRangePicker";
import { ALL_MONTHS } from "./MonthRangePicker";
import { ALL_YEARS } from "./YearRangePicker";
import { PeriodRangePicker, description, type PeriodRange } from "./PeriodRangePicker";

const EMPTY: PeriodRange = {
  grain: "month",
  day: ALL_DATES,
  month: ALL_MONTHS,
  year: ALL_YEARS,
};

const meta = {
  title: "Legacy/Components/Date & Time/PeriodRangePicker",
  component: PeriodRangePicker,
  parameters: { docs: { description: { component: description } } },
  args: { value: EMPTY, onChange: () => {} },
} satisfies Meta<typeof PeriodRangePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

function Harness(props: { initial?: PeriodRange }) {
  const [value, setValue] = useState<PeriodRange>(props.initial ?? EMPTY);
  return (
    <>
      <PeriodRangePicker value={value} onChange={setValue} />
      <span data-testid="month-value">{value.month.from || "-"}..{value.month.to || "-"}</span>
    </>
  );
}

// The range control FOLLOWS the grain: Monthly gives a month picker, not a day picker you are
// trusted to align to month boundaries yourself.
export const RangeControlFollowsTheGrain: Story = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("month-range-trigger")).toBeVisible();

    await userEvent.click(canvas.getByTestId("period-grain-year"));
    await waitFor(async () => {
      await expect(canvas.getByTestId("year-range-trigger")).toBeVisible();
    });
    await expect(canvas.queryByTestId("month-range-trigger")).toBeNull();
  },
};

// ⚠ EACH GRAIN KEEPS ITS OWN WINDOW. Converting on every grain change loses information both ways —
// months→days invents boundaries the user never chose, days→months silently widens their window. So
// Monthly → Daily → Monthly returns the ORIGINAL month window, not a lossy round-trip of it.
export const SwitchingGrainAndBackIsLossless: Story = {
  render: () => <Harness initial={{ ...EMPTY, month: { from: "2026-03", to: "2026-08" } }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("month-value")).toHaveTextContent("2026-03..2026-08");

    await userEvent.click(canvas.getByTestId("period-grain-day"));
    await waitFor(async () => {
      await expect(canvas.queryByTestId("month-range-trigger")).toBeNull();
    });

    await userEvent.click(canvas.getByTestId("period-grain-month"));
    await waitFor(async () => {
      await expect(canvas.getByTestId("month-range-trigger")).toHaveTextContent("Mar 2026 – Aug 2026");
    });
    await expect(canvas.getByTestId("month-value")).toHaveTextContent("2026-03..2026-08");
  },
};
