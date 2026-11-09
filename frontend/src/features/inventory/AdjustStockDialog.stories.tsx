import { useState } from "react";
import { create } from "@bufbuild/protobuf";
import { Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { reportScenario } from "../../../.storybook/foundRequestStub";
import { type Product, ProductSchema } from "../../gen/warehouse/product/v1/product_pb";
import { AdjustStockDialog, description } from "./AdjustStockDialog";

// THE ADJUST DIALOG — and its FOUND, which waits for approval (an-adjust-found-waits-for-the-owner-or-admin).
//
// A unit found on a rack names no batch: it is reported through FoundRequestCreate for the warehouse Owner or Admin to
// approve, and the dialog says plainly that nothing changes until then. Damaged and Lost still name their batch.
//
// Gudang Pusat (11): Beras on B-02-1 is free; stock count #15 holds Gula Pasir on A-01-2; Kopi Arabika was never stocked
// here (foundRequestFixtures.ts).

const BERAS = create(ProductSchema, { id: 74n, teamId: 12n, productCode: "SKU-BERAS-5K", name: "Beras Pandan Wangi 5kg" });
const GULA = create(ProductSchema, { id: 73n, teamId: 13n, productCode: "SKU-GULA-1K", name: "Gula Pasir 1kg" });
const KOPI = create(ProductSchema, { id: 71n, teamId: 11n, productCode: "SKU-KOPI-250", name: "Kopi Arabika 250g" });

function Open({ product }: { product: Product }) {
  const [open, setOpen] = useState(true);

  return (
    <>
      <AdjustStockDialog warehouseId={11n} product={product} currentOnHand={8n} open={open} onOpenChange={setOpen} />
      {!open && <Text data-testid="adjust-closed">closed</Text>}
    </>
  );
}

const meta = {
  title: "Features/Inventory/AdjustStockDialog",
  component: AdjustStockDialog,
  parameters: { docs: { description: { component: description } } },
  args: { warehouseId: 11n, product: BERAS, currentOnHand: 8n, open: true, onOpenChange: () => {} },
  render: (args) => <Open product={args.product} />,
} satisfies Meta<typeof AdjustStockDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

// The dialog portals and its RackSelect renders inline, so the option is looked up inside the picker's own root.
async function pickRack(rackId: bigint) {
  const trigger = await screen.findByTestId("rack-select");
  const root = trigger.closest<HTMLElement>('[data-scope="select"][data-part="root"]')!;
  await userEvent.click(trigger);
  const option = await within(root).findByTestId(`rack-select-option-${rackId}`);
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option);
}

async function amount(value: string) {
  const el = screen.getByTestId("adjust-amount");
  await userEvent.clear(el);
  await userEvent.type(el, value, { delay: 40 });
}

async function reportFound(rackId: bigint) {
  await screen.findByTestId("adjust-dialog");
  await pickRack(rackId);
  await userEvent.selectOptions(screen.getByTestId("adjust-reason-type"), "found");
}

// Found asks for no batch, says nothing changes until the Owner or Admin approves, and sends a request.
export const FoundWaitsForApproval: Story = {
  play: async () => {
    await reportFound(43n);

    // No batch — the approval picks the batches (the oldest loss's, then a minted one).
    await expect(screen.queryByTestId("adjust-batch")).toBeNull();
    const notice = screen.getByTestId("adjust-found-waits");
    // ONE LINE (a-found-waits-in-one-line); what it claims back on approval is its hover.
    await expect(notice).toHaveTextContent(/^Stock changes once another Owner or Admin of the warehouse approves it\.$/);
    await expect(notice).toHaveAttribute("title", expect.stringContaining("oldest open loss"));

    // A found report starts at one unit, not at the rack's on-hand.
    await expect(screen.getByTestId("adjust-amount")).toHaveValue("1");
    await amount("4");
    await userEvent.type(screen.getByTestId("adjust-reason"), "Behind the cartons", { delay: 20 });
    // Nothing moves now, so there is no before → after.
    await expect(screen.queryByTestId("adjust-delta")).toBeNull();

    const submit = screen.getByTestId("submit-adjust");
    await expect(submit).toHaveTextContent("Send for Approval");
    await userEvent.click(submit);

    await screen.findByTestId("adjust-closed");
    // FoundRequestCreate — the one door; StockAdjust refuses FOUND.
    await expect(reportScenario.last).toEqual({ productId: 74n, rackId: 43n, quantity: 4n, note: "Behind the cartons" });
  },
};

// A PRODUCT ITS TEAM NEVER HAD HERE IS REFUSED AT THE REPORT (a-found-never-stocked-here-is-refused-at-the-report): the
// server's words name it and say how it comes in, and nothing is sent.
export const NeverStockedHereIsRefused: Story = {
  args: { product: KOPI },
  play: async () => {
    await reportFound(43n);
    await userEvent.click(screen.getByTestId("submit-adjust"));

    const error = await screen.findByTestId("adjust-error");
    await expect(error).toHaveTextContent("Kopi Arabika 250g (SKU-KOPI-250) was never stocked here");
    await expect(error).toHaveTextContent("bring it in by restock");
    await expect(screen.queryByTestId("adjust-closed")).toBeNull();
  },
};

// Found alone names no batch: Damaged still names the batch the units are written off from.
export const DamagedStillNamesItsBatch: Story = {
  play: async () => {
    await screen.findByTestId("adjust-dialog");
    await pickRack(43n);
    await userEvent.selectOptions(screen.getByTestId("adjust-reason-type"), "damaged");

    await expect(await screen.findByTestId("adjust-batch")).toBeInTheDocument();
    await expect(screen.queryByTestId("adjust-found-waits")).toBeNull();
    await expect(screen.getByTestId("submit-adjust")).toHaveTextContent("Adjust");
  },
};

// A stock count holding the product on the rack refuses the report like every adjustment
// (a-lock-stops-sales-and-cancels-too) — nothing is sent for approval, and the dialog says which count.
export const ACountedRackRefusesTheFound: Story = {
  args: { product: GULA },
  play: async () => {
    await reportFound(42n);
    await amount("2");
    await userEvent.click(screen.getByTestId("submit-adjust"));

    await expect(await screen.findByTestId("adjust-error")).toHaveTextContent("count #15");
    await expect(reportScenario.last?.productId).toBe(73n);
    await expect(screen.queryByTestId("adjust-closed")).toBeNull();
  },
};

// The note says where its limit is — FoundRequestCreateRequest.note's 200 (a-limited-field-shows-its-count).
export const TheNoteShowsItsLimit: Story = {
  play: async () => {
    await reportFound(43n);
    await userEvent.type(screen.getByTestId("adjust-reason"), "Rak bawah", { delay: 20 });
    await expect(screen.getByTestId("adjust-reason-count")).toHaveTextContent("9/200");
  },
};
