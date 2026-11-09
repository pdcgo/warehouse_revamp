import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Dialog, Portal, Text } from "@chakra-ui/react";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";

import { products } from "../../../.storybook/fixtures";
import { asRole } from "../../../.storybook/sessionScenario";
import { warehouseProductSearchScenario } from "../../../.storybook/warehouseProductSearchStub";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { ProductSelect, type PickedProduct, description } from "./ProductSelect";

const meta = {
  title: "Components/Products/ProductSelect",
  component: ProductSelect,
  parameters: {
    docs: { description: { component: description } },
  },
  args: { teamId: 11n, onChange: fn() },
} satisfies Meta<typeof ProductSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TeamCatalogue: Story = {};

// "all" scope discovers products across EVERY team (ProductDiscover, #110) rather than searching
// this team's catalogue. The team id then only authorizes the request.
export const CrossTeamDiscovery: Story = { args: { scope: "all" } };

export const Disabled: Story = { args: { disabled: true } };

// One character is not a search yet — the hint says so. (With NOTHING typed it lists the first page — below.)
export const BelowTwoCharactersItDoesNotSearch: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("combobox");

    await userEvent.click(input);
    await userEvent.type(input, "k");

    await expect(await screen.findByText("Type at least 2 characters")).toBeInTheDocument();
  },
};

export const SearchesByNameOrProductCode: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("combobox");

    await userEvent.click(input);
    await userEvent.type(input, "kopi");

    const option = await screen.findByTestId(`product-select-option-${products[0]!.productCode}`);
    await waitFor(() => expect(option).toBeVisible());

    // Each option reads "sku" over "name", so two similarly-named variants stay distinguishable.
    await expect(option).toHaveTextContent(products[0]!.productCode);
    await expect(option).toHaveTextContent(products[0]!.name);
  },
};

// The "team" scope searches only THIS team's catalogue. Product 73 belongs to another team, so it
// must not appear here — while the cross-team story below finds it.
export const TeamScopeExcludesOtherTeamsProducts: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("combobox");

    await userEvent.click(input);
    await userEvent.type(input, "gula");

    await expect(await screen.findByText("No products found")).toBeInTheDocument();
  },
};

export const AllScopeFindsOtherTeamsProducts: Story = {
  args: { scope: "all" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("combobox");

    await userEvent.click(input);
    await userEvent.type(input, "gula");

    const option = await screen.findByTestId(`product-select-option-${products[2]!.productCode}`);
    await waitFor(() => expect(option).toBeVisible());
  },
};

// It emits the WHOLE PickedProduct, not just an id — the caller snapshots sku and name onto the
// order line, because those are what was ordered and must not change when the catalogue does (#67).
// Price is deliberately absent: a product has no catalogue price, so the buyer-paid unit price is
// typed on the line itself.
export const EmitsTheSnapshotNotJustAnId: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("combobox");

    await userEvent.click(input);
    await userEvent.type(input, "teh");

    const option = await screen.findByTestId(`product-select-option-${products[1]!.productCode}`);
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await expect(args.onChange).toHaveBeenCalledWith({
      id: products[1]!.id,
      productCode: products[1]!.productCode,
      name: products[1]!.name,
    });
  },
};

export const Interactive: Story = {
  render: (args) => {
    const [picked, setPicked] = useState<PickedProduct | null>(null);

    return (
      <>
        <ProductSelect {...args} value={picked?.id} onChange={setPicked} />
        <Text mt="3" fontSize="sm" data-testid="picked">
          {picked ? `${picked.productCode} — ${picked.name}` : "(nothing picked)"}
        </Text>
      </>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("combobox");

    await userEvent.click(input);
    await userEvent.type(input, "kopi");

    const option = await screen.findByTestId(`product-select-option-${products[0]!.productCode}`);
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await waitFor(() => expect(canvas.getByTestId("picked")).toHaveTextContent(products[0]!.name));

    // The picked product must also stay READABLE in the field — the half that broke in
    // SupplierSelect. This picker searches SERVER-side, so on selection the label is written back
    // into the input and searched for; the guard is that the field still shows it afterwards.
    await waitFor(() =>
      expect(input).toHaveValue(`${products[0]!.productCode} — ${products[0]!.name}`),
    );
  },
};

// INSIDE A MODAL DIALOG the list must not portal: a portalled listbox lands outside the dialog, where the modal makes it
// inert. `portalled={false}` renders it inline, so it opens and takes a click (the stock count's found-product dialog).
export const InsideADialog: Story = {
  args: { portalled: false, scope: "all" },
  render: (args) => (
    <Dialog.Root open>
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid="product-select-dialog">
            <Dialog.Body p="6">
              <ProductSelect {...args} />
            </Dialog.Body>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  ),
  play: async ({ args }) => {
    const dialog = await screen.findByTestId("product-select-dialog");
    await waitFor(() => expect(dialog).toBeVisible());

    const input = within(dialog).getByRole("combobox");
    await userEvent.click(input);
    await userEvent.type(input, "kopi", { delay: 20 });
    // The option is INSIDE the dialog, not portalled out of it.
    const option = await within(dialog).findByTestId(`product-select-option-${products[0]!.productCode}`);
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);
    await waitFor(() => expect(args.onChange).toHaveBeenCalled());
  },
};

// OPENED WITH NOTHING TYPED IT LISTS THE CATALOGUE'S FIRST PAGE — and OPENED AGAIN AFTER A PICK it lists it again, the
// picked product among them, not the one picked alone (owner: *"semua combobox kalau sudah select opsinya munculkan semua
// saat dibuka kembali, selalu bermasalah jika hanya menampilkan satu"*, a-search-select-reopens-whole).
export const AReopenedPickerShowsTheList: Story = {
  render: (args) => {
    const [value, setValue] = useState<bigint | undefined>(undefined);

    return <ProductSelect {...args} value={value} onChange={(p) => setValue(p.id)} />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("combobox");

    await userEvent.click(input);
    await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(1), { timeout: 4000 });
    const browsed = screen.getAllByRole("option").length;

    await userEvent.type(input, "kopi", { delay: 30 });
    const option = await screen.findByTestId(`product-select-option-${products[0]!.productCode}`);
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);
    await waitFor(() => expect(input).toHaveValue(`${products[0]!.productCode} — ${products[0]!.name}`));

    await userEvent.click(input);
    await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThanOrEqual(browsed), { timeout: 4000 });
    await expect(screen.getByTestId(`product-select-option-${products[0]!.productCode}`)).toBeInTheDocument();
  },
};

// ── The WAREHOUSE scope (a-warehouse-picks-only-what-it-has-held) ──────────────────────────────────────────────────────
//
// What a warehouse screen picks from — Report Found, a count's product plan and its found: ONLY the products with a batch
// in THIS warehouse, any team's, at 0 or not (WarehouseProductSearch). teamId is the warehouse, Gudang Pusat (11). Its
// batch registers (foundRequestFixtures, opnameFixtures) hold Beras (74, Toko Melati), Gula Pasir (73, Toko Kenanga) and
// four of Toko Anggrek's (700–703, two of them at 0) — and no Kopi Arabika, which is in the catalogue all the same.

export const WarehouseScope: Story = {
  args: { scope: "warehouse" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("combobox");

    await userEvent.click(input);
    await userEvent.type(input, "gula", { delay: 20 });

    // Each option names its OWNER — a warehouse holds several teams' goods, and two teams' same-named products are two.
    const option = await screen.findByTestId(`product-select-option-${products[2]!.productCode}`);
    await waitFor(() => expect(option).toBeVisible());
    await expect(option).toHaveTextContent("Gula Pasir 1kg · Toko Kenanga");
  },
};

// A product this warehouse NEVER had is not offered, however well it matches: "gula" matches Gula Pasir, held here, and
// two of Toko Anggrek's — Gula Merah's carton and the Paket Sembako that names Gula — which never were. A found or a count
// of those would be refused anyway (a-found-never-stocked-here-is-refused-at-the-report).
export const WarehouseScopeNeverOffersWhatWasNeverHere: Story = {
  args: { scope: "warehouse" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("combobox");

    await userEvent.click(input);
    await userEvent.type(input, "gula", { delay: 20 });

    // The held one arrives — so the answer is in — and it is the only one.
    const option = await screen.findByTestId(`product-select-option-${products[2]!.productCode}`);
    await waitFor(() => expect(option).toBeVisible());
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));
    await expect(screen.queryByTestId("product-select-option-SL-03-ANG-005")).toBeNull();
    await expect(screen.queryByTestId("product-select-option-SL-03-ANG-006")).toBeNull();
  },
};

// Held at 0 is still held: "karton" matches 22 of Toko Anggrek's products, and the two with a batch here — both emptied
// since — are the two offered.
export const WarehouseScopeFindsWhatIsHeldAtZero: Story = {
  args: { scope: "warehouse" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("combobox");

    await userEvent.click(input);
    await userEvent.type(input, "karton", { delay: 20 });

    const minyak = await screen.findByTestId("product-select-option-SL-03-ANG-002");
    await waitFor(() => expect(minyak).toBeVisible());
    await expect(screen.getByTestId("product-select-option-SL-03-ANG-004")).toBeVisible();
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
    // Gula Merah's carton is in the catalogue, never here.
    await expect(screen.queryByTestId("product-select-option-SL-03-ANG-006")).toBeNull();
  },
};

// An ARCHIVED product this warehouse holds is still offered, labelled (an-archived-product-held-here-can-be-picked): Toko
// Anggrek archived the old 2L pack, but its batch is here, so a unit found of it can be reported and a count planned on it.
// The live 2L beside it carries no label.
export const WarehouseScopeOffersAnArchivedProductHeldHere: Story = {
  args: { scope: "warehouse" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("combobox");

    await userEvent.click(input);
    await userEvent.type(input, "minyak goreng sawit 2l", { delay: 20 });

    const old = await screen.findByTestId("product-select-option-SL-03-ANG-001-L");
    await waitFor(() => expect(old).toBeVisible());
    await expect(screen.getByTestId("product-select-archived-SL-03-ANG-001-L")).toHaveTextContent("Archived");
    await expect(screen.queryByTestId("product-select-archived-SL-03-ANG-001")).toBeNull();
  },
};

// It emits the same snapshot as the other scopes — the owner is shown, not frozen onto the line.
export const WarehouseScopeEmitsTheSnapshot: Story = {
  args: { scope: "warehouse" },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("combobox");

    await userEvent.click(input);
    await userEvent.type(input, "beras", { delay: 20 });

    const option = await screen.findByTestId(`product-select-option-${products[3]!.productCode}`);
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await expect(args.onChange).toHaveBeenCalledWith({
      id: products[3]!.id,
      productCode: products[3]!.productCode,
      name: products[3]!.name,
    });
  },
};

// The policy is the warehouse's: a selling role is refused (the stub checks it, as the server does), and the picker
// shows nothing rather than another team's catalogue. A seller picks through the "all" scope.
export const WarehouseScopeRefusesASellingRole: Story = {
  args: { scope: "warehouse" },
  beforeEach: asRole(Role.SELLING_OWNER),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("combobox");
    const refusedBefore = warehouseProductSearchScenario.refused;

    await userEvent.click(input);
    await userEvent.type(input, "gula", { delay: 20 });

    // The stub turned the search away — the picker asked, and shows nothing.
    await waitFor(() => expect(warehouseProductSearchScenario.refused).toBeGreaterThan(refusedBefore));
    await expect(await screen.findByText("No products found")).toBeInTheDocument();
    await expect(screen.queryByTestId(`product-select-option-${products[2]!.productCode}`)).toBeNull();
  },
};
