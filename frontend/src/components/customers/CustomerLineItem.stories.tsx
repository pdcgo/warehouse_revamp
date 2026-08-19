import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button, Stack } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { CustomerLineItem, description } from "./CustomerLineItem";

// The address shape every caller satisfies — an order's frozen snapshot, a draft's, or the picker's
// in-progress value. Written out here so the story asserts on the same names the component reads.
const bandung = {
  provinsiName: "Jawa Barat",
  kabupatenName: "Kota Bandung",
  kecamatanName: "Coblong",
  desaName: "Dago",
  addressLine: "Jl. Ir. H. Juanda No. 12, RT 03/RW 05",
  kodePos: "40135",
};

const meta = {
  title: "Components/Customers/CustomerLineItem",
  component: CustomerLineItem,
  parameters: {
    docs: { description: { component: description } },
  },
  args: {
    name: "Siti Rahmawati",
    phone: "0812-3456-7890",
    address: bandung,
  },
} satisfies Meta<typeof CustomerLineItem>;

export default meta;
type Story = StoryObj<typeof meta>;

// The default row: name + phone. The address is passed but not shown — a caller opts into it.
export const Default: Story = {};

export const NameOnly: Story = {
  args: { showPhone: false },
};

export const WithAddress: Story = {
  args: { showAddress: true },
};

export const AddressWithoutPhone: Story = {
  args: { showPhone: false, showAddress: true },
};

export const NoPhoneOnRecord: Story = {
  args: { phone: "" },
};

export const Missing: Story = {
  args: { name: "", phone: "" },
};

export const Large: Story = {
  args: { size: "lg", showAddress: true },
};

export const WithAction: Story = {
  args: { action: <Button size="xs">Open</Button> },
};

// The four shapes a caller picks between, stacked so the density of each is comparable.
export const InAList: Story = {
  render: () => (
    <Stack gap="3" w="96">
      <CustomerLineItem name="Siti Rahmawati" phone="0812-3456-7890" testId="1" />
      <CustomerLineItem name="Budi Santoso" testId="2" />
      <CustomerLineItem name="" phone="0857-1111-2222" testId="3" />
      <CustomerLineItem
        name="Andi Pratama"
        phone="0821-9999-0000"
        address={bandung}
        showAddress
        testId="4"
      />
    </Stack>
  ),
};

// The two facts a row is read for: who, and how to reach them. The phone is on by default — a
// caller that wants it should not have to ask.
export const ShowsNameAndPhoneByDefault: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Siti Rahmawati")).toBeInTheDocument();
    await expect(canvas.getByText("0812-3456-7890")).toBeInTheDocument();
  },
};

// …and `showPhone={false}` reduces the row to the name, for a narrow column that has room for
// nothing else.
export const PhoneCanBeTurnedOff: Story = {
  args: { showPhone: false, testId: "5" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Siti Rahmawati")).toBeInTheDocument();
    await expect(canvas.queryByTestId("customer-line-item-phone-5")).toBeNull();
  },
};

// A MISSING NAME IS SHOWN, not blanked. An order requires a customer name and a draft without one
// cannot be promoted (`draftGaps` → `missingCustomer`), so the empty case is the one worth seeing —
// the same reasoning that keeps ProductListItem's stock badge visible at zero. Replacing this with a
// bare "—" is the regression this story exists to catch.
export const MissingNameIsCalledOut: Story = {
  args: { name: "", phone: "" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("No customer")).toBeInTheDocument();
    await expect(canvas.queryByText("—")).toBeNull();
  },
};

// Whitespace is not a name. A scraped push can arrive with " " in the field, and rendering it would
// give a row that looks filled in and blocks promotion for no visible reason.
export const BlankNameCountsAsMissing: Story = {
  args: { name: "   " },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("No customer")).toBeInTheDocument();
  },
};

// The OPPOSITE rule to the name: an absent phone renders nothing at all, EVEN WITH `showPhone` ON.
// The flag says the column has room for a phone, not that there must be one — most orders have
// none, and a column of dashes is what trains people to stop reading the field.
export const AbsentPhoneRendersNothingEvenWhenShown: Story = {
  args: { phone: "", showPhone: true, testId: "7" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Siti Rahmawati")).toBeInTheDocument();
    await expect(canvas.queryByTestId("customer-line-item-phone-7")).toBeNull();
  },
};

// The address reads narrowest-first — the order an address is said aloud.
export const AddressIsNarrowestFirst: Story = {
  args: { showAddress: true, testId: "8" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("customer-line-item-address-8")).toHaveTextContent(
      "Dago, Coblong, Kota Bandung, Jawa Barat",
    );
  },
};

// …and it is OFF unless asked for, so a customer column stays a customer column. Passing the
// address alone must not start rendering it.
export const AddressHiddenByDefault: Story = {
  args: { testId: "9" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("customer-line-item-address-9")).toBeNull();
  },
};

// The summary is NOT the shipping label. The street line and the postcode are deliberately absent —
// anything somebody copies onto a parcel uses AddressField, which is unclamped for that reason.
export const AddressOmitsStreetAndPostcode: Story = {
  args: { showAddress: true, testId: "10" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const line = canvas.getByTestId("customer-line-item-address-10");

    await expect(line).not.toHaveTextContent("Jl. Ir. H. Juanda");
    await expect(line).not.toHaveTextContent("40135");
  },
};

// A snapshot that only ever got a province still renders that one name rather than an empty line.
export const PartialAddressStillRenders: Story = {
  args: { address: { provinsiName: "Jawa Barat" }, showAddress: true, testId: "11" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("customer-line-item-address-11")).toHaveTextContent(
      "Jawa Barat",
    );
  },
};

// Both off, and nothing on record: the row is a single line and renders no empty second row.
export const BothOffLeavesOnlyTheName: Story = {
  args: { showPhone: false, showAddress: false, testId: "12" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("customer-line-item-phone-12")).toBeNull();
    await expect(canvas.queryByTestId("customer-line-item-address-12")).toBeNull();
    await expect(canvas.getByTestId("customer-line-item-name-12")).toHaveTextContent(
      "Siti Rahmawati",
    );
  },
};
