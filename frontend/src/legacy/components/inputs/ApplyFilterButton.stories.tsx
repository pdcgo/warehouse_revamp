import type { Meta, StoryObj } from "@storybook/react-vite";
import { HStack } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { ApplyFilterButton, ResetFilterButton, description, resetDescription } from "./ApplyFilterButton";

const APPLIED = { q: "", supplierId: 0n, status: "all" };

const meta = {
  title: "Legacy/Components/Inputs/ApplyFilterButton",
  component: ApplyFilterButton,
  parameters: { docs: { description: { component: description } } },
  args: { value: APPLIED, applied: APPLIED },
} satisfies Meta<typeof ApplyFilterButton>;

export default meta;
type Story = StoryObj<typeof meta>;

// Nothing to apply: DISABLED. A permanently-enabled Apply button cannot answer "does what I am
// looking at match what is on screen below", and gets clicked reflexively.
export const NothingToApplyIsDisabled: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("apply-filter")).toBeDisabled();
    await expect(canvas.queryByTestId("dirty-dot")).toBeNull();
  },
};

export const DirtyIsEnabledAndDotted: Story = {
  args: { value: { ...APPLIED, q: "kaos" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("apply-filter")).toBeEnabled();
    await expect(canvas.getByTestId("dirty-dot")).toBeVisible();
  },
};

// ⚠ THE EMPTY-COLLAPSING RULE. A filter never touched is `undefined`; one set and then cleared is
// `""` or `0n` or `[]`. Those all mean "not narrowing anything", so they must NOT read as a change —
// otherwise Apply stays lit after the user clears a box they never really used.
export const ClearedEqualsUntouched: Story = {
  args: {
    applied: { q: "", supplierId: 0n, tags: [] },
    value: { q: undefined, supplierId: undefined, tags: [] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("apply-filter")).toBeDisabled();
  },
};

// Reset compares against the DEFAULTS, not against what is applied — the two diverge constantly, and
// that is why they are separate components rather than one with a mode flag.
export const ResetComparesAgainstDefaults: Story = {
  parameters: { docs: { description: { story: resetDescription } } },
  render: () => (
    <HStack gap="2">
      <ApplyFilterButton value={{ status: "unpaid" }} applied={{ status: "unpaid" }} />
      <ResetFilterButton value={{ status: "unpaid" }} defaults={{ status: "all" }} />
    </HStack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Applied and the draft agree, so there is nothing to apply…
    await expect(canvas.getByTestId("apply-filter")).toBeDisabled();
    // …but it is still far from the defaults, so there IS something to reset.
    await expect(canvas.getByTestId("reset-filter")).toBeEnabled();
  },
};
