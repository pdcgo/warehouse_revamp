import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button, Stack } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";
import { ShopItem, description } from "./ShopItem";

const meta = {
  title: "Components/Entity/ShopItem",
  component: ShopItem,
  parameters: {
    docs: { description: { component: description } },
  },
  args: {
    shop: { name: "Melati Official", marketplace: Marketplace.SHOPEE, shopId: 21n },
  },
} satisfies Meta<typeof ShopItem>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Shopee: Story = {};

export const Tokopedia: Story = {
  args: { shop: { name: "Melati Store", marketplace: Marketplace.TOKOPEDIA, shopId: 22n } },
};

export const WithAction: Story = {
  args: { action: <Button size="xs">Pilih</Button> },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// ⚠ THE MARKETPLACE IS HALF THE NAME. A selling team's storefronts often share a name across
// platforms — this is the case the component exists for, and the badge is the only thing telling the
// two rows apart.
export const TwoShopsSharingANameStayDistinguishable: Story = {
  render: () => (
    <Stack gap="3">
      <ShopItem shop={{ name: "Toko Jaya", marketplace: Marketplace.SHOPEE, shopId: 31n }} />
      <ShopItem shop={{ name: "Toko Jaya", marketplace: Marketplace.TOKOPEDIA, shopId: 32n }} />
    </Stack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const names = canvas.getAllByTestId("shop-item-name");
    await expect(names).toHaveLength(2);
    await expect(names[0]).toHaveTextContent("Toko Jaya");
    await expect(names[1]).toHaveTextContent("Toko Jaya");

    // Same name, different badge — the pair is what identifies one.
    await expect(
      canvas.getByTestId(`marketplace-badge-${Marketplace.SHOPEE}`),
    ).toBeInTheDocument();
    await expect(
      canvas.getByTestId(`marketplace-badge-${Marketplace.TOKOPEDIA}`),
    ).toBeInTheDocument();
  },
};

// ⚠ A LOOKUP THAT MISSED IS NOT A SHOP THAT IS NOT THERE. A list resolves shop names in one batched
// call; when that has not landed — or the shop was deleted upstream — the row still has an id, and
// showing it is the honest reading. A blank cell says something different and wrong.
export const AnUnresolvedIdFallsBackToItsNumber: Story = {
  args: { shop: { shopId: 44n, marketplace: Marketplace.LAZADA } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("shop-item-name")).toHaveTextContent("Shop #44");
  },
};

// …and with no id either there is nothing to name, so it reads as an em-dash rather than "Shop
// #undefined". An order taken over the phone has no shop at all.
export const NoShopAtAllIsADash: Story = {
  args: { shop: {} },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("shop-item-name")).toHaveTextContent("—");
  },
};

// An UNSPECIFIED marketplace draws no badge — the sentinel means "not recorded", and a badge saying
// so would be a badge on every phone order.
export const AnUnrecordedMarketplaceDrawsNoBadge: Story = {
  args: { shop: { name: "Toko Telepon", shopId: 55n } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("shop-item-name")).toHaveTextContent("Toko Telepon");
    await expect(canvasElement.querySelectorAll('[data-testid^="marketplace-badge-"]')).toHaveLength(
      0,
    );
  },
};
