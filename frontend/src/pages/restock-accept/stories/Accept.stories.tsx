import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { restockRequestService } from "../../../../.storybook/restockStub";
import { restockAcceptScenario } from "../../../../.storybook/restockAcceptScenario";
import { holdUploads, refuseUploads } from "../../../../.storybook/uploadScenario";
import { RestockProblemType, RestockRequestStatus } from "../../../gen/warehouse/inventory/v1/restock_request_pb";
import { toaster } from "../../../components/feedback/Toaster";
import {
  A_01_1,
  A_01_2,
  ACCEPT_META,
  COFFEE,
  PHOTO,
  RICE,
  acceptControl,
  askCharge,
  count,
  countWhole,
  expectAccept,
  lineOf,
  loaded,
  place,
  routedFrom,
  typeInto,
} from "./kit";

// RESTOCK ACCEPT — Terima itself: the one line by it saying what it waits for, what it sends — with nothing left unkept —
// and where every way out lands.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockAccept/Accept",
  ...ACCEPT_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// Built ONCE, at module scope — a router built inside `render` is a fresh history on every re-render (pageStory.tsx).
const FromTheList = routedFrom(502n, "/inventories/restock?status=arrived");

async function confirmAccept(canvasElement: HTMLElement) {
  await userEvent.click(acceptControl(canvasElement));
  const confirm = await screen.findByTestId("confirm-action");
  await waitFor(() => expect(confirm).toBeVisible());
  await userEvent.click(confirm);
}

/**
 * WHAT TERIMA WAITS FOR IS ONE LINE (a-save-button-says-what-it-waits-for) — the first thing still missing, in the
 * page's order, the rest one click away; ✓ once nothing is.
 */
export const TheReadyLineNamesWhatIsMissing: Story = {
  name: "What it waits for",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await lineOf(canvasElement, COFFEE.productId);

    // Two lines to count: the coffee first, the rice under +1.
    await expect(canvas.getByTestId(`accept-ready-line-missing-line-${COFFEE.productId}`)).toBeVisible();
    await userEvent.click(canvas.getByTestId("accept-ready-line-missing-more"));
    const detail = await screen.findByTestId("accept-ready-line-missing-detail");
    await waitFor(() => expect(detail).toBeVisible());
    await expect(within(detail).getByTestId(`accept-ready-line-missing-detail-line-${RICE.productId}`)).toHaveTextContent(
      "received · Beras Pandan Wangi 5kg",
    );
    await userEvent.keyboard("{Escape}");

    await countWhole(canvasElement, COFFEE.productId, A_01_1);
    await expect(canvas.getByTestId(`accept-ready-line-missing-line-${RICE.productId}`)).toBeVisible();
    await expect(canvas.queryByTestId("accept-ready-line-missing-more")).toBeNull();

    await countWhole(canvasElement, RICE.productId, A_01_2);
    await expect(canvas.getByTestId("accept-ready-line-ready")).toHaveTextContent("Ready to accept");
    // Every line counted and the box whole — the count turns success (the-box-count-says-its-state-in-colour).
    await expect(canvas.getByTestId("accept-restock-count")).toHaveAttribute("data-tone", "success");
  },
};

/**
 * THE READY LINE TAKES YOU TO WHAT IT NAMES (owner: *"usulan 1 oke"*, the-ready-line-jumps-to-what-it-names) — each
 * missing thing is a link: the rice, picked from the popover, scrolls into view clear of the header and blinks
 * (a-nav-jump-blinks-where-it-lands).
 */
export const TheReadyLineJumpsToTheLine: Story = {
  name: "Jumps to the line",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await lineOf(canvasElement, RICE.productId);

    await userEvent.click(canvas.getByTestId("accept-ready-line-missing-more"));
    const detail = await screen.findByTestId("accept-ready-line-missing-detail");
    await waitFor(() => expect(detail).toBeVisible());
    await userEvent.click(within(detail).getByTestId(`accept-ready-line-missing-detail-line-${RICE.productId}-link`));

    const rice = canvas.getByTestId(`accept-line-${RICE.productId}`);
    await waitFor(() => expect(rice).toHaveAttribute("data-flash"), { timeout: 2000 });
    // It lands clear of the sticky header, which publishes its height for the jump.
    const page = canvas.getByTestId("restock-accept-page");
    await expect(parseFloat(page.style.getPropertyValue("--accept-header-h"))).toBeGreaterThan(0);
    await expect(getComputedStyle(rice).scrollMarginTop).not.toBe("0px");
  },
};

/**
 * THE CONFIRM SAYS THE COUNT (owner: *"2 oke"*, the-confirm-says-the-count) — before a count that cannot be undone,
 * the figures: coffee 12 all good, rice 4 of 5 — Baik 16 pcs, Rusak 0 (grey), Kurang 1 pcs, and no COD charge. Then
 * Batal leaves everything as it was.
 */
export const TheConfirmSaysTheCount: Story = {
  name: "Confirm says the count",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await countWhole(canvasElement, COFFEE.productId, A_01_1);
    await count(canvasElement, RICE.productId, "4");
    await place(canvasElement, RICE.productId, 0, A_01_2);

    await userEvent.click(acceptControl(canvasElement));
    const summary = await screen.findByTestId("accept-confirm-summary");
    await waitFor(() => expect(summary).toBeVisible());
    await expect(within(summary).getByTestId("accept-confirm-good")).toHaveTextContent("16 pcs");
    await expect(within(summary).getByTestId("accept-confirm-good")).toHaveAttribute("data-tone", "success");
    await expect(within(summary).getByTestId("accept-confirm-broken")).toHaveAttribute("data-tone", "gray");
    await expect(within(summary).getByTestId("accept-confirm-missing")).toHaveTextContent("1 pcs");
    await expect(within(summary).getByTestId("accept-confirm-missing")).toHaveAttribute("data-tone", "warning");
    await expect(within(summary).getByTestId("accept-confirm-charge")).toHaveTextContent("No COD charge paid by the warehouse.");

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("accept-confirm-summary")).toBeNull());
    await expect(canvas.queryByTestId("at-restock-detail")).toBeNull();
  },
};

/**
 * Accepting sends the count and lands on the restock — reached by a link, the page has no opener, so it returns to what
 * Terima was about. The stub keeps what the handler would: received 12 with 1 broken on coffee, the rice 1 short
 * (missing, worked out), the charge and its note.
 */
export const AcceptingCountsTheBoxIn: Story = {
  name: "Counts the box in",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await count(canvasElement, COFFEE.productId, "12", "1");
    await typeInto(canvas.getByTestId(`accept-broken-note-${COFFEE.productId}`), "Bungkus sobek");
    await place(canvasElement, COFFEE.productId, 0, A_01_1);

    await count(canvasElement, RICE.productId, "4");
    await place(canvasElement, RICE.productId, 0, A_01_2);
    // Every line counted, one rice short — the count says so in warning (the-box-count-says-its-state-in-colour).
    await expect(canvas.getByTestId("accept-restock-count")).toHaveAttribute("data-tone", "warning");
    await expect(canvas.getByTestId("accept-restock-count-pcs")).toHaveTextContent("16 of 17 pcs");

    await askCharge(canvasElement);
    await typeInto(canvas.getByTestId("accept-courier-charge"), "5000");
    await typeInto(canvas.getByTestId("accept-courier-note"), "Biaya COD");

    await confirmAccept(canvasElement);
    await expect(await canvas.findByTestId("at-restock-detail", {}, { timeout: 4000 })).toBeInTheDocument();

    const stored = (
      await restockRequestService.restockRequestDetail!({ teamId: 11n, requestId: 502n } as never, {} as never)
    ).request!;
    await expect(stored.status).toBe(RestockRequestStatus.ACCEPTED);
    await expect(stored.warehouseAdditionalCost).toBe(5000);

    const coffee = stored.items!.find((l) => l.productId === COFFEE.productId)!;
    await expect(coffee.receivedCount).toBe(12n);
    await expect(coffee.placements).toEqual([{ placementId: A_01_1, quantity: 11n }]);
    await expect(coffee.problems!.find((p) => p.type === RestockProblemType.BROKEN)?.note).toBe("Bungkus sobek");

    const rice = stored.items!.find((l) => l.productId === RICE.productId)!;
    await expect(rice.problems!.find((p) => p.type === RestockProblemType.MISSING)?.count).toBe(1n);
  },
};

// THE DOOR'S PHOTOS ARE KEPT (a-broken-product-carries-a-photo, the-courier-slip-has-an-optional-photo): Terima sends the
// slip's document with the charge and the broken units' on their line — the uploads made as they were picked — and the
// rice line, with nothing broken, sends none. Nothing is left to say was not kept, so no warning follows.
export const AcceptingKeepsTheDoorsPhotos: Story = {
  name: "Keeps the door's photos",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const pid = COFFEE.productId;

    await askCharge(canvasElement);
    await typeInto(canvas.getByTestId("accept-courier-charge"), "5000");
    await typeInto(canvas.getByTestId("accept-courier-note"), "Biaya COD");
    const slip = within(canvas.getByTestId("accept-courier-photo"));
    await userEvent.upload(slip.getByTestId("accept-courier-photo-input"), PHOTO());
    await waitFor(() => expect(slip.getByTestId("accept-courier-photo-shown")).toHaveAttribute("data-state", "kept"));
    await count(canvasElement, pid, "12", "1");
    const line = await lineOf(canvasElement, pid);
    await userEvent.upload(await line.findByTestId(`accept-broken-photo-${pid}-input`), PHOTO());
    await waitFor(() => expect(line.getByTestId(`accept-broken-photo-${pid}-shown`)).toHaveAttribute("data-state", "kept"));
    await place(canvasElement, pid, 0, A_01_1);
    await countWhole(canvasElement, RICE.productId, A_01_2);

    await confirmAccept(canvasElement);
    await expect(await canvas.findByTestId("at-restock-detail", {}, { timeout: 4000 })).toBeInTheDocument();

    // What was SENT — the stub's uploaded documents, each where it belongs.
    await expect(restockAcceptScenario.photos).toHaveLength(1);
    const sent = restockAcceptScenario.photos[0]!;
    await expect(sent.slip).toMatch(/^stub-upload-/);
    await expect(sent.broken[COFFEE.id.toString()]).toMatch(/^stub-upload-/);
    await expect(sent.broken[COFFEE.id.toString()]).not.toBe(sent.slip);
    await expect(sent.broken[RICE.id.toString()]).toBe("");

    // …and kept on the restock: the slip beside the charge, the photo on the coffee's broken row.
    const stored = (
      await restockRequestService.restockRequestDetail!({ teamId: 11n, requestId: 502n } as never, {} as never)
    ).request!;
    await expect(stored.warehouseAdditionalCostFile).toBe(sent.slip);
    const coffee = stored.items!.find((l) => l.productId === COFFEE.productId)!;
    await expect(coffee.problems!.find((p) => p.type === RestockProblemType.BROKEN)?.photoFile).toBe(
      sent.broken[COFFEE.id.toString()],
    );
    await expect(screen.queryByText(/^Not kept:/)).toBeNull();
  },
};

// …and only what goes with what it belongs to: a slip picked under *Ada*, then the charge taken back to *Tidak ada*, is not
// sent — there is no charge for it to go with. Nothing else is left unkept: the broken units' rack, the last thing Terima
// said it did not keep, is gone (a-restocks-broken-units-are-just-broken-for-now) — so no warning follows, broken units
// and all.
export const AcceptingSaysWhatWasNotKept: Story = {
  name: "Nothing left unkept",
  // The toaster is module-level: a story reading the toasts clears the last story's first.
  beforeEach: () => {
    toaster.remove();
  },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const pid = COFFEE.productId;

    await askCharge(canvasElement);
    const slip = within(canvas.getByTestId("accept-courier-photo"));
    await userEvent.upload(slip.getByTestId("accept-courier-photo-input"), PHOTO());
    await waitFor(() => expect(slip.getByTestId("accept-courier-photo-shown")).toHaveAttribute("data-state", "kept"));
    await userEvent.click(canvas.getByTestId("accept-courier-asked-none"));
    await count(canvasElement, pid, "12", "1");
    await place(canvasElement, pid, 0, A_01_1);
    await countWhole(canvasElement, RICE.productId, A_01_2);

    await confirmAccept(canvasElement);
    await expect(await canvas.findByTestId("at-restock-detail", {}, { timeout: 4000 })).toBeInTheDocument();
    await expect(restockAcceptScenario.photos[0]?.slip).toBe("");
    // Accepted — and that is all Terima says.
    await expect(await screen.findByText("Delivery accepted")).toBeInTheDocument();
    await expect(screen.queryByText(/^Not kept:/)).toBeNull();
  },
};

// A PHOTO STILL ON ITS WAY HOLDS TERIMA (a-save-button-says-what-it-waits-for): the box is counted, but the broken units'
// photo has not finished uploading — the line by Terima names it, and Terima waits; the moment it lands, Terima is free.
export const TerimaWaitsForAPhotoOnItsWay: Story = {
  name: "Waits for a photo on its way",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const pid = COFFEE.productId;

    await count(canvasElement, pid, "12", "1");
    await place(canvasElement, pid, 0, A_01_1);
    await countWhole(canvasElement, RICE.productId, A_01_2);
    await expectAccept(canvasElement, true);

    const release = holdUploads();
    const line = await lineOf(canvasElement, pid);
    await userEvent.upload(await line.findByTestId(`accept-broken-photo-${pid}-input`), PHOTO());
    await waitFor(() =>
      expect(line.getByTestId(`accept-broken-photo-${pid}-shown`)).toHaveAttribute("data-state", "uploading"),
    );
    await expect(canvas.getByTestId(`accept-ready-line-missing-photo-line-${pid}`)).toHaveTextContent(
      "photo still uploading · Kopi Arabika 250g",
    );
    await expectAccept(canvasElement, false);

    release();
    await waitFor(() => expect(line.getByTestId(`accept-broken-photo-${pid}-shown`)).toHaveAttribute("data-state", "kept"));
    await waitFor(() => expect(canvas.queryByTestId(`accept-ready-line-missing-photo-line-${pid}`)).toBeNull());
    await expectAccept(canvasElement, true);
  },
};

// A PHOTO THAT CANNOT BE UPLOADED IS SAID, NEVER KEPT SILENTLY: the refusal is a toast in the photo's own words, the
// picker reads as it did before, and Terima waits for nothing — the photo is optional (a-broken-product-carries-a-photo).
export const ARefusedPhotoIsSaid: Story = {
  name: "A refused photo",
  play: async ({ canvasElement }) => {
    const pid = COFFEE.productId;

    await count(canvasElement, pid, "12", "1");
    await place(canvasElement, pid, 0, A_01_1);
    await countWhole(canvasElement, RICE.productId, A_01_2);

    refuseUploads();
    const line = await lineOf(canvasElement, pid);
    await userEvent.upload(await line.findByTestId(`accept-broken-photo-${pid}-input`), PHOTO());
    await expect(await screen.findByText("The photo could not be uploaded")).toBeInTheDocument();
    await waitFor(() => expect(line.queryByTestId(`accept-broken-photo-${pid}-shown`)).toBeNull());
    await expect(line.getByTestId(`accept-broken-photo-${pid}-pick`)).toHaveTextContent("Add Photo");
    await expectAccept(canvasElement, true);
  },
};

// OPENED FROM THE LIST, BACK TO THE LIST (a-form-returns-where-it-was-opened; owner, on the restock form: *"kalau detail ke
// detail, kalau list ke list"*) — the arrow back…
export const FromTheListBackGoesToTheList: Story = {
  name: "From the list · back",
  render: () => <FromTheList />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("accept-back"));
    await canvas.findByTestId("at-restock-list");
  },
};

// …and Terima, once the box is counted in.
export const FromTheListTerimaGoesToTheList: Story = {
  name: "From the list · Terima",
  render: () => <FromTheList />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await countWhole(canvasElement, COFFEE.productId, A_01_1);
    await countWhole(canvasElement, RICE.productId, A_01_2);

    await confirmAccept(canvasElement);
    await canvas.findByTestId("at-restock-list", {}, { timeout: 4000 });
  },
};
