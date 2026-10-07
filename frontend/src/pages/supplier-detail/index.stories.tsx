import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { channelFixture, supplierFixture } from "../../../.storybook/supplierFixtures";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { SupplierDetailPage } from "./index";

// ⚠ PROTOTYPE for design_accept — the supplier CRUD pass
// (docs/business/supplier/context_clarify.md#proposed-design).
//
// One supplier: its own fields on top, then two horizontal tabs (supplier-detail-has-channels-and-products-tabs)
// — CHANNELS, one list with a marketplace badge per row, and PRODUCTS, sample rows until an accepted restock links
// a product to its store. The stub plays supplier_service (supplierStub.ts): reads cross teams, writes do not, and
// deletes are soft.

const SUMBER = supplierFixture("PT Sumber Makmur");
const CAHAYA = supplierFixture("CV Cahaya Abadi");
const SINAR = supplierFixture("Toko Grosir Sinar");
const MAKMUR_JAYA = supplierFixture("UD Makmur Jaya"); // team 13's
const BANYAK = supplierFixture("PT Banyak Toko"); // twelve channels — more than a page
const LAMA_TUTUP = supplierFixture("CV Lama Tutup"); // deleted

const SHOPEE_STORE = channelFixture(311n);
const TOKOPEDIA_STORE = channelFixture(312n);
const SUMBER_WEBSITE = channelFixture(313n); // "Cigondewah" is only in its description
const WEBSITE = channelFixture(321n);
const MAKMUR_JAYA_STORE = channelFixture(341n);

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
const AtBanyak = routedAt(BANYAK.id);
const AtDeleted = routedAt(LAMA_TUTUP.id);

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

async function openProducts(canvas: ReturnType<typeof within>) {
  await userEvent.click(canvas.getByTestId("supplier-tab-products"));
  await waitFor(() => expect(canvas.getByTestId("supplier-tab-products")).toHaveAttribute("aria-selected", "true"));
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {};

export const ProductsTab: Story = {
  play: async ({ canvasElement }) => {
    await openProducts(await loaded(canvasElement));
  },
};

// the-figures-are-a-statistics-tab-and-a-supplier-report — the figures supplier_service folds (SupplierStatistics).
export const StatisticsTab: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.click(canvas.getByTestId("supplier-tab-statistics"));
    await expect(await canvas.findByTestId("supplier-statistics")).toBeInTheDocument();
  },
};

export const AWebsiteOnly: Story = { render: () => <AtCahaya /> };

export const NoChannelsYet: Story = { render: () => <AtSinar /> };

export const ManyChannels: Story = { render: () => <AtBanyak /> };

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// the-supplier-has-no-code · no-province-or-city: a contact, an address, a description.
export const TheDecidedFields: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("supplier-detail-name")).toHaveTextContent(SUMBER.name);
    await expect(canvas.getByTestId("supplier-detail-contact")).toHaveTextContent(SUMBER.contact);
    await expect(canvas.getByTestId("supplier-detail-address")).toHaveTextContent(SUMBER.address);
    await expect(canvas.getByTestId("supplier-detail-description")).toHaveTextContent(SUMBER.description);
  },
};

// supplier-detail-has-channels-and-products-tabs: HORIZONTAL tabs, Channels open on arrival — and Statistics beside
// them (the-figures-are-a-statistics-tab-and-a-supplier-report).
export const ChannelsAndProductsTabs: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const tablist = canvas.getByRole("tablist");
    await expect(tablist).toHaveAttribute("aria-orientation", "horizontal");
    await expect(within(tablist).getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Channels",
      // Products carries its own sample mark; Statistics is real (the-figures-screens-are-accepted).
      "Products1",
      "Statistics",
    ]);
    await expect(canvas.getByTestId("supplier-tab-channels")).toHaveAttribute("aria-selected", "true");
  },
};

// The Channels tab is ONE list, each row wearing its marketplace's badge (channel-type-is-the-marketplace-list).
export const ChannelsAreOneListWithBadges: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId(`channel-row-${SHOPEE_STORE.id}`)).toHaveTextContent("Shopee"));
    await expect(canvas.getByTestId(`channel-row-${TOKOPEDIA_STORE.id}`)).toHaveTextContent("Tokopedia");
  },
};

// A plain website is the owner's `custom` — the shared list's Other (custom-is-labelled-other).
export const AWebsiteIsOther: Story = {
  render: () => <AtCahaya />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const row = await canvas.findByTestId(`channel-row-${WEBSITE.id}`);
    await expect(row).toHaveTextContent("Other");
    await expect(row).toHaveTextContent("https://cahayaabadi.co.id");
  },
};

// No online/offline switch: a channel is a type, a name, a link and a description — and every one of them is
// kept, the description included.
export const AddChannel: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(await canvas.findByTestId("add-channel"));
    const name = await screen.findByTestId("channel-name");
    await waitFor(() => expect(name).toBeVisible());

    await expect(screen.queryByTestId("channel-location")).toBeNull();
    await expect(screen.getByTestId("submit-channel")).toBeDisabled();

    // The dialog's own picker — the Channels tab's type filter is a second one on the page.
    await userEvent.click(within(screen.getByRole("dialog")).getByTestId("marketplace-select"));
    await userEvent.click(await screen.findByRole("option", { name: "Lazada" }));
    await userEvent.type(name, "Sumber Makmur Lazada", { delay: 40 });
    await userEvent.type(screen.getByTestId("channel-uri"), "https://www.lazada.co.id/shop/sumbermakmur", {
      delay: 10,
    });
    await userEvent.type(screen.getByTestId("channel-description"), "Gratis ongkir di atas 5 rol", { delay: 10 });

    await expect(screen.getByTestId("submit-channel")).toBeEnabled();
    await userEvent.click(screen.getByTestId("submit-channel"));

    await waitFor(() => expect(canvas.getByTestId("channels-table")).toHaveTextContent("Sumber Makmur Lazada"));
    await expect(canvas.getByTestId("channels-table")).toHaveTextContent("Lazada");
    // The description is stored now — supplier_service has the field the old server lacked.
    await expect(canvas.getByTestId("channels-table")).toHaveTextContent("Gratis ongkir di atas 5 rol");
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

// The one thing that is not real yet, said on the page: the Products tab is invented rows (sample). A channel's
// description is real now, so it carries no mark — not in the table, not in the form.
export const WhatIsNotRealYetIsMarked: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("not-implemented-summary")).toBeVisible();
    await canvas.findByTestId(`channel-row-${SHOPEE_STORE.id}`);
    await expect(
      within(canvas.getByTestId("supplier-tab-products")).getByTestId("not-implemented-products"),
    ).toBeVisible();
    await expect(canvas.queryAllByTestId("not-implemented-channelDescription")).toHaveLength(0);

    await userEvent.click(canvas.getByTestId("add-channel"));
    const description = await screen.findByTestId("channel-description");
    await waitFor(() => expect(description).toBeVisible());
    await expect(
      within(screen.getByRole("dialog")).queryByTestId("not-implemented-channelDescription"),
    ).toBeNull();
  },
};

// products-hang-off-a-channel: each product names the channel it is bought from. SAMPLE rows, made up from
// the supplier's real channels — two per channel.
export const ProductsNameTheirChannel: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await canvas.findByTestId(`channel-row-${SHOPEE_STORE.id}`);

    await openProducts(canvas);

    const table = await canvas.findByTestId("products-table");
    await expect(within(table).getAllByRole("row")).toHaveLength(1 + 2 * 3);
    await expect(canvas.getByTestId(`product-row-${SHOPEE_STORE.id}-0`)).toHaveTextContent(SHOPEE_STORE.name);
    await expect(canvas.getByTestId(`product-row-${SHOPEE_STORE.id}-0`)).toHaveTextContent("Shopee");
  },
};

export const NoChannelsMeansNoProducts: Story = {
  render: () => <AtSinar />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await canvas.findByTestId("channels-empty");
    await openProducts(canvas);
    await canvas.findByTestId("products-empty");
  },
};

// the-channels-tab-searches-filters-and-pages: the search reads the name, the link and the description; nothing
// matching says so, rather than reading as "no channels".
export const ChannelsSearch: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await canvas.findByTestId(`channel-row-${SHOPEE_STORE.id}`);

    await userEvent.type(canvas.getByTestId("channels-search"), "official", { delay: 40 });
    await waitFor(() => expect(canvas.queryByTestId(`channel-row-${TOKOPEDIA_STORE.id}`)).toBeNull());
    await expect(canvas.getByTestId(`channel-row-${SHOPEE_STORE.id}`)).toBeVisible();

    // The description is searchable too — "Cigondewah" is only in the website's.
    await userEvent.clear(canvas.getByTestId("channels-search"));
    await userEvent.type(canvas.getByTestId("channels-search"), "cigondewah", { delay: 40 });
    await waitFor(() => expect(canvas.queryByTestId(`channel-row-${SHOPEE_STORE.id}`)).toBeNull());
    await expect(canvas.getByTestId(`channel-row-${SUMBER_WEBSITE.id}`)).toBeVisible();

    await userEvent.clear(canvas.getByTestId("channels-search"));
    await userEvent.type(canvas.getByTestId("channels-search"), "zzz", { delay: 40 });
    await canvas.findByTestId("channels-none-match");
  },
};

export const ChannelsFilterByType: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await canvas.findByTestId(`channel-row-${SHOPEE_STORE.id}`);

    await userEvent.click(within(canvas.getByTestId("channels-type-filter")).getByTestId("marketplace-select"));
    await userEvent.click(await canvas.findByRole("option", { name: "Tokopedia" }));

    await waitFor(() => expect(canvas.queryByTestId(`channel-row-${SHOPEE_STORE.id}`)).toBeNull());
    await expect(canvas.getByTestId(`channel-row-${TOKOPEDIA_STORE.id}`)).toBeVisible();
  },
};

// Twelve channels at ten a page, newest first: two pages, the oldest on the second.
export const ChannelsPaginate: Story = {
  render: () => <AtBanyak />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const table = await canvas.findByTestId("channels-table");
    await waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(1 + 10));

    await userEvent.click(canvas.getByTestId("page-next"));
    await waitFor(() => expect(within(canvas.getByTestId("channels-table")).getAllByRole("row")).toHaveLength(1 + 2));
    await expect(canvas.getByTestId("channel-row-351")).toBeVisible();
  },
};

// the-products-tab-searches-and-pages: the product, its SKU, or the channel it is bought from.
export const ProductsSearch: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await canvas.findByTestId(`channel-row-${SHOPEE_STORE.id}`);
    await openProducts(canvas);

    await userEvent.type(canvas.getByTestId("products-search"), "KTN", { delay: 40 });
    await waitFor(() => expect(within(canvas.getByTestId("products-table")).getAllByRole("row")).toHaveLength(1 + 1));
    await expect(canvas.getByTestId("products-table")).toHaveTextContent("Kain Katun Jepang");

    await userEvent.clear(canvas.getByTestId("products-search"));
    await userEvent.type(canvas.getByTestId("products-search"), "zzz", { delay: 40 });
    await canvas.findByTestId("products-none-match");
  },
};

// Twelve channels make twenty-four sample products: three pages of ten.
export const ProductsPaginate: Story = {
  render: () => <AtBanyak />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await canvas.findByTestId("channel-row-362");
    await openProducts(canvas);

    await waitFor(() => expect(within(canvas.getByTestId("products-table")).getAllByRole("row")).toHaveLength(1 + 10));
    await userEvent.click(canvas.getByTestId("page-next"));
    await userEvent.click(canvas.getByTestId("page-next"));
    await waitFor(() => expect(within(canvas.getByTestId("products-table")).getAllByRole("row")).toHaveLength(1 + 4));
  },
};

// READS CROSS TEAMS, WRITES DO NOT. Another selling team's supplier, opened here by its URL, reads in full —
// SupplierDetail answers for any team — but this team may not change it, so the page offers no Add Channel and no
// Edit or Delete on a store: the server would answer NotFound to every one.
export const AnotherTeamsSupplierIsReadOnly: Story = {
  render: () => <AtAnotherTeams />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("supplier-detail-name")).toHaveTextContent(MAKMUR_JAYA.name);
    await canvas.findByTestId(`channel-row-${MAKMUR_JAYA_STORE.id}`);

    await expect(canvas.queryByTestId("add-channel")).toBeNull();
    await expect(canvas.queryAllByTestId(/^edit-channel-|^delete-channel-/)).toHaveLength(0);
    await expect(within(canvas.getByTestId("channels-table")).queryByText("Actions")).toBeNull();
  },
};

// a-deleted-supplier-is-kept-for-its-figures: a deleted supplier leaves every detail — kept for past restocks
// and the figures, read by id, never opened as a record.
export const ADeletedSupplierIsNotFound: Story = {
  render: () => <AtDeleted />,
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
