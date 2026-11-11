import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { SUPPLIER_DETAIL_META, SHOPEE_STORE, TOKOPEDIA_STORE, loaded } from "./kit";

// SUPPLIER DETAIL — Add Store, the examples in its form (the-add-store-form-shows-examples), and a store's Delete.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Suppliers/SupplierDetail/StoreActions",
  ...SUPPLIER_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// No online/offline switch: a channel is a type, a name, a link and a description — and every one of them is
// kept, the description included.
export const AddChannel: Story = {
  name: "Add a store",
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

// THE ADD-STORE FORM SHOWS EXAMPLES — every field, as the add-supplier form does (the-add-store-form-shows-examples).
export const TheAddStoreFormShowsExamples: Story = {
  name: "Form examples",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(await canvas.findByTestId("add-channel"));
    const name = await screen.findByTestId("channel-name");
    await waitFor(() => expect(name).toBeVisible());

    await expect(name).toHaveAttribute("placeholder", "e.g. Sumber Makmur Official");
    await expect(screen.getByTestId("channel-uri")).toHaveAttribute("placeholder", "e.g. https://shopee.co.id/sumbermakmur");
    await expect(screen.getByTestId("channel-description")).toHaveAttribute("placeholder", "e.g. free shipping over 5 rolls");
  },
};

export const DeleteChannelConfirms: Story = {
  name: "Delete confirms",
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
