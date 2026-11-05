import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { supplierFixture } from "../../../../.storybook/supplierFixtures";
import { SUPPLIER_DISCOVER_DETAIL_META, AtSinar, NUSANTARA, loaded, routedAt } from "./kit";

// DISCOVER SUPPLIER DETAIL — the name and whose it is, who it is beside the team
// (the-discover-detail-reads-as-the-supplier-page), the warehouses over the tabs, the way back — and a supplier that
// does not open. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Suppliers/DiscoverSupplierDetail/Header",
  ...SUPPLIER_DISCOVER_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const LAMA_TUTUP = supplierFixture("CV Lama Tutup"); // deleted

const AtDeleted = routedAt(LAMA_TUTUP.id);
const AtUnknown = routedAt(999n);

// Whose supplier it is, on top — the thing worth knowing on a cross-team page.
export const NamesTheOwningTeam: Story = {
  name: "Owning team",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("discover-detail-name")).toHaveTextContent(NUSANTARA.name);
    await waitFor(() => expect(canvas.getByTestId("discover-detail-team")).toHaveTextContent("Toko Anggrek"));
    await expect(canvas.getByTestId("discover-detail-address")).toHaveTextContent(NUSANTARA.address);
  },
};

// THE NAME, THEN WHOSE ON THE LEFT AND WHO IT IS BESIDE IT — the supplier page's identity line right of the team, not a
// card of uppercase labels (discover-detail-puts-the-team-left-and-the-contact-right); the contact copies with one click.
export const TheTeamThenWhoItIs: Story = {
  name: "Team, then who it is",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const team = (await canvas.findByTestId("discover-detail-team")).getBoundingClientRect();
    const meta = canvas.getByTestId("discover-detail-meta");
    const at = meta.getBoundingClientRect();
    // Beside the team, close to it — not from the middle of the page — and top-aligned.
    await expect(at.left).toBeGreaterThan(team.right);
    await expect(at.left - team.right).toBeLessThan(48);
    await expect(Math.abs(at.top - team.top)).toBeLessThan(4);
    await expect(canvas.getByTestId("discover-detail-contact")).toHaveTextContent(NUSANTARA.contact);
    await expect(canvas.getByTestId("discover-detail-description")).toHaveTextContent(NUSANTARA.description);
    await expect(within(meta).getByRole("button", { name: /copy/i })).toBeInTheDocument();
    await expect(within(meta).queryByText("CONTACT")).toBeNull();
    // Read-only: no Edit or Delete.
    await expect(canvas.queryByTestId("supplier-detail-edit")).toBeNull();
  },
};

// …and a supplier with nothing but a name shows its name and its team — no empty line.
export const AnEmptySupplierShowsItsNameAndTeam: Story = {
  name: "Only a name",
  render: () => <AtSinar />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await canvas.findByTestId("discover-detail-team");
    await expect(canvas.queryByTestId("discover-detail-meta")).toBeNull();
  },
};

// GUDANG TERKAIT, as on the manage detail (a-supplier-page-is-scoped-by-its-warehouses) — over the tabs, marked 4 and 5.
export const TheWarehousesScopeThePage: Story = {
  name: "Warehouses over the tabs",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const row = await canvas.findByTestId("supplier-warehouses");
    await expect(within(row).getByTestId("not-implemented-warehouses")).toHaveTextContent("4");
    await expect(within(row).getByTestId("not-implemented-warehouseFilter")).toHaveTextContent("5");
    await expect(row.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      canvas.getByTestId("supplier-tabs").getBoundingClientRect().top,
    );
  },
};

export const BackGoesToDiscover: Story = {
  name: "Back to Discover",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("discover-detail-back"));
    await canvas.findByTestId("at-discover");
  },
};

export const UnknownSupplierIsNotFound: Story = {
  name: "Unknown, not found",
  render: () => <AtUnknown />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("discover-detail-error", {}, { timeout: 4000 });
  },
};

// a-deleted-supplier-is-kept-for-its-figures: kept for past restocks and the figures, but never opened as a record.
export const ADeletedSupplierIsNotFound: Story = {
  name: "Deleted, not found",
  render: () => <AtDeleted />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("discover-detail-error", {}, { timeout: 4000 });
  },
};
