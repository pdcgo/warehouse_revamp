import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { DateText, StackedDateText, description, stackedDescription } from "./DateText";

// A fixed instant, so the absolute renderings are stable across runs.
const FIXED = 1_785_000_000n; // 2026-08-01, roughly

const meta = {
  title: "Legacy/Components/Text/DateText",
  component: DateText,
  parameters: { docs: { description: { component: description } } },
  args: { value: FIXED },
} satisfies Meta<typeof DateText>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DateAndTime: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("date-text")).toHaveTextContent("2026");
  },
};

export const DateOnly: Story = { args: { variant: "date" } };

export const TimeOnly: Story = { args: { variant: "time" } };

// The recency reading. It re-renders on a timer — "a minute ago" left standing for twenty minutes
// is worse than an absolute time, because it reads as fresh and nothing about it looks wrong.
export const Relative: Story = {
  args: { value: BigInt(Math.floor(Date.now() / 1000) - 3600), variant: "relative" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("date-text")).toHaveTextContent(/hour/i);
  },
};

// Every input shape lands on the same rendering — an RPC's bigint, a picker's Date, the stock
// endpoints' RFC3339 string. A component that only took one of them would push the conversion into
// every caller.
export const EveryInputShape: Story = {
  render: () => (
    <Stack gap="1">
      <DateText value={FIXED} />
      <DateText value={new Date(Number(FIXED) * 1000)} />
      <DateText value={new Date(Number(FIXED) * 1000).toISOString()} />
      <DateText value={Number(FIXED)} />
    </Stack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const all = canvas.getAllByTestId("date-text");

    await expect(all).toHaveLength(4);
    // All four describe the same instant, so all four must render identically.
    const first = all[0].textContent;
    for (const el of all) await expect(el.textContent).toBe(first);
  },
};

// "No date" is a real state, not a failure. It renders the em dash the rest of the app uses — and
// so does an UNPARSEABLE value, rather than the "Invalid Date" a bare Date would print.
export const NoDateAndGarbage: Story = {
  render: () => (
    <Stack gap="1">
      <DateText value={0n} />
      <DateText value={undefined} />
      <DateText value="not a date" />
    </Stack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    for (const el of canvas.getAllByTestId("date-text")) {
      await expect(el).toHaveTextContent("—");
    }
  },
};

// The two-line form for narrow columns: day above, clock below.
export const Stacked: Story = {
  parameters: { docs: { description: { story: stackedDescription } } },
  render: () => <StackedDateText value={FIXED} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("stacked-date-text")).toBeVisible();
    await expect(canvas.getAllByTestId("date-text")).toHaveLength(2);
  },
};
