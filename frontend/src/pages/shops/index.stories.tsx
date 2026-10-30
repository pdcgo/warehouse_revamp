import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { shops } from "../../../.storybook/fixtures";
import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { ShopsPage } from "./index";

// THE SHOPS LIST — a selling team's marketplace storefronts (#66), on the screen rules
// (the-shop-screens-follow-the-screen-rules). The stub is shopStub.ts:
// a team sees only its own shops, a delete is soft, and the primary CS is a flag on a grant.
//
// Toko Melati (12) runs four: Melati Official (Shopee, primary CS Ani), Melati Store (Tokopedia, NO primary CS), Melati
// Grosir (Lazada, primary CS Eko) and Melati TikTok (TikTok, no grants). Kenanga Official is team 13's.

const MELATI = 12n;
const OWN = shops.filter((s) => s.teamId === MELATI);
const KENANGA_SHOP = shops.find((s) => s.teamId !== MELATI)!;

function asMelatiOwner() {
  asTeam(MELATI)();
  asRole(Role.SELLING_OWNER)();
}

const Routed = routedPage(
  [{ path: "/shops", element: <ShopsPage /> }, marker("/shops/:shopId", "at-shop-detail")],
  "/shops",
);

const meta = {
  title: "Pages/Shops/Shops",
  component: Routed,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: asMelatiOwner,
} satisfies Meta<typeof Routed>;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("shop-row-MEL-SHP", {}, { timeout: 4000 });
  return canvas;
}

// The primary CS action lives in the row's ⋯ — open it, and hand back the item (the menu portals).
async function primaryItem(canvas: ReturnType<typeof within>, code: string) {
  await userEvent.click(canvas.getByTestId(`shop-actions-${code}`));
  const item = await screen.findByTestId(`shop-primary-change-${code}`);
  await waitFor(() => expect(item).toBeVisible());
  return item;
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {};

/** A phone — each shop a block (no table headings), New Shop its ＋ alone on the title's row, Edit and Delete at each
 * block's foot (a-phone-reads-each-line-as-a-block, a-phone-header-action-is-an-icon). */
export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(within(canvas.getByTestId("shops-table")).queryAllByRole("columnheader")).toHaveLength(0);
    const create = canvas.getByRole("button", { name: "New Shop" });
    await expect(create).toHaveAttribute("data-testid", "open-create-shop");
    await expect(create).not.toHaveTextContent("New Shop");
    await expect(within(canvas.getByTestId("shop-row-MEL-SHP")).getByTestId("edit-MEL-SHP")).toBeVisible();
    await expect(within(canvas.getByTestId("shop-row-MEL-SHP")).getByTestId("shop-actions-MEL-SHP")).toBeVisible();
    // The primary CS by name alone — no "Primary CS ·" before it.
    await waitFor(() => expect(canvas.getByTestId("shop-primary-MEL-SHP")).toHaveTextContent(/^Ani Rahayu$/));
  },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

/** The team's OWN shops, each with its code and its marketplace — another team's is never on the list. */
export const TheTeamsOwnShops: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    for (const shop of OWN) {
      await expect(canvas.getByTestId(`shop-row-${shop.shopCode}`)).toHaveTextContent(shop.name);
    }
    await expect(canvas.queryByTestId(`shop-row-${KENANGA_SHOP.shopCode}`)).toBeNull();
    await expect(canvas.getByTestId("shop-row-MEL-SHP")).toHaveTextContent("MEL-SHP");
  },
};

/** A shop with no primary CS says so in its CS column — in words, in the warning role, not a badge: it cannot import its
 * statements until one is made primary. */
export const AShopWithNoPrimaryCsSaysSo: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const none = canvas.getByTestId("shop-no-primary-MEL-TOK");
    await expect(none).toBeVisible();
    await expect(none).toHaveTextContent("No primary CS");
    await expect(none.tagName).toBe("P");
    await expect(none.getAttribute("class") ?? "").not.toMatch(/orange|badge/);
    await expect(canvas.queryByTestId("shop-no-primary-MEL-SHP")).toBeNull();
  },
};

// THE PRIMARY CS IS ITS OWN COLUMN, changed from the row's ⋯ (owner: "jadi kolom saja karena masih luas juga, gantinya
// taruh di aksi", then "pilih cs di ellipsis") — the person an imported statement's rows with no order are counted for.

/** Each shop names its primary CS in its own column; the row's ⋯ holds Change Primary CS — Choose Primary CS on a shop
 * with none — while Edit and Delete stay on the row. */
export const ThePrimaryCsHasItsOwnColumn: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(within(canvas.getByTestId("shops-table")).getByRole("columnheader", { name: "Primary CS" })).toBeVisible();
    await waitFor(() => expect(canvas.getByTestId("shop-primary-MEL-SHP")).toHaveTextContent("Ani Rahayu"));
    await expect(canvas.getByTestId("shop-primary-MEL-LAZ")).toHaveTextContent("Eko Prasetyo");
    await expect(within(canvas.getByTestId("shop-primary-MEL-TOK")).getByTestId("shop-no-primary-MEL-TOK")).toBeVisible();

    await expect(canvas.getByTestId("edit-MEL-SHP")).toBeVisible();
    await expect(canvas.queryByTestId("shop-primary-change-MEL-SHP")).toBeNull();
    await expect(await primaryItem(canvas, "MEL-SHP")).toHaveTextContent("Change Primary CS");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("shop-primary-change-MEL-SHP")).toBeNull());
    await expect(await primaryItem(canvas, "MEL-TOK")).toHaveTextContent("Choose Primary CS");
  },
};

/** Change Primary CS offers the shop's granted users only, the current one marked; picking another and saving moves the
 * column — and the row does not open under the click. */
export const ChangeMovesThePrimaryCs: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(await primaryItem(canvas, "MEL-SHP"));
    const dialog = await screen.findByTestId("primary-cs-dialog");
    await waitFor(() => expect(dialog).toBeVisible());
    await expect(canvas.queryByTestId("at-shop-detail")).toBeNull();

    const ani = await within(dialog).findByTestId("primary-cs-option-ani");
    await expect(ani).toHaveTextContent("Current");
    await expect(within(dialog).queryByTestId("primary-cs-option-eko")).toBeNull();
    await expect(within(dialog).getByTestId("primary-cs-save")).toBeDisabled();

    await userEvent.click(within(dialog).getByTestId("primary-cs-option-budi"));
    await waitFor(() => expect(within(dialog).getByTestId("primary-cs-save")).toBeEnabled());
    await userEvent.click(within(dialog).getByTestId("primary-cs-save"));

    await waitFor(() => expect(canvas.getByTestId("shop-primary-MEL-SHP")).toHaveTextContent("Budi Santoso"));
    await waitFor(() => expect(screen.queryByTestId("primary-cs-dialog")).toBeNull());
  },
};

/** A shop nobody holds has no one to choose — the dialog says why, offers no Save, and opens the shop's page, where
 * access is given. */
export const NobodyToChooseOpensTheShop: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(await primaryItem(canvas, "MEL-TOK"));
    const hint = await screen.findByTestId("primary-cs-nobody");
    await waitFor(() => expect(hint).toBeVisible());
    await expect(screen.queryByTestId("primary-cs-save")).toBeNull();

    await userEvent.click(screen.getByTestId("primary-cs-open-shop"));
    await waitFor(() => expect(canvas.getByTestId("at-shop-detail")).toBeInTheDocument());
  },
};

/** The name and the code sort from their headings — A to Z first, then flipped; the server sorts. */
export const SortsFromTheHeadings: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const firstRow = () => within(canvas.getByTestId("shops-table")).getAllByRole("row")[1]!;

    await userEvent.click(canvas.getByTestId("shop-sort-name"));
    await waitFor(() => expect(firstRow()).toHaveTextContent("Melati Grosir"));
    await userEvent.click(canvas.getByTestId("shop-sort-name"));
    await waitFor(() => expect(firstRow()).toHaveTextContent("Melati TikTok"));

    await userEvent.click(canvas.getByTestId("shop-sort-code"));
    await waitFor(() => expect(firstRow()).toHaveTextContent("MEL-LAZ"));
  },
};

/** A row lights up under the pointer, every cell (a-table-row-lights-up) — and the whole row opens the shop. */
export const TheWholeRowLightsUpAndOpens: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const row = canvas.getByTestId("shop-row-MEL-SHP");
    const cells = within(row).getAllByRole("cell");

    const resting = getComputedStyle(cells[0]!).backgroundColor;
    row.setAttribute("data-hover", "");
    await waitFor(() => expect(getComputedStyle(cells[0]!).backgroundColor).not.toBe(resting));
    row.removeAttribute("data-hover");

    await userEvent.click(cells[1]!);
    await waitFor(() => expect(canvas.getByTestId("at-shop-detail")).toBeInTheDocument());
  },
};

/** The search reads the name and the code. */
export const SearchesByNameOrCode: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.type(canvas.getByTestId("shop-search"), "grosir", { delay: 40 });
    await waitFor(() => expect(canvas.queryByTestId("shop-row-MEL-SHP")).toBeNull());
    await expect(canvas.getByTestId("shop-row-MEL-LAZ")).toBeVisible();

    await userEvent.clear(canvas.getByTestId("shop-search"));
    await userEvent.type(canvas.getByTestId("shop-search"), "mel-tik", { delay: 40 });
    await waitFor(() => expect(canvas.getByTestId("shop-row-MEL-TIK")).toBeVisible());
    await expect(canvas.queryByTestId("shop-row-MEL-LAZ")).toBeNull();
  },
};

/** Nothing matches — the hint says so, and Clear Filters brings the shops back (an-empty-list-shows-a-hint). */
export const NothingMatches: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.type(canvas.getByTestId("shop-search"), "tidak ada", { delay: 40 });
    const hint = await canvas.findByTestId("shops-none-match");
    await waitFor(() => expect(hint).toBeVisible());

    await userEvent.click(within(hint).getByRole("button", { name: "Clear Filters" }));
    await waitFor(() => expect(canvas.getByTestId("shop-row-MEL-SHP")).toBeVisible());
    await expect(canvas.getByTestId("shop-search")).toHaveValue("");
  },
};

/** A shop's name opens its page. */
export const ANameOpensTheShop: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("open-shop-MEL-SHP"));
    await waitFor(() => expect(canvas.getByTestId("at-shop-detail")).toBeInTheDocument());
  },
};

/** New Shop asks for a name, a code and a marketplace, and the shop is on the list straight after. */
export const NewShopLandsOnTheList: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("open-create-shop"));
    const name = await screen.findByTestId("shop-name");
    await waitFor(() => expect(name).toBeVisible());
    await expect(screen.getByTestId("submit-shop")).toBeDisabled();

    await userEvent.type(name, "Melati Blibli", { delay: 20 });
    await userEvent.type(screen.getByTestId("shop-code"), "MEL-BLI", { delay: 20 });
    await userEvent.click(screen.getByTestId("marketplace-select"));
    const option = await screen.findByRole("option", { name: "Blibli" });
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await waitFor(() => expect(screen.getByTestId("submit-shop")).toBeEnabled());
    await userEvent.click(screen.getByTestId("submit-shop"));
    await waitFor(() => expect(canvas.getByTestId("shop-row-MEL-BLI")).toHaveTextContent("Melati Blibli"));
  },
};

/** Edit opens the same form, filled with the shop — its description a textarea, a sentence of text
 * (chakra-first-whenever-it-has-the-component). */
export const EditOpensTheShopFilledIn: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("edit-MEL-SHP"));
    const name = await screen.findByTestId("shop-name");
    await waitFor(() => expect(name).toBeVisible());
    await expect(name).toHaveValue("Melati Official");
    await expect(screen.getByTestId("shop-code")).toHaveValue("MEL-SHP");
    await expect(screen.getByTestId("shop-description").tagName).toBe("TEXTAREA");
  },
};

/** Delete confirms first, naming the shop — and the row is gone after. */
export const DeleteConfirmsFirst: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("delete-MEL-LAZ"));
    const dialog = await screen.findByRole("alertdialog");
    await waitFor(() => expect(dialog).toBeVisible());
    await expect(dialog).toHaveTextContent("Melati Grosir");

    await userEvent.click(within(dialog).getByTestId("confirm-action"));
    await waitFor(() => expect(canvas.queryByTestId("shop-row-MEL-LAZ")).toBeNull());
    await expect(canvas.getByTestId("shop-row-MEL-SHP")).toBeVisible();
  },
};

// THE SEARCH LIVES IN THE URL (a-lists-filters-live-in-the-url) — opened at a URL, the list is narrowed by it; a change
// is written back.
const AtSearchedUrl = routedPage([{ path: "/shops", element: <><ShopsPage /><LocationProbe /></> }], "/shops?q=grosir");

export const FiltersLiveInTheUrl: Story = {
  render: () => <AtSearchedUrl />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const search = await canvas.findByTestId("shop-search", {}, { timeout: 4000 });

    await expect(search).toHaveValue("grosir");
    await waitFor(() => expect(canvas.getByTestId("shop-row-MEL-LAZ")).toBeVisible());
    await expect(canvas.queryByTestId("shop-row-MEL-SHP")).toBeNull();

    await userEvent.clear(search);
    await userEvent.type(search, "store", { delay: 40 });
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("?q=store"));
  },
};

// THE MARKETPLACE, THE PRIMARY CS AND "NO PRIMARY CS", AHEAD OF THE CONTRACT (owner: "oke tambahkan dengan warning,
// filter mp, cs utama sama belum ada cs", then "bedakan belum ada csnya") — each held in the URL and marked ⚠, its pick
// thrown away: ShopListFilter has only `q`.
const AtShopsWithProbe = routedPage([{ path: "/shops", element: <><ShopsPage /><LocationProbe /></> }], "/shops");

/** The three filters carry their ⚠ numbers and the summary names them; a pick is kept in the URL but the list is not
 * narrowed — every shop is still there. */
export const TheNewFiltersAreHeldButNotSentYet: Story = {
  render: () => <AtShopsWithProbe />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("not-implemented-summary")).toBeVisible();
    await expect(within(canvas.getByTestId("shops-marketplace-filter")).getByTestId("not-implemented-marketplaceFilter")).toHaveTextContent("1");
    await expect(within(canvas.getByTestId("shops-primary-filter")).getByTestId("not-implemented-primaryFilter")).toHaveTextContent("2");
    await expect(within(canvas.getByTestId("shops-no-primary-filter")).getByTestId("not-implemented-noPrimaryFilter")).toHaveTextContent("3");

    await userEvent.click(canvas.getByTestId("shops-marketplace-select"));
    const lazada = await within(canvas.getByTestId("shops-marketplace-filter")).findByRole("option", { name: "Lazada" });
    await waitFor(() => expect(lazada).toBeVisible());
    await userEvent.click(lazada);

    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent(`market=${Marketplace.LAZADA}`));
    await expect(canvas.getByTestId("shop-row-MEL-SHP")).toBeVisible();
    await expect(canvas.getByTestId("shop-row-MEL-TOK")).toBeVisible();
  },
};

/** The CS filter offers the people who ARE a primary CS on this team's shops — Ani and Eko; Budi holds a grant but is
 * nobody's primary, so he is not offered (a-who-filter-lists-the-people-on-its-rows). No "nobody" among them. */
export const ThePrimaryFilterOffersThePrimaries: Story = {
  render: () => <AtShopsWithProbe />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const input = within(canvas.getByTestId("shops-primary-filter")).getByRole("combobox");

    await userEvent.click(input);
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
    const [first, second] = screen.getAllByRole("option");
    await waitFor(() => expect(first).toBeVisible());
    await expect(first).toHaveTextContent("Ani Rahayu");
    await expect(second).toHaveTextContent("Eko Prasetyo");

    await userEvent.click(second!);
    await waitFor(() => expect(input).toHaveValue("Eko Prasetyo"));
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("cs=65"));
  },
};

/** "No primary CS" is a tick of its own (owner: "bedakan belum ada csnya"), in the Filter panel ("pakai panel untuk
 * checkbox"). It and a person cannot both hold, so setting one lifts the other; the trigger counts it, and the × attached
 * to it turns it off without opening the panel. */
export const NoPrimaryCsIsATickInThePanel: Story = {
  render: () => <AtShopsWithProbe />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const person = within(canvas.getByTestId("shops-primary-filter")).getByRole("combobox");

    // The tick is in the panel, not on the strip.
    await expect(canvas.queryByTestId("shops-no-primary-only")).toBeNull();
    await userEvent.click(canvas.getByTestId("shops-options-trigger"));
    const panel = await screen.findByTestId("shops-options-panel");
    await waitFor(() => expect(panel).toBeVisible());
    await userEvent.click(within(panel).getByTestId("shops-no-primary-only"));
    await waitFor(() => expect(within(panel).getByRole("checkbox")).toBeChecked());
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("nocs=1"));
    await expect(canvas.getByTestId("shops-options-count")).toHaveTextContent("1");
    await userEvent.keyboard("{Escape}");

    // A person lifts the tick…
    await userEvent.click(person);
    const ani = await screen.findByTestId("person-filter-option-61");
    await waitFor(() => expect(ani).toBeVisible());
    await userEvent.click(ani);
    await waitFor(() => expect(canvas.queryByTestId("shops-options-count")).toBeNull());
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("?cs=61"));

    // …the tick lifts the person…
    await userEvent.click(canvas.getByTestId("shops-options-trigger"));
    const again = await screen.findByTestId("shops-options-panel");
    await waitFor(() => expect(again).toBeVisible());
    await userEvent.click(within(again).getByTestId("shops-no-primary-only"));
    await waitFor(() => expect(person).toHaveValue(""));
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("?nocs=1"));
    await userEvent.keyboard("{Escape}");

    // …and the trigger's own × turns it off.
    await userEvent.click(canvas.getByTestId("shops-options-clear"));
    await waitFor(() => expect(canvas.queryByTestId("shops-options-count")).toBeNull());
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent(/^$/));
  },
};

/** Opened at a URL holding them, the filters show them; Clear Filters empties every one — and the URL. */
const AtFilteredUrl = routedPage(
  [{ path: "/shops", element: <><ShopsPage /><LocationProbe /></> }],
  `/shops?market=${Marketplace.SHOPEE}&cs=65`,
);

export const TheNewFiltersComeBackFromTheUrl: Story = {
  render: () => <AtFilteredUrl />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("shops-marketplace-select")).toHaveTextContent("Shopee");
    const input = within(canvas.getByTestId("shops-primary-filter")).getByRole("combobox");
    await waitFor(() => expect(input).toHaveValue("Eko Prasetyo"));

    await userEvent.click(canvas.getByTestId("shops-filter-clear"));
    await waitFor(() => expect(input).toHaveValue(""));
    await expect(canvas.getByTestId("shops-marketplace-select")).not.toHaveTextContent("Shopee");
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent(/^$/));
  },
};
