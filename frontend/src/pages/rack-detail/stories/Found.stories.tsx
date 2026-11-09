import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { reportScenario } from "../../../../.storybook/foundRequestStub";
import { asTeam } from "../../../../.storybook/pageStory";
import { asRole } from "../../../../.storybook/sessionScenario";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { At41, RACK_DETAIL_META, type } from "./kit";

// RACK DETAIL — Report Found from the shelf (staff-may-report-a-found): staff and the Owner, and only what this warehouse
// has held. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Racks/RackDetail/Found",
  ...RACK_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function pickProduct(query: string, productCode: string) {
  const dialog = await screen.findByTestId("report-found-dialog");
  const input = within(dialog).getByRole("combobox");
  await userEvent.click(input);
  await userEvent.type(input, query, { delay: 20 });
  const option = await within(dialog).findByTestId(`product-select-option-${productCode}`);
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option);
}

// REPORT FOUND (staff-may-report-a-found): staff report units found on THIS shelf — the rack is set, they pick the
// product — and it waits for the Owner or Admin, posting nothing. Its place here was accepted 2026-11-03.
export const StaffReportFoundHere: Story = {
  name: "Staff report a found",
  render: () => <At41 />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId("rack-action-report-found"));
    const dialog = await screen.findByTestId("report-found-dialog");
    await expect(dialog).toHaveTextContent("Report Found on A-01-1");
    // ONE LINE (a-found-waits-in-one-line): that it waits, who approves, and that it is somebody else.
    await expect(within(dialog).getByTestId("report-found-waits")).toHaveTextContent(
      /^Stock changes once another Owner or Admin of the warehouse approves it\.$/,
    );
    await expect(within(dialog).getByTestId("report-found-submit")).toBeDisabled();
    // ON A DESKTOP IT IS A DIALOG, NOT A SHEET — its own height, well short of the window (full screen is the phone's,
    // by the JS breakpoint; a responsive `size` once stretched it to the window).
    await waitFor(() => expect(dialog.getBoundingClientRect().height).toBeLessThan(window.innerHeight * 0.8));

    // A short count box and a two-row note (the-found-dialog-fits-its-fields).
    const amount = within(dialog).getByTestId("report-found-amount");
    await expect(amount.getBoundingClientRect().width).toBeLessThan(dialog.getBoundingClientRect().width / 2);
    await expect(within(dialog).getByTestId("report-found-note").tagName).toBe("TEXTAREA");

    await pickProduct("beras", "SKU-BERAS-5K");
    await type(amount, "2");
    await userEvent.type(within(dialog).getByTestId("report-found-note"), "Behind the scale", { delay: 20 });
    await userEvent.click(within(dialog).getByTestId("report-found-submit"));

    await expect(await screen.findByText("2 × SKU-BERAS-5K sent for approval")).toBeInTheDocument();
    await expect(reportScenario.last).toEqual({ productId: 74n, rackId: 41n, quantity: 2n, note: "Behind the scale" });
  },
};

// THE × EMPTIES THE PRODUCT (owner: *"produk close ablenya tidak hilang saat produknya sudah close"*): the × goes with it,
// and Send is off again — the dialog no longer holds the product that was cleared.
export const ClearingTheProduct: Story = {
  name: "Clearing the product",
  render: () => <At41 />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId("rack-action-report-found"));
    const dialog = await screen.findByTestId("report-found-dialog");
    await pickProduct("beras", "SKU-BERAS-5K");
    const submit = within(dialog).getByTestId("report-found-submit");
    await waitFor(() => expect(submit).toBeEnabled());

    const clear = within(dialog).getByTestId("product-select-clear");
    await waitFor(() => expect(clear).toBeVisible());
    await userEvent.click(clear);

    await waitFor(() => expect(clear).not.toBeVisible());
    await expect(within(dialog).getByRole("combobox")).toHaveValue("");
    await expect(submit).toBeDisabled();
  },
};

// The picker offers only what this warehouse holds or has held (a-warehouse-picks-only-what-it-has-held): "gula" finds
// Gula Pasir, with its owner beside it — and not Gula Merah's carton, whose team never had it in Gudang Pusat, so a found
// of it would be refused at the report (a-found-never-stocked-here-is-refused-at-the-report).
export const ReportFoundOffersOnlyWhatWasHeldHere: Story = {
  name: "Only what was held here",
  render: () => <At41 />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId("rack-action-report-found"));
    const dialog = await screen.findByTestId("report-found-dialog");
    await waitFor(() => expect(dialog).toBeVisible());
    await expect(dialog).toHaveTextContent("Only products this warehouse holds or has held");

    const input = within(dialog).getByRole("combobox");
    await userEvent.click(input);
    await userEvent.type(input, "gula", { delay: 20 });
    const option = await within(dialog).findByTestId("product-select-option-SKU-GULA-1K");
    await waitFor(() => expect(option).toBeVisible());
    await expect(option).toHaveTextContent("Gula Pasir 1kg · Toko Kenanga");
    await waitFor(() => expect(within(dialog).getAllByRole("option")).toHaveLength(1));
    await expect(within(dialog).queryByTestId("product-select-option-SL-03-ANG-006")).toBeNull();
  },
};

// The Owner and Admin report from the shelf too — the same request, approved by somebody else.
export const TheOwnerReportsFoundToo: Story = {
  name: "The Owner reports too",
  render: () => <At41 />,
  beforeEach: () => {
    asTeam(11n)();
    asRole(Role.WAREHOUSE_OWNER)();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("rack-action-report-found")).toBeInTheDocument();
  },
};
