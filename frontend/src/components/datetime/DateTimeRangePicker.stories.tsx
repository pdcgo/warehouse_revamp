import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";

import {
  ALL_TIMES,
  DateTimeRangePicker,
  type DateTimeRange,
  description,
  isAllTimes,
  relativeLabel,
  resolveRange,
} from "./DateTimeRangePicker";

const meta = {
  title: "Components/Date & Time/DateTimeRangePicker",
  component: DateTimeRangePicker,
  parameters: {
    docs: { description: { component: description } },
  },
  args: { value: ALL_TIMES, onChange: fn(), testId: "dtrange" },
} satisfies Meta<typeof DateTimeRangePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllTimes: Story = {};

export const LastFiveMinutes: Story = { args: { value: { kind: "relative", minutes: 5 } } };

export const LastSixHours: Story = { args: { value: { kind: "relative", minutes: 360 } } };

export const AbsoluteWindow: Story = {
  args: { value: { kind: "absolute", from: "2026-08-15T08:00", to: "2026-08-15T17:00" } },
};

export const Disabled: Story = { args: { value: { kind: "relative", minutes: 60 }, disabled: true } };

// Same live-window decision as the date-only sibling, one rung finer: the MINUTE COUNT is stored,
// never resolved instants, so "Last 5 minutes" still means the last 5 minutes an hour from now.
export const QuickRangeEmitsAMinuteCount: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("dtrange"));
    const quick = await screen.findByTestId("dtrange-quick-360");
    await waitFor(() => expect(quick).toBeVisible());
    await userEvent.click(quick);

    await expect(args.onChange).toHaveBeenCalledWith({ kind: "relative", minutes: 360 });
  },
};

export const AbsolutePaneCommitsOnApply: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("dtrange"));

    const from = await screen.findByTestId("dtrange-from");
    await waitFor(() => expect(from).toBeVisible());

    await userEvent.type(from, "2026-08-15T08:00");
    await userEvent.type(await screen.findByTestId("dtrange-to"), "2026-08-15T17:00");

    // Still a draft — typing must not refetch the list behind the popover on every keystroke.
    await expect(args.onChange).not.toHaveBeenCalled();

    await userEvent.click(await screen.findByTestId("dtrange-apply"));

    await expect(args.onChange).toHaveBeenCalledWith({
      kind: "absolute",
      from: "2026-08-15T08:00",
      to: "2026-08-15T17:00",
    });
  },
};

export const ClearsBackToAllTimes: Story = {
  args: { value: { kind: "relative", minutes: 60 } },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("dtrange"));
    const clear = await screen.findByTestId("dtrange-clear");
    await waitFor(() => expect(clear).toBeVisible());
    await userEvent.click(clear);

    await expect(args.onChange).toHaveBeenCalledWith(ALL_TIMES);
  },
};

export const Interactive: Story = {
  render: (args) => {
    const [value, setValue] = useState<DateTimeRange>(ALL_TIMES);

    return <DateTimeRangePicker {...args} value={value} onChange={setValue} />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("dtrange"));
    const quick = await screen.findByTestId("dtrange-quick-15");
    await waitFor(() => expect(quick).toBeVisible());
    await userEvent.click(quick);

    await waitFor(() => expect(canvas.getByTestId("dtrange")).toHaveTextContent(/15/));
  },
};

// A minute count is humanised as the LARGEST WHOLE UNIT — 360 reads "6 hours", not "360 minutes".
// The ladder is stored in minutes so the arithmetic stays in one unit; only the label converts.
export const LabelAndResolveRules: Story = {
  render: () => <p data-testid="rules">See the assertions in this story's play function.</p>,
  play: async () => {
    const t = (key: string, opts?: Record<string, unknown>) => `${key}:${opts?.count}`;

    await expect(relativeLabel(5, t)).toBe("dateTimeRange.lastMinutes:5");
    await expect(relativeLabel(360, t)).toBe("dateTimeRange.lastHours:6");
    await expect(relativeLabel(2880, t)).toBe("dateTimeRange.lastDays:2");

    // A relative window ends at NOW (not at the end of the day — that is the date-only sibling's
    // rule) and starts N minutes before it.
    const now = new Date(2026, 7, 15, 13, 45);
    const window = resolveRange({ kind: "relative", minutes: 15 }, now);
    await expect(window.toUnix).toBe(BigInt(Math.floor(now.getTime() / 1000)));
    await expect(window.fromUnix).toBe(BigInt(Math.floor((now.getTime() - 15 * 60_000) / 1000)));

    // An empty side is an OPEN end — 0n, not the epoch.
    const open = resolveRange({ kind: "absolute", from: "2026-08-15T08:00", to: "" });
    await expect(open.toUnix).toBe(0n);
    await expect(isAllTimes(ALL_TIMES)).toBe(true);
  },
};
