import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { ShopDetailPage } from "./index";

// A SHOP'S PAGE (#85) — its fields, and who may work on it (#86), on the screen rules
// (the-shop-screens-follow-the-screen-rules). The stub is shopStub.ts:
// a team reads only its own shops, and the primary CS is a flag on a grant — the FIRST user granted becomes it, and
// removing the primary's grant leaves none.
//
//   21 Melati Official — Shopee; Ani (primary) and Budi
//   22 Melati Store    — Tokopedia; nobody, so NO primary CS
//   24 Kenanga Official — team 13's, so NOT FOUND for Toko Melati

function asMelatiOwner() {
  asTeam(12n)();
  asRole(Role.SELLING_OWNER)();
}

const routes = [{ path: "/shops/:shopId", element: <ShopDetailPage /> }, marker("/shops", "at-shops")];
const At = (shopId: number) => routedPage(routes, `/shops/${shopId}`);
const AtOfficial = At(21);
const AtStore = At(22);
const AtKenanga = At(24);

const meta = {
  title: "Pages/Shops/ShopDetail",
  component: AtOfficial,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: asMelatiOwner,
} satisfies Meta<typeof AtOfficial>;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("shop-detail-page", {}, { timeout: 4000 });
  return canvas;
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {};

/** A phone — the header stays one row, Edit and Delete their icons (a-phone-header-action-is-an-icon). */
export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("shop-detail-name")).toHaveTextContent("Melati Official");
    const edit = canvas.getByRole("button", { name: "Edit" });
    await expect(edit).toHaveAttribute("data-testid", "shop-detail-edit");
    await expect(edit).not.toHaveTextContent("Edit");
    const name = canvas.getByTestId("shop-detail-name").getBoundingClientRect();
    await expect(edit.getBoundingClientRect().top).toBeLessThan(name.bottom);
  },
};

/** A shop with no one granted — and so no primary CS. */
export const NobodyGranted: Story = { render: () => <AtStore /> };

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

/** The page's title is the shop's name, its marketplace beside it; its code and description on one line under it —
 * "No description" when it has none. */
export const TheShopsFields: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("shop-detail-name")).toHaveTextContent(/^Melati Official$/);
    await expect(canvas.getByTestId("shop-detail-page")).toHaveTextContent("Shopee");
    await expect(canvas.getByTestId("shop-detail-code")).toHaveTextContent("MEL-SHP");
    await expect(canvas.getByTestId("shop-detail-meta")).toHaveTextContent("No description");
  },
};

/** Delete confirms, naming the shop, then goes back to the list. */
export const DeleteConfirmsAndGoesBack: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("shop-detail-delete"));
    const dialog = await screen.findByRole("alertdialog");
    await waitFor(() => expect(dialog).toBeVisible());
    await expect(dialog).toHaveTextContent("Melati Official");

    await userEvent.click(within(dialog).getByTestId("confirm-action"));
    await waitFor(() => expect(canvas.getByTestId("at-shops")).toBeInTheDocument());
  },
};

/** The primary CS wears the badge; everyone else can be made primary. */
export const ThePrimaryCsIsMarked: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("shop-user-primary-ani")).toBeVisible());
    await expect(canvas.queryByTestId("make-primary-ani")).toBeNull();
    await expect(canvas.getByTestId("make-primary-budi")).toBeVisible();
    await expect(canvas.queryByTestId("shop-no-primary")).toBeNull();
  },
};

/** Make Primary moves the badge. */
export const MakePrimaryMovesTheBadge: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(await canvas.findByTestId("make-primary-budi"));
    await waitFor(() => expect(canvas.getByTestId("shop-user-primary-budi")).toBeVisible());
    await expect(canvas.queryByTestId("shop-user-primary-ani")).toBeNull();
  },
};

/** No grants, no primary CS — the page says so, and why it matters. */
export const NoPrimaryCsSaysSo: Story = {
  render: () => <AtStore />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("shop-no-primary")).toBeVisible();
    await waitFor(() => expect(canvas.getByTestId("shop-users-empty")).toBeVisible());
  },
};

/** The FIRST user granted becomes the primary CS. The picker offers the team's members (Eko is one of Toko Melati's). */
export const TheFirstGrantBecomesPrimary: Story = {
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

/** Removing a grant confirms first; removing the PRIMARY's leaves the shop with none. */
export const RemovingThePrimaryLeavesNone: Story = {
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

/** Edit opens the shop's form, filled in. */
export const EditOpensTheForm: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("shop-detail-edit"));
    const name = await screen.findByTestId("shop-name");
    await waitFor(() => expect(name).toBeVisible());
    await expect(name).toHaveValue("Melati Official");
  },
};

/** Another team's shop is not found — the id in the URL is not trusted to belong to the team in hand. */
export const AnotherTeamsShopIsNotFound: Story = {
  render: () => <AtKenanga />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByTestId("shop-detail-error", {}, { timeout: 4000 })).toBeVisible();
  },
};

/** Back goes to the shops list. */
export const BackGoesToTheList: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("shop-detail-back"));
    await waitFor(() => expect(canvas.getByTestId("at-shops")).toBeInTheDocument());
  },
};
