import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, asTeam, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { unlinkShopForStory } from "../../../.storybook/financialAccountStub";
import { closeShopForStory, shopService } from "../../../.storybook/shopStub";
import { MarketplaceInfoForm, emptyMarketplaceInfo } from "../../components/orders/MarketplaceInfoForm";
import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { formatUnixDate } from "../../lib/datetime";
import { SettlementImportsPage } from "../settlement-imports";
import { ShopDetailPage } from "../shop-detail";
import { ShopsPage } from "./index";

// CLOSE A SHOP — the accepted design (the-close-shop-prototype-is-accepted), now live over ShopList `status`, ShopClose
// and ShopReopen (the stub plays the server's rules, .storybook/shopStub.ts).
//
// What the owner decided (docs/business/shop/context_decision.md), and the story that pins each:
//
//   | decision                                  | the rule                                              | story                                   |
//   | ----------------------------------------- | ----------------------------------------------------- | --------------------------------------- |
//   | a-shop-is-closed-never-deleted            | open by default, closed by a filter · no delete       | TheListShowsOpenShopsByDefault, …Closed… |
//   | a-closed-shop-refuses-only-new-selling    | the order form's picker never offers it ·             | TheOrderFormsPickerNeverOffersAClosedShop |
//   | a-close-leaves-the-drafts-waiting         | the order form keeps a draft's closed shop, badged    | TheOrderFormKeepsADraftsClosedShop      |
//   |                                           | the statement import still takes it                   | TheStatementImportOffersAClosedShop     |
//   | a-close-leaves-the-drafts-waiting         | the close is never refused; the dialog says so        | CloseConfirmsWhatItDoes                 |
//   | a-shop-code-is-unique-among-open-shops    | reopen refused while an open shop holds the code      | ReopenIsRefusedWhileAnOpenShopHoldsTheCode |
//   | a-closed-shop-locks-all-but-its-grants    | no Edit on a closed shop · access stays editable      | AClosedShopsPageSaysSo                  |
//   | a-closed-shop-takes-no-new-account-link   | its page offers no account link                       | AClosedShopTakesNoNewAccountLink        |
//
// Toko Melati (12): Melati Official 21 (Shopee, MEL-SHP, primary Ani) · Melati Store 22 (Tokopedia, MEL-TOK, nobody
// granted) — CLOSED three days ago in every story here · Melati Grosir 23 (Lazada, MEL-LAZ, Eko) · Melati TikTok 25
// (TikTok, MEL-TIK). The team's owner is signed in: owner and admin close and reopen.

const MELATI = 12n;

function asMelatiOwner() {
  asTeam(MELATI)();
  asRole(Role.SELLING_OWNER)();
}

const shopRoutes = [
  {
    path: "/shops",
    element: (
      <>
        <ShopsPage />
        <LocationProbe />
      </>
    ),
  },
  { path: "/shops/:shopId", element: <ShopDetailPage /> },
];
const List = routedPage(shopRoutes, "/shops");
const ListClosed = routedPage(shopRoutes, "/shops?status=closed");
const ListAll = routedPage(shopRoutes, "/shops?status=all");
const StorePage = routedPage(shopRoutes, "/shops/22");
const OfficialPage = routedPage(shopRoutes, "/shops/21");
const Imports = routedPage([{ path: "/settlement/imports", element: <SettlementImportsPage /> }], "/settlement/imports");

/** The order form's marketplace block — the very ShopSelect the order form and a draft use (`writable`, `keepClosed`). */
function OrderFormShop({ shopId = 0n }: { shopId?: bigint }) {
  const [value, setValue] = useState({ ...emptyMarketplaceInfo, shopId });
  return (
    <>
      <MarketplaceInfoForm teamId={MELATI} value={value} onChange={setValue} required />
      <span data-testid="held-shop">{value.shopId.toString()}</span>
    </>
  );
}
const OrderForm = routedPage([{ path: "/orders/new", element: <OrderFormShop /> }], "/orders/new");
const DraftOnClosedShop = routedPage([{ path: "/orders/new", element: <OrderFormShop shopId={22n} /> }], "/orders/new");

const meta = {
  title: "Pages/Shops/CloseShop",
  component: List,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: () => {
    asMelatiOwner();
    closeShopForStory(22n, 3);
  },
} satisfies Meta<typeof List>;

export default meta;
type Story = StoryObj<typeof meta>;

async function listed(canvasElement: HTMLElement, code = "MEL-SHP") {
  const canvas = within(canvasElement);
  await canvas.findByTestId(`shop-row-${code}`, {}, { timeout: 4000 });
  return canvas;
}

async function detail(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("shop-detail-page", {}, { timeout: 4000 });
  return canvas;
}

async function pickStatus(canvasElement: HTMLElement, status: "open" | "closed" | "all") {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByTestId("shops-status-select"));
  const option = await canvas.findByTestId(`shops-status-option-${status}`);
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option);
}

// A toast may still be on screen from the story before — find at least one.
async function toast(text: string | RegExp) {
  await waitFor(async () => expect((await screen.findAllByText(text)).length).toBeGreaterThan(0));
}

async function alertDialog() {
  const box = await screen.findByRole("alertdialog");
  await waitFor(() => expect(box).toBeVisible());
  return box;
}

// ── The list ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** OPEN BY DEFAULT (a-shop-is-closed-never-deleted): the status filter reads *Open shops*, the closed Melati Store is not
 * listed, and every open row offers Close in Delete's place — there is no delete at all. */
export const TheListShowsOpenShopsByDefault: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await listed(canvasElement);

    await expect(canvas.getByTestId("shops-status-select")).toHaveTextContent("Open shops");
    await expect(canvas.queryByTestId("shop-row-MEL-TOK")).toBeNull();
    for (const code of ["MEL-SHP", "MEL-LAZ", "MEL-TIK"]) {
      const row = within(canvas.getByTestId(`shop-row-${code}`));
      await expect(row.getByTestId(`close-${code}`)).toHaveTextContent(/^Close$/);
      await expect(row.getByTestId(`edit-${code}`)).toBeVisible();
      await expect(row.queryByTestId(`shop-closed-${code}`)).toBeNull();
    }
    await expect(canvas.queryAllByTestId(/^delete-/)).toHaveLength(0);
    // Open is the default, not a filter — nothing counted, nothing in the URL.
    await expect(canvas.getByTestId("location-search")).toHaveTextContent(/^$/);
  },
};

/** CLOSED BY A FILTER: *Closed shops* lists only Melati Store, its badge (with the day) under its name, Reopen in Close's
 * place, no Edit (a-closed-shop-locks-all-but-its-grants) — and the primary CS action still in its ⋯ (grants stay
 * editable). The pick is in the URL. */
export const TheClosedFilterListsTheClosedShops: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await listed(canvasElement);

    await pickStatus(canvasElement, "closed");
    await canvas.findByTestId("shop-row-MEL-TOK");
    await waitFor(() => expect(canvas.queryByTestId("shop-row-MEL-SHP")).toBeNull());

    const row = within(canvas.getByTestId("shop-row-MEL-TOK"));
    await expect(row.getByTestId("shop-closed-MEL-TOK")).toHaveTextContent(/^Closed · /);
    await expect(row.getByTestId("reopen-MEL-TOK")).toHaveTextContent(/^Reopen$/);
    await expect(row.queryByTestId("edit-MEL-TOK")).toBeNull();
    await expect(row.queryByTestId("close-MEL-TOK")).toBeNull();
    await expect(row.getByTestId("shop-actions-MEL-TOK")).toBeVisible();
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("status=closed"));
    // Closed is a filter: Clear puts the list back on Open.
    await userEvent.click(canvas.getByTestId("shops-filter-clear"));
    await canvas.findByTestId("shop-row-MEL-SHP");
    await expect(canvas.getByTestId("shops-status-select")).toHaveTextContent("Open shops");
  },
};

/** ALL: every shop, the closed one badged under its name so the badges line up. */
export const AllListsBothTheClosedOneBadged: Story = {
  render: () => <ListAll />,
  play: async ({ canvasElement }) => {
    const canvas = await listed(canvasElement, "MEL-TOK");

    await expect(canvas.getByTestId("shops-status-select")).toHaveTextContent("All shops");
    for (const code of ["MEL-SHP", "MEL-TOK", "MEL-LAZ", "MEL-TIK"]) {
      await expect(canvas.getByTestId(`shop-row-${code}`)).toBeVisible();
    }
    await expect(canvas.getAllByTestId(/^shop-closed-/)).toHaveLength(1);
    // Under the name, not beside it.
    const name = canvas.getByTestId("open-shop-MEL-TOK").getBoundingClientRect();
    await expect(canvas.getByTestId("shop-closed-MEL-TOK").getBoundingClientRect().top).toBeGreaterThanOrEqual(name.bottom - 1);
  },
};

/** CLOSE CONFIRMS, saying what it does (the closed-shop decisions), then the shop leaves the Open list and is under
 * Closed. Never refused for drafts (a-close-leaves-the-drafts-waiting). */
export const CloseConfirmsWhatItDoes: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await listed(canvasElement, "MEL-LAZ");

    await userEvent.click(canvas.getByTestId("close-MEL-LAZ"));
    const box = await alertDialog();
    await expect(within(box).getByRole("heading", { name: "Close Shop" })).toBeVisible();
    await expect(box).toHaveTextContent("Close Melati Grosir? You can reopen it later.");
    await expect(within(box).getByTestId("close-shop-explained")).toHaveTextContent(/drafts stay listed/);
    await expect(within(box).getByTestId("close-shop-code")).toHaveTextContent("MEL-LAZ");
    // The row did not open under the click.
    await expect(canvas.queryByTestId("shop-detail-page")).toBeNull();

    await userEvent.click(within(box).getByTestId("confirm-action"));
    await toast("Melati Grosir is closed");
    await waitFor(() => expect(canvas.queryByTestId("shop-row-MEL-LAZ")).toBeNull());

    await pickStatus(canvasElement, "closed");
    await expect(within(await canvas.findByTestId("shop-row-MEL-LAZ")).getByTestId("shop-closed-MEL-LAZ")).toBeVisible();
  },
};

/** REOPEN gives selling back at once — not destructive, so no confirm — and the shop is on the Open list again. With no
 * closed shop left, the Closed list says so. */
export const ReopenPutsItBackOnTheOpenList: Story = {
  render: () => <ListClosed />,
  play: async ({ canvasElement }) => {
    const canvas = await listed(canvasElement, "MEL-TOK");

    await userEvent.click(canvas.getByTestId("reopen-MEL-TOK"));
    await toast("Melati Store is open again");
    await canvas.findByTestId("shops-none-closed");
    await expect(canvas.getByTestId("shops-none-closed")).toHaveTextContent("No closed shops");

    await pickStatus(canvasElement, "open");
    const row = within(await canvas.findByTestId("shop-row-MEL-TOK"));
    await expect(row.getByTestId("close-MEL-TOK")).toBeVisible();
    await expect(row.queryByTestId("shop-closed-MEL-TOK")).toBeNull();
  },
};

/** REOPEN IS REFUSED while an open shop of the team holds the code, naming that shop
 * (a-shop-code-is-unique-among-open-shops) — closing freed MEL-TOK and a new shop took it. */
export const ReopenIsRefusedWhileAnOpenShopHoldsTheCode: Story = {
  render: () => <ListClosed />,
  beforeEach: () => {
    shopService.shopCreate({
      teamId: MELATI,
      name: "Melati Store Baru",
      shopCode: "MEL-TOK",
      marketplace: Marketplace.TOKOPEDIA,
      description: "",
    });
  },
  play: async ({ canvasElement }) => {
    const canvas = await listed(canvasElement, "MEL-TOK");

    await userEvent.click(canvas.getByTestId("reopen-MEL-TOK"));
    await toast("Could not reopen the shop");
    await toast(/the open shop Melati Store Baru holds the code MEL-TOK/);
    await expect(within(canvas.getByTestId("shop-row-MEL-TOK")).getByTestId("shop-closed-MEL-TOK")).toBeVisible();
  },
};

/** No closed shop yet — the Closed list says so, rather than offering to add one. */
export const NoClosedShopSaysSo: Story = {
  render: () => <ListClosed />,
  beforeEach: async () => {
    shopService.shopReopen({ teamId: MELATI, shopId: 22n });
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const hint = await canvas.findByTestId("shops-none-closed", {}, { timeout: 4000 });
    await expect(hint).toHaveTextContent("No closed shops");
    await expect(canvas.queryByTestId("shops-empty-create")).toBeNull();
  },
};

/** A PHONE — each shop a block; the closed one's badge under its name and Reopen at its foot; the status filter stands in
 * the Filter sheet with the others (a-phone-filters-from-a-sheet). */
export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
  render: () => <ListAll />,
  play: async ({ canvasElement }) => {
    const canvas = await listed(canvasElement, "MEL-TOK");

    await expect(within(canvas.getByTestId("shops-table")).queryAllByRole("columnheader")).toHaveLength(0);
    const block = within(canvas.getByTestId("shop-row-MEL-TOK"));
    await expect(block.getByTestId("shop-closed-MEL-TOK")).toBeVisible();
    await expect(block.getByTestId("reopen-MEL-TOK")).toBeVisible();
    await expect(within(canvas.getByTestId("shop-row-MEL-SHP")).getByTestId("close-MEL-SHP")).toBeVisible();

    await userEvent.click(canvas.getByTestId("shops-filter-open"));
    const sheet = await screen.findByTestId("shops-filter-sheet");
    await waitFor(() => expect(sheet).toBeVisible());
    await expect(within(sheet).getByTestId("shops-status-select")).toHaveTextContent("All shops");
  },
};

// ── A shop's page ───────────────────────────────────────────────────────────────────────────────────────────────────

/** A CLOSED SHOP'S PAGE SAYS SO: the badge on the title's row, a banner with the day it closed and what it still does,
 * Reopen Shop as its one action — no Edit, no Close, no Delete (a-closed-shop-locks-all-but-its-grants) — while the access
 * panel still takes a grant, so its last statements can be imported. */
export const AClosedShopsPageSaysSo: Story = {
  render: () => <StorePage />,
  play: async ({ canvasElement }) => {
    const canvas = await detail(canvasElement);

    await expect(await canvas.findByTestId("shop-detail-closed")).toHaveTextContent(/^Closed$/);
    const banner = canvas.getByTestId("shop-closed-banner");
    await expect(banner).toHaveTextContent("This shop is closed");
    const closedOn = formatUnixDate(BigInt(Math.floor((Date.now() - 3 * 24 * 3600 * 1000) / 1000)));
    await expect(banner).toHaveTextContent(`Closed on ${closedOn}.`);
    await expect(banner).toHaveTextContent(/statements still import/);
    await expect(canvas.getByTestId("shop-detail-reopen")).toHaveTextContent("Reopen Shop");
    await expect(canvas.queryByTestId("shop-detail-edit")).toBeNull();
    await expect(canvas.queryByTestId("shop-detail-close")).toBeNull();
    await expect(canvas.queryByTestId("shop-detail-delete")).toBeNull();
    await expect(within(canvas.getByTestId("shop-users-section")).getByTestId("shop-add-user")).toBeInTheDocument();
  },
};

/** A closed shop with no withdrawal account offers no link (a-closed-shop-takes-no-new-account-link) — it says why. */
export const AClosedShopTakesNoNewAccountLink: Story = {
  render: () => <StorePage />,
  beforeEach: () => {
    unlinkShopForStory(22n);
  },
  play: async ({ canvasElement }) => {
    const canvas = await detail(canvasElement);

    await expect(await canvas.findByTestId("shop-withdrawal-closed", {}, { timeout: 3000 })).toHaveTextContent(
      "A closed shop takes no new account link",
    );
    await expect(canvas.queryByTestId("shop-withdrawal-open-accounts")).toBeNull();
  },
};

/** AN OPEN SHOP CLOSES FROM ITS PAGE — Close Shop in Delete's place confirms, and the page stays, now read as closed. */
export const AnOpenShopClosesFromItsPage: Story = {
  render: () => <OfficialPage />,
  play: async ({ canvasElement }) => {
    const canvas = await detail(canvasElement);

    await expect(canvas.queryByTestId("shop-detail-delete")).toBeNull();
    await expect(canvas.getByTestId("shop-detail-edit")).toBeVisible();
    await userEvent.click(canvas.getByTestId("shop-detail-close"));
    const box = await alertDialog();
    await expect(box).toHaveTextContent("Close Melati Official?");
    await userEvent.click(within(box).getByTestId("confirm-action"));

    await canvas.findByTestId("shop-closed-banner");
    await expect(canvas.getByTestId("shop-detail-name")).toHaveTextContent("Melati Official");
    await expect(canvas.getByTestId("shop-detail-reopen")).toBeVisible();
    await expect(canvas.queryByTestId("shop-detail-edit")).toBeNull();
  },
};

/** Reopen from the page — the banner goes, Edit and Close come back. */
export const ReopenFromItsPage: Story = {
  render: () => <StorePage />,
  play: async ({ canvasElement }) => {
    const canvas = await detail(canvasElement);

    await userEvent.click(await canvas.findByTestId("shop-detail-reopen"));
    await toast("Melati Store is open again");
    await waitFor(() => expect(canvas.queryByTestId("shop-closed-banner")).toBeNull());
    await expect(canvas.getByTestId("shop-detail-close")).toBeVisible();
    await expect(canvas.getByTestId("shop-detail-edit")).toBeVisible();
  },
};

/** A PHONE — the header stays one row: back above, then the name, the Closed badge and Reopen as its icon
 * (the-phone-header-is-one-row); the banner under it. */
export const ClosedShopMobile: Story = {
  globals: { viewport: { value: "mobile2" } },
  render: () => <StorePage />,
  play: async ({ canvasElement }) => {
    const canvas = await detail(canvasElement);

    const reopen = await canvas.findByRole("button", { name: "Reopen Shop" });
    await expect(reopen).toHaveAttribute("data-testid", "shop-detail-reopen");
    await expect(reopen).not.toHaveTextContent("Reopen Shop");
    const name = canvas.getByTestId("shop-detail-name").getBoundingClientRect();
    await expect(reopen.getBoundingClientRect().top).toBeLessThan(name.bottom);
    await expect(canvas.getByTestId("shop-detail-closed").getBoundingClientRect().top).toBeLessThan(name.bottom);
    await expect(canvas.getByTestId("shop-closed-banner").getBoundingClientRect().top).toBeGreaterThanOrEqual(name.bottom);
  },
};

// ── The pickers ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** THE STATEMENT IMPORT STILL TAKES A CLOSED SHOP (a-closed-shop-refuses-only-new-selling — its last payouts arrive after
 * the close): the dialog's picker offers Melati TikTok, closed, after the open shops and badged; picked, it says its
 * statements still import, and the import runs. */
export const TheStatementImportOffersAClosedShop: Story = {
  render: () => <Imports />,
  beforeEach: () => {
    closeShopForStory(25n, 1);
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByTestId("open-import-file", {}, { timeout: 4000 }));
    const box = await screen.findByTestId("import-dialog");
    await waitFor(() => expect(box).toBeVisible());
    const d = within(box);

    await userEvent.click(d.getByTestId("shop-select"));
    const closed = await d.findByTestId("shop-select-option-25");
    await waitFor(() => expect(closed).toBeVisible());
    await expect(within(closed).getByTestId("shop-select-closed-25")).toHaveTextContent("Closed");
    // After the open ones (Melati Store is closed too, so both closed shops trail the list).
    const options = d.getAllByRole("option").map((o) => o.getAttribute("data-testid"));
    for (const open of ["shop-select-option-21", "shop-select-option-23"]) {
      await expect(options.indexOf("shop-select-option-25")).toBeGreaterThan(options.indexOf(open));
      await expect(options.indexOf("shop-select-option-22")).toBeGreaterThan(options.indexOf(open));
    }
    await expect(d.queryByTestId("shop-select-closed-21")).toBeNull();

    await userEvent.click(closed);
    await expect(await d.findByTestId("import-closed-shop")).toHaveTextContent("its last statements still import");
    const input = d.getByTestId("import-file-input") as HTMLInputElement;
    await userEvent.upload(input, new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], "statement.xlsx"), {
      applyAccept: false,
    });
    await waitFor(() => expect(d.getByTestId("start-import")).toBeEnabled());
    await userEvent.click(d.getByTestId("start-import"));
    await d.findByTestId("import-progress");
  },
};

/** The import dialog's picker, open — the closed shops last, each badged (the picture to review). */
export const TheImportPickerListsTheClosedShopsLast: Story = {
  render: () => <Imports />,
  beforeEach: () => {
    closeShopForStory(25n, 1);
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByTestId("open-import-file", {}, { timeout: 4000 }));
    const box = await screen.findByTestId("import-dialog");
    await waitFor(() => expect(box).toBeVisible());
    const d = within(box);

    await userEvent.click(d.getByTestId("shop-select"));
    await waitFor(() => expect(d.getByTestId("shop-select-option-25")).toBeVisible());
    await expect(d.getAllByTestId(/^shop-select-closed-/)).toHaveLength(2);
  },
};

/** THE ORDER FORM'S PICKER NEVER OFFERS A CLOSED SHOP (a-closed-shop-refuses-only-new-selling) — the order form's own
 * block: Melati Store is not an option. */
export const TheOrderFormsPickerNeverOffersAClosedShop: Story = {
  render: () => <OrderForm />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("shop-select"));
    const open = await canvas.findByTestId("shop-select-option-21");
    await waitFor(() => expect(open).toBeVisible());
    await expect(canvas.queryByTestId("shop-select-option-22")).toBeNull();
    await expect(canvas.queryAllByTestId(/^shop-select-closed-/)).toHaveLength(0);
  },
};

/** A WAITING DRAFT KEEPS ITS CLOSED SHOP (a-close-leaves-the-drafts-waiting, the-close-shop-prototype-is-accepted): the
 * order form opened on a draft of the closed Melati Store holds it — badged, never silently cleared — and offers no
 * other closed shop. (The form's refused Create is pinned on the order form's own stories.) */
export const TheOrderFormKeepsADraftsClosedShop: Story = {
  render: () => <DraftOnClosedShop />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("shop-select")).toHaveValue("Melati Store"), { timeout: 4000 });
    await expect(canvas.getByTestId("held-shop")).toHaveTextContent("22");

    await userEvent.click(canvas.getByTestId("shop-select"));
    const kept = await canvas.findByTestId("shop-select-option-22");
    await waitFor(() => expect(kept).toBeVisible());
    await expect(within(kept).getByTestId("shop-select-closed-22")).toBeVisible();
    await expect(canvas.getAllByTestId(/^shop-select-closed-/)).toHaveLength(1);
  },
};

// ── No delete anywhere ─────────────────────────────────────────────────────────────────────────────────────────────
// What the screens USED to show — Delete, a closed shop missing from the import — is gone: these pin the live behaviour.

/** The list: the status filter, Close on every open row, no Delete — and the closed shop is off the default list. */
export const TheLiveListClosesAndNeverDeletes: Story = {
  render: () => <List />,
  play: async ({ canvasElement }) => {
    const canvas = await listed(canvasElement);

    await expect(canvas.getByTestId("shops-status-filter")).toBeVisible();
    await expect(canvas.getByTestId("close-MEL-SHP")).toHaveTextContent(/^Close$/);
    await expect(canvas.getByTestId("edit-MEL-SHP")).toBeVisible();
    await expect(canvas.queryAllByTestId(/^delete-/)).toHaveLength(0);
    await expect(canvas.queryByTestId("shop-row-MEL-TOK")).toBeNull();
  },
};

/** An open shop's page: Edit and Close Shop, no Delete, no banner. */
export const TheLivePageClosesAndNeverDeletes: Story = {
  render: () => <OfficialPage />,
  play: async ({ canvasElement }) => {
    const canvas = await detail(canvasElement);

    await expect(canvas.getByTestId("shop-detail-close")).toHaveTextContent("Close Shop");
    await expect(canvas.getByTestId("shop-detail-edit")).toBeVisible();
    await expect(canvas.queryByTestId("shop-detail-delete")).toBeNull();
    await expect(canvas.queryByTestId("shop-closed-banner")).toBeNull();
  },
};

/** The import dialog offers a closed shop — the gap the close fixed (backlog #21b). */
export const TheLiveImportDialogOffersTheClosedShop: Story = {
  render: () => <Imports />,
  beforeEach: () => {
    closeShopForStory(25n, 1);
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByTestId("open-import-file", {}, { timeout: 4000 }));
    const box = await screen.findByTestId("import-dialog");
    await waitFor(() => expect(box).toBeVisible());
    const d = within(box);

    await userEvent.click(d.getByTestId("shop-select"));
    await waitFor(() => expect(d.getByTestId("shop-select-option-25")).toBeVisible());
    await expect(within(d.getByTestId("shop-select-option-25")).getByTestId("shop-select-closed-25")).toBeVisible();
  },
};
