import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { customShipmentListTerms, customShipmentScenario } from "../../../.storybook/customShipmentScenario";
import { PHONE, SELLING_META, sellingAt } from "../../features/customShipment/storyKit";
import { fitsTheScreen } from "../../features/warehouseTransfer/storyPhone";

// KIRIM PAKET — the selling team's list of its custom shipments (docs/business/custom_shipments/context_decision.md,
// the-custom-shipments-prototype-is-accepted), live: CustomShipmentList through the stub transport
// (.storybook/customShipmentStub.ts), paged and filtered by the server.
//
// Toko Melati (12) sees its seven: 801 requested · 802 picked · 803 a reship requested · 804 handed over · 805 a reship
// handed over · 806 cancelled · 808 picked — never Toko Kenanga's 807.

const Routed = sellingAt("/inventories/custom-shipments");

const meta = {
  title: "Pages/Inventory/CustomShipment/SellingList",
  component: Routed,
  ...SELLING_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("custom-shipment-row-801", {}, { timeout: 4000 });
  return canvas;
}

const rowIds = (canvasElement: HTMLElement) =>
  Array.from(within(canvasElement).getByTestId("custom-shipments-table").querySelectorAll("[data-testid^='custom-shipment-row-']")).map(
    (row) => row.getAttribute("data-testid")!.replace("custom-shipment-row-", ""),
  );

const lastListRequest = () => customShipmentScenario.calls.filter((c) => c.rpc === "CustomShipmentList").at(-1)?.req;

// THE TEAM'S OWN PARCELS, newest first — the kind on each, who it goes to, from which warehouse, the step it is at, what
// is in it, how it travels and who pays, and the sample's value (the team sees what its samples are worth). The list is
// the server's page: asked as the team, page 1 of 20.
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(rowIds(canvasElement)).toEqual(["808", "806", "805", "804", "803", "802", "801"]);
    await expect(canvas.queryByTestId("custom-shipment-row-807")).toBeNull();
    await expect(lastListRequest()).toMatchObject({ teamId: 12n, page: { page: 1, limit: 20 } });

    const sample = within(canvas.getByTestId("custom-shipment-row-801"));
    await expect(sample.getByTestId("custom-shipment-kind-sample")).toBeVisible();
    await expect(sample.getByTestId("custom-shipment-status-requested")).toBeVisible();
    await expect(sample.getByTestId("custom-shipment-recipient-801")).toHaveTextContent("Rina Kusuma");
    await waitFor(() => expect(sample.getByTestId("custom-shipment-other-801")).toHaveTextContent("Gudang Pusat"));
    await expect(sample.getByTestId("custom-shipment-pay-801")).toHaveTextContent("Warehouse pays · at handover");
    await expect(sample.getByTestId("custom-shipment-value-801")).toHaveTextContent("195.000");

    // A reship's value is none of the stock's — it took nothing from a rack.
    const reship = within(canvas.getByTestId("custom-shipment-row-803"));
    await expect(reship.getByTestId("custom-shipment-kind-reship")).toBeVisible();
    await expect(reship.getByTestId("custom-shipment-value-803")).toHaveTextContent("—");

    // The team's own ongkir, and the one the warehouse paid at the handover.
    await expect(canvas.getByTestId("custom-shipment-pay-802")).toHaveTextContent("We pay · Rp 18.000");
    await expect(canvas.getByTestId("custom-shipment-pay-804")).toHaveTextContent("Warehouse paid Rp 12.000");
    await expect(canvas.getByTestId("custom-shipment-pager")).toBeVisible();
  },
};

// A PHONE READS EACH PARCEL AS A BLOCK (every-page-has-a-mobile-story, the transfer lists' blocks): the page names itself
// with Paket Baru as its ＋, the tabs slide, nothing runs past the screen's edge.
export const Mobile: Story = {
  globals: PHONE,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(window.innerWidth).toBe(390);
    await expect(canvas.getByTestId("custom-shipments-table")).toHaveAttribute("data-layout", "phone");
    await expect(canvasElement.querySelector("table")).toBeNull();
    await expect(canvas.getByRole("heading", { name: "Custom Shipments" })).toBeVisible();
    await expect(canvas.getByTestId("open-create-custom-shipment")).toHaveAccessibleName("New Parcel");
    await expect(within(canvas.getByTestId("custom-shipment-row-802")).getByTestId("custom-shipment-actions-802")).toBeVisible();
    await fitsTheScreen(canvasElement);
  },
};

// THE STATUS TABS cut the list to one step ON THE SERVER, and say so in the URL (a-lists-filters-live-in-the-url).
export const ATabNarrowsToItsStatus: Story = {
  name: "A tab narrows to its status",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("custom-shipment-tab-picked"));
    await waitFor(() => expect(rowIds(canvasElement)).toEqual(["808", "802"]));
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("status=picked"));
    await expect(lastListRequest()).toMatchObject({ filter: { status: 2 } });

    await userEvent.click(canvas.getByTestId("custom-shipment-tab-cancelled"));
    await waitFor(() => expect(rowIds(canvasElement)).toEqual(["806"]));
  },
};

// THE KIND is one filter in the strip — Kirim balik ke supplier leaves the two reships.
export const TheKindFilterNarrows: Story = {
  name: "The kind filter narrows",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("custom-shipment-kind"));
    const option = await within(canvasElement).findByTestId("custom-shipment-kind-option-reship");
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await waitFor(() => expect(rowIds(canvasElement)).toEqual(["805", "803"]));
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("kind=reship"));
    await expect(lastListRequest()).toMatchObject({ filter: { kind: 2 } });
  },
};

// THE SEARCH IS THE SERVER'S, sent once typing pauses — the whole term in one request (pasted here as a person's quick
// typing would land), never one request per letter.
export const TheSearchSendsTheWholeTerm: Story = {
  name: "The search sends the whole term",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("custom-shipment-search"));
    await userEvent.paste("Dimas");

    await waitFor(() => expect(rowIds(canvasElement)).toEqual(["808"]));
    await expect(customShipmentListTerms().filter((q) => q !== "")).toEqual(["Dimas"]);
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("q=Dimas"));
  },
};

// NO LETTER MINIMUM (a-product-picker-needs-no-two-letters' spirit): ONE letter is asked of the server as typed — here
// nothing matches it, so the list says so and offers to clear the search.
export const OneLetterIsSearchedToo: Story = {
  name: "One letter is searched too",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("custom-shipment-search"));
    await userEvent.paste("x");

    await waitFor(() => expect(customShipmentListTerms()).toContain("x"));
    await waitFor(() => expect(canvas.getByTestId("custom-shipments-empty")).toBeVisible(), { timeout: 5000 });
    await userEvent.click(canvas.getByTestId("custom-shipments-empty-clear"));
    await waitFor(() => expect(rowIds(canvasElement)).toHaveLength(7));
  },
};

// ⋯ OFFERS WHAT THE STEP ALLOWS (sellingActions): a requested *Gudang bayar* parcel — Cancel only; a picked *Kami bayar*
// one — Edit Shipping Cost only (no cancel once the goods are in the basket); a handed-over one — nothing.
export const EachRowOffersWhatItsStepAllows: Story = {
  name: "Each row offers what its step allows",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("custom-shipment-actions-801"));
    await waitFor(() => expect(screen.getByTestId("custom-shipment-action-cancel-801")).toBeVisible(), { timeout: 5000 });
    await expect(screen.queryByTestId("custom-shipment-action-edit-cost-801")).toBeNull();
    await userEvent.keyboard("{Escape}");

    await userEvent.click(canvas.getByTestId("custom-shipment-actions-802"));
    await waitFor(() => expect(screen.getByTestId("custom-shipment-action-edit-cost-802")).toBeVisible(), { timeout: 5000 });
    await expect(screen.queryByTestId("custom-shipment-action-cancel-802")).toBeNull();
    await userEvent.keyboard("{Escape}");

    await expect(canvas.queryByTestId("custom-shipment-actions-804")).toBeNull();
  },
};

// A CANCEL FROM THE ROW'S ⋯ — the server's write, and the list re-reads: 801 moves to Cancelled where it stands.
export const ARowCancelsFromItsMenu: Story = {
  name: "A row cancels from its menu",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("custom-shipment-actions-801"));
    await userEvent.click(await screen.findByTestId("custom-shipment-action-cancel-801"));
    await userEvent.click(await screen.findByTestId("confirm-action"));

    await waitFor(() =>
      expect(within(canvas.getByTestId("custom-shipment-row-801")).getByTestId("custom-shipment-status-cancelled")).toBeVisible(),
    );
    await expect(customShipmentScenario.calls.filter((c) => c.rpc === "CustomShipmentCancel").map((c) => c.req)).toEqual([
      expect.objectContaining({ teamId: 12n, id: 801n }),
    ]);
  },
};

// Paket Baru opens the form; a row opens its parcel.
export const NewParcelAndARowOpen: Story = {
  name: "New parcel and a row open",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("custom-shipment-row-804"));
    await waitFor(() => expect(canvas.getByTestId("custom-shipment-detail-page")).toBeVisible(), { timeout: 5000 });
    await userEvent.click(canvas.getByTestId("custom-shipment-back"));

    await userEvent.click(await canvas.findByTestId("open-create-custom-shipment"));
    await waitFor(() => expect(canvas.getByTestId("custom-shipment-form")).toBeVisible(), { timeout: 5000 });
  },
};
