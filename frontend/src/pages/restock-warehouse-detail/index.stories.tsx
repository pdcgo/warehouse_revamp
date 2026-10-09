import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { RestockRequestStatus } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { RestockWarehouseDetailPage } from "./index";

// ⚠ PROTOTYPE for implementation_analysis — the restock decisions (docs/business/inventory/restock_decision.md).
//
// One delivery as Gudang Pusat (11), the receiving warehouse, sees it — read by a member of the floor crew
// (WAREHOUSE_STAFF): any warehouse member signs and accepts (any-warehouse-member-counts-what-arrived). The stub plays
// the decided rules (restockStub.ts): Arrive from ongoing or lost, Accept from ongoing or arrived.

function routedAt(id: bigint) {
  return routedPage(
    [
      { path: "/inventories/restock/:requestId", element: <RestockWarehouseDetailPage /> },
      marker("/inventories/restock/:requestId/accept", "at-restock-accept"),
      marker("/inventories/restock/:requestId/labels", "at-restock-labels"),
      marker("/inventories/restock/:requestId/receipt", "at-restock-receipt"),
      marker("/inventories/restock", "at-restock-list"),
    ],
    `/inventories/restock/${id}`,
  );
}

const At501 = routedAt(501n);
const At502 = routedAt(502n);
const At503 = routedAt(503n);
const At504 = routedAt(504n);
const At505 = routedAt(505n);
const At507 = routedAt(507n);

const meta = {
  title: "Pages/Restock/RestockWarehouseDetail",
  component: At501,
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
  await canvas.findByTestId("restock-detail-page", {}, { timeout: 4000 });
  return canvas;
}

async function expectStatus(canvas: ReturnType<typeof within>, status: RestockRequestStatus) {
  await waitFor(() =>
    expect(within(canvas.getByTestId("restock-detail-status")).getByTestId(`restock-status-${status}`)).toBeVisible(),
  );
}

function actionsIn(canvasElement: HTMLElement): string[] {
  return [...canvasElement.querySelectorAll<HTMLElement>("[data-testid^='restock-action-']")].map(
    (el) => el.dataset.testid ?? "",
  );
}

function trailRows(canvasElement: HTMLElement): HTMLElement[] {
  return [...canvasElement.querySelectorAll<HTMLElement>("[data-testid^='restock-timeline-'][data-kind]")];
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Ongoing: Story = {};

export const Arrived: Story = { render: () => <At502 /> };

export const Accepted: Story = { render: () => <At503 /> };

export const Lost: Story = { render: () => <At504 /> };

export const Cancelled: Story = { render: () => <At505 /> };

export const AcceptedWithADeletedStore: Story = { render: () => <At507 /> };

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// the-warehouse-signs-and-accepts-the-team-does-the-rest — ongoing: Sign for Box and Accept (a box that turns up
// unannounced can be accepted straight away, accept-locks-the-restock). Never the selling team's acts.
export const OngoingOffersSignAndAccept: Story = {
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);

    await waitFor(() =>
      expect(actionsIn(canvasElement)).toEqual(["restock-action-sign-501", "restock-action-accept-501"]),
    );
  },
};

// Arrived: signed for already — Accept only.
export const ArrivedOffersAcceptOnly: Story = {
  render: () => <At502 />,
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);

    await waitFor(() => expect(actionsIn(canvasElement)).toEqual(["restock-action-accept-502"]));
  },
};

// a-late-lost-box-is-signed-for-as-arrived — lost: Sign for Box only; it cannot be accepted until it is signed for.
export const LostOffersSignForBox: Story = {
  render: () => <At504 />,
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);

    await waitFor(() => expect(actionsIn(canvasElement)).toEqual(["restock-action-sign-504"]));
  },
};

// Accepted: no status act — only what the crew does next, the labels and the receipt.
export const AcceptedOffersLabelsAndReceipt: Story = {
  render: () => <At503 />,
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);

    await waitFor(() =>
      expect(actionsIn(canvasElement)).toEqual(["restock-action-labels-503", "restock-action-receipt-503"]),
    );
  },
};

export const CancelledOffersNothing: Story = {
  render: () => <At505 />,
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);
    await expect(actionsIn(canvasElement)).toEqual([]);
  },
};

// Signing for the box confirms, moves 501 to arrived, and lands in the trail — after which only Accept is left.
export const SignForBoxMovesItToArrived: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await waitFor(() => expect(trailRows(canvasElement)).toHaveLength(1));

    await userEvent.click(canvas.getByTestId("restock-action-sign-501"));
    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await userEvent.click(confirm);

    await expectStatus(canvas, RestockRequestStatus.ARRIVED);
    await waitFor(() => expect(actionsIn(canvasElement)).toEqual(["restock-action-accept-501"]));
    await waitFor(() => expect(trailRows(canvasElement)).toHaveLength(2));
    await expect(trailRows(canvasElement)[1]).toHaveTextContent("Signed for the box");
    await expect(canvas.getByTestId("restock-detail-arrived-at")).not.toHaveTextContent("—");
  },
};

// a-late-lost-box-is-signed-for-as-arrived — the lost parcel turned up: signed for, lost → arrived, then accepted as usual.
export const ALateLostBoxIsSignedForAsArrived: Story = {
  render: () => <At504 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("restock-action-sign-504"));
    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await userEvent.click(confirm);

    await expectStatus(canvas, RestockRequestStatus.ARRIVED);
    await waitFor(() => expect(actionsIn(canvasElement)).toEqual(["restock-action-accept-504"]));
    const move = await canvas.findByTestId("restock-timeline-3-move");
    await expect(within(move).getByTestId(`restock-status-${RestockRequestStatus.LOST}`)).toBeVisible();
    await expect(within(move).getByTestId(`restock-status-${RestockRequestStatus.ARRIVED}`)).toBeVisible();
  },
};

// Accepting is counting, placing and pricing — a page, not a dialog.
export const AcceptOpensTheAcceptPage: Story = {
  render: () => <At502 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("restock-action-accept-502"));
    await expect(await canvas.findByTestId("at-restock-accept")).toBeInTheDocument();
  },
};

// The lines as counted: Missing, never Lost (a-short-unit-at-the-door-is-missing), and WHERE the good units went, by
// placement code (there-is-no-unplaced-pile).
export const TheCountAndThePlacements: Story = {
  render: () => <At503 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const table = canvas.getByTestId("restock-detail-items");
    await expect(canvas.getByTestId("restock-detail-col-missing")).toHaveTextContent("Missing");
    await expect(within(table).queryByRole("columnheader", { name: /^Lost/ })).toBeNull();
    await expect(canvas.getByTestId("restock-detail-missing-74-count")).toHaveTextContent("1");
    await expect(canvas.getByTestId("restock-detail-broken-74-note")).toHaveTextContent("Karung sobek");

    await waitFor(() => expect(canvas.getByTestId("restock-detail-placement-74")).toHaveTextContent("A-01-1 (5), B-02-1 (2)"));
    await expect(canvas.getByTestId("restock-detail-placement-72")).toHaveTextContent("A-01-2 (20)");
  },
};

// the-couriers-charge-stays-out-of-total — the total is goods + shipping; the 5.000 this warehouse paid at the door is
// shown on its own, owed back by the selling team.
export const TheCouriersChargeIsOwedBack: Story = {
  render: () => <At503 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("restock-detail-total")).toHaveTextContent("Rp 980.000");
    await expect(canvas.getByTestId("restock-detail-courier-charge")).toHaveTextContent("Rp 5.000");
    await expect(canvas.getByTestId("restock-detail-courier-charge-note")).toHaveTextContent("Ongkos bongkar di gudang");
  },
};

// a-deleted-supplier-still-shows-with-a-badge — on the warehouse's copy too.
export const ADeletedStoreKeepsItsName: Story = {
  render: () => <At507 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const supplier = canvas.getByTestId("restock-detail-supplier-72");
    await waitFor(() => expect(within(supplier).getByTestId("deleted-badge")).toBeVisible());
  },
};

// The selling team's edit is in the warehouse's trail too — the count it is about to accept was changed after the box
// was opened (edits-are-in-the-same-trail).
export const TheTrailShowsTheSellingTeamsEdit: Story = {
  render: () => <At502 />,
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);

    await waitFor(() => expect(trailRows(canvasElement).map((row) => row.dataset.kind)).toEqual(["created", "status", "edit"]));
    await expect(trailRows(canvasElement)[2]).toHaveTextContent("10 → 12");
  },
};
