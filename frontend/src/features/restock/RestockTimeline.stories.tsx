import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { RestockTimeline } from "./RestockTimeline";
import { storyRestock } from "./storyRestock";

// A RESTOCK'S TRAIL — one row per status change, and an edit is a row too, where the status stays and the description
// says what changed (every-status-change-is-logged, edits-are-in-the-same-trail). Both detail pages render it.
const meta = {
  title: "Features/Restock/RestockTimeline",
  component: RestockTimeline,
  parameters: { signedIn: true },
} satisfies Meta<typeof RestockTimeline>;

export default meta;
type Story = StoryObj<typeof meta>;

// 502 — signed for, then the selling team edited a line: the edit sits in the same trail.
export const ArrivedWithAnEdit: Story = {
  args: { request: storyRestock(502n) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("restock-timeline-3-description")).toHaveTextContent("10 → 12");
    await expect(canvas.getByTestId("restock-timeline-2-description")).toHaveTextContent(/signed for/i);
  },
};

// 503 — counted in, the courier's charge in the accept's row.
export const Accepted: Story = {
  args: { request: storyRestock(503n) },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByTestId("restock-timeline-3-description")).toHaveTextContent(
      /broken/i,
    );
  },
};

// 504 — given up as lost, with the reason.
export const Lost: Story = { args: { request: storyRestock(504n) } };
