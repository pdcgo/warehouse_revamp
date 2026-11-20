import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { IMPORT_DETAIL_META, fitsTheScreen, heldLines, loaded, rowsShown, shopeeDone } from "./stories/kit";

// One imported statement: what it posted, and each of its rows with what became of it
// (docs/business/settlement/settlement_importer_decision.md). The screen as it is, on a desktop and on a phone: Default
// and Mobile sit FIRST, straight under ImportDetail (every-page-has-a-mobile-story); the same title also holds the
// folders below. Its rules are grouped by the part of the screen they are about, one file each in ./stories
// (stories-are-grouped-by-the-part-of-the-screen), sharing ./stories/kit.tsx:
//
//   File       the file itself — its shop, range, by-line, tally, the original, an interrupted or failed file
//   States     the plain looks other than Default, and the first loads
//   Rows       a desktop row per statement line, tab by tab; the pager, the empty hint, a tab waiting for its own rows
//   Phone      the page on a phone — the title row, the sliding tabs, each tab's note, 320px, Indonesian
//   PhoneRows  the rows on a phone, a block each — tab by tab, the pages, loading, empty

const meta = {
  title: "Pages/Settlement/ImportDetail",
  ...IMPORT_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

// A PHONE READS THE FILE AS ACCEPTED (the-import-detail-phone-prototype-is-accepted), at the 390px it was accepted at:
// the title row with Download as its icon, the tally, the tabs on one row, and Held's rows as blocks (no table), the
// growing pager under them — centred, no page size; nothing runs past the screen's edge.
export const Mobile: Story = {
  name: "Mobile",
  globals: { viewport: { value: "phone390" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(window.innerWidth).toBe(390);

    await expect(canvas.getByTestId("import-detail-header")).toHaveAttribute("data-layout", "phone");
    // One header action → its icon, named by its label, on the title's row (no labelled button of its own row).
    const download = canvas.getByTestId("download-original");
    await expect(download).toHaveAccessibleName("Download original");
    await expect(download).not.toHaveTextContent("Download original");
    const shop = canvas.getByTestId("import-detail-shop").getBoundingClientRect();
    await expect(download.getBoundingClientRect().top).toBeLessThan(shop.bottom);

    await expect(canvas.getByTestId("tally-posted-value")).toHaveTextContent(String(shopeeDone!.tally.posted));
    await expect(canvas.getByTestId("tally-held-value")).toHaveTextContent(String(shopeeDone!.tally.held));

    const list = await canvas.findByTestId("lines-table");
    await expect(list).toHaveAttribute("data-layout", "phone");
    await expect(list.tagName).not.toBe("TABLE");
    await expect(canvasElement.querySelector("table")).toBeNull();
    for (const line of heldLines()) await expect(within(list).getByTestId(`line-row-${line.id}`)).toBeVisible();
    await expect(rowsShown(canvasElement)).toHaveLength(heldLines().length);

    // The pager is always on screen, centred, with no page size (GrowingPager on a phone); the old Pagination is gone.
    const pager = canvas.getByTestId("lines-pager");
    await expect(pager).toBeVisible();
    await expect(getComputedStyle(pager).justifyContent).toBe("center");
    await expect(canvas.queryByTestId("lines-pager-size")).toBeNull();
    await expect(canvas.queryByTestId("page-next")).toBeNull();
    await fitsTheScreen(canvasElement);
  },
};
