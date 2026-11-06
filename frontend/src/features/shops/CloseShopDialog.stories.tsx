import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { create } from "@bufbuild/protobuf";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { shops } from "../../../.storybook/fixtures";
import { shopService } from "../../../.storybook/shopStub";
import { ShopSchema, ShopStatus } from "../../gen/warehouse/selling/v1/selling_pb";
import { CloseShopDialog, description } from "./CloseShopDialog";

// Close Shop's confirmation (the-close-shop-prototype-is-accepted). What it says is the owner's decisions, one line each:
//   stops     a-closed-shop-refuses-only-new-selling (orders, pushed drafts, the order form's picker) ·
//             a-close-leaves-the-drafts-waiting · a-closed-shop-takes-no-new-account-link · a-closed-shop-locks-all-but-its-grants
//   keeps     a-closed-shop-refuses-only-new-selling (placed orders, imports, settlement, accounts, expenses) ·
//             a-closed-shop-locks-all-but-its-grants (grants, primary CS)
//   the code  a-shop-code-is-unique-among-open-shops — closing frees it
//   no CS     a-shop-with-no-primary-cs-cannot-import — warned, never refused

const OFFICIAL = create(ShopSchema, { ...shops[0]!, primaryUserId: 61n }); // Melati Official, primary Ani
const STORE = create(ShopSchema, { ...shops[1]!, primaryUserId: 0n }); // Melati Store, no primary CS

function Open({ shop }: { shop: typeof OFFICIAL }) {
  const [open, setOpen] = useState(true);

  return <CloseShopDialog teamId={12n} shop={shop} open={open} onOpenChange={setOpen} />;
}

const meta = {
  title: "Features/Shops/CloseShopDialog",
  component: CloseShopDialog,
  parameters: { docs: { description: { component: description } } },
  args: { teamId: 12n, shop: OFFICIAL },
  render: () => <Open shop={OFFICIAL} />,
} satisfies Meta<typeof CloseShopDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

async function dialog() {
  const box = await screen.findByRole("alertdialog");
  await waitFor(() => expect(box).toBeVisible());
  return box;
}

/** It names the shop, says what stops and what keeps working, and frees the code. Title Case title and button. */
export const ItSaysWhatClosingDoes: Story = {
  play: async () => {
    const box = await dialog();
    const d = within(box);

    await expect(d.getByRole("heading", { name: "Close Shop" })).toBeVisible();
    await expect(box).toHaveTextContent("Close Melati Official? You can reopen it later.");
    for (const id of ["stops-orders", "stops-picker", "stops-drafts", "stops-account", "stops-edit"]) {
      await expect(d.getByTestId(`close-shop-${id}`)).toBeVisible();
    }
    for (const id of ["keeps-orders", "keeps-money", "keeps-access"]) {
      await expect(d.getByTestId(`close-shop-${id}`)).toBeVisible();
    }
    await expect(d.getByTestId("close-shop-stops-drafts")).toHaveTextContent(/drafts stay listed/);
    await expect(d.getByTestId("close-shop-keeps-money")).toHaveTextContent(/statements still import/);
    await expect(d.getByTestId("close-shop-code")).toHaveTextContent("MEL-SHP");
    // A shop with a primary CS is not warned.
    await expect(d.queryByTestId("close-shop-no-primary")).toBeNull();
    await expect(d.getByTestId("confirm-action")).toHaveTextContent(/^Close Shop$/);
  },
};

/** A shop with no primary CS is warned — its last statements cannot import until one is chosen — and still closes. */
export const ANoPrimaryShopIsWarnedNotRefused: Story = {
  render: () => <Open shop={STORE} />,
  play: async () => {
    const box = await dialog();
    const d = within(box);

    await expect(d.getByTestId("close-shop-no-primary")).toHaveTextContent(/no primary CS/);
    await userEvent.click(d.getByTestId("confirm-action"));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    // Closed through ShopClose — the stub's row is closed, with its date.
    await waitFor(() => expect(shopService.shopDetail({ teamId: 12n, shopId: STORE.id }).shop.status).toBe(ShopStatus.CLOSED));
    await expect(shopService.shopDetail({ teamId: 12n, shopId: STORE.id }).shop.closedAtUnix).toBeGreaterThan(0n);
  },
};
