import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { SUPPLIER_MARKETPLACES, SUPPLIERS } from "../../fixtures";
import { SupplierListPage, description } from "./index";

const meta = {
  title: "Legacy/Pages/SupplierList",
  component: SupplierListPage,
  parameters: { docs: { description: { component: description } } },
  args: { suppliers: SUPPLIERS, marketplaces: SUPPLIER_MARKETPLACES },
} satisfies Meta<typeof SupplierListPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("supplier-list-page")).toBeVisible();
    await expect(canvas.getByText("CV Sinar Jaya")).toBeVisible();
    await expect(canvas.getByTestId("page-range")).toHaveTextContent("5");
  },
};

// DECISION 1: every action happens OVER the list. Creating opens a dialog rather than navigating,
// because the job is working through suppliers, not visiting one.
export const CreatingOpensADialog: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("supplier-create"));
    await waitFor(async () => {
      await expect(screen.getByTestId("modal")).toHaveTextContent("New Supplier");
    });
    // The list is still behind it.
    await expect(canvas.getByTestId("supplier-list-page")).toBeVisible();
  },
};

// DECISION 2: detail is a PANEL, not a page — a supplier is checked against the row you were already
// reading, and a route would take the list's filters and scroll with it.
export const DetailOpensBesideTheList: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Three row actions, so ActionCell collapses them behind one kebab (the app's row-action rule) —
    // the menu has to be opened before View is reachable.
    await userEvent.click(canvas.getAllByTestId("action-menu-trigger")[0]);
    await userEvent.click(await screen.findByTestId("action-View"));

    await waitFor(async () => {
      await expect(screen.getByTestId("supplier-detail")).toBeVisible();
    });
    await expect(screen.getByTestId("popbox")).toHaveTextContent("CV Sinar Jaya");
  },
};

// DECISION 3: the filters are GEOGRAPHIC — suppliers are chosen by where they ship from. And the
// city list is DERIVED, so the pair can never describe somewhere that does not exist.
export const CityFilterIsDisabledUntilAProvinceIsChosen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByLabelText("City")).toBeDisabled();

    await userEvent.selectOptions(canvas.getByLabelText("Province"), "Jawa Barat");
    await waitFor(async () => {
      await expect(canvas.getByLabelText("City")).toBeEnabled();
    });

    // Only that province's suppliers survive.
    await expect(canvas.getByText("CV Sinar Jaya")).toBeVisible();
    await expect(canvas.queryByText("PT Benang Emas")).toBeNull();
  },
};

// Sorting is the DataTable's three-click cycle, driving the page's own state.
export const SortingByProductCount: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("th-productCount"));

    await waitFor(async () => {
      const names = canvas.getAllByTestId("entity-cell-name").map((el) => el.textContent);
      // Ascending: the 26-product supplier leads.
      expect(names[0]).toContain("Toko Kain Makmur");
    });
  },
};

export const Loading: Story = { args: { suppliers: [], loading: true } };

export const Empty: Story = {
  args: { suppliers: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("empty-hint")).toHaveTextContent("No suppliers match this filter");
  },
};

export const LoadFailed: Story = {
  args: { suppliers: [], isError: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("empty-hint")).toHaveTextContent("Could not load suppliers");
  },
};
