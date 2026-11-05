import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { AtStore, SHOP_DETAIL_META, loaded } from "./kit";

// SHOP DETAIL — who may work on it — the primary CS, Make Primary, the picker, removing a grant. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Shops/ShopDetail/Access",
  ...SHOP_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The people are a plain list, not a table (owner: "oke"); the primary CS wears the badge — "Primary", the card says
 * whose ("cs utama jadi utama saja"); everyone else can be made primary. */
export const ThePrimaryCsIsMarked: Story = {
  name: "Primary marked",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("shop-user-primary-ani")).toBeVisible());
    await expect(canvas.getByTestId("shop-user-primary-ani")).toHaveTextContent(/^Primary$/);
    await expect(within(canvas.getByTestId("shop-users-section")).queryByRole("table")).toBeNull();
    await expect(within(canvas.getByTestId("shop-users-list")).getByTestId("shop-user-row-budi")).toBeVisible();
    await expect(canvas.queryByTestId("make-primary-ani")).toBeNull();
    await expect(canvas.getByTestId("make-primary-budi")).toBeVisible();
    await expect(canvas.queryByTestId("shop-no-primary")).toBeNull();
  },
};

/** Make Primary moves the badge. */
export const MakePrimaryMovesTheBadge: Story = {
  name: "Make primary",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // It confirms first (owner: "utama ada confirmnya"), naming who it moves from and to.
    await userEvent.click(await canvas.findByTestId("make-primary-budi"));
    const dialog = await screen.findByRole("alertdialog");
    await waitFor(() => expect(dialog).toBeVisible());
    await expect(dialog).toHaveTextContent("Budi Santoso");
    await expect(dialog).toHaveTextContent("Ani Rahayu");
    await expect(canvas.getByTestId("shop-user-primary-ani")).toBeVisible();

    await userEvent.click(within(dialog).getByTestId("confirm-action"));
    await waitFor(() => expect(canvas.getByTestId("shop-user-primary-budi")).toBeVisible());
    await expect(canvas.queryByTestId("shop-user-primary-ani")).toBeNull();
  },
};

/** Cancelling Make Primary leaves the primary where it was. */
export const CancellingMakePrimaryKeepsThePrimary: Story = {
  name: "Cancel make primary",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(await canvas.findByTestId("make-primary-budi"));
    const dialog = await screen.findByRole("alertdialog");
    await waitFor(() => expect(dialog).toBeVisible());
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await expect(canvas.getByTestId("shop-user-primary-ani")).toBeVisible();
    await expect(canvas.queryByTestId("shop-user-primary-budi")).toBeNull();
  },
};

/** No grants, no primary CS — the page says so, and why it matters. */
export const NoPrimaryCsSaysSo: Story = {
  name: "No primary",
  render: () => <AtStore />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("shop-no-primary")).toBeVisible();
    await waitFor(() => expect(canvas.getByTestId("shop-users-empty")).toBeVisible());
  },
};

/** The FIRST user granted becomes the primary CS. The picker offers the team's members (Eko is one of Toko Melati's). */
export const TheFirstGrantBecomesPrimary: Story = {
  name: "First grant is primary",
  render: () => <AtStore />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.type(within(canvas.getByTestId("shop-users-section")).getByRole("combobox"), "eko", { delay: 40 });
    const option = await screen.findByTestId("user-select-option-eko", {}, { timeout: 3000 });
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await waitFor(() => expect(canvas.getByTestId("shop-add-user")).toBeEnabled());
    await userEvent.click(canvas.getByTestId("shop-add-user"));
    await waitFor(() => expect(canvas.getByTestId("shop-user-row-eko")).toBeVisible());
    await waitFor(() => expect(canvas.getByTestId("shop-user-primary-eko")).toBeVisible());
    await expect(canvas.queryByTestId("shop-no-primary")).toBeNull();
  },
};

/** The picker shows the team's members on a click, nothing typed (owner: "select user langsung muncul usernya tanpa ketik
 * dulu"). */
export const ThePickerShowsTheMembersAtOnce: Story = {
  name: "Members at once",
  render: () => <AtStore />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(within(canvas.getByTestId("shop-users-section")).getByRole("combobox"));
    const eko = await screen.findByTestId("user-select-option-eko", {}, { timeout: 3000 });
    await waitFor(() => expect(eko).toBeVisible());
    await expect(screen.getAllByRole("option").length).toBeGreaterThan(1);
  },
};

/** Removing a grant confirms first; removing the PRIMARY's leaves the shop with none. */
export const RemovingThePrimaryLeavesNone: Story = {
  name: "Remove the primary",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(await canvas.findByTestId("remove-shop-user-ani"));
    const dialog = await screen.findByRole("alertdialog");
    await waitFor(() => expect(dialog).toBeVisible());
    await expect(dialog).toHaveTextContent("ani");

    await userEvent.click(within(dialog).getByTestId("confirm-action"));
    await waitFor(() => expect(canvas.queryByTestId("shop-user-row-ani")).toBeNull());
    await waitFor(() => expect(canvas.getByTestId("shop-no-primary")).toBeVisible());
    await expect(canvas.getByTestId("shop-user-row-budi")).toBeVisible();
  },
};
