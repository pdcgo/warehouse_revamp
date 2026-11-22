import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { customShipmentWrites } from "../../../../.storybook/customShipmentScenario";
import { resolutionsOn } from "../../../../.storybook/restockResolutionScenario";
import { CustomShipmentKind } from "../../../gen/warehouse/inventory/v1/custom_shipment_pb";
import { RestockResolutionType } from "../../../gen/warehouse/inventory/v1/restock_resolution_pb";
import { pickCourier } from "../../../features/customShipment/storyKit";
import { DESKTOP, SELLING_META, recordMenu, resolutionTypes, sellingAt, typeInto } from "../../../features/restockResolution/storyKit";

// A `return` RIDES THE PAKET BARU (backlog #101, live since the-restock-resolutions-prototype-is-accepted). *Catat
// Resolusi → Retur ke Supplier* on a problem restock opens this form on *Kirim balik ke supplier* with the restock picked
// (its broken units, the supplier prefilled as the recipient), saying it is the restock's return; created, the parcel IS
// the restock's `return` resolution — CustomShipmentCreate's `resolution` records the row with the parcel in one step —
// and the page goes back to the restock. Opened plainly, the form is today's Paket Baru.

const FromThe503 = sellingAt("/inventories/restock/503");
const PlainForm = sellingAt("/inventories/custom-shipments/new");

const meta = {
  title: "Pages/Inventory/CustomShipment/Form/Return",
  component: FromThe503,
  ...SELLING_META,
  parameters: { ...SELLING_META.parameters, resolutionSeed: "empty" },
  globals: DESKTOP,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * THE WHOLE STEP — Retur from 503, the form on the reship kind with 503 and its 2 broken Beras, a courier, the
 * resolution's note; Buat — ONE create (reship kind, restock 503, `resolution` with the note), the restock's Resolusi
 * shows the return riding *Paket #809* Diminta.
 */
export const AReturnRecordsItsParcel: Story = {
  name: "Return — the parcel is the resolution",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("restock-detail-resolutions-section", {}, { timeout: 4000 });
    await recordMenu(canvas);
    await userEvent.click(screen.getByTestId("resolution-record-return"));

    const form = within(await canvas.findByTestId("custom-shipment-form", {}, { timeout: 4000 }));
    await waitFor(() => expect(form.getByTestId("custom-shipment-form-name")).toHaveValue("PT Sumber Makmur"), { timeout: 4000 });
    await typeInto(form.getByTestId("custom-shipment-form-return-note"), "2 karung sobek dikirim balik");
    await pickCourier(canvasElement, "jne");
    await waitFor(() => expect(form.getByTestId("custom-shipment-form-submit")).toBeEnabled());
    await userEvent.click(form.getByTestId("custom-shipment-form-submit"));

    const box = within(await canvas.findByTestId("restock-detail-resolutions-section", {}, { timeout: 4000 }));
    await waitFor(() => expect(resolutionTypes(canvasElement)).toEqual(["RETURN"]));
    const creates = customShipmentWrites().filter((c) => c.rpc === "CustomShipmentCreate");
    await expect(creates).toHaveLength(1);
    await expect(creates[0]!.req).toMatchObject({
      kind: CustomShipmentKind.RESTOCK_RESHIP,
      restockId: 503n,
      resolution: { note: "2 karung sobek dikirim balik" },
    });
    const [row] = resolutionsOn(503n);
    await expect(row).toMatchObject({ type: RestockResolutionType.RETURN, note: "2 karung sobek dikirim balik" });
    await waitFor(() => expect(box.getByTestId(`resolution-row-${row!.id}-parcel`)).toHaveTextContent(`Parcel #${row!.customShipmentId}`));
    await waitFor(() =>
      expect(within(box.getByTestId(`resolution-row-${row!.id}-parcel`)).getByTestId("custom-shipment-status-requested")).toBeVisible(),
    );
  },
};

/** PLAIN PAKET BARU — opened without a restock's return, the form is today's: on Sampel, no return card, no `resolution`. */
export const APlainPaketBaru: Story = {
  name: "Plain — no return, today's form",
  render: () => <PlainForm />,
  play: async ({ canvasElement }) => {
    const form = within(await within(canvasElement).findByTestId("custom-shipment-form", {}, { timeout: 4000 }));
    await expect(form.queryByTestId("custom-shipment-form-return")).toBeNull();
    await expect(form.getByTestId("custom-shipment-form-kind-sample")).toHaveAttribute("data-state", "checked");
  },
};
