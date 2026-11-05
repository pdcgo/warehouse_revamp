import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { asTeam } from "../../../../.storybook/pageStory";
import { orderDetailFor, users } from "../../../../.storybook/fixtures";
import { ORDER_DETAIL_META, Routed, WAREHOUSE } from "./kit";

// ONE ORDER — the status rows and the people on them.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Order/OrderDetailPage/Timeline",
  ...ORDER_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// 102 went back to pending WITH A REASON — a status row's `note` — beside a warehouse note row.
const HANDED_BACK = orderDetailFor(102n)!;
const HANDBACK_REASON = HANDED_BACK.timelineLogs.find((log) => log.status !== 0 && log.note)!.note!;
const HANDED_BACK_NOTE = HANDED_BACK.timelineLogs.find((log) => log.status === 0)!.note!;

/**
 * THE HISTORY TAB, WITH THE PEOPLE RESOLVED.
 *
 * The actor ids come from the TIMELINE — the order row records no actor at all — and are resolved
 * through a separate `UserByIDs` read. ⚠ `fetchActors` SWALLOWS a failure there, so an unstubbed
 * lookup does not throw: it quietly degrades every step to "User #61". This story is what notices.
 */
export const Timeline: Story = {
  name: "People resolved",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("timeline-rail")).toBeInTheDocument());

    const ani = users.find((u) => u.id === 61n)!;
    await waitFor(async () => {
      await expect(canvasElement).toHaveTextContent(ani.name);
    });

    // EACH ROW SAYS WHICH SIDE WROTE IT (order-timeline-logs-replaces-order-events): the seller placed the order,
    // the warehouse confirmed it.
    await expect(canvas.getByTestId("order-timeline-pending")).toHaveTextContent("Seller");
    await expect(canvas.getByTestId("order-timeline-processed")).toHaveTextContent("Warehouse");
  },
};

/**
 * ACTOR 0 IS "NOT RECORDED", NOT "USER ZERO".
 *
 * A row whose writer was not identified is in that state. The step must still SHOW — it
 * happened — while the page stays silent about who took it. Inventing a name there would be worse
 * than the gap, and hiding the step would be worse still.
 */
const AtBackfilled = Routed("/orders/108");

export const UnrecordedActor: Story = {
  name: "Unrecorded actor",
  render: () => <AtBackfilled />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("timeline-rail")).toBeInTheDocument());

    // The steps are there — asserted by TESTID, not by the words "handed over", which also appear in the
    // status badge in the header and would pass against a completely empty timeline.
    await waitFor(() => expect(canvas.getByTestId("order-timeline-shipping")).toBeInTheDocument());
    await expect(canvas.getByTestId("order-timeline-pending")).toBeInTheDocument();

    // …and nobody is named on them. Both halves are checked: no resolved person block, and no
    // "User #0" — the fallback firing on an id that means ABSENCE is the specific bug here.
    await expect(canvas.queryByTestId("order-timeline-shipping-by")).not.toBeInTheDocument();
    await expect(canvasElement).not.toHaveTextContent(/User #0/);
  },
};

/**
 * THE TIMELINE IS THE STATUS ROWS. A note row is not a step — it is in Catatan, and only there — while a STATUS row's
 * own reason (102 went back to pending because Rak A was empty) stays under the step it explains.
 */
const AtHandedBack = Routed(`/orders/${HANDED_BACK.id}`);

export const TheTimelineKeepsStatusRowsOnly: Story = {
  name: "Status rows only",
  render: () => <AtHandedBack />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const rail = await canvas.findByTestId("timeline-rail");

    await expect(rail).toHaveTextContent("Handed back to pending");
    await expect(rail).toHaveTextContent(HANDBACK_REASON);
    await expect(rail).not.toHaveTextContent(HANDED_BACK_NOTE);
    await expect(canvas.queryByTestId("order-timeline-note")).not.toBeInTheDocument();

    const notes = await within(canvas.getByTestId("section-notes")).findByTestId("notes-list");
    await expect(notes).toHaveTextContent(HANDED_BACK_NOTE);
    await expect(notes).not.toHaveTextContent(HANDBACK_REASON);
  },
};

/** THE WAREHOUSE'S TIMELINE TAB DROPS THE NOTES TOO, and keeps the hand-back's reason on its step. */
export const WarehouseTimelineKeepsStatusRowsOnly: Story = {
  name: "Warehouse · status rows only",
  beforeEach: asTeam(WAREHOUSE.id),
  render: () => <AtHandedBack />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId("order-detail-tab-timeline"));
    const timeline = await canvas.findByTestId("order-detail-timeline");

    await waitFor(() => expect(timeline).toHaveTextContent(HANDBACK_REASON));
    await expect(timeline).not.toHaveTextContent(HANDED_BACK_NOTE);
  },
};
