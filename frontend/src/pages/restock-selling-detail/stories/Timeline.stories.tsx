import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";

import { patchRestock } from "../../../../.storybook/restockStub";
import { RestockRequestStatus } from "../../../gen/warehouse/inventory/v1/restock_request_pb";
import { At502, SELLING_DETAIL_META, loaded, openTab, trailRows } from "./kit";

// RESTOCK SELLING DETAIL — Riwayat — the trail, its edit rows, and how its line runs.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockSellingDetail/Timeline",
  ...SELLING_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// THE TIMELINE LINES UP (the-timeline-is-centred-and-lines-up) — each step's icon at the middle of its step, not its top;
// every person one width, so the rule beside them runs straight down; and the line runs from the first icon's centre to
// the last's, unbroken — not above the first, not short of the last (owner: *"garis riwayatnya masih belum ngikut"*).
export const TheTimelineLinesUp: Story = {
  name: "Lines up",
  render: () => <At502 />,
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);
    await waitFor(() => expect(trailRows(canvasElement).length).toBeGreaterThanOrEqual(3));
    const steps = trailRows(canvasElement);

    const widths = steps.map((step) => step.querySelector<HTMLElement>("[data-testid$='-by']")!.getBoundingClientRect().width);
    await expect(new Set(widths.map(Math.round)).size).toBe(1);

    for (const step of steps) {
      const indicator = step.querySelector<HTMLElement>(".chakra-timeline__indicator")!.getBoundingClientRect();
      const content = step.querySelector<HTMLElement>(".chakra-timeline__content")!;
      const box = content.getBoundingClientRect();
      const gap = parseFloat(getComputedStyle(content).paddingBottom);
      const middle = box.top + (box.height - gap) / 2;
      await expect(Math.abs(indicator.top + indicator.height / 2 - middle)).toBeLessThan(3);
    }

    // The line: every icon of the trail (the awaiting step's too), and every piece of line behind them.
    const timeline = canvasElement.querySelector<HTMLElement>("[data-testid='restock-detail-timeline']")!;
    const centres = [...timeline.querySelectorAll<HTMLElement>(".chakra-timeline__indicator")].map((el) => {
      const r = el.getBoundingClientRect();
      return r.top + r.height / 2;
    });
    const pieces = [...timeline.querySelectorAll<HTMLElement>(".chakra-timeline__separator")]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.height > 0)
      .sort((a, b) => a.top - b.top);
    await expect(Math.abs(pieces[0]!.top - centres[0]!)).toBeLessThan(2);
    await expect(Math.abs(pieces.at(-1)!.bottom - centres.at(-1)!)).toBeLessThan(2);
    for (let i = 1; i < pieces.length; i++) {
      await expect(Math.abs(pieces[i]!.top - pieces[i - 1]!.bottom)).toBeLessThan(2);
    }
  },
};

// The server's bare "edited" is not shown on an edit's row — it says nothing the row's title does not. 501 is given the
// row the server writes today: an edit, its description the one word.
export const ABareEditSaysNoMore: Story = {
  name: "A bare edit",
  beforeEach: () =>
    patchRestock(501n, {
      logs: [
        { id: 1n, fromStatus: RestockRequestStatus.UNSPECIFIED, toStatus: RestockRequestStatus.ONGOING, actorUserId: 61n, description: "created", atUnix: 1_790_000_000n },
        { id: 2n, fromStatus: RestockRequestStatus.ONGOING, toStatus: RestockRequestStatus.ONGOING, actorUserId: 61n, description: "edited", atUnix: 1_790_003_600n },
      ],
    }),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const edit = canvas.getByTestId("restock-timeline-2");

    await expect(edit).toHaveAttribute("data-kind", "edit");
    await expect(within(edit).queryByTestId("restock-timeline-2-description")).toBeNull();
  },
};

// edits-are-in-the-same-trail — 502's trail: raised, signed for, then the selling team's edit (status unchanged, the
// change in its description), and a waiting step at the end.
export const TheTrailShowsTheEdit: Story = {
  name: "Shows the edit",
  render: () => <At502 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openTab(canvas, "timeline");

    await waitFor(() => expect(trailRows(canvasElement)).toHaveLength(3));
    await expect(trailRows(canvasElement).map((row) => row.dataset.kind)).toEqual(["created", "status", "edit"]);

    const edit = trailRows(canvasElement)[2]!;
    await expect(edit).toHaveTextContent("10 → 12");
    await expect(edit).toHaveTextContent("Edited");
    // The status move is drawn on the status row, not on the edit — an edit keeps its status.
    await expect(within(trailRows(canvasElement)[1]!).getByTestId("restock-timeline-2-move")).toBeVisible();
    await waitFor(() => expect(within(edit).getByTestId("restock-timeline-3-by")).toHaveTextContent("Ani"));
    await expect(canvas.getByTestId("restock-timeline-awaiting")).toBeVisible();
  },
};
