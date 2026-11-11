import type { Meta, StoryObj } from "@storybook/react-vite";

import { At502, At503, At504, SELLING_DETAIL_META, loaded, openTab, routedAt } from "./kit";

// RESTOCK SELLING DETAIL — the restock in each status, as it opens.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockSellingDetail/States",
  ...SELLING_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// Built ONCE, at module scope — a router built inside `render` is a fresh history on every re-render (pageStory.tsx).
const At505 = routedAt(505n);

export const Ongoing: Story = {};

export const Arrived: Story = { render: () => <At502 /> };

export const Accepted: Story = { render: () => <At503 /> };

export const AcceptedProducts: Story = {
  name: "Accepted · products",
  render: () => <At503 />,
  play: async ({ canvasElement }) => {
    await openTab(await loaded(canvasElement), "products");
  },
};

export const Lost: Story = { render: () => <At504 /> };

export const Cancelled: Story = { render: () => <At505 /> };

export const ArrivedTimeline: Story = {
  name: "Arrived · timeline",
  render: () => <At502 />,
  play: async ({ canvasElement }) => {
    await openTab(await loaded(canvasElement), "timeline");
  },
};
