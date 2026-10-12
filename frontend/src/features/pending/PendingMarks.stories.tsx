import type { Meta, StoryObj } from "@storybook/react-vite";
import { Flex, Stack, Text } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { NotImplemented } from "./NotImplemented";
import { NotImplementedSummary } from "./NotImplementedSummary";
import type { PendingList } from "./registry";

// THE SWITCH THAT HIDES THE BUILD-STATUS MARKS — and the two rules that make it safe.
//
// There is no component called `PendingMarks` to story; the subject here is the toolbar global and
// what it does to the two components that read it. So this renders a miniature screen — a strip and a
// marked control — and asserts on both states.
//
// ⚠ THE DEFAULT IS THE HALF THAT MATTERS. `PendingMarksContext` defaults to `true`, so a screen with
// no provider above it — which is every screen in the real app — shows its marks. Flipped, they would
// vanish everywhere and nobody would notice, because a missing warning looks exactly like nothing
// being wrong. `TheMarksAreShownByDefault` is what fails if somebody flips it.

const LIST: PendingList<"withdrawal" | "export"> = {
  // Borrowing the orders list's copy rather than inventing a namespace: the components read
  // `<ns>.pending.<id>.label|reason`, so a made-up ns would render raw keys and prove nothing about
  // how this looks in place.
  ns: "orders",
  parts: [
    { id: "withdrawal", kind: "missing" },
    { id: "export", kind: "dropped" },
  ],
};

function MiniScreen() {
  return (
    <Stack gap="card" maxW="3xl">
      <NotImplementedSummary list={LIST} />

      <Flex gap="1" align="center">
        <Text fontWeight="bold">Withdrawal</Text>
        <NotImplemented list={LIST} id="withdrawal" />
      </Flex>
    </Stack>
  );
}

const meta = {
  title: "Features/Pending/PendingMarks",
  component: MiniScreen,
} satisfies Meta<typeof MiniScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * ⚠ NO `globals` HERE ON PURPOSE. This story runs at whatever the toolbar's default is, so it fails
 * the day the default becomes "off" — which is the one change nobody would otherwise catch.
 */
export const TheMarksAreShownByDefault: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("not-implemented-summary")).toBeInTheDocument();
    await expect(canvas.getByTestId("not-implemented-withdrawal")).toBeInTheDocument();
  },
};

/**
 * Hidden, BOTH halves go — the badge and the strip. Hiding one without the other leaves a ⚠ 3
 * pointing into a list that is not on screen.
 *
 * ⚠ THEY RENDER NOTHING, not something invisible. The badge sits inside a header's `Flex`, so a
 * zero-width placeholder would still hold its gap and the column would stay wider than its content —
 * which is exactly the layout question somebody turns the marks off to look at.
 */
export const HiddenLeavesNothingBehind: Story = {
  globals: { pendingMarks: "off" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("not-implemented-summary")).toBeNull();
    await expect(canvas.queryByTestId("not-implemented-withdrawal")).toBeNull();

    // …and the control it was marking is still there. The switch hides the scaffolding, never the
    // screen under it.
    await expect(canvas.getByText("Withdrawal")).toBeInTheDocument();
  },
};
