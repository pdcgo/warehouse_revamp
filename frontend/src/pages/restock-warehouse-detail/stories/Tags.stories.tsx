import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { DESKTOP, PHONE, TAG, TAG_VIEWPORTS, restockTagScenario } from "../../../../.storybook/restockTagKit";
import { At503, WAREHOUSE_DETAIL_META, loaded } from "./kit";

// RESTOCK WAREHOUSE DETAIL — THE TAGS BOX (backlog #87, live since the-restock-tags-prototype-is-accepted). The same box as
// the selling team's page: the restock's tags are ONE set for both sides, and the warehouse tags too
// (custom-tags-are-shared-system-tags-are-the-admins-and-the-apps — every team uses a custom tag), on a RECEIVED restock
// as in every status (the owner's 🔄). Under Kiriman on the right where the page has room, before the note otherwise.
//
// 503 (Diterima) as Gudang Pusat's floor crew (WAREHOUSE_STAFF): the app's Barang kurang + Barang rusak, locked, and
// Retur ke Supplier, which the warehouse put on.

const meta = {
  title: "Pages/Inventory/Restock/RestockWarehouseDetail/Tags",
  ...WAREHOUSE_DETAIL_META,
  component: At503,
  parameters: { ...WAREHOUSE_DETAIL_META.parameters, viewport: { options: TAG_VIEWPORTS } },
  render: () => <At503 />,
  globals: DESKTOP,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * THE WAREHOUSE'S BOX — beside the products under Kiriman; the problem tags locked, its own custom tag with a ×; on this
 * received restock it makes a custom tag of its own and puts it on — RestockTagCreate, then RestockRequestTagAdd as
 * the warehouse (team 11).
 */
export const TheWarehouseTagsToo: Story = {
  name: "The box — the warehouse tags a received restock",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const section = within(await canvas.findByTestId("restock-detail-tags-section", {}, { timeout: 4000 }));
    await expect(canvas.getByTestId("section-nav-tags")).toBeVisible();

    await expect(section.getByTestId(`restock-tag-${TAG.missing}-lock`)).toBeInTheDocument();
    await expect(section.queryByTestId(`restock-tag-${TAG.missing}-remove`)).toBeNull();
    await expect(section.getByTestId(`restock-tag-${TAG.retur}-remove`)).toBeVisible();
    await expect(section.queryByTestId("restock-tag-manage")).toBeNull();

    const input = canvas.getByTestId("restock-tag-add-input");
    await userEvent.click(input);
    await userEvent.type(input, "Rak Penuh", { delay: 40 });
    const create = await screen.findByTestId("restock-tag-add-create-custom", {}, { timeout: 3000 });
    await waitFor(() => expect(create).toBeVisible());
    await userEvent.click(create);

    await waitFor(() => expect(section.getByText("Rak Penuh")).toBeVisible());
    await expect(restockTagScenario.calls).toEqual([
      { rpc: "RestockTagCreate", name: "Rak Penuh" },
      { rpc: "RestockRequestTagAdd", teamId: 11n, requestId: 503n, tagId: 16n },
    ]);
  },
};

/** ON A PHONE — the box in the one column, before the note; nothing runs off. */
export const OnAPhone: Story = {
  name: "Phone — the box before the note",
  globals: PHONE,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await canvas.findByTestId("restock-detail-tags-section", {}, { timeout: 4000 });
    await expect(window.innerWidth).toBe(390);
    const order = [...canvasElement.querySelectorAll("[id^='restock-section-']")].map((el) => el.id);
    await expect(order.indexOf("restock-section-tags")).toBe(order.indexOf("restock-section-note") - 1);
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};
