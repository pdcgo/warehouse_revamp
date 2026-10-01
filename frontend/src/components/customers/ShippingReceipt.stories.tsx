import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";

// A courier's tracking number, in the shape they actually come in.
const RESI = "JP2026081500471183";

import { ShippingReceipt, description } from "./ShippingReceipt";
import { emptyReceipt } from "../orders/ReceiptUpload";
import type { ReceiptValue } from "../orders/ReceiptUpload";

// The two things a receipt actually arrives as. Both, deliberately: narrowing to images would make
// somebody print and photograph a PDF they already have.
const PDF: ReceiptValue = {
  documentId: "doc_8f21",
  filename: "jne-4711.pdf",
  mimeType: "application/pdf",
};

const PHOTO: ReceiptValue = {
  documentId: "doc_9c02",
  filename: "resi-shopee.jpg",
  mimeType: "image/jpeg",
};

const meta = {
  title: "Components/Customers/ShippingReceipt",
  component: ShippingReceipt,
  parameters: {
    docs: { description: { component: description } },
  },
  args: {
    teamId: 1n,
    value: emptyReceipt,
    onChange: fn(),
    code: "",
    onCodeChange: fn(),
    shippingCode: "",
    onShippingCodeChange: fn(),
  },
} satisfies Meta<typeof ShippingReceipt>;

export default meta;
type Story = StoryObj<typeof meta>;

// How the card opens on a fresh order: nothing attached, one button.
export const Empty: Story = {};

// A photographed slip — the ordinary case, since most receipts are taken with the phone in the
// packer's hand.
export const WithPhoto: Story = {
  args: { value: PHOTO },
};

// …and the other one: the PDF a marketplace prints. Same attachment to this form; only the icon says
// which arrived.
export const WithPdf: Story = {
  args: { value: PDF },
};

// A courier chosen when the order was taken, hours before there is a number to type.
export const CourierOnly: Story = {
  args: { shippingCode: "jne" },
};

// The ordinary state of a shipped order: courier and number known, nobody photographed the slip.
export const CodeWithoutFile: Story = {
  args: { shippingCode: "jne", code: RESI },
};

// All three filled in.
export const Complete: Story = {
  args: { shippingCode: "sicepat", code: RESI, value: PHOTO },
};

// NO handlers for either field — the card is the file alone. A caller that cannot hold a value must
// not show a box for it, which is exactly the state the create form is in until the contract carries
// the receipt code.
export const FileOnly: Story = {
  args: { onCodeChange: undefined, onShippingCodeChange: undefined, value: PHOTO },
};

// A REAL, LIVE card: attach is stubbed out (the upload needs document_service), but the code field and
// Remove both work, so the empty ⇄ attached transition can be clicked through rather than read about.
export const Interactive: Story = {
  render: function Interactive(args) {
    const [value, setValue] = useState<ReceiptValue>(PHOTO);
    const [code, setCode] = useState("");
    const [courier, setCourier] = useState("");

    return (
      <ShippingReceipt
        {...args}
        value={value}
        onChange={setValue}
        code={code}
        onCodeChange={setCode}
        shippingCode={courier}
        onShippingCodeChange={setCourier}
      />
    );
  },
};

// THE WHOLE SECTION: a heading, the courier, the code, the file. It is NOT a card — it is one cell of
// CustomerInfoForm's grid, and the card around it belongs to the caller. A Card.Root reappearing here
// would nest a card inside a card on every screen that mounts it.
export const IsATitledCard: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Shipping Receipt")).toBeInTheDocument();
    await expect(canvas.getByTestId("order-receipt-code")).toBeInTheDocument();
    await expect(canvas.getByTestId("order-receipt-upload")).toBeInTheDocument();
    // No card of its own — the caller draws it.
    await expect(canvas.getByTestId("order-receipt-section")).toBeInTheDocument();
  },
};

// COURIER → CODE → FILE, and the order is the point rather than the arrangement: it is the order the
// three arrive in. A courier is chosen when the order is taken, the number comes back from the
// handover, and the slip is photographed afterwards if at all.
export const ReadsCourierThenCodeThenFile: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const courier = canvas.getByText("Shipping");
    const code = canvas.getByTestId("order-receipt-code");
    const file = canvas.getByTestId("order-receipt-upload");

    // DOCUMENT_POSITION_FOLLOWING — each block comes after the previous one in the DOM.
    await expect(
      courier.compareDocumentPosition(code) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await expect(code.compareDocumentPosition(file) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  },
};

// THE CARD EMITS A COURIER CODE, not a name — `sicepat`, the stable key an order stores, so renaming
// a courier never has to rewrite the orders that used it.
//
// This tests the WIRING, not the picker: ShippingSelect has its own story file for how it opens,
// filters and clears. What can break here is this card passing the wrong half of the pair.
//
// ⚠ The listbox is PORTALLED, so the option is found on `screen` rather than inside the canvas, and
// it is waited on — until the popover finishes animating in, `pointer-events: none` rejects the click.
export const EmitsTheCourierCode: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("combobox"));

    const option = await screen.findByTestId("shipping-select-option-sicepat");
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await expect(args.onShippingCodeChange).toHaveBeenCalledWith("sicepat");
  },
};

// …and hidden entirely without a handler, for the same reason the code field is: a picker whose
// selection is dropped on submit is worse than no picker.
export const CourierIsAbsentWithoutAHandler: Story = {
  args: { onShippingCodeChange: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByRole("combobox")).toBeNull();
    await expect(canvas.getByTestId("order-receipt-upload")).toBeInTheDocument();
  },
};

// WHAT IS TYPED IS WHAT IS HELD. No uppercasing, no trimming mid-typing, no stripping the dashes and
// spaces inside a code: it is pasted into the courier's tracking box, and one we have "tidied" is one
// that comes back not found.
//
// ⚠ IT HOLDS REAL STATE. A story pinning `code` to a constant re-renders the field back after every
// keystroke, so typing would test nothing — and `{ delay: 40 }` because at machine speed a controlled
// input drops characters.
export const CodeIsHeldVerbatim: Story = {
  render: function TypedCode(args) {
    const [code, setCode] = useState("");

    return <ShippingReceipt {...args} code={code} onCodeChange={setCode} />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const field = canvas.getByTestId("order-receipt-code");
    await userEvent.type(field, "spx-id 04", { delay: 40 });

    await expect(field).toHaveValue("spx-id 04");
  },
};

// The code field is HIDDEN, not disabled, when the caller cannot hold the value. A disabled box still
// says "there is a place for this here", which is a promise the caller cannot keep.
export const CodeFieldIsAbsentWithoutAHandler: Story = {
  args: { onCodeChange: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("order-receipt-code")).toBeNull();
    await expect(canvas.getByTestId("order-receipt-upload")).toBeInTheDocument();
  },
};

// Empty offers ATTACH, and shows no attached row — there is nothing to detach yet.
export const EmptyOffersAttach: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("order-receipt-pick")).toHaveTextContent("Attach receipt");
    await expect(canvas.queryByTestId("order-receipt-attached")).toBeNull();
  },
};

// ONE RECEIPT, REPLACED — never accumulated. An order ships once, and a list of receipts leaves
// "which of these is the real one?" for somebody to answer later. The button says so.
export const AttachedOffersReplaceNotAdd: Story = {
  args: { value: PDF },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("order-receipt-attached")).toHaveTextContent("jne-4711.pdf");
    await expect(canvas.getByTestId("order-receipt-pick")).toHaveTextContent("Replace receipt");
  },
};

// REMOVE DETACHES IT FROM THE ORDER, and that is all it does — it reports the empty value and leaves
// the uploaded document where it is. Nothing here owns that file yet, and deleting it because a form
// changed its mind is how a receipt disappears from an order that was already placed with it.
export const RemoveDetachesTheReceipt: Story = {
  args: { value: PDF },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("order-receipt-remove"));

    await expect(args.onChange).toHaveBeenCalledWith(emptyReceipt);
  },
};

// The help text is part of the card, not decoration: it is where the accepted kinds and the size
// ceiling are stated, and both are refused client-side before a byte is uploaded.
export const StatesWhatItAccepts: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("order-receipt-upload")).toHaveTextContent("10 MB");
  },
};
