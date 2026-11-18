import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { restockFixture } from "../../../../.storybook/restockFixtures";
import { raiseTwinRestockForStory } from "../../../../.storybook/restockStub";
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

// ONLY THE RESI CHECK IS MARKED: every field is stored (00024, restock stage 1–3) and carries no mark, and the Order ID
// check is whole now — the server refuses a repeat too (a-reference-in-use-stops-the-restock-form, inventory 00048). The
// resi keeps its mark for what is left: another team's restock holding it is caught by neither half, and the decision
// does not say it should be. A second mark is a field that stopped being kept — this fails the day one comes back.
export const OnlyTheReferenceChecksAreMarked: Story = {
  name: "Only the resi check marked",
  render: () => <EditOngoing />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");

    await expect(canvas.getByTestId("not-implemented-summary")).toBeVisible();
    await expect(canvas.queryByTestId("not-implemented-invoiceRefCheck")).toBeNull();
    await expect(canvas.getByTestId("not-implemented-receiptCheck")).toHaveTextContent("1");
    await expect(canvas.queryAllByTestId(/^not-implemented-(?!summary$|toggle$)/)).toHaveLength(1);
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

// THE SERVER'S REFUSAL IS THE SAME DANGER: the form asked the list while the resi and the Order ID were free, then
// another restock of the team was saved with both — the twin save the screen's check cannot see. Simpan goes out, the
// server refuses it (AlreadyExists, naming the holder), and both fields turn to danger with the twin's number and status,
// exactly as when the check finds a holder itself; the form stays, nothing is saved, and the line by Simpan names the
// first of them. A value nobody holds frees its field again — the other stays in danger until it changes too.
export const TheServersRefusalIsDangerToo: Story = {
  name: "Server refuses a reference in use",
  render: () => <EditOngoing />,
  beforeEach: ongoingFromOneSupplier,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");
    const button = canvas.getByTestId("submit-restock");
    const receipt = canvas.getByTestId("restock-receipt");
    const orderId = canvas.getByTestId("restock-invoice-ref");

    await retype(receipt, "JNE7000000099");
    await retype(orderId, "INV/2026/11/7777");
    await waitFor(() => expect(canvas.getByTestId("restock-form-ready")).toBeVisible(), { timeout: 4000 });
    await expect(canvas.queryByTestId("restock-receipt-check-taken")).toBeNull();

    // The twin lands between the check and the save — in another case, with spaces: still the same parcel.
    const twin = raiseTwinRestockForStory(12n, { receipt: " jne7000000099 ", invoiceRefId: "inv/2026/11/7777" });
    await userEvent.click(button);

    const takenResi = await canvas.findByTestId("restock-receipt-check-taken", {}, { timeout: 4000 });
    await expect(takenResi).toHaveTextContent(`#${twin}`);
    await expect(within(takenResi).getByTestId(`restock-status-${RestockRequestStatus.ONGOING}`)).toBeVisible();
    const takenOrderId = canvas.getByTestId("restock-invoice-ref-check-taken");
    await expect(takenOrderId).toHaveTextContent(`#${twin}`);
    await expect(receipt).toHaveAttribute("aria-invalid", "true");
    await expect(orderId).toHaveAttribute("aria-invalid", "true");
    // The line by Simpan names the first thing missing — the Order ID comes before the resi.
    await expect(canvas.getByTestId("restock-form-missing-invoiceRefTaken")).toBeVisible();
    await expect(button).toBeDisabled();
    // The field says it — no second, raw message under the form, and the form did not leave.
    await expect(canvas.queryByTestId("restock-create-error")).toBeNull();
    await expect(canvas.queryByTestId("at-restock-detail")).toBeNull();

    await retype(orderId, "INV/2026/11/7778");
    await waitFor(() => expect(canvas.queryByTestId("restock-invoice-ref-check-taken")).toBeNull(), { timeout: 4000 });
    await expect(canvas.getByTestId("restock-receipt-check-taken")).toHaveTextContent(`#${twin}`);
    // Once the new Order ID is checked free, the resi is the first thing missing.
    await waitFor(() => expect(canvas.getByTestId("restock-form-missing-receiptTaken")).toBeVisible(), { timeout: 4000 });
    await expect(button).toBeDisabled();
  },
};

// THE GAP THE MARK NAMES: 506 is Toko Kenanga's (team 13), and a selling team cannot list another team's restocks — so
// its resi passes here, and the server, which judges this team's restocks only, takes it too. The decision does not say
// another team's resi should stop the form; the day it does and that is built, this story fails and the mark comes off.
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
