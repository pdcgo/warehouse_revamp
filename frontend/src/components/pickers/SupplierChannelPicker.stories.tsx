import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Text } from "@chakra-ui/react";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";

import { channelFixture, supplierFixture } from "../../../.storybook/supplierFixtures";
import { SupplierChannelPicker, type SupplierChannelPick, description } from "./SupplierChannelPicker";

// a-line-connects-to-any-teams-supplier-from-a-popup · a-line-may-name-a-supplier-without-a-channel
// (docs/business/inventory/restock_decision.md). The stub plays supplier_service (supplierStub.ts): SupplierList's
// EVERY_TEAM scope, newest first, `q` over the name, address, contact and live stores' names; a deleted store never
// reaches a list.

const SUMBER = supplierFixture("PT Sumber Makmur"); // team 12's — three live stores and a deleted one
const CAHAYA = supplierFixture("CV Cahaya Abadi"); // one store
const SINAR = supplierFixture("Toko Grosir Sinar"); // no store — a stall
const MAKMUR_JAYA = supplierFixture("UD Makmur Jaya"); // team 13's — ANOTHER team's supplier
const BATIK = supplierFixture("Batik Pekalongan Asli"); // the newest — first on page one

const SHOPEE_STORE = channelFixture(311n);
const DELETED_STORE = channelFixture(314n);
const MAKMUR_JAYA_STORE = channelFixture(341n);

const ID = "supplier-channel-picker";

const meta = {
  title: "Components/Pickers/SupplierChannelPicker",
  component: SupplierChannelPicker,
  parameters: { docs: { description: { component: description } } },
  args: { teamId: 12n, onChange: fn() },
} satisfies Meta<typeof SupplierChannelPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

async function openPicker(canvasElement: HTMLElement) {
  await userEvent.click(within(canvasElement).getByTestId(`${ID}-trigger`));
  const dialog = await screen.findByTestId(`${ID}-dialog`);
  await waitFor(() => expect(dialog).toBeVisible());

  return within(dialog);
}

async function search(dialog: ReturnType<typeof within>, term: string) {
  await userEvent.type(dialog.getByTestId(`${ID}-search`), term, { delay: 20 });
}

async function pickSupplier(dialog: ReturnType<typeof within>, supplierId: bigint) {
  const row = await dialog.findByTestId(`${ID}-supplier-${supplierId}`, {}, { timeout: 4000 });
  await userEvent.click(row);
  // Its stores are read once it is picked.
  await dialog.findByTestId(`${ID}-no-store`, {}, { timeout: 4000 });
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Closed: Story = {};

export const Open: Story = {
  play: async ({ canvasElement }) => {
    await openPicker(canvasElement);
  },
};

export const SupplierPicked: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await openPicker(canvasElement);
    await search(dialog, "Sumber");
    await pickSupplier(dialog, SUMBER.id);
  },
};

// Re-opened on a line that already names a supplier and a store: both are chosen, the store list is read for it.
export const SeededFromTheLine: Story = {
  args: { value: { supplierId: SUMBER.id, supplierChannelId: SHOPEE_STORE.id } },
  play: async ({ canvasElement }) => {
    const dialog = await openPicker(canvasElement);

    await waitFor(() => expect(dialog.getByTestId(`${ID}-picked`)).toHaveTextContent(SUMBER.name), { timeout: 4000 });
    const store = await dialog.findByTestId(`${ID}-store-${SHOPEE_STORE.id}`);
    await expect(within(store).getByRole("radio")).toBeChecked();
  },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// a-line-connects-to-any-teams-supplier-from-a-popup: EVERY team's suppliers, searched on the server — the newest
// (another team's) is on page one, and a word narrows the list to what matches it.
export const SearchNarrowsEveryTeamsSuppliers: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await openPicker(canvasElement);

    await dialog.findByTestId(`${ID}-supplier-${BATIK.id}`, {}, { timeout: 4000 });

    await search(dialog, "Makmur Jaya");

    await waitFor(() => expect(dialog.queryByTestId(`${ID}-supplier-${BATIK.id}`)).toBeNull(), { timeout: 4000 });
    const row = dialog.getByTestId(`${ID}-supplier-${MAKMUR_JAYA.id}`);
    // Another team's — and the row says whose.
    await expect(row).toHaveTextContent("Toko Kenanga");
    await expect(dialog.getByTestId(`${ID}-supplier-${MAKMUR_JAYA.id}-stores`)).toHaveTextContent("2 stores");
  },
};

// A supplier, then one of its stores — Connect returns both ids.
export const PickingAStoreReturnsBothIds: Story = {
  play: async ({ args, canvasElement }) => {
    const dialog = await openPicker(canvasElement);
    await search(dialog, "Makmur Jaya");
    await pickSupplier(dialog, MAKMUR_JAYA.id);

    // A supplier with stores waits for a choice — "no store" is not assumed.
    await expect(dialog.getByTestId(`${ID}-confirm`)).toBeDisabled();

    await userEvent.click(dialog.getByTestId(`${ID}-store-${MAKMUR_JAYA_STORE.id}`));
    await userEvent.click(dialog.getByTestId(`${ID}-confirm`));

    await waitFor(() =>
      expect(args.onChange).toHaveBeenCalledWith({ supplierId: MAKMUR_JAYA.id, supplierChannelId: MAKMUR_JAYA_STORE.id }),
    );
  },
};

// a-line-may-name-a-supplier-without-a-channel: "No store" is an explicit choice, and it returns 0n.
export const PickingNoStoreReturnsZero: Story = {
  play: async ({ args, canvasElement }) => {
    const dialog = await openPicker(canvasElement);
    await search(dialog, "Cahaya");
    await pickSupplier(dialog, CAHAYA.id);

    await userEvent.click(dialog.getByTestId(`${ID}-no-store`));
    await userEvent.click(dialog.getByTestId(`${ID}-confirm`));

    await waitFor(() => expect(args.onChange).toHaveBeenCalledWith({ supplierId: CAHAYA.id, supplierChannelId: 0n }));
  },
};

// A stall has no store to choose — "no store" is chosen for the person, and Connect is ready at once.
export const AStallNeedsNoStoreChoice: Story = {
  play: async ({ args, canvasElement }) => {
    const dialog = await openPicker(canvasElement);
    await search(dialog, "Grosir Sinar");
    await pickSupplier(dialog, SINAR.id);

    await waitFor(() => expect(within(dialog.getByTestId(`${ID}-no-store`)).getByRole("radio")).toBeChecked());
    await userEvent.click(dialog.getByTestId(`${ID}-confirm`));

    await waitFor(() => expect(args.onChange).toHaveBeenCalledWith({ supplierId: SINAR.id, supplierChannelId: 0n }));
  },
};

// A deleted store never appears — a-store-delete-is-soft-too keeps it for old lines, not for new picks.
export const ADeletedStoreIsNotOffered: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await openPicker(canvasElement);
    await search(dialog, "Sumber");
    await pickSupplier(dialog, SUMBER.id);

    await expect(dialog.getByTestId(`${ID}-store-${SHOPEE_STORE.id}`)).toBeInTheDocument();
    await expect(dialog.queryByTestId(`${ID}-store-${DELETED_STORE.id}`)).toBeNull();
  },
};

// The draft is thrown away: Cancel calls nothing.
export const CancelReturnsNothing: Story = {
  play: async ({ args, canvasElement }) => {
    const dialog = await openPicker(canvasElement);
    await search(dialog, "Cahaya");
    await pickSupplier(dialog, CAHAYA.id);
    await userEvent.click(dialog.getByTestId(`${ID}-no-store`));

    await userEvent.click(dialog.getByTestId(`${ID}-cancel`));

    await waitFor(() => expect(screen.queryByTestId(`${ID}-dialog`)).toBeNull());
    await expect(args.onChange).not.toHaveBeenCalled();
  },
};

// Controlled for real, so the reviewer can see what a pick sends.
export const Interactive: Story = {
  render: (args) => {
    const [pick, setPick] = useState<SupplierChannelPick>({ supplierId: 0n, supplierChannelId: 0n });

    return (
      <>
        <SupplierChannelPicker {...args} value={pick} onChange={setPick} />
        <Text mt="3" fontSize="sm" data-testid="picked">
          {pick.supplierId === 0n ? "(nothing connected)" : `supplier ${pick.supplierId} · store ${pick.supplierChannelId}`}
        </Text>
      </>
    );
  },
};
