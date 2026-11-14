import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";

import { SIDEBAR_OPEN, besideTheOpenSidebar } from "../../../../.storybook/pageStory";
import { expectTheTableFits, kirimanPlacement } from "../../../features/restock/storyLayout";
import { At503, WAREHOUSE_DETAIL_META, loaded } from "./kit";

// RESTOCK WAREHOUSE DETAIL — the page's arrangement: KIRIMAN BESIDE THE PRODUCTS ONLY WHERE BOTH FIT (owner: *"A"*,
// the-delivery-card-stacks-when-the-page-is-narrow). The side-by-side layout is chosen by the room the PAGE AREA has, not by
// the viewport's `xl`: beside the open sidebar a 1440px screen leaves the products 521px beside Kiriman's 20rem, and their
// table needs ≈660 — so Kiriman goes below the products, as the stacked layout draws it, and nothing scrolls sideways.
// A page story draws no sidebar, so these stand one of its width beside the page (`besideTheOpenSidebar`).

const meta = {
  title: "Pages/Inventory/Restock/RestockWarehouseDetail/Layout",
  ...WAREHOUSE_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** 503, counted in: its places are read after the lines, and they are the table's widest cell. */
async function countedIn(canvasElement: HTMLElement) {
  const canvas = await loaded(canvasElement);
  await waitFor(() => expect(canvas.getByTestId("restock-detail-placement-74")).toHaveTextContent("A-01-1 (5), B-02-1 (2)"));
  return canvas;
}

// 1440 BESIDE THE OPEN SIDEBAR — the page area is ≈907px, short of the products' ≈710 + the gap + 20rem: Kiriman below the
// products, above the note, and the table whole in its box. (Before: Kiriman beside, the table scrolling 139px sideways.)
export const KirimanBelowBesideTheSidebarAt1440: Story = {
  name: "1440 beside the sidebar · Kiriman below",
  render: () => <At503 />,
  globals: { viewport: { value: "desktop1440" } },
  decorators: [besideTheOpenSidebar],
  play: async ({ canvasElement }) => {
    await countedIn(canvasElement);
    await expect(window.innerWidth).toBe(1440);

    // The fault first — the table scrolling sideways — then where Kiriman went to end it.
    await expectTheTableFits(canvasElement);
    await expect(kirimanPlacement(canvasElement)).toBe("below");
  },
};

// 1920 BESIDE THE OPEN SIDEBAR — room for both: Kiriman's 20rem column beside the products, the table whole.
export const SideBySideBesideTheSidebarAt1920: Story = {
  name: "1920 beside the sidebar · side by side",
  render: () => <At503 />,
  globals: { viewport: { value: "desktop1920" } },
  decorators: [besideTheOpenSidebar],
  play: async ({ canvasElement }) => {
    await countedIn(canvasElement);
    await expect(window.innerWidth).toBe(1920);

    await waitFor(() => expect(kirimanPlacement(canvasElement)).toBe("beside"));
    await expectTheTableFits(canvasElement);
  },
};

// 1440 WITH NO SIDEBAR BESIDE IT (the page alone, as the app with the sidebar hidden) — the area is ≈1166px, room for both,
// so side by side; whichever it picks, the table never scrolls.
export const At1440WithoutTheSidebar: Story = {
  name: "1440 without the sidebar · fits",
  render: () => <At503 />,
  globals: { viewport: { value: "desktop1440" } },
  play: async ({ canvasElement }) => {
    await countedIn(canvasElement);
    await expect(window.innerWidth).toBe(1440);

    await waitFor(() => expect(kirimanPlacement(canvasElement)).toBe("beside"));
    await expectTheTableFits(canvasElement);
  },
};

// THE ROOM, NOT THE SCREEN — the same 1440px window: the sidebar closes and Kiriman moves beside the products; it opens
// again and Kiriman goes back below. Only Kiriman moves: the products, the note and the trail are the SAME elements
// throughout (one tree for both layouts — a note being typed survives the sidebar).
export const TheSidebarClosingMovesKirimanBeside: Story = {
  name: "Sidebar closes · Kiriman beside, nothing re-mounted",
  render: () => <At503 />,
  globals: { viewport: { value: "desktop1440" } },
  decorators: [besideTheOpenSidebar],
  play: async ({ canvasElement }) => {
    const canvas = await countedIn(canvasElement);
    await waitFor(() => expect(kirimanPlacement(canvasElement)).toBe("below"));

    const products = canvas.getByTestId("restock-detail-products");
    const note = canvas.getByTestId("restock-detail-note-section");
    const timeline = canvas.getByTestId("restock-detail-timeline-section");
    const sidebar = canvas.getByTestId("story-sidebar-width");

    sidebar.style.width = "0px";
    await waitFor(() => expect(kirimanPlacement(canvasElement)).toBe("beside"));
    await expectTheTableFits(canvasElement);

    sidebar.style.width = SIDEBAR_OPEN;
    await waitFor(() => expect(kirimanPlacement(canvasElement)).toBe("below"));
    await expectTheTableFits(canvasElement);

    await expect(canvas.getByTestId("restock-detail-products")).toBe(products);
    await expect(canvas.getByTestId("restock-detail-note-section")).toBe(note);
    await expect(canvas.getByTestId("restock-detail-timeline-section")).toBe(timeline);
  },
};

// A PHONE IS UNCHANGED — one column in the nav's order: the products, Kiriman, the note, the trail.
export const OnAPhoneOneColumn: Story = {
  name: "Phone · one column",
  render: () => <At503 />,
  globals: { viewport: { value: "mobile1" } },
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);

    await waitFor(() => expect(kirimanPlacement(canvasElement)).toBe("below"));
  },
};
