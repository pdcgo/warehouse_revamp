import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { supplierFixture } from "../../../.storybook/supplierFixtures";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { SuppliersPage } from "./index";

// ⚠ PROTOTYPE for design_accept — the supplier CRUD pass
// (docs/business/supplier/context_clarify.md#proposed-design).
//
// The MANAGE page (manage-and-discover-are-two-pages): a selling team's own suppliers. The stub plays
// supplier_service (supplierStub.ts) — the OWN scope, soft deletes, and a create only a selling team may make.

const SUMBER = supplierFixture("PT Sumber Makmur");
const CAHAYA = supplierFixture("CV Cahaya Abadi");
const SINAR = supplierFixture("Toko Grosir Sinar");
const MAKMUR_JAYA = supplierFixture("UD Makmur Jaya"); // team 13's — never on team 12's list
const LAMA_TUTUP = supplierFixture("CV Lama Tutup"); // team 12's, deleted

const SELLING_TEAM = 12n;
const WAREHOUSE_TEAM = 11n;

function standingIn(teamId: bigint) {
  return () => {
    asTeam(teamId)();
    asRole(Role.SELLING_OWNER)();
  };
}

const meta = {
  title: "Pages/Suppliers/Suppliers",
  component: SuppliersPage,
  parameters: { signedIn: true, layout: "padded" },
  beforeEach: standingIn(SELLING_TEAM),
} satisfies Meta<typeof SuppliersPage>;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId(`supplier-row-${SUMBER.id}`, {}, { timeout: 4000 });
  return canvas;
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {};

// A PHONE READS EACH SUPPLIER AS A BLOCK (a-phone-reads-each-line-as-a-block) — the name and its stores, or words saying
// it has none; no contact, no address; no headings, so the sort is the Filter sheet's, with the store type.
export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(within(canvas.getByTestId("suppliers-table")).queryAllByRole("columnheader")).toHaveLength(0);
    const sumber = canvas.getByTestId(`supplier-row-${SUMBER.id}`);
    await expect(sumber).toHaveTextContent("Shopee");
    // Its name and its stores — no contact, no address (a-phone-supplier-is-its-name-and-stores).
    await expect(sumber).not.toHaveTextContent(SUMBER.contact);
    await expect(sumber).not.toHaveTextContent(SUMBER.address);
    // A supplier with no store says so in words, not a dash.
    await expect(canvas.getByTestId(`supplier-row-${SINAR.id}-no-stores`)).toHaveTextContent("No supplier stores yet");

    await userEvent.click(canvas.getByTestId("suppliers-filter-open"));
    const sheet = await screen.findByTestId("suppliers-filter-sheet");
    await waitFor(() => expect(sheet).toBeVisible());
    await expect(within(sheet).getByTestId("supplier-sort-select")).toBeVisible();
    await expect(within(sheet).getByTestId("marketplace-select")).toBeVisible();
  },
};

export const AWarehouseTeam: Story = { beforeEach: standingIn(WAREHOUSE_TEAM) };

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// the-supplier-has-no-code · no-province-or-city: Name, Contact, Address — no Code, no City.
export const TheDecidedColumns: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const table = canvas.getByTestId("suppliers-table");

    await expect(within(table).queryByText("Code")).toBeNull();
    await expect(within(table).queryByText("City")).toBeNull();
    await expect(canvas.getByTestId(`supplier-row-${SUMBER.id}`)).toHaveTextContent(SUMBER.address);
  },
};

// The page lists THIS team's live suppliers only: another selling team's is Discover's question, and a deleted one
// has left every list (a-deleted-supplier-is-kept-for-its-figures).
export const OnlyThisTeamsLiveSuppliers: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByTestId(`supplier-row-${MAKMUR_JAYA.id}`)).toBeNull();
    await expect(canvas.queryByTestId(`supplier-row-${LAMA_TUTUP.id}`)).toBeNull();
  },
};

export const SearchesByName: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.type(canvas.getByTestId("supplier-search"), "cahaya", { delay: 40 });

    await waitFor(() => expect(canvas.queryByTestId(`supplier-row-${SUMBER.id}`)).toBeNull());
    await expect(canvas.getByTestId(`supplier-row-${CAHAYA.id}`)).toBeVisible();
  },
};

// the-supplier-has-no-code: the form asks for a name, a contact, an address and a description — and nothing else.
export const NewSupplierAsksNoCode: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("open-create-supplier"));
    const name = await screen.findByTestId("supplier-name");
    await waitFor(() => expect(name).toBeVisible());

    await expect(screen.queryByTestId("supplier-code")).toBeNull();
    await expect(screen.queryByTestId("supplier-city")).toBeNull();
    await expect(screen.queryByTestId("supplier-province")).toBeNull();

    // Name is the one required field.
    await expect(screen.getByTestId("submit-supplier")).toBeDisabled();

    await userEvent.type(name, "PT Baru Jaya", { delay: 40 });
    await userEvent.type(screen.getByTestId("supplier-contact"), "0811-7777-8888", { delay: 20 });
    await userEvent.type(screen.getByTestId("supplier-address"), "Jl. Kopo 9, Bandung", { delay: 20 });
    await expect(screen.getByTestId("submit-supplier")).toBeEnabled();
    await userEvent.click(screen.getByTestId("submit-supplier"));

    await waitFor(() => expect(canvas.getByTestId("suppliers-table")).toHaveTextContent("PT Baru Jaya"));
  },
};

// Edit re-opens the record pre-filled, and what is saved is what the row then shows.
export const EditCorrectsTheAddress: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId(`edit-supplier-${SUMBER.id}`));
    const address = await screen.findByTestId("supplier-address");
    await waitFor(() => expect(address).toHaveValue(SUMBER.address));

    await userEvent.clear(address);
    await userEvent.type(address, "Jl. Kopo 9, Bandung", { delay: 20 });
    await userEvent.click(screen.getByTestId("submit-supplier"));

    await waitFor(() => expect(screen.queryByTestId("supplier-address")).toBeNull());
    await waitFor(() =>
      expect(canvas.getByTestId(`supplier-row-${SUMBER.id}`)).toHaveTextContent("Jl. Kopo 9, Bandung"),
    );
  },
};

// a-deleted-supplier-is-kept-for-its-figures: delete confirms, says past restocks keep the name, and the supplier leaves the list.
export const DeleteKeepsTheHistory: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId(`delete-supplier-${SINAR.id}`));

    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await expect(screen.getByText(/past restocks and its figures keep its name/)).toBeVisible();
    await userEvent.click(confirm);

    await waitFor(() => expect(canvas.queryByTestId(`supplier-row-${SINAR.id}`)).toBeNull());
  },
};

// only-a-selling-team-has-suppliers: a warehouse team gets no New Supplier, and is told why.
export const OnlyASellingTeamHasSuppliers: Story = {
  beforeEach: standingIn(WAREHOUSE_TEAM),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await canvas.findByTestId("suppliers-selling-only", {}, { timeout: 4000 });
    await expect(canvas.queryByTestId("open-create-supplier")).toBeNull();
  },
};

// ── The screen rules (`the-suppliers-list-follows-the-screen-rules`) ───────────────────────────────

const BANYAK = supplierFixture("PT Banyak Toko");

const rowNames = (canvas: ReturnType<typeof within>) =>
  within(canvas.getByTestId("suppliers-table"))
    .getAllByRole("row")
    .slice(1)
    .map((r) => r.querySelector("td p")?.textContent ?? "");

// THE COLUMNS ARE DISCOVER'S, MINUS THE TEAM — the supplier and where it is (two lines), its stores as one badge per
// type, its contact. A deleted store is not a badge (a-store-delete-is-soft-too): PT Sumber Makmur's Lazada is gone.
export const ItsStoresAreBadges: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const sumber = canvas.getByTestId(`supplier-row-${SUMBER.id}`);
    await expect(sumber).toHaveTextContent("Shopee");
    await expect(sumber).toHaveTextContent("Tokopedia");
    await expect(sumber).not.toHaveTextContent("Lazada");
    await expect(canvas.getByTestId(`supplier-row-${BANYAK.id}`)).toHaveTextContent("×3");
    // A supplier with no store reads a dash, and its address line too.
    await expect(canvas.getByTestId(`supplier-row-${SINAR.id}`)).toHaveTextContent("—");
  },
};

// THE SHARED FILTER STRIP (a-phone-filters-from-a-sheet, clear-filters-is-red-and-bold) — "which of ours sell on
// Lazada?": a live store of the type. Clear, red and bold while anything narrows, puts it back.
export const TheStoreTypeFilters: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByTestId("suppliers-filter-clear")).toBeNull();
    await userEvent.click(within(canvas.getByTestId("suppliers-type-filter")).getByTestId("marketplace-select"));
    const lazada = await canvas.findByRole("option", { name: "Lazada" });
    await waitFor(() => expect(lazada).toBeVisible());
    await userEvent.click(lazada);

    await waitFor(() => expect(canvas.queryByTestId(`supplier-row-${SUMBER.id}`)).toBeNull());
    await expect(canvas.getByTestId(`supplier-row-${BANYAK.id}`)).toBeVisible();

    const clear = canvas.getByTestId("suppliers-filter-clear");
    await expect(getComputedStyle(clear).fontWeight).toBe("700");
    await userEvent.click(clear);
    await waitFor(() => expect(canvas.getByTestId(`supplier-row-${SUMBER.id}`)).toBeVisible());
  },
};

// THE NAME SORTS FROM ITS HEADING (a-table-sorts-from-its-headings) — the list's own order is newest first; the
// heading starts at A to Z, then flips. The server sorts; a page is never re-sorted here.
export const TheNameSortsFromItsHeading: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(rowNames(canvas)).toEqual(["PT Banyak Toko", "Toko Grosir Sinar", "CV Cahaya Abadi", "PT Sumber Makmur"]);

    await userEvent.click(canvas.getByTestId("supplier-sort-name"));
    await waitFor(() =>
      expect(rowNames(canvas)).toEqual(["CV Cahaya Abadi", "PT Banyak Toko", "PT Sumber Makmur", "Toko Grosir Sinar"]),
    );

    await userEvent.click(canvas.getByTestId("supplier-sort-name"));
    await waitFor(() =>
      expect(rowNames(canvas)).toEqual(["Toko Grosir Sinar", "PT Sumber Makmur", "PT Banyak Toko", "CV Cahaya Abadi"]),
    );
  },
};

// The pages grow as they are opened, as on the accounts list.
export const TheGrowingPager: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("suppliers-pager")).toBeVisible();
  },
};

// A ROW LIGHTS UP UNDER THE POINTER, every cell of it (owner: *"hoverable"*, `a-supplier-row-lights-up`) — as the
// account's statement does.
//
// ⚠ HOVER IS DRIVEN BY `data-hover`, which Chakra's `_hover` honours — a synthetic pointer event sets no CSS `:hover`.
export const ASupplierRowLightsUp: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const row = canvas.getByTestId(`supplier-row-${SUMBER.id}`);
    const cells = within(row).getAllByRole("cell");
    const resting = getComputedStyle(cells[0]!).backgroundColor;
    row.setAttribute("data-hover", "");
    await waitFor(() => expect(getComputedStyle(cells[0]!).backgroundColor).not.toBe(resting));
    await expect(getComputedStyle(cells[cells.length - 1]!).backgroundColor).toBe(getComputedStyle(cells[0]!).backgroundColor);
  },
};
