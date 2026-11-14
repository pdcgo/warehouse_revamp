import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";

import { besideTheOpenSidebar } from "../../../../.storybook/pageStory";
import { expectTheTableFits, kirimanPlacement } from "../../../features/restock/storyLayout";
import { At503, SELLING_DETAIL_META, loaded } from "./kit";

// RESTOCK SELLING DETAIL — the page's arrangement: THE INFO COLUMN BESIDE THE PRODUCTS ONLY WHERE BOTH FIT — the rule the
// owner gave the warehouse's page (*"A"*, the-delivery-card-stacks-when-the-page-is-narrow), applied to its twin, which
// had the same fault: Kiriman, Pembayaran and Ongkir COD went beside the products from the viewport's `xl`, ignoring the
// sidebar, and the products table (≈779px at its narrowest — supplier, price, line total) scrolled sideways at 1440 and
// 1600 beside the open sidebar. Now the PAGE AREA's own width chooses: where it cannot hold the table + the card + the
// gap + 20rem, the info goes below the products in the nav's order, as the stacked layout draws it. A page story draws no
// sidebar, so these stand one of its width beside the page (`besideTheOpenSidebar`).

const meta = {
  title: "Pages/Inventory/Restock/RestockSellingDetail/Layout",
  ...SELLING_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** 503, counted in: its stores are read after the lines, and they sit in the table's widest cell. */
async function counted(canvasElement: HTMLElement) {
  const canvas = await loaded(canvasElement);
  await waitFor(() => expect(canvas.getByTestId("restock-detail-supplier-74")).toHaveTextContent("Sumber Makmur Store"));
  return canvas;
}

// 1440 BESIDE THE OPEN SIDEBAR — the area is ≈907px: the info below the products, the table whole in its box.
// (Before: beside, the table scrolling ≈258px sideways.)
export const InfoBelowBesideTheSidebarAt1440: Story = {
  name: "1440 beside the sidebar · info below",
  render: () => <At503 />,
  globals: { viewport: { value: "desktop1440" } },
  decorators: [besideTheOpenSidebar],
  play: async ({ canvasElement }) => {
    await counted(canvasElement);
    await expect(window.innerWidth).toBe(1440);

    // The fault first — the table scrolling sideways — then where Kiriman went to end it.
    await expectTheTableFits(canvasElement);
    await expect(kirimanPlacement(canvasElement)).toBe("below");
  },
};

// 1600 BESIDE THE OPEN SIDEBAR — the area is ≈1067px, still short of ≈1165: below too. (Before: beside, ≈98px of scroll.)
export const InfoBelowBesideTheSidebarAt1600: Story = {
  name: "1600 beside the sidebar · info below",
  render: () => <At503 />,
  globals: { viewport: { value: "desktop1600" } },
  decorators: [besideTheOpenSidebar],
  play: async ({ canvasElement }) => {
    await counted(canvasElement);
    await expect(window.innerWidth).toBe(1600);

    // The fault first — the table scrolling sideways — then where Kiriman went to end it.
    await expectTheTableFits(canvasElement);
    await expect(kirimanPlacement(canvasElement)).toBe("below");
  },
};

// 1920 BESIDE THE OPEN SIDEBAR — room for both: the 20rem info column beside the products, the table whole.
export const SideBySideBesideTheSidebarAt1920: Story = {
  name: "1920 beside the sidebar · side by side",
  render: () => <At503 />,
  globals: { viewport: { value: "desktop1920" } },
  decorators: [besideTheOpenSidebar],
  play: async ({ canvasElement }) => {
    await counted(canvasElement);
    await expect(window.innerWidth).toBe(1920);

    await waitFor(() => expect(kirimanPlacement(canvasElement)).toBe("beside"));
    await expectTheTableFits(canvasElement);
  },
};

// 1440 WITH NO SIDEBAR — the area (≈1166px) is right at what the two need: whichever layout it picks, nothing scrolls.
export const At1440WithoutTheSidebar: Story = {
  name: "1440 without the sidebar · fits",
  render: () => <At503 />,
  globals: { viewport: { value: "desktop1440" } },
  play: async ({ canvasElement }) => {
    await counted(canvasElement);
    await expect(window.innerWidth).toBe(1440);

    await expect(["beside", "below"]).toContain(kirimanPlacement(canvasElement));
    await expectTheTableFits(canvasElement);
  },
};

// A PHONE IS UNCHANGED — one column in the nav's order: the products, Kiriman, the money, the note, the trail.
export const OnAPhoneOneColumn: Story = {
  name: "Phone · one column",
  render: () => <At503 />,
  globals: { viewport: { value: "mobile1" } },
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);

    await waitFor(() => expect(kirimanPlacement(canvasElement)).toBe("below"));
  },
};
