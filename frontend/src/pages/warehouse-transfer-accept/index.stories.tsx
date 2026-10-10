import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { transferWire } from "../../../.storybook/warehouseTransferStub";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import {
  WarehouseTransferProblemType,
  WarehouseTransferStatus,
} from "../../gen/warehouse/inventory/v1/warehouse_transfer_pb";
import { WarehouseTransferAcceptPage } from "./index";

// ⚠ PROTOTYPE for implementation_analysis — the warehouse transfer decisions
// (docs/business/inventory/warehouse_transfer_decision.md).
//
// Gudang Pusat (11) counts in 608 — 3 Beras and 5 Teh shipped to it from Gudang Cabang — onto its racks A-01-1, A-01-2
// and B-02-1.

function routedAt(id: bigint) {
  return routedPage(
    [
      { path: "/inventories/transfer/:transferId/accept", element: <WarehouseTransferAcceptPage /> },
      marker("/inventories/transfer/:transferId", "at-transfer-detail"),
    ],
    `/inventories/transfer/${id}/accept`,
  );
}

const At608 = routedAt(608n);
const At601 = routedAt(601n);

const meta = {
  title: "Pages/WarehouseTransfer/TransferAccept",
  component: At608,
  parameters: { signedIn: true, dataRouter: true, layout: "padded" },
  beforeEach: () => {
    asTeam(11n)();
    asRole(Role.WAREHOUSE_STAFF)();
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// QuantityInput puts its test id on the input itself.
const spin = (canvas: ReturnType<typeof within>, testId: string) => canvas.getByTestId(testId);

async function type(el: HTMLElement, value: string) {
  await userEvent.clear(el);
  await userEvent.type(el, value, { delay: 40 });
}

async function pickRack(canvas: ReturnType<typeof within>, line: string, rackId: bigint) {
  const field = within(canvas.getByTestId(`accept-line-${line}-placements`));
  await userEvent.click(field.getByTestId("rack-select"));
  const option = await field.findByTestId(`rack-select-option-${rackId}`);
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option);
}

// Nothing is counted yet, so nothing can be accepted on defaults.
export const Uncounted: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("accept-line-6081")).toBeInTheDocument();
    await expect(canvas.getByTestId("accept-summary-uncounted")).toHaveTextContent("2");
    await expect(canvas.getByTestId("accept-submit")).toBeDisabled();
  },
};

// The whole count: Beras 3 sent, 2 arrived, 1 of them broken; Teh all 5 fine. The broken and the missing rows are
// written, and every good unit is on a rack.
export const CountsTheBoxIn: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("accept-line-6081");

    await type(spin(canvas, "accept-line-6081-arrived"), "2");
    await type(spin(canvas, "accept-line-6081-broken"), "1");
    await pickRack(canvas, "6081", 41n);
    await type(spin(canvas, "accept-line-6081-placement-0-qty"), "1");

    await type(spin(canvas, "accept-line-6082-arrived"), "5");
    await pickRack(canvas, "6082", 43n);
    await type(spin(canvas, "accept-line-6082-placement-0-qty"), "5");

    await waitFor(() => expect(canvas.getByTestId("accept-submit")).toBeEnabled());
    await userEvent.click(canvas.getByTestId("accept-submit"));
    await userEvent.click(await screen.findByTestId("confirm-action"));

    await canvas.findByTestId("at-transfer-detail");
    const done = transferWire(608n);
    await expect(done.status).toBe(WarehouseTransferStatus.ACCEPTED);
    const beras = done.items.find((i) => i.productId === 74n)!;
    await expect(beras.problems.map((p) => p.type)).toEqual([
      WarehouseTransferProblemType.BROKEN,
      WarehouseTransferProblemType.MISSING,
    ]);
  },
};

// A good unit with no rack holds the accept — there is no unplaced pile.
export const EveryGoodUnitNeedsARack: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("accept-line-6081");

    await type(spin(canvas, "accept-line-6081-arrived"), "3");
    await type(spin(canvas, "accept-line-6082-arrived"), "5");

    await expect(canvas.getByTestId("accept-line-6081-placed")).toHaveTextContent("0");
    await expect(canvas.getByTestId("accept-submit")).toBeDisabled();
  },
};

// A courier's charge says what it was for.
export const AChargeNeedsItsNote: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("accept-line-6081");

    await userEvent.type(canvas.getByTestId("accept-charge-amount"), "5000", { delay: 20 });
    await expect(canvas.getByTestId("accept-submit")).toBeDisabled();
    // Where the team's debt to B is held is not decided yet — the card says so.
    await expect(canvas.getByTestId("not-implemented-courierDebt")).toBeInTheDocument();
  },
};

// 601 is still created and is leaving this warehouse — there is nothing here to accept.
export const NotAcceptableHere: Story = {
  render: () => <At601 />,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByTestId("accept-not-acceptable")).toBeInTheDocument();
  },
};
