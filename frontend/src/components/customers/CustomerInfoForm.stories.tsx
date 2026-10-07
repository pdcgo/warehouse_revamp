import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { CustomerInfoForm, description } from "./CustomerInfoForm";
import { emptyAddress } from "./AddressPicker";
import type { AddressValue } from "./AddressPicker";
import { emptyReceipt } from "../orders/ReceiptUpload";

// An address as the picker emits it — CODES AND NAMES both, because a consumer snapshots the names
// onto its own record rather than keeping a live reference into the region tree.
const bandung: AddressValue = {
  provinsiCode: "32",
  provinsiName: "Jawa Barat",
  kabupatenCode: "3273",
  kabupatenName: "Kota Bandung",
  kecamatanCode: "327309",
  kecamatanName: "Coblong",
  desaCode: "3273091005",
  desaName: "Dago",
  kodePos: "40135",
  addressLine: "Jl. Ir. H. Juanda No. 12, RT 03/RW 05",
};

const meta = {
  title: "Components/Customers/CustomerInfoForm",
  component: CustomerInfoForm,
  parameters: {
    docs: { description: { component: description } },
  },
  args: {
    customerName: "",
    onCustomerNameChange: fn(),
    customerPhone: "",
    onCustomerPhoneChange: fn(),
    address: emptyAddress,
    onAddressChange: fn(),
    // The RECEIPT CELL, on by default: the create form is the screen this card was built for, and it
    // has one. The draft case (no receipt) is its own story below.
    teamId: 1n,
    receipt: emptyReceipt,
    onReceiptChange: fn(),
    shippingCode: "",
    onShippingCodeChange: fn(),
  },
} satisfies Meta<typeof CustomerInfoForm>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

// How the card opens on a fresh order: an empty customer beside an empty address, the name the only
// required field in either column.
export const Empty: Story = {};

// A customer taken down over the phone, address and all — the whole card at its tallest.
export const Filled: Story = {
  args: {
    customerName: "Siti Rahmawati",
    customerPhone: "0812-3456-7890",
    address: bandung,
  },
};

// THE ORDINARY CASE, and the reason neither the phone nor the address is required: an order is taken
// while the buyer is still looking up their own postcode (#118). A name is enough to start.
export const NameOnly: Story = {
  args: { customerName: "Budi Santoso" },
};

// THE DRAFT SHAPE — no receipt cell, and a different testid prefix. Nothing has been handed to a
// courier yet, so there is no slip to attach and no number to type; the card is customer + address.
export const OnADraft: Story = {
  args: {
    idPrefix: "draft",
    customerName: "Andi Pratama",
    customerPhone: "0857-1111-2222",
    address: bandung,
    onReceiptChange: undefined,
    receipt: undefined,
  },
};

// A LIVE card, for clicking through rather than reading about — the address cascade included.
export const Interactive: Story = {
  render: function Interactive(args) {
    const [name, setName] = useState("");
    const [phone, setPhone] = useState("");
    const [address, setAddress] = useState<AddressValue>(emptyAddress);

    return (
      <CustomerInfoForm
        {...args}
        customerName={name}
        onCustomerNameChange={setName}
        customerPhone={phone}
        onCustomerPhoneChange={setPhone}
        address={address}
        onAddressChange={setAddress}
      />
    );
  },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// THE CARD NAMES ITSELF, and says what it is for. Without the header the card opened on three
// same-sized section headings with nothing saying they belonged together — and the description is
// what makes "why is a shipping receipt in the customer card?" answerable from the screen.
export const HasATitleAndADescription: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Customer Information")).toBeInTheDocument();
    await expect(
      canvas.getByText("Who the parcel is for, where it goes, and what was handed to the courier."),
    ).toBeInTheDocument();
  },
};

// THE CARD IS WHO THE ORDER IS FOR: a heading, the name, the phone — in that order, which is the
// order somebody says them while taking an order down.
export const IsATitledCardOfNameThenPhone: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Customer")).toBeInTheDocument();

    const name = canvas.getByTestId("order-create-customer-name");
    const phone = canvas.getByTestId("order-create-customer-phone");

    await expect(name.compareDocumentPosition(phone) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  },
};

// ⚠ TWO COLUMNS IN ONE CARD (owner) — the customer, then the address. They were two separate cards,
// and the address drifted far enough from the name that nothing on screen said whose address it was.
// This is the rule that keeps them together, and keeps the customer FIRST: it is what is asked for
// first, and it is what the narrow-screen single column collapses to at the top.
export const HoldsTheCustomerBesideTheAddress: Story = {
  args: { customerName: "Siti Rahmawati", address: bandung },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const customer = canvas.getByTestId("order-create-customer");
    const address = canvas.getByTestId("order-create-address");

    await expect(canvas.getByText("Delivery address")).toBeInTheDocument();
    await expect(
      customer.compareDocumentPosition(address) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  },
};

// THE ADDRESS IS REALLY THE PICKER, not a copy of it: the four-rung cascade, the postcode and the
// street box. Re-implementing it here would lose the postcode lookup and the "a kelurahan is not 1:1
// with a postcode" rule the picker carries.
export const AddressColumnIsTheRealPicker: Story = {
  args: { address: bandung },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const address = within(canvas.getByTestId("order-create-address"));

    await expect(address.getByDisplayValue("Jawa Barat")).toBeInTheDocument();
    await expect(address.getByDisplayValue("Kota Bandung")).toBeInTheDocument();
    await expect(address.getByDisplayValue("40135")).toBeInTheDocument();
    await expect(
      address.getByDisplayValue("Jl. Ir. H. Juanda No. 12, RT 03/RW 05"),
    ).toBeInTheDocument();
  },
};

// AN EMPTY ADDRESS IS A NORMAL STATE, not a gap to flag (#118). An order is taken while the buyer is
// still looking up their own postcode, so the column renders its empty picker and says nothing about
// it — the name beside it is the only field that ever complains.
export const EmptyAddressIsNotAnError: Story = {
  args: { customerName: "Budi Santoso" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const address = canvas.getByTestId("order-create-address");

    await expect(address).toBeInTheDocument();
    await expect(within(address).queryByRole("alert")).toBeNull();
  },
};

// ⚠ NO COURIER PICKER (owner). It used to sit in this card under a "Customer & shipping" heading; a
// courier is a fact about the PARCEL, so it lives on ShippingReceipt now. This story is what stops it
// drifting back and putting one value in two boxes.
export const CarriesNoCourierPicker: Story = {
  args: { customerName: "Siti Rahmawati" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // ⚠ SCOPED TO THE CUSTOMER CELL. The card as a whole HAS a courier — it is in the receipt
    // section, where it belongs — and the address rungs are comboboxes too. The rule is about which
    // cell it sits in, so the query has to be about one cell.
    await expect(within(canvas.getByTestId("order-create-customer")).queryByRole("combobox")).toBeNull();
    await expect(canvas.queryByText("Customer & shipping")).toBeNull();
  },
};

// ⚠ THE THIRD CELL: the receipt, UNDER the customer and beside the address. It is where the courier
// lives, which is why the customer cell above has none.
export const HoldsTheReceiptUnderTheCustomer: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const customer = canvas.getByTestId("order-create-customer");
    const receipt = canvas.getByTestId("order-receipt-section");

    await expect(
      customer.compareDocumentPosition(receipt) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await expect(within(receipt).getByTestId("shipping-select")).toBeInTheDocument();
    await expect(within(receipt).getByTestId("order-receipt-upload")).toBeInTheDocument();
  },
};

// …AND IT IS ABSENT WITHOUT A HANDLER — the draft case. A draft has nothing handed over yet, so a
// slip box and a tracking field would be two controls whose contents go nowhere.
export const ReceiptCellIsAbsentWithoutAHandler: Story = {
  args: { onReceiptChange: undefined, receipt: undefined, address: bandung },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("order-receipt-section")).toBeNull();
    await expect(canvas.queryByTestId("shipping-select")).toBeNull();
    // The other two cells are untouched.
    await expect(canvas.getByTestId("order-create-customer")).toBeInTheDocument();
    await expect(canvas.getByTestId("order-create-address")).toBeInTheDocument();
  },
};

// THE NAME IS THE REQUIRED ONE, and it is the only required field on the whole order form: an order
// cannot be created without it and a draft cannot be promoted without it. The asterisk says so before
// somebody has to find out from a disabled button.
export const OnlyTheNameIsRequired: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("order-create-customer-name")).toBeRequired();
    await expect(canvas.getByTestId("order-create-customer-phone")).not.toBeRequired();
  },
};

// What is typed is what is reported — no trimming mid-typing, no casing. A name is written the way
// the customer says it, and a phone number keeps the spacing people paste in.
//
// ⚠ Its own live state: a story pinning `value` to a constant re-renders the field back after every
// keystroke, so the spy would only ever see one character and the assertion would test nothing.
export const ReportsWhatIsTyped: Story = {
  render: function Typing(args) {
    const [name, setName] = useState("");
    const [phone, setPhone] = useState("");
    const [address, setAddress] = useState<AddressValue>(emptyAddress);

    return (
      <CustomerInfoForm
        {...args}
        address={address}
        onAddressChange={setAddress}
        customerName={name}
        onCustomerNameChange={(v) => {
          args.onCustomerNameChange(v);
          setName(v);
        }}
        customerPhone={phone}
        onCustomerPhoneChange={(v) => {
          args.onCustomerPhoneChange(v);
          setPhone(v);
        }}
      />
    );
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    // Slowly — at machine speed a controlled input drops characters.
    await userEvent.type(canvas.getByTestId("order-create-customer-name"), "Bu Ani", { delay: 40 });
    await expect(args.onCustomerNameChange).toHaveBeenLastCalledWith("Bu Ani");

    await userEvent.type(canvas.getByTestId("order-create-customer-phone"), "0812 345", {
      delay: 40,
    });
    await expect(args.onCustomerPhoneChange).toHaveBeenLastCalledWith("0812 345");
  },
};

// The prefix reaches BOTH fields. One that renamed the name and not the phone would look right on
// screen and break exactly one assertion on one screen.
export const IdPrefixRenamesEveryField: Story = {
  args: { idPrefix: "draft" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("draft-customer-name")).toBeInTheDocument();
    await expect(canvas.getByTestId("draft-customer-phone")).toBeInTheDocument();
    await expect(canvas.queryByTestId("order-create-customer-name")).toBeNull();
  },
};
