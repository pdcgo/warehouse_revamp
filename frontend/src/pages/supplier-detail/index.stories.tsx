import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { channelFixtures, supplierFixture } from "../../../.storybook/supplierFixtures";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { SupplierDetailPage } from "./index";

// ⚠ PROTOTYPE for design_accept — the supplier CRUD pass
// (docs/business/supplier/context_clarify.md#proposed-design).
//
// One supplier and its CHANNELS — the stores it sells through, each typed off the shared marketplace list
// (the-supplier-lists-only-its-online-stores, channel-type-is-the-marketplace-list). The stub plays today's
// server, which still wants an online/offline type: every channel saved below proves the translation step
// sends one.

const SUMBER = supplierFixture("PT Sumber Makmur");
const CAHAYA = supplierFixture("CV Cahaya Abadi");
const SINAR = supplierFixture("Toko Grosir Sinar");
const MAKMUR_JAYA = supplierFixture("UD Makmur Jaya"); // team 13's

const channel = (id: bigint) => channelFixtures.find((c) => c.id === id)!;
const SHOPEE_STORE = channel(311n);
const TOKOPEDIA_STORE = channel(312n);
const OLD_OFFLINE_SHOP = channel(313n);
const WEBSITE = channel(321n);

function routedAt(supplierId: bigint) {
  return routedPage(
    [
      { path: "/inventories/suppliers/:supplierId", element: <SupplierDetailPage /> },
      marker("/inventories/suppliers", "at-suppliers"),
    ],
    `/inventories/suppliers/${supplierId}`,
  );
}

// Built ONCE, at module scope — a router built inside `render` is a fresh history on every re-render
// (pageStory.tsx).
const AtCahaya = routedAt(CAHAYA.id);
const AtSinar = routedAt(SINAR.id);
const AtAnotherTeams = routedAt(MAKMUR_JAYA.id);

const meta = {
  title: "Pages/Suppliers/SupplierDetail",
  component: routedAt(SUMBER.id),
  parameters: { signedIn: true, dataRouter: true, layout: "padded" },
  beforeEach: () => {
    asTeam(12n)();
    asRole(Role.SELLING_OWNER)();
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("supplier-detail-page", {}, { timeout: 4000 });
  return canvas;
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {};

export const AWebsiteOnly: Story = { render: () => <AtCahaya /> };

export const NoChannelsYet: Story = { render: () => <AtSinar /> };

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// the-supplier-has-no-code · no-province-city-or-soft-delete: a contact, an address, a description.
export const TheDecidedFields: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("supplier-detail-name")).toHaveTextContent(SUMBER.name);
    await expect(canvas.getByTestId("supplier-detail-address")).toHaveTextContent(
      "Jl. Soekarno-Hatta 112, Bandung, Jawa Barat",
    );
    await expect(canvas.queryByText("SUP-A")).toBeNull();
  },
};

// channels-are-a-horizontal-tab: the channels sit under a HORIZONTAL Channels tab, open on arrival — the tab
// row is where the parked products and statistics land later.
export const TheChannelsAreAHorizontalTab: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const tab = canvas.getByTestId("supplier-tab-channels");
    await expect(tab).toHaveTextContent("Channels");
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect(canvas.getByRole("tablist")).toHaveAttribute("aria-orientation", "horizontal");
    await expect(within(canvas.getByTestId("channels-section")).getByTestId("channels-table")).toBeVisible();
  },
};

// channel-type-is-the-marketplace-list: each store wears its marketplace's badge.
export const ChannelsAreTypedOffTheMarketplaceList: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId(`channel-row-${SHOPEE_STORE.id}`)).toHaveTextContent("Shopee"));
    await expect(canvas.getByTestId(`channel-row-${TOKOPEDIA_STORE.id}`)).toHaveTextContent("Tokopedia");
  },
};

// the-supplier-lists-only-its-online-stores: an OLD offline shop has no marketplace, so it reads as Other,
// its contact and location carried as its description — the fold the move makes.
export const AnOldOfflineShopReadsAsOther: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const row = await canvas.findByTestId(`channel-row-${OLD_OFFLINE_SHOP.id}`);
    await expect(row).toHaveTextContent("Other");
    await expect(row).toHaveTextContent("0812-1111-9999 · Jl. Cigondewah Kaler 7, Bandung");
  },
};

// A plain website is the owner's `custom` — the shared list's Other.
export const AWebsiteIsOther: Story = {
  render: () => <AtCahaya />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const row = await canvas.findByTestId(`channel-row-${WEBSITE.id}`);
    await expect(row).toHaveTextContent("Other");
    await expect(row).toHaveTextContent("https://cahayaabadi.co.id");
  },
};

// No online/offline switch: a channel is a type, a name, a link and a description. The stub still wants
// ONLINE and a marketplace — the translation step sends them.
export const AddChannel: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("add-channel"));
    const name = await screen.findByTestId("channel-name");
    await waitFor(() => expect(name).toBeVisible());

    await expect(screen.queryByTestId("channel-location")).toBeNull();
    await expect(screen.getByTestId("submit-channel")).toBeDisabled();

    await userEvent.click(screen.getByTestId("marketplace-select"));
    await userEvent.click(await screen.findByRole("option", { name: "Lazada" }));
    await userEvent.type(name, "Sumber Makmur Lazada", { delay: 40 });
    await userEvent.type(screen.getByTestId("channel-uri"), "https://www.lazada.co.id/shop/sumbermakmur", {
      delay: 10,
    });

    await expect(screen.getByTestId("submit-channel")).toBeEnabled();
    await userEvent.click(screen.getByTestId("submit-channel"));

    await waitFor(() => expect(canvas.getByTestId("channels-table")).toHaveTextContent("Sumber Makmur Lazada"));
    await expect(canvas.getByTestId("channels-table")).toHaveTextContent("Lazada");
  },
};

// The one thing the old server cannot hold: a channel's description is typed and thrown away, and the page
// says so — in the summary at the top and beside the field.
export const TheChannelDescriptionIsNotSavedYet: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("not-implemented-summary")).toBeVisible();
    await expect(canvas.getAllByTestId("not-implemented-channelDescription").length).toBeGreaterThan(0);

    await userEvent.click(canvas.getByTestId("add-channel"));
    const description = await screen.findByTestId("channel-description");
    await waitFor(() => expect(description).toBeVisible());
    await expect(
      within(screen.getByRole("dialog")).getByTestId("not-implemented-channelDescription"),
    ).toBeVisible();
  },
};

export const DeleteChannelConfirms: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(await canvas.findByTestId(`delete-channel-${TOKOPEDIA_STORE.id}`));
    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await userEvent.click(confirm);

    await waitFor(() => expect(canvas.queryByTestId(`channel-row-${TOKOPEDIA_STORE.id}`)).toBeNull());
    await expect(canvas.getByTestId(`channel-row-${SHOPEE_STORE.id}`)).toBeVisible();
  },
};

// Another selling team's supplier is not on this page — the manage page is a team's own. Seeing other
// teams' suppliers is the discover page, after the CRUD pass.
export const AnotherTeamsSupplierIsNotFound: Story = {
  render: () => <AtAnotherTeams />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("supplier-detail-error", {}, { timeout: 4000 });
  },
};

export const BackGoesToTheList: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("supplier-detail-back"));
    await canvas.findByTestId("at-suppliers");
  },
};
