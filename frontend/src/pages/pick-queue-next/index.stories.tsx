import type { Meta, StoryObj } from "@storybook/react-vite";

import { NEW_HERE, PICK_QUEUE_META, rowOf } from "./stories/kit";

// THE WAREHOUSE'S ORDER LIST — the list as it is, on a desktop and on a phone: Default and Mobile sit FIRST, straight
// under PickQueueNextPage. The same title also holds the folders below, so Storybook draws it as a folder with these two
// stories leading it. Its rules are grouped by the part of the screen they are about, one file each in ./stories
// (stories-are-grouped-by-the-part-of-the-screen):
//
//   Actions  the row's ⋯ moves, and the bulk bar
//   Filters  the step tabs, the crew's filters, the URL
//   Rows     what a row shows, and how it opens the pick list
//   Scans    the handover, find-parcel and validation scans
//   States   without the marks, a selling team turned away, every gap marked

const meta = {
  title: "Pages/Warehouse/PickQueueNextPage",
  // HIDDEN from the sidebar for now (owner, 2026-10-02: *"hidden aja dulu yang preview order gudang ini"*).
  // `!dev` drops it from the workbench only — the `test` tag stays, so every rule below still runs in
  // `npm run test:stories` and the preview cannot rot while it waits. Delete this line to show it again.
  tags: ["!dev"],
  ...PICK_QUEUE_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  name: "Default",
  play: async ({ canvasElement }) => {
    for (const o of NEW_HERE) {
      await rowOf(canvasElement, o.id);
    }
  },
};

// ⚠ No `play()`: the `viewport` global resizes the WORKBENCH canvas only.
export const Mobile: Story = {
  name: "Mobile",
  globals: { viewport: { value: "mobile2" } },
};
