import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";

import {
  ALL_DATES,
  DateRangePicker,
  type DateRange,
  description,
  isAllDates,
  resolveRange,
} from "./DateRangePicker";

const meta = {
  title: "Components/Date & Time/DateRangePicker",
  component: DateRangePicker,
  parameters: {
    docs: { description: { component: description } },
  },
  args: { value: ALL_DATES, onChange: fn(), testId: "range" },
} satisfies Meta<typeof DateRangePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllDates: Story = {};

export const RelativeWindow: Story = { args: { value: { kind: "relative", days: 7 } } };

export const AbsoluteWindow: Story = {
  args: { value: { kind: "absolute", from: "2026-08-01", to: "2026-08-15" } },
};

export const OpenEnded: Story = {
  args: { value: { kind: "absolute", from: "2026-08-01", to: "" } },
};

export const Disabled: Story = { args: { value: { kind: "relative", days: 30 }, disabled: true } };

// With `fields`, the trigger grows a leading segment choosing WHICH timestamp the window filters on
// (#225) — so one control picks both the column and the range.
export const WithATimeTypeSegment: Story = {
  args: {
    value: { kind: "relative", days: 7 },
    fields: [
      { value: "created", label: "Created" },
      { value: "arrived", label: "Arrived" },
    ],
    field: "created",
    onFieldChange: fn(),
  },
};

// ⚠ THE DESIGN DECISION THIS PINS: a relative range is stored as the NUMBER OF DAYS, never as
// resolved dates. That is what keeps the window LIVE — reopen the screen tomorrow and "Last 7 days"
// still means the last 7 days, not the 7 days that were current when it was picked.
export const QuickRangeEmitsADayCountNotDates: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("range"));
    const quick = await screen.findByTestId("range-quick-7");
    await waitFor(() => expect(quick).toBeVisible());
    await userEvent.click(quick);

    await expect(args.onChange).toHaveBeenCalledWith({ kind: "relative", days: 7 });
  },
};

// A filter must be able to return to "no bound" — otherwise the first date somebody picks is
// permanent for the rest of the session.
export const ClearsBackToAllDates: Story = {
  args: { value: { kind: "relative", days: 7 } },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("range"));
    const clear = await screen.findByTestId("range-clear");
    await waitFor(() => expect(clear).toBeVisible());
    await userEvent.click(clear);

    await expect(args.onChange).toHaveBeenCalledWith(ALL_DATES);
  },
};

// The absolute pane is a DRAFT: picking days must not fire onChange on every click, only on Apply.
// Otherwise every intermediate half-range would refetch the list behind the popover.
export const AbsolutePaneCommitsOnApply: Story = {
  // The seeded value pins which month the calendar opens on — it is derived from the selection, so
  // a story starting at ALL_DATES would open on whatever month the test runs in and the hardcoded
  // day ids would rot. The first click re-anchors regardless, so nothing is weakened.
  args: { value: { kind: "absolute", from: "2026-08-01", to: "" } },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("range"));

    const day = await screen.findByTestId("range-day-2026-08-10");
    await waitFor(() => expect(day).toBeVisible());
    await userEvent.click(day);
    await userEvent.click(await screen.findByTestId("range-day-2026-08-14"));

    // Nothing committed yet.
    await expect(args.onChange).not.toHaveBeenCalled();

    await userEvent.click(await screen.findByTestId("range-apply"));

    await expect(args.onChange).toHaveBeenCalledWith({
      kind: "absolute",
      from: "2026-08-10",
      to: "2026-08-14",
    });
  },
};

export const Interactive: Story = {
  render: (args) => {
    const [value, setValue] = useState<DateRange>(ALL_DATES);

    return <DateRangePicker {...args} value={value} onChange={setValue} />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("range"));
    const quick = await screen.findByTestId("range-quick-30");
    await waitFor(() => expect(quick).toBeVisible());
    await userEvent.click(quick);

    await waitFor(() => expect(canvas.getByTestId("range")).toHaveTextContent(/30/));
  },
};

// `resolveRange` is what a caller turns the value into for an RPC, so its edges are pinned directly:
// 0n is an OPEN end on either side, and a relative window spans whole local days.
export const ResolveRangeRules: Story = {
  render: () => <p data-testid="resolve">See the assertions in this story's play function.</p>,
  play: async () => {
    const now = new Date(2026, 7, 15, 13, 45); // 15 Aug 2026, local

    // "Today" is N=1: the start of today through the end of today.
    const today = resolveRange({ kind: "relative", days: 1 }, now);
    await expect(today.fromUnix).toBe(BigInt(Math.floor(new Date(2026, 7, 15, 0, 0, 0, 0).getTime() / 1000)));

    // A 7-day window starts 6 days back — inclusive of today, not 7 days before it.
    const week = resolveRange({ kind: "relative", days: 7 }, now);
    await expect(week.fromUnix).toBe(BigInt(Math.floor(new Date(2026, 7, 9, 0, 0, 0, 0).getTime() / 1000)));

    // An empty side is an OPEN end — 0n, not the epoch.
    const openEnded = resolveRange({ kind: "absolute", from: "2026-08-01", to: "" });
    await expect(openEnded.toUnix).toBe(0n);

    const all = resolveRange(ALL_DATES);
    await expect(all.fromUnix).toBe(0n);
    await expect(all.toUnix).toBe(0n);
    await expect(isAllDates(ALL_DATES)).toBe(true);
    await expect(isAllDates({ kind: "relative", days: 7 })).toBe(false);
  },
};
