import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { restockFixture } from "../../../../.storybook/restockFixtures";
import { RestockRequestStatus } from "../../../gen/warehouse/inventory/v1/restock_request_pb";
import { ACCEPTED, ARRIVED, EditOngoing, FORM_META, ONGOING, loaded, ongoingFromOneSupplier } from "./kit";

// RESTOCK FORM — payment and parcel — its typed fields, and a resi or an Order ID already on another restock
// (a-reference-in-use-stops-the-restock-form).
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockForm/Payment",
  ...FORM_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Clear a field and type into it, at a speed a controlled input keeps up with. */
async function retype(el: HTMLElement, text: string) {
  await userEvent.clear(el);
  await userEvent.type(el, text, { delay: 20 });
}

// ONLY THE REFERENCE CHECKS ARE MARKED: every field is stored (00024, restock stage 1–3) and carries no mark; the two
// checks see this team's restocks only, and nothing behind them refuses (a-reference-in-use-stops-the-restock-form). A
// third mark is a field that stopped being kept — this fails the day one comes back.
export const OnlyTheReferenceChecksAreMarked: Story = {
  name: "Only the checks marked",
  render: () => <EditOngoing />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");

    await expect(canvas.getByTestId("not-implemented-summary")).toBeVisible();
    await expect(canvas.getByTestId("not-implemented-invoiceRefCheck")).toHaveTextContent("1");
    await expect(canvas.getByTestId("not-implemented-receiptCheck")).toHaveTextContent("2");
    await expect(canvas.queryAllByTestId(/^not-implemented-(?!summary$|toggle$)/)).toHaveLength(2);
  },
};

// IN DANGER UNDER THE FIELD, AND SIMPAN WAITS (owner: *"ada checker … untuk cek resi dan order id -> danger langsung di
// formnya"*, *"hasil checkernya jadi validasi juga"*) — 502's resi typed into 501, in lower case: the same parcel. Its
// number and status show in red under the field, and the line by Simpan names it. A resi nobody holds frees it again.
export const AResiInUseIsDangerAndStopsSave: Story = {
  name: "Resi in use",
  render: () => <EditOngoing />,
  beforeEach: ongoingFromOneSupplier,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");
    const button = canvas.getByTestId("submit-restock");
    const receipt = canvas.getByTestId("restock-receipt");

    await waitFor(() => expect(button).toBeEnabled(), { timeout: 4000 });

    await retype(receipt, ARRIVED.receipt.toLowerCase());
    const taken = await canvas.findByTestId("restock-receipt-check-taken", {}, { timeout: 4000 });
    await expect(taken).toHaveTextContent(`#${ARRIVED.id}`);
    await expect(within(taken).getByTestId(`restock-status-${RestockRequestStatus.ARRIVED}`)).toBeVisible();
    await expect(receipt).toHaveAttribute("aria-invalid", "true");
    await expect(canvas.getByTestId("restock-form-missing-receiptTaken")).toBeVisible();
    await expect(button).toBeDisabled();

    await retype(receipt, "JNE7000000001");
    await waitFor(() => expect(canvas.queryByTestId("restock-receipt-check-taken")).toBeNull(), { timeout: 4000 });
    await waitFor(() => expect(button).toBeEnabled(), { timeout: 4000 });
  },
};

// …and an Order ID the same way — 503's, whose restock was accepted: every status but cancelled holds it.
export const AnOrderIdInUseIsDangerToo: Story = {
  name: "Order ID in use",
  render: () => <EditOngoing />,
  beforeEach: ongoingFromOneSupplier,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");
    const button = canvas.getByTestId("submit-restock");

    await waitFor(() => expect(button).toBeEnabled(), { timeout: 4000 });

    await retype(canvas.getByTestId("restock-invoice-ref"), ACCEPTED.invoiceRefId);
    const taken = await canvas.findByTestId("restock-invoice-ref-check-taken", {}, { timeout: 4000 });
    await expect(taken).toHaveTextContent(`#${ACCEPTED.id}`);
    await expect(within(taken).getByTestId(`restock-status-${RestockRequestStatus.ACCEPTED}`)).toBeVisible();
    await expect(canvas.getByTestId("restock-form-missing-invoiceRefTaken")).toBeVisible();
    await expect(button).toBeDisabled();
  },
};

// NOT A DUPLICATE: the restock being edited does not hold its own resi and Order ID, and a CANCELLED restock holds
// nothing — 505's Order ID is free again. Simpan waits for the answer, then saves.
export const ACancelledRestockHoldsNothing: Story = {
  name: "Cancelled holds nothing",
  render: () => <EditOngoing />,
  beforeEach: ongoingFromOneSupplier,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");

    await waitFor(() => expect(canvas.getByTestId("restock-form-ready")).toBeVisible(), { timeout: 4000 });
    await expect(canvas.queryByTestId("restock-receipt-check-taken")).toBeNull();
    await expect(canvas.queryByTestId("restock-invoice-ref-check-taken")).toBeNull();

    await retype(canvas.getByTestId("restock-invoice-ref"), restockFixture(505n).invoiceRefId);
    await canvas.findByTestId("restock-form-missing-invoiceRefChecking");
    await expect(canvas.getByTestId("submit-restock")).toBeDisabled();

    await waitFor(() => expect(canvas.getByTestId("restock-form-ready")).toBeVisible(), { timeout: 4000 });
    await expect(canvas.queryByTestId("restock-invoice-ref-check-taken")).toBeNull();
    await expect(canvas.getByTestId("submit-restock")).toBeEnabled();
  },
};

// THE GAP THE MARK NAMES: 506 is Toko Kenanga's (team 13), and a selling team cannot list another team's restocks — so
// its resi passes here. The day the server checks every team, this story fails and the mark comes off.
export const AnotherTeamsResiIsNotCaughtYet: Story = {
  name: "Another team's resi",
  render: () => <EditOngoing />,
  beforeEach: ongoingFromOneSupplier,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");

    await waitFor(() => expect(canvas.getByTestId("submit-restock")).toBeEnabled(), { timeout: 4000 });

    await retype(canvas.getByTestId("restock-receipt"), restockFixture(506n).receipt);
    await canvas.findByTestId("restock-form-missing-receiptChecking");
    await waitFor(() => expect(canvas.getByTestId("restock-form-ready")).toBeVisible(), { timeout: 4000 });
    await expect(canvas.queryByTestId("restock-receipt-check-taken")).toBeNull();
  },
};

// THE ORDER ID, AN EXAMPLE IN EVERY TYPED FIELD, AND A LIMITED ONE'S COUNT — the store's reference reads Order ID
// (the-store-reference-is-the-order-id), its field and the tracking number show an example (every-form-field-shows-an-example),
// and each limited field says how much of its limit is used (a-limited-field-shows-its-count).
export const EveryFieldShowsAnExampleAndItsCount: Story = {
  name: "Examples and counts",
  render: () => <EditOngoing />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");
    const orderId = canvas.getByTestId("restock-invoice-ref");

    await expect(canvas.getByText("Order ID")).toBeVisible();
    await expect(orderId).toHaveAttribute("placeholder", expect.stringMatching(/^Example: /));
    await expect(canvas.getByTestId("restock-receipt")).toHaveAttribute("placeholder", expect.stringMatching(/^Example: /));
    await expect(canvas.getByTestId("restock-note")).toHaveAttribute("placeholder", expect.stringMatching(/^Example: /));
    await expect(canvas.getByTestId("restock-line-0-note")).toHaveAttribute("placeholder", expect.stringMatching(/^Example: /));

    await expect(canvas.getByTestId("restock-invoice-ref-count")).toHaveTextContent(`${ONGOING.invoiceRefId.length}/100`);
    await expect(canvas.getByTestId("restock-receipt-count")).toHaveTextContent(`${ONGOING.receipt.length}/100`);
    await expect(canvas.getByTestId("restock-note-count")).toHaveTextContent(`${ONGOING.note.length}/1000`);
    await expect(canvas.getByTestId("restock-line-0-note-count")).toHaveTextContent(/\/200$/);

    await userEvent.clear(orderId);
    await userEvent.type(orderId, "INV-7", { delay: 30 });
    await expect(canvas.getByTestId("restock-invoice-ref-count")).toHaveTextContent("5/100");
  },
};
