import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { opnameNoActiveSession } from "../../../.storybook/opnameStub";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { OpnameSessionsPage } from "./index";

// ⚠ PROTOTYPE for implementation_analysis — the stock count's decisions (docs/business/inventory/opname_decision.md).
//
// Gudang Pusat (11) runs count #15 — `all`, mid-count — and has #13 cancelled, #12 and #9 finished. One active count per
// warehouse (one-active-count-per-warehouse), so New Count waits until #15 ends.

const Routed = routedPage(
  [
    { path: "/inventories/opname/sessions", element: <OpnameSessionsPage /> },
    marker("/inventories/opname/sessions/:sessionId", "at-session-detail"),
    marker("/inventories/opname/sessions/:sessionId/count", "at-session-count"),
  ],
  "/inventories/opname/sessions",
);

const meta = {
  title: "Pages/Opname/Sessions",
  component: Routed,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: () => {
    asTeam(11n)();
    asRole(Role.WAREHOUSE_ADMIN)();
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("opname-session-row-15", {}, { timeout: 4000 });
  return canvas;
}

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // The active count stands above the history, with its progress.
    await expect(canvas.getByTestId("opname-active-session")).toHaveTextContent("Count #15 is active");
    await expect(canvas.getByTestId("opname-active-progress")).toHaveTextContent("3 of 6 rows counted, on 3 racks");
    // The history, newest first.
    await expect(canvas.getByTestId("opname-session-row-13")).toBeInTheDocument();
    await expect(canvas.getByTestId("opname-session-row-9")).toBeInTheDocument();
    // One active count at a time: New Count waits.
    await expect(canvas.getByTestId("opname-new-session")).toBeDisabled();
  },
};

export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // A phone reads each count as a block, not a squeezed table.
    await expect(canvas.getByTestId("opname-sessions-blocks")).toBeInTheDocument();
    await expect(canvas.queryByTestId("opname-sessions-table")).toBeNull();
  },
};

// Staff come here to count: no New Count, no watch page — only Count on the active one.
export const StaffOnlyCount: Story = {
  beforeEach: asRole(Role.WAREHOUSE_STAFF),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByTestId("opname-new-session")).toBeNull();
    await expect(canvas.queryByTestId("opname-active-open")).toBeNull();
    await userEvent.click(canvas.getByTestId("opname-active-count"));
    await canvas.findByTestId("at-session-count");
  },
};

// With no active count, the admin plans one: all racks, started at once, and the watch page opens.
export const NewCountWhenNoneIsActive: Story = {
  beforeEach: opnameNoActiveSession,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("opname-session-row-15", {}, { timeout: 4000 });

    await expect(canvas.queryByTestId("opname-active-session")).toBeNull();
    await userEvent.click(canvas.getByTestId("opname-new-session"));
    const dialog = await screen.findByTestId("opname-new-session-dialog");
    // The dialog says what it locks.
    await expect(within(dialog).getByTestId("opname-new-session-lock")).toHaveTextContent("locked");
    await userEvent.click(within(dialog).getByTestId("opname-new-session-submit"));
    await canvas.findByTestId("at-session-detail");
  },
};

// A rack plan needs its rack before it can start — the target is a filter, and an empty one selects nothing.
export const APlanNeedsItsTarget: Story = {
  beforeEach: opnameNoActiveSession,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("opname-session-row-15", {}, { timeout: 4000 });

    await userEvent.click(canvas.getByTestId("opname-new-session"));
    const dialog = await screen.findByTestId("opname-new-session-dialog");
    await userEvent.click(within(dialog).getByTestId("opname-plan-placement"));
    await waitFor(() => expect(within(dialog).getByTestId("opname-new-session-submit")).toBeDisabled());
  },
};

// A team plan: the team is picked inside the dialog — its list renders inline, so it takes the click.
export const PlanOneTeam: Story = {
  beforeEach: opnameNoActiveSession,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("opname-session-row-15", {}, { timeout: 4000 });

    await userEvent.click(canvas.getByTestId("opname-new-session"));
    const dialog = await screen.findByTestId("opname-new-session-dialog");
    await waitFor(() => expect(dialog).toBeVisible());
    await userEvent.click(within(dialog).getByTestId("opname-plan-team"));
    await userEvent.click(await within(dialog).findByRole("combobox"));
    const option = await within(dialog).findByTestId("team-select-option-SL-01");
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await waitFor(() => expect(within(dialog).getByTestId("opname-new-session-submit")).toBeEnabled());
    await userEvent.click(within(dialog).getByTestId("opname-new-session-submit"));
    await canvas.findByTestId("at-session-detail");
  },
};
