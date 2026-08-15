import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box, Text } from "@chakra-ui/react";
import { expect, fn, userEvent, within } from "storybook/test";

import { RangeCalendar, description } from "./RangeCalendar";

const meta = {
  title: "Components/RangeCalendar",
  component: RangeCalendar,
  parameters: {
    docs: { description: { component: description } },
  },
  args: { from: "2026-08-05", to: "2026-08-19", onChange: fn(), testId: "cal" },
  decorators: [
    (Story) => (
      <Box w="72">
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof RangeCalendar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ARange: Story = {};

// `""` on a side is an OPEN end, so a lone anchor is a valid "from X onwards".
export const OpenEnded: Story = { args: { from: "2026-08-05", to: "" } };

export const Empty: Story = { args: { from: "", to: "" } };

// The view is seeded from the SELECTION (its end, then its start) rather than always from today, so
// the calendar opens looking at the dates you already chose.
export const OpensOnTheSelectedMonth: Story = {
  args: { from: "2026-02-10", to: "2026-02-20" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("cal-day-2026-02-10")).toBeInTheDocument();
  },
};

// Two clicks set a window: the first drops an anchor, the second closes it.
export const TwoClicksSetAWindow: Story = {
  // ⚠ `from` is seeded only to PIN THE VISIBLE MONTH. The view is derived from the selection (its
  // end, then its start, then today), so a story starting fully empty would open on whatever month
  // the test happens to run in and its hardcoded day ids would rot. The first click re-anchors
  // regardless of what `from` held, so this does not weaken what is being tested.
  args: { from: "2026-08-01", to: "" },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("cal-day-2026-08-10"));
    await userEvent.click(canvas.getByTestId("cal-day-2026-08-14"));

    await expect(args.onChange).toHaveBeenLastCalledWith("2026-08-10", "2026-08-14");
  },
};

// …in EITHER ORDER. Clicking the later day first still yields an ascending pair, because a person
// reading a calendar does not necessarily start at the left.
export const ClicksInEitherOrderSort: Story = {
  // ⚠ `from` is seeded only to PIN THE VISIBLE MONTH. The view is derived from the selection (its
  // end, then its start, then today), so a story starting fully empty would open on whatever month
  // the test happens to run in and its hardcoded day ids would rot. The first click re-anchors
  // regardless of what `from` held, so this does not weaken what is being tested.
  args: { from: "2026-08-01", to: "" },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("cal-day-2026-08-14"));
    await userEvent.click(canvas.getByTestId("cal-day-2026-08-10"));

    await expect(args.onChange).toHaveBeenLastCalledWith("2026-08-10", "2026-08-14");
  },
};

// A single click is a complete, usable answer — "from the 10th onwards".
export const OneClickIsAnOpenEndedRange: Story = {
  // ⚠ `from` is seeded only to PIN THE VISIBLE MONTH. The view is derived from the selection (its
  // end, then its start, then today), so a story starting fully empty would open on whatever month
  // the test happens to run in and its hardcoded day ids would rot. The first click re-anchors
  // regardless of what `from` held, so this does not weaken what is being tested.
  args: { from: "2026-08-01", to: "" },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("cal-day-2026-08-10"));

    await expect(args.onChange).toHaveBeenLastCalledWith("2026-08-10", "");
  },
};

export const MonthNavigation: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("cal-prev"));
    await expect(canvas.getByTestId("cal-day-2026-07-15")).toBeInTheDocument();

    await userEvent.click(canvas.getByTestId("cal-next"));
    await userEvent.click(canvas.getByTestId("cal-next"));
    await expect(canvas.getByTestId("cal-day-2026-09-15")).toBeInTheDocument();
  },
};

export const Interactive: Story = {
  render: (args) => {
    // Seeded to pin the visible month — see the note on TwoClicksSetAWindow.
    const [range, setRange] = useState({ from: "2026-08-01", to: "" });

    return (
      <>
        <RangeCalendar
          {...args}
          from={range.from}
          to={range.to}
          onChange={(from, to) => setRange({ from, to })}
        />
        <Text mt="3" fontSize="sm" data-testid="readout">
          {range.from || "(open)"} → {range.to || "(open)"}
        </Text>
      </>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("cal-day-2026-08-03"));
    await userEvent.click(canvas.getByTestId("cal-day-2026-08-21"));

    await expect(canvas.getByTestId("readout")).toHaveTextContent("2026-08-03 → 2026-08-21");
  },
};
