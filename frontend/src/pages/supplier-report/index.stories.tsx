import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { SUPPLIER_REPORT_META, loaded } from "./stories/kit";

// SUPPLIER REPORT — the screen as it is, on a desktop and on a phone: Default and Mobile sit FIRST, straight under
// SupplierReport. The same title also holds the folders below, so Storybook draws SupplierReport as a folder with
// these two stories leading it. Its rules are grouped by the part of the screen they are about, one file each in
// ./stories (stories-are-grouped-by-the-part-of-the-screen):
//
//   Filters  the search, the team and the range — each narrowing the ranking, and all of them in the URL
//   Header   the title's row and its Export, and the headline under it
//   Order    by restocked value or by broken rate, a segmented choice with its arrow
//   Rows     where a ranked row opens, its hover, the pager

const meta = {
  title: "Pages/Suppliers/SupplierReport",
  ...SUPPLIER_REPORT_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

// A PHONE reads each supplier as a block (a-phone-reads-each-line-as-a-block) — named Mobile, right after Default
// (every-page-has-a-mobile-story). A block that opens a supplier lights up while pressed.
export const Mobile: Story = {
  name: "Mobile",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(within(canvas.getByTestId("supplier-report-table")).queryAllByRole("columnheader")).toHaveLength(0);
  },
};
