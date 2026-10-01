import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { ALL_YEARS, YearRangePicker, description, type YearRange } from "./YearRangePicker";

const meta = {
  title: "Legacy/Components/Date & Time/YearRangePicker",
  component: YearRangePicker,
  parameters: { docs: { description: { component: description } } },
  args: { value: ALL_YEARS, onChange: () => {} },
} satisfies Meta<typeof YearRangePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

function Harness(props: { initial?: YearRange }) {
  const [value, setValue] = useState<YearRange>(props.initial ?? ALL_YEARS);
  return (
    <>
      <YearRangePicker value={value} onChange={setValue} />
      <span data-testid="value">{value.from || "-"}..{value.to || "-"}</span>
    </>
  );
}

// The page is ALIGNED so the current year is on it — opening the picker should not require paging
// to find this year.
export const OpensOnTheCurrentDecade: Story = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const year = new Date().getFullYear();

    await userEvent.click(canvas.getByTestId("year-range-trigger"));
    await waitFor(async () => {
      await expect(screen.getByTestId(`year-${year}`)).toBeVisible();
    });
  },
};

// No free-text year: a mistyped digit cannot produce a range a century away.
export const PickingARange: Story = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const year = new Date().getFullYear();

    await userEvent.click(canvas.getByTestId("year-range-trigger"));
    await userEvent.click(await screen.findByTestId(`year-${year}`));
    await userEvent.click(await screen.findByTestId(`year-${year - 2}`));

    await expect(canvas.getByTestId("value")).toHaveTextContent(`${year - 2}..${year}`);
  },
};

export const Clearing: Story = {
  render: () => <Harness initial={{ from: "2024", to: "2026" }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("year-range-trigger"));
    await userEvent.click(await screen.findByTestId("year-range-clear"));

    await expect(canvas.getByTestId("value")).toHaveTextContent("-..-");
  },
};
