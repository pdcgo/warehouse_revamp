import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { RestockLabelsPage } from "./index";

// ⚠ PROTOTYPE for implementation_analysis — the restock decisions (docs/business/inventory/restock_decision.md).
//
// The shelf labels for an ACCEPTED restock, printed by Gudang Pusat (11). 503 was counted in with 7 good rice on A-01-1
// and B-02-1 and 20 tea on A-01-2 — every good unit is on a placement (there-is-no-unplaced-pile), so every label
// carries a placement code, and the 3 broken or missing units have none.

function routedAt(id: bigint) {
  return routedPage(
    [
      { path: "/inventories/restock/:requestId/labels", element: <RestockLabelsPage /> },
      marker("/inventories/restock/:requestId", "at-restock-detail"),
    ],
    `/inventories/restock/${id}/labels`,
  );
}

const At503 = routedAt(503n);
const At501 = routedAt(501n);

const meta = {
  title: "Pages/Restock/RestockLabels",
  component: At503,
  parameters: { signedIn: true, dataRouter: true, layout: "padded" },
  beforeEach: () => {
    asTeam(11n)();
    asRole(Role.WAREHOUSE_STAFF)();
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function sheet(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("labels-sheet", {}, { timeout: 4000 });
  return canvas;
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Accepted: Story = {};

export const OnePerPlacement: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await sheet(canvasElement);
    await userEvent.click(within(canvas.getByTestId("labels-mode")).getByText("Shelf"));
  },
};

export const NotYetAccepted: Story = { render: () => <At501 /> };

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// there-is-no-unplaced-pile — one label per placement, each with its placement code; no holding pile.
export const EveryLabelHasAPlacement: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await sheet(canvasElement);

    await userEvent.click(within(canvas.getByTestId("labels-mode")).getByText("Shelf"));
    await waitFor(() =>
      expect(canvas.getAllByTestId("label-placement").map((el) => el.textContent)).toEqual(["A-01-1", "B-02-1", "A-01-2"]),
    );
    await expect(canvas.getByTestId("labels-sheet")).not.toHaveTextContent("HOLDING");
  },
};

// Broken and missing units never became stock, so they get no label — and the page says how many were left out.
export const BrokenAndMissingGetNoLabel: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await sheet(canvasElement);

    await expect(canvas.getByTestId("labels-excluded")).toHaveTextContent("3 units arrived broken or missing");
  },
};

// Only an ACCEPTED restock has labels — an ongoing one says so instead of asking the server for a refusal.
export const OnlyAnAcceptedRestockPrints: Story = {
  render: () => <At501 />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("labels-not-accepted", {}, { timeout: 4000 })).toBeVisible();
    await expect(canvas.queryByTestId("labels-sheet")).toBeNull();
  },
};

// Warehouse-only: a selling team does not print the shelf labels of somebody else's building.
export const ASellingTeamCannotPrint: Story = {
  beforeEach: () => {
    asTeam(12n)();
    asRole(Role.SELLING_OWNER)();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("labels-not-warehouse", {}, { timeout: 4000 })).toBeVisible();
  },
};
