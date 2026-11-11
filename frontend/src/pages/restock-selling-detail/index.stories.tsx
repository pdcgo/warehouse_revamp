import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { SELLING_DETAIL_META, loaded } from "./stories/kit";

// RESTOCK SELLING DETAIL — the screen as it is, on a desktop and on a phone: Default and Mobile sit FIRST, straight
// under RestockSellingDetail (owner: *"default dan mobile taruh di depan saja"*). The same title also holds the folders
// below, so Storybook draws RestockSellingDetail as a folder with these two stories leading it. Its rules are grouped
// by the part of the screen they are about, one file each in ./stories (stories-are-grouped-by-the-part-of-the-screen):
//
//   Actions     the header's acts, by status, and the acts they run
//   Header      the title row — the order ID leading, the references, and a phone's bar and one action
//   Notes       Catatan — one note per writer, edited on the page, on a phone in a sheet
//   Payment     the receipt, the paying account, and the courier's charge on its own
//   Products    the lines — their adjustment, the broken units' photo, where each was bought
//   States      the restock in each status, as it opens
//   Timeline    Riwayat — the trail and its edit rows

const meta = {
  title: "Pages/Inventory/Restock/RestockSellingDetail",
  ...SELLING_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

// A PHONE (the-restock-detail-follows-the-screen-rules) — the header ONE row that stays: back, the number, the status,
// the actions (three, so one ⋯); the tabs across the top; the product lines as blocks; the title at 20px.
export const Mobile: Story = {
  name: "Mobile",
  globals: { viewport: { value: "mobile1" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    // The section chips stick at the top; the title row carries the actions — three, so one ⋯.
    const strip = canvas.getByTestId("restock-detail-header");
    await expect(getComputedStyle(strip).position).toBe("sticky");
    await expect(within(strip).getByTestId("section-nav-strip")).toBeVisible();
    await expect(canvas.getByTestId("restock-actions-501")).toBeVisible();
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);

    // EVERY TITLE ON A PHONE IS 20px, this one too, not 26 (every-phone-title-is-20px) — and the order id reads whole,
    // uncut. The sticky bar's title is the same size.
    const title = canvas.getByTestId("restock-detail-title");
    await expect(getComputedStyle(title).fontSize).toBe("20px");
    const value = [...title.querySelectorAll<HTMLElement>("*")].filter((el) => el.scrollWidth > el.clientWidth + 1);
    await expect(value).toHaveLength(0);
  },
};
