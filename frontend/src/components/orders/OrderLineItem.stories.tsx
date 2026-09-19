import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button, Stack } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { OrderLineItem, description } from "./OrderLineItem";
import { OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";

// The seller's own reference for the sale — a draft's `external_id`.
const REF = "INV-250815-004";

// A courier's tracking number, in the shape they actually come in: mixed case, digits, and a length
// nobody would type twice.
const RESI = "JP2026081500471183";

const meta = {
  title: "Components/Orders/OrderLineItem",
  component: OrderLineItem,
  parameters: {
    docs: { description: { component: description } },
  },
  args: {
    id: 1042n,
    orderRefId: REF,
    status: OrderStatus.SHIPPED,
    receiptCode: RESI,
  },
} satisfies Meta<typeof OrderLineItem>;

export default meta;
type Story = StoryObj<typeof meta>;

// All three of the order's names, and where it has got to.
export const Default: Story = {};

// The ordinary state of a fresh order — placed hours or days before the courier issues a code.
export const NotShippedYet: Story = {
  args: { status: OrderStatus.PLACED, receiptCode: "" },
};

// An order taken over the phone has no reference and never will, so the parentheses are simply absent.
export const NoOrderRef: Story = {
  args: { orderRefId: "", status: OrderStatus.PLACED, receiptCode: "" },
};

// A SCRAPED DRAFT: no id of ours yet, so its own ref is the only name it has.
export const DraftHasOnlyItsRef: Story = {
  args: { id: 0n, status: undefined, receiptCode: "" },
};

export const Confirmed: Story = {
  args: { status: OrderStatus.CONFIRMED, receiptCode: "" },
};

export const Picking: Story = {
  args: { status: OrderStatus.PICKING, receiptCode: "" },
};

export const Cancelled: Story = {
  args: { status: OrderStatus.CANCELLED, receiptCode: "" },
};

// Nothing but our own number: an order typed in by hand and not yet shipped.
export const IdAlone: Story = {
  args: { orderRefId: "", status: undefined, receiptCode: "" },
};

// Marketplace refs and courier codes both run long. Neither clamps — see the rule.
export const LongReferences: Story = {
  args: { orderRefId: "250815PXKM7TDNQF", receiptCode: "SPXID04871166553219-XZ" },
};

export const Large: Story = {
  args: { size: "lg" },
};

export const WithAction: Story = {
  args: { action: <Button size="xs">Open</Button> },
};

// A page of orders. Only the shipped one carries a code and only the scraped ones carry a ref, which
// is the shape a real list has — the two-line row collapses to one wherever there is nothing to say.
export const InAList: Story = {
  render: () => (
    <Stack gap="4" w="lg">
      <OrderLineItem id={1042n} orderRefId="INV-250815-004" status={OrderStatus.PLACED} />
      <OrderLineItem id={1041n} status={OrderStatus.PICKING} />
      <OrderLineItem
        id={1040n}
        orderRefId="INV-250814-118"
        status={OrderStatus.SHIPPED}
        receiptCode={RESI}
      />
      <OrderLineItem id={0n} orderRefId="250815PXKM7TDNQF" />
      <OrderLineItem id={1039n} status={OrderStatus.CANCELLED} />
    </Stack>
  ),
};

// The three names of one order, on the two lines the layout is: `#ours (theirs) [status]`, then the
// courier's.
export const ShowsIdRefStatusAndCode: Story = {
  args: { testId: "a" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("order-line-item-id-a")).toHaveTextContent("#1042");
    await expect(canvas.getByTestId("order-line-item-ref-a")).toHaveTextContent(`(${REF})`);
    await expect(canvas.getByText("Shipped")).toBeInTheDocument();
    await expect(canvas.getByTestId("order-line-item-receipt-a")).toHaveTextContent(RESI);
  },
};

// IDENTITY ONLY. No customer, no money, no date, no line count — each belongs to a component or a
// column that already owns it, and this is the story that catches one of them creeping back in.
export const CarriesNoMoneyOrDate: Story = {
  args: { testId: "b" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByText(/^Rp/)).toBeNull();
    await expect(canvas.queryByTestId("order-line-item-total-b")).toBeNull();
    await expect(canvas.queryByTestId("order-line-item-date-b")).toBeNull();
    await expect(canvas.queryByTestId("order-line-item-items-b")).toBeNull();
  },
};

// AN ORDER WITH NO ID IS "Unsaved", NEVER "#0". Zero is not an order number: it is searchable,
// quotable and completely fictional, and printing it is how somebody ends up looking for order 0.
export const UnsavedOrderIsNotNumberZero: Story = {
  args: { id: 0n, testId: "c" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("order-line-item-id-c")).toHaveTextContent("Unsaved");
    await expect(canvas.queryByText("#0")).toBeNull();
  },
};

// …and an absent id behaves identically to `0n`. The create form holds no id field at all until the
// server answers, so both spellings of "not saved yet" reach this component.
export const AbsentIdReadsTheSameAsZero: Story = {
  args: { id: undefined, testId: "d" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("order-line-item-id-d")).toHaveTextContent("Unsaved");
  },
};

// A DRAFT IS READ BY ITS REF. It has no id of ours, so the ref is not a decoration beside the number
// — it is the only thing on the row anybody can match against their own records.
export const RefSurvivesWhenThereIsNoId: Story = {
  args: { id: 0n, testId: "e" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("order-line-item-id-e")).toHaveTextContent("Unsaved");
    await expect(canvas.getByTestId("order-line-item-ref-e")).toHaveTextContent(`(${REF})`);
  },
};

// NO REF RENDERS NOTHING — never an empty `()`. An order taken over the phone has no reference, and
// a pair of brackets around nothing reads as a value that failed to load.
export const MissingRefRendersNoParentheses: Story = {
  args: { orderRefId: "", testId: "f" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("order-line-item-ref-f")).toBeNull();
    await expect(canvas.queryByText("()")).toBeNull();
  },
};

// Whitespace is not a reference. A scraped push arrives padded often enough that rendering it would
// give a row with empty brackets on it.
export const BlankRefCountsAsMissing: Story = {
  args: { orderRefId: "   ", testId: "g" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("order-line-item-ref-g")).toBeNull();
  },
};

// RENDERED VERBATIM, like every reference here. It is pasted into the seller's own spreadsheet, and
// one we have uppercased or stripped is one that comes back not found.
export const RefIsRenderedVerbatim: Story = {
  args: { orderRefId: "inv 250815/004-a", testId: "h" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("order-line-item-ref-h")).toHaveTextContent(
      "(inv 250815/004-a)",
    );
  },
};

// A DRAFT HAS NO STATUS, and none is invented for it. Defaulting to PLACED would claim stock had been
// taken off a shelf for something nobody has placed; defaulting to "Unknown" would claim the system
// lost track of an order it never had.
export const NoStatusRendersNoBadge: Story = {
  args: { status: undefined, testId: "i" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("order-line-item-id-i")).toHaveTextContent("#1042");
    await expect(canvas.queryByText("Shipped")).toBeNull();
    await expect(canvas.queryByText("Unknown")).toBeNull();
  },
};

// The status comes from the shared badge, so the colour and the wording are the ones the tabs above
// the list use. A locally-written label here is how one screen starts calling PICKING something else.
export const StatusUsesTheSharedBadge: Story = {
  args: { status: OrderStatus.PICKING, testId: "j" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId(`order-status-${OrderStatus.PICKING}`)).toHaveTextContent(
      "Picking",
    );
  },
};

// THE RECEIPT CODE IS THE NAME THE OUTSIDE WORLD USES — the courier, the marketplace and the buyer
// all call the parcel by it — so it gets its own line rather than being crowded onto the first.
export const ShowsTheReceiptCode: Story = {
  args: { testId: "k" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("order-line-item-receipt-k")).toHaveTextContent(RESI);
  },
};

// Verbatim too: no uppercasing, no stripping of dashes or spaces inside it. The code is pasted into a
// courier's tracking box, and one we have "tidied" is one that comes back not found.
export const ReceiptCodeIsRenderedVerbatim: Story = {
  args: { receiptCode: "spx-id 0487 1166a", testId: "l" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("order-line-item-receipt-l")).toHaveTextContent(
      "spx-id 0487 1166a",
    );
  },
};

// NEVER CLAMPED. Half a tracking number with an ellipsis after it is worse than none — it looks like
// a value somebody can use. This is the same rule CustomerLineItem's phone follows.
export const LongCodeIsNotClamped: Story = {
  args: { receiptCode: "SPXID04871166553219-XZ", testId: "m" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const line = canvas.getByTestId("order-line-item-receipt-m");

    await expect(line).toHaveTextContent("SPXID04871166553219-XZ");
    await expect(line).not.toHaveTextContent("…");
  },
};

// NO CODE RENDERS NOTHING — no icon, no dash, no reserved space. An order is placed hours or days
// before the courier issues one, so a marker on every unshipped order is the noise that trains people
// to stop reading the field.
export const MissingCodeRendersNothing: Story = {
  args: { receiptCode: "", status: OrderStatus.PLACED, testId: "n" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("order-line-item-receipt-n")).toBeNull();
    await expect(canvas.queryByText("—")).toBeNull();
  },
};

// Whitespace is not a code either — a padded scrape would otherwise put an icon beside an empty space,
// on a row that then claims to be trackable.
export const BlankCodeCountsAsMissing: Story = {
  args: { receiptCode: "   ", testId: "o" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("order-line-item-receipt-o")).toBeNull();
  },
};

// Everything optional absent: the row collapses to our own number and renders no empty second line.
export const IdAloneLeavesOneLine: Story = {
  args: {
    orderRefId: "",
    status: undefined,
    receiptCode: "",
    testId: "p",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("order-line-item-id-p")).toHaveTextContent("#1042");
    await expect(canvas.queryByTestId("order-line-item-ref-p")).toBeNull();
    await expect(canvas.queryByTestId("order-line-item-receipt-p")).toBeNull();
  },
};
