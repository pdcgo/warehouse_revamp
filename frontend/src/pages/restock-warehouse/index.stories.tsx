import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { RestockRequestStatus } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { RestockWarehousePage } from "./index";

// ⚠ PROTOTYPE for implementation_analysis — the restock decisions (docs/business/inventory/restock_decision.md).
//
// Gudang Pusat's (11) inbound queue, read by its floor crew (WAREHOUSE_STAFF). It opens on the last 7 days, so the rows
// are 501 (ongoing, Toko Melati), 502 (arrived) and 506 (ongoing, Toko Kenanga); the headline counts every restock
// still on its way or at the door, whatever the window.

const Routed = routedPage(
  [
    { path: "/inventories/restock", element: <RestockWarehousePage /> },
    marker("/inventories/restock/:requestId", "at-restock-detail"),
    marker("/inventories/restock/:requestId/accept", "at-restock-accept"),
  ],
  "/inventories/restock",
);

const meta = {
  title: "Pages/Restock/RestockWarehouse",
  component: Routed,
  parameters: { signedIn: true, dataRouter: true, layout: "padded" },
  beforeEach: () => {
    asTeam(11n)();
    asRole(Role.WAREHOUSE_STAFF)();
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("restock-row-501", {}, { timeout: 4000 });
  return canvas;
}

function actionsOf(row: HTMLElement): string[] {
  return [...row.querySelectorAll<HTMLElement>("[data-testid^='restock-action-']")].map((el) => el.dataset.testid ?? "");
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

export const FiveStatusTabs: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    for (const tab of ["all", "ongoing", "arrived", "accepted", "lost", "cancelled"]) {
      await expect(canvas.getByTestId(`restock-tab-${tab}`)).toBeVisible();
    }
  },
};

// the-warehouse-signs-and-accepts-the-team-does-the-rest — ongoing rows offer Sign for Box and Accept; the arrived one
// Accept only. Never Edit, Cancel or Mark Lost — those are the selling team's.
export const TheRowActionsFollowTheStatus: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(actionsOf(canvas.getByTestId("restock-row-501"))).toEqual([
      "restock-action-sign-501",
      "restock-action-accept-501",
    ]);
    await expect(actionsOf(canvas.getByTestId("restock-row-502"))).toEqual(["restock-action-accept-502"]);
    await expect(actionsOf(canvas.getByTestId("restock-row-506"))).toEqual([
      "restock-action-sign-506",
      "restock-action-accept-506",
    ]);
  },
};

// Signing for the box confirms, and the row moves to arrived — leaving Accept.
export const SignForBoxFromTheRow: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("restock-action-sign-501"));
    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await userEvent.click(confirm);

    const row = canvas.getByTestId("restock-row-501");
    await waitFor(() => expect(within(row).getByTestId(`restock-status-${RestockRequestStatus.ARRIVED}`)).toBeVisible());
    await waitFor(() => expect(actionsOf(row)).toEqual(["restock-action-accept-501"]));
    // The dialog did not navigate the row behind it.
    await expect(canvas.queryByTestId("at-restock-detail")).toBeNull();
  },
};

// Accept opens the accept PAGE — counting, placing and pricing is a form with sections.
export const AcceptOpensTheAcceptPage: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("restock-action-accept-502"));
    await expect(await canvas.findByTestId("at-restock-accept")).toBeInTheDocument();
  },
};

// The headline is the queue still to do — ongoing AND arrived — over every restock to this warehouse, not the page.
export const TheHeadlineCountsOngoingAndArrived: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // 501 and 506 ongoing, 502 arrived — 504 is lost and 503/507 accepted, so they are not waiting.
    await waitFor(() => expect(canvas.getByTestId("restock-stat-restocks")).toHaveTextContent("3"));
  },
};

// The courier is a shipment channel, named.
export const TheCourierIsNamed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const row = canvas.getByTestId("restock-row-501");
    await waitFor(() => expect(within(row).getByTestId("shipment-channel-badge-jne")).toHaveTextContent("JNE"));
    await expect(row).toHaveTextContent("JNE0123456789");
  },
};
