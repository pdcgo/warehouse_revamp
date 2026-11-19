import type { Meta, StoryObj } from "@storybook/react-vite";
import { Flex, Stack, Text } from "@chakra-ui/react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import i18n from "../../i18n/config";
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

const LIST: PendingList<"import" | "export"> = {
  // Borrowing the orders list's copy rather than inventing a namespace: the components read
  // `<ns>.pending.<id>.label|reason`, so a made-up ns would render raw keys and prove nothing about
  // how this looks in place.
  ns: "orders",
  parts: [
    { id: "import", kind: "missing" },
    { id: "export", kind: "dropped" },
  ],
};

function MiniScreen() {
  return (
    <Stack gap="card" maxW="3xl">
      <NotImplementedSummary list={LIST} />

      <Flex gap="1" align="center">
        <Text fontWeight="bold">Import</Text>
        <NotImplemented list={LIST} id="import" />
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
    await expect(canvas.getByTestId("not-implemented-import")).toBeInTheDocument();
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
    await expect(canvas.queryByTestId("not-implemented-import")).toBeNull();

    // …and the control it was marking is still there. The switch hides the scaffolding, never the
    // screen under it.
    await expect(canvas.getByText("Import")).toBeInTheDocument();
  },
};

// One part against a business decision, one not. No screen carries such a part today — the last, the accept page's rack
// for broken units, went with a-restocks-broken-units-are-just-broken-for-now — so this example brings its own copy,
// worded as that one was, under a namespace of its own (never in the app's locales: a part no screen has).
i18n.addResourceBundle(
  "en",
  "translation",
  {
    pendingExample: {
      pending: {
        chargeAtArrival: {
          label: "Charge noted at Mark Arrived",
          reason: "Marking arrived keeps no charge yet, so one noted there must be entered again.",
        },
        brokenRack: {
          label: "Broken products' rack",
          reason: "Put on a rack is not kept — the broken units are still recorded as thrown away.",
          conflict: "a broken unit is thrown away — no rack holds it.",
        },
      },
    },
  },
  true,
  false,
);

const CONFLICTED: PendingList<"chargeAtArrival" | "brokenRack"> = {
  ns: "pendingExample",
  parts: [
    { id: "chargeAtArrival", kind: "missing" },
    { id: "brokenRack", kind: "dropped", conflict: true },
  ],
};

/**
 * A PART AGAINST A BUSINESS DECISION SAYS SO (owner: *"kalau bertentangan kamu kasih catatan di unimplemented"*,
 * a-conflict-with-a-business-decision-is-said-in-its-mark) — on a line of its own in the part's row, in words rather
 * than the decision's slug, and on the badge's hover. A part without `conflict` says nothing of the kind.
 */
export const AConflictIsSaidInItsRow: Story = {
  render: () => (
    <Stack gap="card" maxW="3xl">
      <NotImplementedSummary list={CONFLICTED} />
      <NotImplemented list={CONFLICTED} id="brokenRack" />
    </Stack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("not-implemented-toggle"));
    const row = await canvas.findByTestId("pending-row-brokenRack-conflict");
    await waitFor(() => expect(row).toBeVisible());
    await expect(row).toHaveTextContent("Against a business decision: a broken unit is thrown away — no rack holds it.");
    await expect(canvas.queryByTestId("pending-row-chargeAtArrival-conflict")).toBeNull();

    await expect(canvas.getByTestId("not-implemented-brokenRack")).toHaveAttribute(
      "title",
      expect.stringContaining("Against a business decision: a broken unit is thrown away"),
    );
  },
};

/**
 * ⚠ AN EMPTY LIST RENDERS NOTHING — not a strip counting "0 parts". A screen whose last unwired part has
 * landed keeps its list and its mount (the order form's, which the draft page extends), so the strip must
 * disappear on its own, with the marks still switched on.
 */
export const AnEmptyListLeavesNoStrip: Story = {
  render: () => <NotImplementedSummary list={{ ns: "orderForm", parts: [] }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("not-implemented-summary")).toBeNull();
    await expect(canvas.queryByTestId("not-implemented-toggle")).toBeNull();
  },
};
