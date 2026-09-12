import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { ALL_MONTHS, MonthRangePicker, description, type MonthRange } from "./MonthRangePicker";

const meta = {
  title: "Legacy/Components/Date & Time/MonthRangePicker",
  component: MonthRangePicker,
  parameters: { docs: { description: { component: description } } },
  args: { value: ALL_MONTHS, onChange: () => {} },
} satisfies Meta<typeof MonthRangePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

function Harness(props: { initial?: MonthRange }) {
  const [value, setValue] = useState<MonthRange>(props.initial ?? ALL_MONTHS);
  return (
    <>
      <MonthRangePicker value={value} onChange={setValue} />
      <span data-testid="value">{value.from || "-"}..{value.to || "-"}</span>
    </>
  );
}

export const Empty: Story = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("month-range-trigger")).toHaveTextContent("All months");
  },
};

// ⚠ THE ORDER-INSENSITIVE RULE. Everyone has clicked the END of a range first. Forcing a strict
// order means an error message for something the component can simply understand — so whichever two
// months are picked, the earlier becomes `from`.
export const BackwardsSelectionIsUnderstood: Story = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const year = new Date().getFullYear();

    await userEvent.click(canvas.getByTestId("month-range-trigger"));
    await waitFor(async () => {
      await expect(screen.getByTestId("month-range-panel")).toBeVisible();
    });

    // Click September first, then March.
    await userEvent.click(screen.getByTestId(`month-${year}-09`));
    await userEvent.click(screen.getByTestId(`month-${year}-03`));

    await expect(canvas.getByTestId("value")).toHaveTextContent(`${year}-03..${year}-09`);
  },
};

// A first click shows a single-month window, so the click has visible effect before the range is
// complete rather than appearing to do nothing.
export const FirstClickSelectsOneMonth: Story = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const year = new Date().getFullYear();

    await userEvent.click(canvas.getByTestId("month-range-trigger"));
    await userEvent.click(await screen.findByTestId(`month-${year}-05`));

    await expect(canvas.getByTestId("value")).toHaveTextContent(`${year}-05..${year}-05`);
  },
};

export const APickedRange: Story = {
  render: () => <Harness initial={{ from: "2026-03", to: "2026-08" }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("month-range-trigger")).toHaveTextContent("Mar 2026 – Aug 2026");
  },
};
