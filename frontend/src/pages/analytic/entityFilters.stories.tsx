import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { inventoryLostCalls } from "../../../.storybook/inventoryAnalyticStub";
import { LocationProbe, asTeam, routedPage } from "../../../.storybook/pageStory";
import { withAnalyticSampleProducts } from "../../../.storybook/productScenario";
import { asRole } from "../../../.storybook/sessionScenario";
import type { FilterItem } from "../../gen/warehouse/analytic_base/v1/analytic_pb";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { AnalyticPage } from "./index";

// THE PRODUCT AND SUPPLIER FILTERS (backlog #19) — the team's REAL entities, searched as that team may search them
// elsewhere, where the composer once offered sample entries. Only Lost stock (metrics/inventory/lost) narrows by them,
// read by the seller that owns the stock and the warehouse that held it:
//
//   seller (Toko Melati, 12)       products: its own catalogue (ProductList) · suppliers: its own (SupplierList OWN)
//   warehouse (Gudang Pusat, 11)   products: what it holds or has held (WarehouseProductSearch) · suppliers: every
//                                  team's, searched (SupplierList EVERY_TEAM) — it keeps none of its own
//
// A pick goes into the URL (`product=`, `supplier=`), reaches the Lost stock request as its ProductFilter /
// SupplierFilter, and shows as a chip named by ProductByIds / SupplierByIds — after a reload too.
//
// The sample's products (201–206) are listed as Toko Melati's catalogue for these stories (withAnalyticSampleProducts),
// held where the sample lost them: 201, 202, 203, 206 at Gudang Pusat (11), 204 and 205 at Gudang Cabang (14).

const LOST = "metrics/inventory/lost";
const QUARTER = "r=2026-08-01..2026-10-31";

const at = (search: string) =>
  routedPage(
    [
      {
        path: "/analytic",
        element: (
          <>
            <AnalyticPage />
            <LocationProbe />
          </>
        ),
      },
    ],
    `/analytic${search}`,
  );

const ByWarehouse = at(`?g=warehouse&m=${LOST}&${QUARTER}`);
const Chosen = at(`?g=warehouse&m=${LOST}&${QUARTER}&product=205&supplier=31`);

const clearCalls = () => {
  inventoryLostCalls.length = 0;
};

const meta = {
  title: "Pages/Analytic/Product and supplier filters",
  component: ByWarehouse,
  parameters: { dataRouter: true, signedIn: true },
  beforeEach: [asTeam(12n), asRole(Role.SELLING_OWNER), withAnalyticSampleProducts, clearCalls],
} satisfies Meta<typeof ByWarehouse>;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await waitFor(() => expect(canvas.getByTestId("analytic-table")).toBeVisible(), { timeout: 4000 });
  await waitFor(() => expect(canvas.getAllByTestId(/^analytic-row-/).length).toBeGreaterThan(0), { timeout: 4000 });

  return canvas;
}

/** The product and supplier ids the LAST Lost stock request carried — what the server narrows by. */
function lastFilters(): { teamId: bigint; product?: bigint; supplier?: bigint } {
  const call = inventoryLostCalls.at(-1);
  if (!call) return { teamId: 0n };

  const of = (items: FilterItem[]) => ({
    product: items.find((i) => i.f.case === "productFilter")?.f.value as { productId: bigint } | undefined,
    supplier: items.find((i) => i.f.case === "supplierFilter")?.f.value as { supplierId: bigint } | undefined,
  });
  const found = of(call.filters);

  return { teamId: call.teamId, product: found.product?.productId, supplier: found.supplier?.supplierId };
}

/** Type into the picker inside a filter slot, then click the option once it has animated in. */
async function pick(field: HTMLElement, text: string, optionTestId: string) {
  const input = within(field).getByRole("combobox");
  await userEvent.click(input);
  if (text) await userEvent.type(input, text, { delay: 30 });

  const option = await screen.findByTestId(optionTestId, {}, { timeout: 4000 });
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option);
}

// A SELLER picks a product from its own catalogue and a supplier from its own: each lands in the URL, in the Lost stock
// request, and as a chip naming it; the table narrows to where that product was lost (Sepatu Kanvas — Gudang Cabang).
// The chip's × reads every product again.
export const ASellerPicksAProductAndASupplier: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.getAllByTestId(/^analytic-row-/)).toHaveLength(2);

    await pick(canvas.getByTestId("analytic-filter-product"), "sepatu", "product-select-option-MEL-SMP-205");
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("product=205"));
    await waitFor(() => expect(canvas.getByTestId("analytic-product-chip")).toHaveTextContent("Sepatu Kanvas"));
    await waitFor(() => expect(lastFilters()).toEqual({ teamId: 12n, product: 205n, supplier: undefined }));
    await waitFor(() => expect(canvas.getAllByTestId(/^analytic-row-/)).toHaveLength(1));
    await expect(canvas.getByTestId("analytic-row-14")).toHaveTextContent("Gudang Cabang");

    // Its own suppliers open on a click — the whole list.
    await pick(canvas.getByTestId("analytic-filter-supplier"), "", "supplier-select-option-31");
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("supplier=31"));
    await expect(canvas.getByTestId("location-search")).toHaveTextContent("product=205");
    await waitFor(() => expect(canvas.getByTestId("analytic-supplier-chip")).toHaveTextContent("PT Sumber Makmur"));
    await waitFor(() => expect(lastFilters()).toEqual({ teamId: 12n, product: 205n, supplier: 31n }));
    await expect(canvas.getByTestId("analytic-filters-clear")).toBeVisible();

    // × on the product: every product again, the picker back, the supplier kept.
    await userEvent.click(canvas.getByTestId("analytic-product-chip-remove"));
    await waitFor(() => expect(canvas.getByTestId("location-search")).not.toHaveTextContent("product="));
    await expect(canvas.queryByTestId("analytic-product-chip")).toBeNull();
    await expect(within(canvas.getByTestId("analytic-filter-product")).getByRole("combobox")).toBeVisible();
    await waitFor(() => expect(lastFilters()).toEqual({ teamId: 12n, product: undefined, supplier: 31n }));
  },
};

// A SELLER'S SEARCH IS ITS OWN CATALOGUE — another team's product (Gula Pasir 1kg, team 13's) is never offered.
export const ASellersSearchIsItsOwnCatalogue: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const input = within(canvas.getByTestId("analytic-filter-product")).getByRole("combobox");

    await userEvent.click(input);
    await userEvent.type(input, "gula", { delay: 30 });
    await expect(await screen.findByText("No products found", {}, { timeout: 4000 })).toBeInTheDocument();
  },
};

// AFTER A RELOAD (a link, a refresh) the chosen ids read as their NAMES, by ProductByIds and SupplierByIds — never a
// blank search box or "#205" — and the first request already carries both filters.
export const ChipsNameTheChosenAfterAReload: Story = {
  render: () => <Chosen />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("analytic-product-chip")).toHaveTextContent("Sepatu Kanvas"));
    await waitFor(() => expect(canvas.getByTestId("analytic-supplier-chip")).toHaveTextContent("PT Sumber Makmur"));
    await expect(canvas.getByTestId("analytic-product-chip")).not.toHaveTextContent("#205");
    await expect(inventoryLostCalls.every((c) => c.filters.some((i) => i.f.case === "productFilter"))).toBe(true);
    await expect(lastFilters()).toEqual({ teamId: 12n, product: 205n, supplier: 31n });
    await expect(canvas.getAllByTestId(/^analytic-row-/)).toHaveLength(1);
  },
};

// A WAREHOUSE (Gudang Pusat) picks only a product it holds or has held — any seller's, each naming its owner — and a
// supplier from every team's, searched (a warehouse keeps none). Sepatu Kanvas was lost at Gudang Cabang, never held
// here, so it is not offered; Kaos Polos Hitam is.
export const AWarehousePicksWhatItHolds: Story = {
  beforeEach: [asTeam(11n), asRole(Role.WAREHOUSE_ADMIN)],
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const productField = canvas.getByTestId("analytic-filter-product");
    const input = within(productField).getByRole("combobox");

    await userEvent.click(input);
    await userEvent.type(input, "sepatu", { delay: 30 });
    await expect(await screen.findByText("No products found", {}, { timeout: 4000 })).toBeInTheDocument();
    await userEvent.clear(input);

    await pick(productField, "kaos", "product-select-option-MEL-SMP-201");
    await waitFor(() => expect(canvas.getByTestId("analytic-product-chip")).toHaveTextContent("Kaos Polos Hitam"));
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("product=201"));

    const supplierField = canvas.getByTestId("analytic-filter-supplier");
    await pick(supplierField, "cahaya", "supplier-search-select-option-32");
    await waitFor(() => expect(canvas.getByTestId("analytic-supplier-chip")).toHaveTextContent("CV Cahaya Abadi"));
    await expect(canvas.getByTestId("location-search")).toHaveTextContent("supplier=32");
    await waitFor(() => expect(lastFilters()).toEqual({ teamId: 11n, product: 201n, supplier: 32n }));
    await waitFor(() => expect(canvas.getAllByTestId(/^analytic-row-/)).toHaveLength(1));
    await expect(canvas.getByTestId("analytic-row-11")).toBeVisible();
  },
};

// A WAREHOUSE'S SUPPLIER OPTIONS NAME THE TEAM THAT KEEPS EACH — two sellers may each buy from a "CV Maju".
export const AWarehousesSupplierOptionsNameTheirTeam: Story = {
  beforeEach: [asTeam(11n), asRole(Role.WAREHOUSE_ADMIN)],
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const input = within(canvas.getByTestId("analytic-filter-supplier")).getByRole("combobox");

    await userEvent.click(input);
    await userEvent.type(input, "sumber", { delay: 30 });
    const option = await screen.findByTestId("supplier-search-select-option-31", {}, { timeout: 4000 });
    await waitFor(() => expect(option).toHaveTextContent("PT Sumber Makmur"));
    await expect(option).toHaveTextContent("Toko Melati");
  },
};

// ON A PHONE the filters sit in the bottom sheet, and the pickers list INSIDE it (a portalled list would land outside
// the modal sheet, inert): the seller picks a product there, and the chip names it.
export const OnAPhone: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("analytic-filters-open"));
    const sheet = within(await screen.findByTestId("analytic-filters-sheet"));
    const input = within(sheet.getByTestId("analytic-filter-product")).getByRole("combobox");

    await userEvent.click(input);
    await userEvent.type(input, "sepatu", { delay: 30 });
    const option = await sheet.findByTestId("product-select-option-MEL-SMP-205", {}, { timeout: 4000 });
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await waitFor(() => expect(sheet.getByTestId("analytic-product-chip")).toHaveTextContent("Sepatu Kanvas"));
    await expect(canvas.getByTestId("location-search")).toHaveTextContent("product=205");
    await waitFor(() => expect(lastFilters()).toEqual({ teamId: 12n, product: 205n, supplier: undefined }));
  },
};
