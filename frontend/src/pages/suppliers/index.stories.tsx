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
// The MANAGE page (manage-and-discover-are-two-pages): a selling team's own suppliers. The stub plays today's
// server — it still demands a code — so every create below also proves the translation step supplies one.

const SUMBER = supplierFixture("PT Sumber Makmur");
const CAHAYA = supplierFixture("CV Cahaya Abadi");
const SINAR = supplierFixture("Toko Grosir Sinar");
const MAKMUR_JAYA = supplierFixture("UD Makmur Jaya"); // team 13's — never on team 12's list

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

export const AWarehouseTeam: Story = { beforeEach: standingIn(WAREHOUSE_TEAM) };

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// the-supplier-has-no-code · no-province-city-or-soft-delete: Name, Contact, Address — no Code, no City.
// An old supplier's city and province are folded into its address, the same fold the move makes.
export const TheDecidedColumns: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const table = canvas.getByTestId("suppliers-table");

    await expect(within(table).queryByText("Code")).toBeNull();
    await expect(within(table).queryByText("City")).toBeNull();
    await expect(canvas.getByTestId(`supplier-row-${SUMBER.id}`)).toHaveTextContent(
      "Jl. Soekarno-Hatta 112, Bandung, Jawa Barat",
    );
    // Another selling team's supplier is not on this one's manage page.
    await expect(canvas.queryByTestId(`supplier-row-${MAKMUR_JAYA.id}`)).toBeNull();
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

// the-supplier-has-no-code: the form asks for a name, a contact, an address and a description. The stub
// still refuses a supplier without a code — so this passing is the translation step making one up.
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

// Editing an old supplier: its address arrives FOLDED, and saving does not fold the city in a second time.
export const EditKeepsTheFoldedAddress: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId(`edit-supplier-${SUMBER.id}`));
    const address = await screen.findByTestId("supplier-address");
    await waitFor(() => expect(address).toHaveValue("Jl. Soekarno-Hatta 112, Bandung, Jawa Barat"));

    await userEvent.click(screen.getByTestId("submit-supplier"));

    await waitFor(() => expect(screen.queryByTestId("supplier-address")).toBeNull());
    const row = canvas.getByTestId(`supplier-row-${SUMBER.id}`);
    await waitFor(() => expect(row).toHaveTextContent("Jl. Soekarno-Hatta 112, Bandung, Jawa Barat"));
    await expect(row.textContent).not.toContain("Bandung, Jawa Barat, Bandung");
  },
};

// no-province-city-or-soft-delete: delete confirms, says it is for good, and the supplier is gone.
export const DeleteIsForGood: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId(`delete-supplier-${SINAR.id}`));

    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await expect(screen.getByText(/removed for good/)).toBeVisible();
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
