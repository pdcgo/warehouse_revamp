import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { receiptLabel, receiptLabelFile } from "../../../../.storybook/fixtures";
import { receiptCheckScenario } from "../../../../.storybook/sessionScenario";
import { ORDER_CREATE_META } from "./kit";

// ORDER CREATE — the receipt file and its two numbers, and the label read back.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Order/OrderCreate/Receipt",
  ...ORDER_CREATE_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// THE RECEIPT FILE LEADS, AND THE TWO NUMBERS IT CARRIES SIT WITH IT (owner) — the marketplace's
// order id and the courier's tracking number are printed on one piece of paper, so they are one card
// at the top rather than two fields three cards apart. The other half of the move is that the
// customer card no longer holds a courier or a file.
export const TheReceiptFileLeadsWithBothOfItsNumbers: Story = {
  name: "Leads, with both numbers",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const receiptCard = canvas.getByTestId("order-create-receipt-preview").closest("div[class*='card__root']");
    await expect(receiptCard).not.toBeNull();
    await expect(within(receiptCard as HTMLElement).getByTestId("order-external-ref-id")).toBeInTheDocument();
    await expect(within(receiptCard as HTMLElement).getByTestId("order-receipt-code")).toBeInTheDocument();

    // The old home of the courier + upload, now empty of them.
    await expect(canvas.queryByTestId("order-receipt-section")).toBeNull();
  },
};

// ── THE LABEL, READ BACK — shipment's ReceiptCheck (receipt-check-is-shipments) ─────────────────
//
// The check runs on the FILE the person picked, beside its upload (receipt-check-takes-the-file-bytes).
// The stub answers by a marker written into the fake PDF (`receiptLabelFile`), so each story names the
// answer it is about.

async function attachReceipt(canvasElement: HTMLElement, file: File, answer: string) {
  const input = canvasElement.querySelector<HTMLInputElement>(
    '[data-testid="order-receipt-upload"] input[type="file"]',
  );
  await expect(input).not.toBeNull();
  await userEvent.upload(input as HTMLInputElement, file, { applyAccept: false });

  const canvas = within(canvasElement);
  await canvas.findByTestId("order-receipt-attached");
  // The check has ANSWERED — what makes "nothing appeared" an assertion rather than a race.
  await waitFor(() =>
    expect(canvas.getByTestId("order-create-receipt-card")).toHaveAttribute("data-scan-result", answer),
  );
}

// A label that reads fills BOTH empty boxes, and says it did: a box that filled itself looks exactly
// like one somebody typed, and only one of the two should be trusted without a second look.
export const AttachingALabelFillsItsTwoNumbers: Story = {
  name: "A label fills both",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await attachReceipt(canvasElement, receiptLabelFile(), "read");

    await expect(canvas.getByTestId("order-external-ref-id")).toHaveValue(receiptLabel.orderRefId);
    await expect(canvas.getByTestId("order-receipt-code")).toHaveValue(receiptLabel.receipt);
    await expect(canvas.getByTestId("order-create-scan-filled")).toBeVisible();
    await expect(canvas.queryByTestId("order-create-scan-notice")).toBeNull();
  },
};

// ⚠ A MACHINE NEVER OVERWRITES A PERSON. The typed order id stays; only the EMPTY tracking box fills.
// The disagreement is raised at Create instead (`checkScanMatches`), where somebody can look at both.
export const ALabelNeverOverwritesWhatWasTyped: Story = {
  name: "Never overwrites",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("order-external-ref-id"), "260101BBBB0002", { delay: 10 });
    await attachReceipt(canvasElement, receiptLabelFile(), "read");

    await expect(canvas.getByTestId("order-external-ref-id")).toHaveValue("260101BBBB0002");
    await expect(canvas.getByTestId("order-receipt-code")).toHaveValue(receiptLabel.receipt);
  },
};

// A file that is not a courier's label SAYS so — a warning, never a refusal: the file stays attached,
// and nothing is filled from it (a-label-outcome-is-a-result-not-an-error).
export const AFileThatIsNotALabelSaysSo: Story = {
  name: "Not a label",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await attachReceipt(canvasElement, receiptLabelFile("not_shipping_label"), "notShippingLabel");

    await expect(canvas.getByTestId("order-create-scan-notice")).toHaveAttribute("data-result", "notShippingLabel");
    await expect(canvas.getByTestId("order-receipt-attached")).toBeInTheDocument();
    await expect(canvas.getByTestId("order-external-ref-id")).toHaveValue("");
    await expect(canvas.getByTestId("order-receipt-code")).toHaveValue("");
  },
};

// A bulk print is read as NOTHING — never page 1, which would fill in another order's numbers.
//
// ⚠ The real ReceiptCheck does not answer `multipleLabels` yet: the reader's error for it is unexported, so a bulk print
// comes back `unknownLabel` and says nothing (docs/services/shipment_service/rpc.md). This pins what the form does the
// day it does.
export const ABulkPrintFillsNothingAndSaysWhy: Story = {
  name: "Bulk print",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await attachReceipt(canvasElement, receiptLabelFile("multiple_labels"), "multipleLabels");

    await expect(canvas.getByTestId("order-create-scan-notice")).toHaveAttribute("data-result", "multipleLabels");
    await expect(canvas.getByTestId("order-receipt-code")).toHaveValue("");
  },
};

// …and a real label the reader has not learned yet says NOTHING. It is normal, not a failure: the
// person types the numbers exactly as before the check existed.
export const ALabelTheReaderDoesNotKnowSaysNothing: Story = {
  name: "Unknown label",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await attachReceipt(canvasElement, receiptLabelFile("unknown_label"), "unknownLabel");

    await expect(canvas.queryByTestId("order-create-scan-notice")).toBeNull();
    await expect(canvas.queryByTestId("order-create-scan-filled")).toBeNull();
    await expect(canvas.getByTestId("order-receipt-code")).toHaveValue("");
  },
};

// TWO CHECKS ALREADY RUNNING IS "NO CHECK" (an-attached-file-is-up-to-15-mb-and-two-checks-run-at-once). The server
// refuses a third at once (ResourceExhausted), and the form treats the failed call exactly as no check at all: the
// file stays attached, nothing fills, nothing is said — no notice and no error. The person types the numbers.
export const ABusyCheckIsNoCheck: Story = {
  name: "Busy, no check",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const input = canvasElement.querySelector<HTMLInputElement>(
      '[data-testid="order-receipt-upload"] input[type="file"]',
    );
    await expect(input).not.toBeNull();
    await userEvent.upload(input as HTMLInputElement, receiptLabelFile("busy"), { applyAccept: false });

    await canvas.findByTestId("order-receipt-attached");
    // The check WAS asked, and refused — what makes "nothing appeared" an assertion rather than a race. A refusal
    // leaves no mark on the card to wait for, so the page is given a moment to show anything it was going to.
    await waitFor(() => expect(receiptCheckScenario.refused).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 200));

    await expect(canvas.getByTestId("order-create-receipt-card")).toHaveAttribute("data-scan-result", "none");
    await expect(canvas.queryByTestId("order-create-scan-notice")).toBeNull();
    await expect(canvas.queryByTestId("order-create-scan-filled")).toBeNull();
    await expect(canvas.getByTestId("order-receipt-code")).toHaveValue("");
    await expect(screen.queryByText("The receipt could not be uploaded")).toBeNull();
    await expect(screen.queryByText(/label checks/i)).toBeNull();
  },
};

// EVERY PART OF THE FORM IS WIRED (2026-10-23): the receipt file was the last, and ReceiptCheck is built
// (the-receipt-check-prototype-is-accepted). So a new order carries no strip and no mark — a mark that comes back
// is a part that stopped being real, and this fails the day it does. Even with a label read, the line that says the
// boxes filled themselves carries no ⚠. (The duplicate-ref warning's draft half held one entry for a day, until
// OrderDraftByExternalRefs was built.)
export const NothingOnTheFormIsMarkedNotImplemented: Story = {
  name: "Nothing marked",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await attachReceipt(canvasElement, receiptLabelFile(), "read");
    await expect(canvas.getByTestId("order-create-scan-filled")).toBeVisible();

    await expect(canvas.queryByTestId("not-implemented-summary")).toBeNull();
    await expect(canvas.queryAllByTestId(/^not-implemented-/)).toHaveLength(0);
  },
};
