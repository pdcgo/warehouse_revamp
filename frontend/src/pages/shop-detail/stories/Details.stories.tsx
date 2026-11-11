import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { unlinkShopForStory } from "../../../../.storybook/financialAccountStub";
import { AtStore, SHOP_DETAIL_META, asMelatiOwner, loaded } from "./kit";

// SHOP DETAIL — the Shop Details panel — its fields, the two panels, the withdrawal account. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Shops/ShopDetail/Details",
  ...SHOP_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The page's title is the shop's name alone; under it the Detail Toko card (owner: "untuk toko taruh detail di atas",
 * "yang sekarang saja, tapi ui kurang") — its code, its marketplace and its description, each a labelled fact; an absent
 * description reads "—". No primary CS ("di detail tidak perlu ada cs utama"), no badge by the title ("di atas tidak
 * perlu marketplace"). */
export const TheShopsFields: Story = {
  name: "Fields",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("shop-detail-name")).toHaveTextContent(/^Melati Official$/);
    const info = canvas.getByTestId("shop-detail-info");
    await expect(info).toHaveTextContent("Shop Details");
    await expect(within(info).getByTestId("shop-detail-code")).toHaveTextContent("MEL-SHP");
    await expect(within(info).getByTestId("shop-detail-marketplace")).toHaveTextContent("Shopee");
    // No primary CS in the card, and no marketplace beside the title — each said once, where it belongs.
    await expect(within(info).queryByTestId("shop-detail-primary")).toBeNull();
    await expect(canvas.getAllByText("Shopee")).toHaveLength(1);
    await expect(within(info).getByTestId("shop-detail-description")).toHaveTextContent("—");
  },
};

/** Two panels, detail and access (owner: "space terlalu banyak, coba jadi 2 panel, detail dan akses") — side by side
 * from `lg`, the detail on the left, half and half ("detail terlalu kecil"); narrower, the detail stacks above. */
export const DetailAndAccessAreTwoPanels: Story = {
  name: "Two panels",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const info = canvas.getByTestId("shop-detail-info").getBoundingClientRect();
    const users = canvas.getByTestId("shop-users-section").getBoundingClientRect();
    if (window.matchMedia("(min-width: 64em)").matches) {
      await expect(Math.abs(info.top - users.top)).toBeLessThan(2);
      await expect(info.right).toBeLessThanOrEqual(users.left);
      await expect(Math.abs(users.width - info.width)).toBeLessThan(2);
    } else {
      await expect(info.bottom).toBeLessThanOrEqual(users.top);
    }
  },
};

/** AKUN PENARIKAN under the details (owner: "di bawah detail ada akun penarikan, jika tidak ada kasih link ke
 * rekeningnya") — Melati Official withdraws into BCA Operasional: its name, its number, its holder; Open Account goes
 * to it. */
export const TheWithdrawalAccountIsUnderTheDetails: Story = {
  name: "Withdrawal account",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const card = await canvas.findByTestId("shop-withdrawal-account", {}, { timeout: 3000 });
    await expect(card).toHaveTextContent("BCA Operasional");
    await expect(card).toHaveTextContent("1234567890");
    await expect(card).toHaveTextContent("PT Melati Sejahtera");

    const details = canvas.getByTestId("shop-detail-info").getBoundingClientRect();
    await expect(details.bottom).toBeLessThanOrEqual(canvas.getByTestId("shop-withdrawal-card").getBoundingClientRect().top);

    await userEvent.click(canvas.getByTestId("shop-withdrawal-open"));
    await waitFor(() => expect(canvas.getByTestId("at-account")).toBeInTheDocument());
  },
};

/** A shop that withdraws into no account says so, in the warning role, and links to the accounts — where a shop is
 * linked to one. */
export const NoWithdrawalAccountLinksToTheAccounts: Story = {
  name: "No withdrawal account",
  render: () => <AtStore />,
  beforeEach: () => {
    asMelatiOwner();
    unlinkShopForStory(22n);
  },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const none = await canvas.findByTestId("shop-withdrawal-none", {}, { timeout: 3000 });
    await expect(none).toHaveTextContent("No withdrawal account");

    await userEvent.click(canvas.getByTestId("shop-withdrawal-open-accounts"));
    await waitFor(() => expect(canvas.getByTestId("at-accounts")).toBeInTheDocument());
  },
};
