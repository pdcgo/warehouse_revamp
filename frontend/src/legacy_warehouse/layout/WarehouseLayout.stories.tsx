import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack, Text } from "@chakra-ui/react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { WarehouseLayout, description } from "./WarehouseLayout";

const USER = {
  name: "Ani Rahmawati",
  email: "ani@example.test",
  roles: ["admin", "packer"],
};

const meta = {
  title: "LegacyWarehouse/Layout/WarehouseLayout",
  component: WarehouseLayout,
  parameters: { docs: { description: { component: description } } },
  args: {
    pathname: "/inbound",
    // The runner has one fixed viewport, and it is narrower than the shell's xl breakpoint. Every
    // story below that is about the sidebar pins the wide arrangement explicitly rather than hoping
    // the viewport lands there; the compact one pins the other.
    arrangement: "wide" as const,
    user: USER,
    badges: { "problem-items": 7 },
    children: (
      <Stack p="4">
        <Text>The selected screen renders here.</Text>
      </Stack>
    ),
  },
} satisfies Meta<typeof WarehouseLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("warehouse-layout")).toBeVisible();
    await expect(canvas.getByTestId("floor-content")).toHaveTextContent("The selected screen renders here");
  },
};

// ⚠ EXACTLY ONE SIDEBAR IS IN THE TREE. The compact branch renders the drawer OR the aside, never
// both — hiding one with CSS would give the page two `navigation` landmarks and two of every test id
// inside them, which is the bug the live app's two-shell rule exists to prevent.
export const OnlyOneSidebarMounts: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getAllByTestId("warehouse-sidebar")).toHaveLength(1);
    await expect(canvas.queryByTestId("open-menu")).toBeNull();
  },
};

// The menu is grouped by WHO IS ASKING, not by data type — the picker's screens are together in
// Movement rather than scattered across Orders / Products / Users.
export const GroupedByWhoIsAsking: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("nav-group-movement")).toBeVisible();
    await expect(canvas.getByTestId("nav-group-stock")).toBeVisible();
    await expect(canvas.getByTestId("nav-group-elsewhere")).toBeVisible();
  },
};

// ⚠ A ROLE-GATED SCREEN IS ABSENT, NOT GREYED OUT. A permanently disabled item is an invitation to
// click something that will refuse — and on a tablet shared between shifts it also leaks what
// somebody else is allowed to do.
export const AnItemYouCannotUseIsNotThere: Story = {
  args: { user: { ...USER, roles: ["packer"] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("side-link-team-members")).toBeNull();
    // Everything ungated is still there.
    await expect(canvas.getByTestId("side-link-settings")).toBeVisible();
  },
};

export const OwnerSeesTeamMembers: Story = {
  args: { user: { ...USER, roles: ["owner"] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("side-link-team-members")).toBeVisible();
  },
};

// The rewrite runs BESIDE the screen it replaces, both in the menu, told apart by a tag. Deliberate
// — outbound stops the warehouse if it is wrong — but two items sharing a name is a real hazard for
// a reader in a hurry. See nav.ts.
export const TheRewriteRunsBesideTheOriginal: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("side-link-outbound")).toHaveTextContent("Outbound");
    const exp = canvas.getByTestId("side-link-outbound-exp");
    await expect(exp).toHaveTextContent("Outbound");
    await expect(within(exp).getByTestId("side-link-exp")).toHaveTextContent("EXP");
  },
};

// Longest-prefix match with "/" special-cased to exact — without the special case the dashboard is
// "current" on every screen in the app.
export const TheDashboardIsNotCurrentEverywhere: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("side-link-inbound")).toHaveAttribute("aria-current", "page");
    await expect(canvas.getByTestId("side-link-dashboard")).not.toHaveAttribute("aria-current");
  },
};

// A count past a hundred changes nothing about what you do next, and a four-digit badge pushes the
// name out of the row.
export const BadgesCapAtNinetyNinePlus: Story = {
  args: { badges: { "problem-items": 412 } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("side-link-problem-items")).toHaveTextContent("99+");
  },
};

// ⚠ WHO AM I SIGNED IN AS is a real question on a shared floor tablet — nobody signs out, and every
// movement recorded is attributed to whoever the last shift left signed in. So the name is large,
// always visible, and sign-out is a permanent footer rather than an item in an avatar menu.
export const TheSharedTabletProblem: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("user-card")).toHaveTextContent("Ani Rahmawati");
    await expect(canvas.getAllByTestId("user-role")).toHaveLength(2);
    await expect(canvas.getByTestId("sign-out")).toBeVisible();
  },
};

// A blank user card reads as "signed out", and the operator's next move is to sign in over somebody
// else's session.
export const UserStillLoading: Story = {
  args: { user: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("user-card-loading")).toBeVisible();
    await expect(canvas.queryAllByTestId("user-role")).toHaveLength(0);
  },
};

// The trolley tablet: same screen, menu pulled out on demand. Not a phone shell — there is no thumb
// to reach a bottom bar, because the operator is holding a scanner.
export const CompactPullsTheMenuOut: Story = {
  args: { arrangement: "compact" as const },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Still exactly one sidebar — it is simply not mounted until asked for.
    await expect(canvas.queryAllByTestId("warehouse-sidebar")).toHaveLength(0);

    await userEvent.click(canvas.getByTestId("open-menu"));

    // The drawer portals out of the canvas.
    await waitFor(async () => {
      await expect(within(document.body).getByTestId("warehouse-sidebar")).toBeVisible();
    });
    await expect(within(document.body).getAllByTestId("warehouse-sidebar")).toHaveLength(1);
  },
};
