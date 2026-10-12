import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { PERIOD_GRAINS, PeriodGrainPicker, description } from "./PeriodGrainPicker";

const meta = {
  title: "Components/Date & Time/PeriodGrainPicker",
  component: PeriodGrainPicker,
  parameters: {
    docs: { description: { component: description } },
  },
  args: { value: "day", onChange: fn(), testId: "grain" },
} satisfies Meta<typeof PeriodGrainPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Daily: Story = {};

export const Monthly: Story = { args: { value: "month" } };

export const Yearly: Story = { args: { value: "year" } };

export const Disabled: Story = { args: { value: "month", disabled: true } };

// A caller narrows the offer when its SERIES cannot answer at a resolution — not when the grain is
// merely uninteresting. Offering a resolution the data cannot fill is how a screen ends up showing one
// row under a picker that promised more.
export const NarrowedToWhatTheDataCanAnswer: Story = {
  args: { value: "day", grains: ["day", "month"] },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// It emits the same union `lib/period` works in, so a caller rolls a daily series up with `bucketOf`
// and `bucketSpine` and never needs a mapping table between "what the control said" and "what the
// spine takes".
export const PickingAGrainEmitsTheUnionMember: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("grain-month"));

    await waitFor(() => expect(args.onChange).toHaveBeenCalledWith("month"));
  },
};

// ⚠ CLICKING THE ACTIVE SEGMENT IS NOT A DESELECT. Ark reports `null` when the current segment is
// picked again, and a grain has no "off" — writing that back would leave the caller holding `null`
// where its spine expects a unit, and the table below would empty for what reads as a stray click.
export const ClickingTheActiveSegmentHoldsIt: Story = {
  args: { value: "month" },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("grain-month"));

    // Either nothing was emitted, or the value it emitted is the one already held — never `null`.
    for (const call of (args.onChange as ReturnType<typeof fn>).mock.calls) {
      await expect(call[0]).toBe("month");
    }
  },
};

// All three are visible WITHOUT opening anything, which is the entire reason this is a segmented group
// rather than the Select every other picker in the app is. Somebody reading a running total has to be
// able to tell at a glance whether the rows under it are days or months.
export const EveryGrainIsReadableWithoutOpeningAnything: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    for (const grain of PERIOD_GRAINS) {
      await expect(canvas.getByTestId(`grain-${grain}`)).toBeVisible();
    }
  },
};

// The group carries a name of its own. The segments say "Daily / Monthly / Yearly", which tells a
// screen reader the options but not the question — so the radiogroup is labelled rather than announced
// as a bare "radiogroup".
export const TheGroupIsNamedForAScreenReader: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("grain")).toHaveAccessibleName(/group by/i);
  },
};
