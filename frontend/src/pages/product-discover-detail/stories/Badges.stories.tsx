import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";

import { warehouseStock } from "../../../../.storybook/fixtures";
import { patchProduct } from "../../../../.storybook/productStub";
import { sampleDivision } from "../../../features/products/discoverSample";
import { AtKopi, AtTeh, DISCOVER_PRODUCT_DETAIL_META, GULA, KOPI, STOCKED, TEH, loaded, openTab, sectionOf, stockLoaded, tehIs } from "./kit";

// DISCOVER PRODUCT DETAIL — the title's badges (the-lock-is-the-title-badge): the division, the lock — a reserve, a
// minimum in force, locked — and archived, each saying what it means for the stock on offer. The page's stories are
// grouped by the part of the screen they are about (stories-are-grouped-by-the-part-of-the-screen); what they share is
// ./kit.tsx.

const meta = {
  title: "Pages/Products/DiscoverProductDetail/Badges",
  ...DISCOVER_PRODUCT_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// THE CARD'S BADGES, BESIDE THE NAME — the division a sample (Gula's is Riset), the lock absent while it is open.
export const TheCardsBadgesAreOnTheTitle: Story = {
  name: "Badges on the title",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(sampleDivision(GULA.id)).toBe("research");
    await expect(canvas.getByTestId(`discover-detail-division-badge-${GULA.id}`)).toHaveTextContent("Research");
    await expect(canvas.queryByTestId(`discover-detail-lock-${GULA.id}`)).toBeNull();
  },
};

// THE OWNER'S RESERVE READS ON THE TITLE'S LOCK BADGE (the-lock-is-the-title-badge) — Kopi keeps 2 of its 40: *Min 2
// pcs*, not in force. It is not taken off any warehouse's figure: the table says what is ready.
export const AReserveReadsOnTheLock: Story = {
  name: "Reserve on the lock",
  render: () => <AtKopi />,
  play: async ({ canvasElement }) => {
    const canvas = await stockLoaded(canvasElement);
    const badge = canvas.getByTestId(`discover-detail-lock-${KOPI.id}`);

    await expect(canvas.getByTestId(`discover-stock-ready-${STOCKED.id}`)).toHaveTextContent(
      `${warehouseStock[KOPI.id.toString()]} pcs`,
    );
    await expect(badge).toHaveTextContent(`Min ${KOPI.reservedStock} pcs`);
    await expect(badge).not.toHaveAttribute("data-now");
  },
};

// A MINIMUM IN FORCE SAYS LOCKED (owner: *"tapi kalau min gimana?"*) — Kopi's minimum raised to ONE ABOVE its whole
// shelf: the ready stock is UNDER the minimum (a-minimum-closes-only-under-it — at exactly the minimum it is open), so the
// badge reads *Locked · Min N pcs*, its reason in a tooltip.
export const AMinimumInForceSaysLocked: Story = {
  name: "Minimum in force, locked",
  beforeEach: () => patchProduct(KOPI.id, { reservedStock: Number(warehouseStock[KOPI.id.toString()]) + 1 }),
  render: () => <AtKopi />,
  play: async ({ canvasElement }) => {
    const canvas = await stockLoaded(canvasElement);
    const badge = canvas.getByTestId(`discover-detail-lock-${KOPI.id}`);
    const minimum = Number(warehouseStock[KOPI.id.toString()]!) + 1;

    await waitFor(() => expect(badge).toHaveAttribute("data-now", "true"));
    await expect(badge).toHaveTextContent(`Locked · Min ${minimum} pcs`);
    await expect(badge).toHaveAttribute("title", expect.stringContaining(`${minimum}`));
  },
};

// A LOCKED product is on Discover with its badge (a-locked-product-shows-on-discover); its page says why where the ready
// figure would stand, and offers no stock — but still says who sells it: a team may restock from another team's
// supplier itself.
export const LockedSaysSoAndOffersNoStock: Story = {
  name: "Locked, no stock",
  beforeEach: tehIs("crossLocked"),
  render: () => <AtTeh />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const info = await sectionOf(canvas, "info");
    const price = await sectionOf(canvas, "price");

    await expect(info.getByTestId("discover-detail-locked")).toBeVisible();
    await expect(info.queryByTestId("discover-detail-highlight")).toBeNull();
    await expect(canvas.getByTestId(`discover-detail-lock-${TEH.id}`)).toHaveTextContent("Locked");
    await expect(price.getByTestId("discover-detail-stock-not-offered")).toBeVisible();
    await expect(price.queryByTestId(/^discover-stock-row-/)).toBeNull();
    const suppliers = await openTab(canvas, "suppliers");
    await waitFor(() => expect(suppliers.getByTestId("pd-supplier-row-0")).toBeInTheDocument());
  },
};

export const ArchivedSaysSoAndOffersNoStock: Story = {
  name: "Archived, no stock",
  beforeEach: tehIs("archived"),
  render: () => <AtTeh />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("discover-detail-archived")).toBeVisible();
    await expect(canvas.getByTestId("discover-detail-archived-badge")).toBeInTheDocument();
    await expect(canvas.queryByTestId("discover-detail-locked")).toBeNull();
    await expect(canvas.queryByTestId(/^discover-stock-row-/)).toBeNull();
  },
};
