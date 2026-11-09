import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";

import { shops } from "../../../../.storybook/fixtures";
import { orderImportScenario } from "../../../../.storybook/sessionScenario";
import { Marketplace } from "../../../gen/warehouse/marketplace/v1/marketplace_pb";
import { ImportOrdersDialog } from "./ImportOrdersDialog";

// THE ORDER IMPORT, IN THE OWNER'S THREE STEPS (the-import-is-platform-then-shop-and-file-then-log): the marketplace,
// then the shop and the file together, then the log. Toko Melati (12) runs a Shopee, a Tokopedia, a Lazada and a
// TikTok shop, which is what lets these stories show the shop list narrowing to one storefront.
//
// The dialog portals, so everything is found through `screen`; ShopSelect renders inline inside it. Step 3 runs the
// real hook against the stub's fixed stream (stubTransport's orderImportLog).

const MELATI_SHOPEE = shops[0]!; // Melati Official (21), Shopee
const MELATI_TOKOPEDIA = shops[1]!; // Melati Store (22), Tokopedia
const MELATI_TIKTOK = shops[4]!; // Melati TikTok (25), TikTok

const meta = {
  title: "Pages/Orders/ImportOrdersDialog",
  component: ImportOrdersDialog,
  args: { teamId: 12n, open: true, onOpenChange: fn() },
} satisfies Meta<typeof ImportOrdersDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

const EXPORT = new File(["order export"], "Order.all.20261030.xlsx", {
  type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
});

async function pickMarketplace(m: Marketplace) {
  await userEvent.click(await screen.findByTestId(`import-marketplace-${m}`));
}

async function pickShop(shopId: bigint) {
  const field = await screen.findByTestId("import-shop");
  await userEvent.click(within(field).getByTestId("shop-select"));

  const option = await screen.findByTestId(`shop-select-option-${shopId}`);
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option);
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const PickAMarketplace: Story = {};

export const ShopAndFile: Story = {
  play: async () => {
    await pickMarketplace(Marketplace.SHOPEE);
  },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// ONLY THE PICKED STOREFRONT'S SHOPS: a Shopee sheet matched against a Tokopedia shop's refs finds nothing.
export const TheShopListIsTheMarketplacesShops: Story = {
  play: async () => {
    await pickMarketplace(Marketplace.SHOPEE);

    const field = await screen.findByTestId("import-shop");
    await userEvent.click(within(field).getByTestId("shop-select"));

    const option = await screen.findByTestId(`shop-select-option-${MELATI_SHOPEE.id}`);
    await waitFor(() => expect(option).toBeVisible());
    await expect(screen.queryByTestId(`shop-select-option-${MELATI_TOKOPEDIA.id}`)).not.toBeInTheDocument();
  },
};

// Import waits for BOTH halves of step 2 — there is no import of a file without the shop whose refs it names.
export const ImportWaitsForTheShopAndTheFile: Story = {
  play: async () => {
    await pickMarketplace(Marketplace.SHOPEE);
    const submit = screen.getByTestId("import-submit");
    await expect(submit).toBeDisabled();

    await pickShop(MELATI_SHOPEE.id);
    await expect(submit).toBeDisabled();

    await userEvent.upload(screen.getByTestId("import-file-input"), EXPORT);
    await expect(screen.getByTestId("import-file-name")).toHaveTextContent(EXPORT.name);
    await expect(submit).toBeEnabled();
  },
};

// Another Marketplace drops the shop with the file: a Shopee shop is not a shop of TikTok.
export const AnotherMarketplaceDropsTheShopAndTheFile: Story = {
  play: async () => {
    await pickMarketplace(Marketplace.SHOPEE);
    await pickShop(MELATI_SHOPEE.id);
    await userEvent.upload(screen.getByTestId("import-file-input"), EXPORT);

    await userEvent.click(screen.getByTestId("import-back"));
    await pickMarketplace(Marketplace.TIKTOK);

    await expect(within(screen.getByTestId("import-shop")).getByTestId("shop-select")).toHaveValue("");
    await expect(screen.getByTestId("import-file-name")).not.toHaveTextContent(EXPORT.name);
    await expect(screen.getByTestId("import-submit")).toBeDisabled();
  },
};

// Import sends the picked shop and the file down the PLATFORM'S import, and step 3 is the stream: the three counts from
// the tally, the order not applied listed with its reason.
export const ImportStreamsTheLog: Story = {
  play: async () => {
    await pickMarketplace(Marketplace.SHOPEE);
    await pickShop(MELATI_SHOPEE.id);
    await userEvent.upload(screen.getByTestId("import-file-input"), EXPORT);
    await userEvent.click(screen.getByTestId("import-submit"));

    await expect(await screen.findByTestId("order-import-summary")).toHaveTextContent("1 order was not applied");
    await expect(screen.getByTestId("order-import-tally-moved")).toHaveTextContent("2");
    await expect(screen.getByTestId("order-import-not-applied")).toHaveTextContent("cancelled on the platform");

    await expect(orderImportScenario.last).toEqual({ platform: "shopee", shopId: MELATI_SHOPEE.id, bytes: EXPORT.size });
  },
};

// The platform picks the RPC: a TikTok shop's file goes down TikTok's import.
export const TikTokGoesDownTikToksImport: Story = {
  play: async () => {
    await pickMarketplace(Marketplace.TIKTOK);
    await pickShop(MELATI_TIKTOK.id);
    await userEvent.upload(screen.getByTestId("import-file-input"), EXPORT);
    await userEvent.click(screen.getByTestId("import-submit"));

    await screen.findByTestId("order-import-summary");
    await expect(orderImportScenario.last?.platform).toBe("tiktok");
  },
};

// A marketplace with no reader is offered in the grid and told "not yet" where the file would go — not hidden.
export const AMarketplaceWithNoReaderSaysNotYet: Story = {
  play: async () => {
    await pickMarketplace(Marketplace.LAZADA);

    await expect(await screen.findByTestId("import-unsupported")).toHaveTextContent("cannot be imported yet");
    await expect(screen.queryByTestId("import-drop-zone")).not.toBeInTheDocument();
    await expect(screen.getByTestId("import-submit")).toBeDisabled();
  },
};
