import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";

import { asTeam } from "../../../../.storybook/pageStory";
import { orders } from "../../../../.storybook/fixtures";
import { ORDER_DETAIL_PENDING } from "../pending";
import { ORDER_DETAIL_META, Routed, WAREHOUSE } from "./kit";

// ONE ORDER — without the marks, a warehouse reading another team's order, not found, a bad id, every gap marked.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Order/OrderDetailPage/States",
  ...ORDER_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// 110 belongs to Toko Kenanga but ships from Gudang Pusat — the other half of the two-sided read.
const OTHER_TEAMS = orders.find((o) => o.id === 110n)!;

/** The layout without the ⚠ scaffolding — the version to judge the design on. */
export const WithoutTheMarks: Story = {
  name: "Without the marks",
  globals: { pendingMarks: "off" },
};

/**
 * THE SCOPE IS TWO-SIDED — a warehouse reads an order it did not place.
 *
 * 110 belongs to Toko Kenanga and ships from Gudang Pusat. The picking crew must be able to open the
 * job they are picking, so `team_id` matching the WAREHOUSE is enough. ⚠ Tightening this to an owner
 * check is the change this story exists to catch.
 */
const AtOtherTeamsOrder = Routed(`/orders/${OTHER_TEAMS.id}`);

// ⚠ AND IT READS THE OLD PAGE. A warehouse gets `WarehouseOrderDetail` — the seller's rebuilt detail
// shows harga beli and margin, which a building fulfilling many sellers has no business reading
// (`the-two-ends-are-two-screens`). The tabs below are that page's.
export const WarehouseReadsAnotherTeamsOrder: Story = {
  name: "Warehouse reads it",
  beforeEach: asTeam(WAREHOUSE.id),
  render: () => <AtOtherTeamsOrder />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-detail-title")).toBeInTheDocument());
    await expect(canvas.getByTestId("order-detail-title")).toHaveTextContent(
      OTHER_TEAMS.id.toString(),
    );
    await expect(canvas.getByText(OTHER_TEAMS.customerName)).toBeInTheDocument();
    // The warehouse's Info tab names the buyer's marketplace username beside the customer, too.
    await expect(canvas.getByTestId("order-detail-buyer-username")).toHaveTextContent(OTHER_TEAMS.buyerUsername!);
  },
};

/**
 * AN ORDER THIS TEAM MAY NOT READ IS "NOT FOUND", not "forbidden".
 *
 * 110 is Kenanga's and ships from Gudang Pusat, so Melati is on neither side of it. The page shows
 * the error and keeps the way back — a dead end with no back button is how somebody gets stuck on a
 * URL they mistyped.
 */
const AtForbidden = Routed("/orders/110");

export const NotFound: Story = {
  name: "Not found",
  render: () => <AtForbidden />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-detail-error")).toBeInTheDocument());
    await expect(canvas.getByTestId("order-detail-back")).toBeInTheDocument();
  },
};

/**
 * A MALFORMED ID NEVER REACHES THE SERVER.
 *
 * The query is disabled for it, so the message comes from the page rather than from an error no
 * request produced — which is also why this cannot be folded into `NotFound`: one is a refusal, the
 * other never asked.
 */
const AtGarbageId = Routed("/orders/not-a-number");

export const InvalidId: Story = {
  name: "Invalid id",
  render: () => <AtGarbageId />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-detail-error")).toBeInTheDocument());
  },
};

/**
 * ⚠ EVERY GAP THE SCREEN DECLARES HAS A MARK ON IT. The deadline entry once sat in the pending list for
 * a whole round with no badge anywhere, while the deadline itself was the loudest invented thing on the
 * page. No exemptions (owner: *"kasih saja dulu seperti lainnya"*).
 */
export const EveryDeclaredGapIsMarkedOnScreen: Story = {
  name: "Every gap marked",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("summary-tiles")).toBeInTheDocument());

    for (const part of ORDER_DETAIL_PENDING.parts) {
      await expect(canvas.queryAllByTestId(`not-implemented-${part.id}`).length).toBeGreaterThan(0);
    }
  },
};
