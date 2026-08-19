import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { shops } from "../../../.storybook/fixtures";
import {
  MarketplaceInfoForm,
  description,
  emptyMarketplaceInfo,
  type MarketplaceInfoValue,
} from "./MarketplaceInfoForm";
import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";

// A reference in the shape a marketplace actually issues: no separators, mixed digits and letters,
// and nothing about it that a mask could have predicted.
const REF = "250815ABCD1234";

// The fixture team's Shopee and Tokopedia storefronts — one shop each, which is what makes the
// narrowing visible in a story.
const SHOPEE_SHOP = shops.find((s) => s.marketplace === Marketplace.SHOPEE)!;
const TOKOPEDIA_SHOP = shops.find((s) => s.marketplace === Marketplace.TOKOPEDIA)!;

// Every story builds its value off the empty one, so a field added later cannot leave a story
// asserting a shape the component no longer has.
const filled: MarketplaceInfoValue = {
  ...emptyMarketplaceInfo,
  shopId: SHOPEE_SHOP.id,
  orderExternalRefId: REF,
  marketplaceTotal: "250000",
};

const meta = {
  title: "Components/Orders/MarketplaceInfoForm",
  component: MarketplaceInfoForm,
  parameters: {
    docs: { description: { component: description } },
  },
  // The fixture selling team — its shops come back from the stubbed ShopList.
  args: { teamId: 12n, value: emptyMarketplaceInfo, onChange: fn() },
} satisfies Meta<typeof MarketplaceInfoForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const Filled: Story = {
  args: { value: { ...filled, marketplace: Marketplace.SHOPEE } },
};

// An order taken over the phone has a shop but never a marketplace reference — which is why the
// reference is optional even when `required` marks the shop.
export const ShopRequired: Story = {
  args: {
    required: true,
    value: { ...emptyMarketplaceInfo, shopId: SHOPEE_SHOP.id },
  },
};

export const Disabled: Story = {
  args: { disabled: true, value: filled },
};

// ── THE MARKETPLACE SCOPES THE SHOP LIST ────────────────────────────────────────────────────────

// Naming the storefront first cuts a team's shops to the ones that could possibly be right. It is a
// FILTER — nothing is submitted from it, the shop already carries its own marketplace.
export const MarketplaceNarrowsTheShops: Story = {
  args: { value: { ...emptyMarketplaceInfo, marketplace: Marketplace.SHOPEE } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("shop-select"));

    await expect(
      await canvas.findByTestId(`shop-select-option-${SHOPEE_SHOP.id}`),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByTestId(`shop-select-option-${TOKOPEDIA_SHOP.id}`),
    ).not.toBeInTheDocument();
  },
};

// A SHOP THE FILTER NO LONGER OFFERS IS CLEARED. Otherwise the trigger goes blank while the id stays
// held, and the form places a Shopee order against a Tokopedia storefront with nothing saying so.
export const NarrowingClearsAShopFromAnotherMarketplace: Story = {
  args: {
    value: { ...emptyMarketplaceInfo, marketplace: Marketplace.SHOPEE, shopId: TOKOPEDIA_SHOP.id },
  },
  play: async ({ args }) => {
    await waitFor(() =>
      expect(args.onChange).toHaveBeenCalledWith(
        expect.objectContaining({ shopId: 0n, marketplace: Marketplace.SHOPEE }),
      ),
    );
  },
};

// Unset means ALL — a team that sells on one marketplace should never have to name it first.
export const NoMarketplaceShowsEveryShop: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("shop-select"));

    await expect(
      await canvas.findByTestId(`shop-select-option-${SHOPEE_SHOP.id}`),
    ).toBeInTheDocument();
    await expect(
      canvas.getByTestId(`shop-select-option-${TOKOPEDIA_SHOP.id}`),
    ).toBeInTheDocument();
  },
};

// Picking the marketplace emits the WHOLE value — the reference a person had already pasted must
// survive a change of filter.
export const PickingAMarketplaceKeepsTheRef: Story = {
  args: { value: { ...emptyMarketplaceInfo, orderExternalRefId: REF } },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("marketplace-select"));

    const option = await canvas.findByRole("option", { name: "Tokopedia" });
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await expect(args.onChange).toHaveBeenCalledWith({
      ...emptyMarketplaceInfo,
      marketplace: Marketplace.TOKOPEDIA,
      orderExternalRefId: REF,
    });
  },
};

// ── THE REFERENCE AND THE TOTAL ─────────────────────────────────────────────────────────────────

// The total is a NOTE about what the storefront took — grouped with the shop and the reference
// rather than beside the order's arithmetic, because nothing computes from it.
export const TotalIsFormattedAsTyped: Story = {
  args: { value: { ...emptyMarketplaceInfo, marketplaceTotal: "250000" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("order-marketplace-total")).toHaveValue("250.000");
  },
};

// …and it emits RAW DIGITS, never the formatted text — the page parses this straight to rupiah. Typed
// onto the "0" every money field starts at, so this also pins the leading zero being dropped.
export const TotalEmitsRawDigits: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("order-marketplace-total"), "2", { delay: 40 });

    await expect(args.onChange).toHaveBeenCalledWith({
      ...emptyMarketplaceInfo,
      marketplaceTotal: "2",
    });
  },
};

// Picking a shop emits the WHOLE value, reference and total intact. A patch that dropped the other
// fields would silently clear a reference the person had already pasted.
export const PickingAShopKeepsTheRest: Story = {
  args: { value: { ...filled, shopId: 0n } },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("shop-select"));
    const option = await canvas.findByTestId(`shop-select-option-${TOKOPEDIA_SHOP.id}`);
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await expect(args.onChange).toHaveBeenCalledWith({
      ...filled,
      shopId: TOKOPEDIA_SHOP.id,
    });
  },
};

// …and the same in the other direction: typing the reference must not clear the shop or the total.
export const TypingTheRefKeepsTheShop: Story = {
  args: { value: { ...filled, orderExternalRefId: "" } },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("order-external-ref-id"), "2", { delay: 40 });

    await expect(args.onChange).toHaveBeenCalledWith({
      ...filled,
      orderExternalRefId: "2",
    });
  },
};

// The server's ceiling for a draft's external_id is 128 characters, and the input carries it — a
// paste is refused at the field rather than accepted and rejected on submit.
export const RefIsCappedAtTheServerLimit: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("order-external-ref-id")).toHaveAttribute("maxlength", "128");
  },
};

export const Interactive: Story = {
  render: (args) => {
    const [value, setValue] = useState<MarketplaceInfoValue>(emptyMarketplaceInfo);

    return <MarketplaceInfoForm {...args} value={value} onChange={setValue} />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Narrow to Tokopedia, then pick the one shop left — the flow the order form is arranged for.
    await userEvent.click(canvas.getByTestId("marketplace-select"));
    const marketplace = await canvas.findByRole("option", { name: "Tokopedia" });
    await waitFor(() => expect(marketplace).toBeVisible());
    await userEvent.click(marketplace);

    await userEvent.click(canvas.getByTestId("shop-select"));
    const shop = await canvas.findByTestId(`shop-select-option-${TOKOPEDIA_SHOP.id}`);
    await waitFor(() => expect(shop).toBeVisible());
    await userEvent.click(shop);

    await userEvent.type(canvas.getByTestId("order-external-ref-id"), REF, { delay: 40 });
    await userEvent.clear(canvas.getByTestId("order-marketplace-total"));
    await userEvent.type(canvas.getByTestId("order-marketplace-total"), "250000", { delay: 40 });

    await expect(canvas.getByTestId("shop-select")).toHaveTextContent(TOKOPEDIA_SHOP.name);
    await expect(canvas.getByTestId("order-external-ref-id")).toHaveValue(REF);
    await expect(canvas.getByTestId("order-marketplace-total")).toHaveValue("250.000");
  },
};
