import type { Meta, StoryObj } from "@storybook/react-vite";
import { create } from "@bufbuild/protobuf";
import { useQueryClient } from "@tanstack/react-query";
import { Button, HStack } from "@chakra-ui/react";
import { expect, spyOn, userEvent, waitFor, within } from "storybook/test";

import { marker, routedPage } from "../../../.storybook/pageStory";
import { warehouseInfoClient } from "../../api/clients";
import { key } from "../../api/queryClient";
import { useSaveShop } from "../../features/shops/queries";
import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";
import { WarehouseInfoDetailResponseSchema } from "../../gen/warehouse/warehouse/v1/warehouse_info_pb";
import { TeamDetailPage } from "./index";

// A TEAM'S PAGE (/teams/:teamId) — its record and members for every team, plus the part its type adds: a warehouse's
// location and two weekly schedules (WarehouseInfoSection), a selling team's shops (ShopsSection).
//
// Both parts read through query hooks (#122) — the warehouse's profile is the same cache entry its edit page reads, the
// shops are under `shops` — so a save made elsewhere shows here without a reload. The profile is served by a spy here
// (warehouseInfoStub answers an empty one): Gudang Pusat (11) on Jl. Gudang 1 until a story saves a new address.

let location = "Jl. Gudang 1, Bekasi";

// Story-only controls standing in for a save made on ANOTHER screen: the warehouse's address saved on its edit page
// (which invalidates its profile), a shop added on the Shops screen (useSaveShop, which invalidates `shops`).
function StoryElsewhere() {
  const client = useQueryClient();
  const saveShop = useSaveShop();

  return (
    <HStack mt="4">
      <Button
        size="xs"
        data-testid="story-profile-saved"
        onClick={() => {
          location = "Jl. Baru 7, Cikarang";
          void client.invalidateQueries({ queryKey: key.warehouseInfo(11n) });
        }}
      >
        Save a new address elsewhere
      </Button>
      <Button
        size="xs"
        data-testid="story-shop-added"
        onClick={() =>
          void saveShop.mutateAsync({ teamId: 12n, name: "Melati Baru", shopCode: "MEL-NEW", marketplace: Marketplace.SHOPEE, description: "" })
        }
      >
        Add a shop elsewhere
      </Button>
    </HStack>
  );
}

const routes = [
  {
    path: "/teams/:teamId",
    element: (
      <>
        <TeamDetailPage backTo="/teams" />
        <StoryElsewhere />
      </>
    ),
  },
  marker("/teams", "at-teams"),
  marker("/teams/:teamId/edit", "at-warehouse-edit"),
  marker("/shops", "at-shops"),
];
const AtGudangPusat = routedPage(routes, "/teams/11");
const AtTokoMelati = routedPage(routes, "/teams/12");

const meta = {
  title: "Pages/Teams/TeamDetailPage",
  component: AtGudangPusat,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: () => {
    location = "Jl. Gudang 1, Bekasi";
    const spy = spyOn(warehouseInfoClient, "warehouseInfoDetail").mockImplementation(async (req) =>
      create(WarehouseInfoDetailResponseSchema, {
        info: { teamId: req.teamId, location, operatingHours: [], receivingHours: [], closures: [] },
      }),
    );

    return () => spy.mockRestore();
  },
} satisfies Meta<typeof AtGudangPusat>;

export default meta;
type Story = StoryObj<typeof meta>;

async function warehouseSection(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const section = await canvas.findByTestId("warehouse-detail-section", {}, { timeout: 5000 });
  await waitFor(() => expect(section).toHaveTextContent("Jl. Gudang 1, Bekasi"), { timeout: 5000 });

  return { canvas, section };
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

/** Gudang Pusat: its record, and its Gudang section — the address and the two schedules. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const { section } = await warehouseSection(canvasElement);

    await expect(within(section).getByTestId("warehouse-detail-operating")).toBeVisible();
    await expect(within(section).getByTestId("warehouse-detail-receiving")).toBeVisible();
  },
};

export const Mobile: Story = {
  name: "Mobile",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    await warehouseSection(canvasElement);
  },
};

/** Toko Melati: a selling team's page lists its shops — name, code, marketplace. */
export const ASellingTeamListsItsShops: Story = {
  name: "A selling team lists its shops",
  render: () => <AtTokoMelati />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("shop-detail-row-MEL-SHP")).toBeVisible(), { timeout: 5000 });
    await expect(canvas.getByTestId("shop-detail-row-MEL-TOK")).toHaveTextContent("Melati Store");
  },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

/** THE PROFILE IS A QUERY: an address saved on the edit page shows here, in place — no reload. */
export const AProfileSavedElsewhereShowsHere: Story = {
  name: "A warehouse's address saved elsewhere shows here without a reload",
  play: async ({ canvasElement }) => {
    const { canvas, section } = await warehouseSection(canvasElement);

    await userEvent.click(canvas.getByTestId("story-profile-saved"));
    await waitFor(() => expect(section).toHaveTextContent("Jl. Baru 7, Cikarang"), { timeout: 5000 });
  },
};

/** THE SHOPS ARE A QUERY under `shops`: a shop added on the Shops screen shows on the team's page — no reload. */
export const AShopAddedElsewhereShowsHere: Story = {
  name: "A shop added elsewhere shows on the team's page without a reload",
  render: () => <AtTokoMelati />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("shop-detail-row-MEL-SHP")).toBeVisible(), { timeout: 5000 });

    await userEvent.click(canvas.getByTestId("story-shop-added"));
    await waitFor(() => expect(canvas.getByTestId("shop-detail-row-MEL-NEW")).toBeVisible(), { timeout: 5000 });
  },
};
