import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import type { StoryContext } from "@storybook/react-vite";

import { LocationProbe, asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { SETTLED_IN_SEED, restockResolutionScenario, seedRestockResolutionsForStory } from "../../../.storybook/restockResolutionScenario";
import { secondProblemRestock } from "../../../.storybook/restockTagKit";
import { takeProblemTagsOff } from "../../../.storybook/restockTagScenario";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { PHONE_VIEWPORTS } from "../warehouseTransfer/storyPhone";
import { RestockSellingDetailPage } from "../../pages/restock-selling-detail";
import { RestockSellingPage } from "../../pages/restock-selling";
import { RestockWarehousePage } from "../../pages/restock-warehouse";
import { RestockReshippingFormPage } from "../../pages/restock-reshipping-form";
import { CustomShipmentInboundPage } from "../../pages/custom-shipment-inbound";
import { CustomShipmentFormPage } from "../../pages/custom-shipment-form";
import { CustomShipmentSellingPage } from "../../pages/custom-shipments";
import { toaster } from "../../components/feedback/Toaster";

// STORY-ONLY — what the restock resolutions' stories share (backlog #101, live since
// the-restock-resolutions-prototype-is-accepted). Imported by `*.stories.tsx` only. Each file keeps its own `title`
// literal (Storybook reads it statically) and spreads a meta below.
//
// The pages are mounted under ONE router per side with their real neighbours, so a story walks the screens as a person
// would — the restock's Catat Resolusi opens the reshipping form or Paket Baru, and each comes back to the restock. The
// stub transport plays the server: the restock, its tags and the accounts (restockStub.ts), the parcels both ways
// (customShipmentStub.ts), and the resolutions, the settled marks, their Riwayat rows and the inbound parcels
// (.storybook/restockResolutionScenario.ts — empty by default, seeded here with the accepted prototype's rows unless the
// story says `parameters.resolutionSeed: "empty"`).

const DETAIL = "/inventories/restock/:requestId";

/** The selling team's restock screens and the custom-shipment ones they open, at `entry`. */
export function sellingAt(entry: string | { pathname: string; state?: unknown }) {
  return routedPage(
    [
      { path: "/inventories/restock", element: <><RestockSellingPage /><LocationProbe hidden /></> },
      { path: DETAIL, element: <><RestockSellingDetailPage /><LocationProbe hidden /></> },
      { path: `${DETAIL}/reshipping`, element: <RestockReshippingFormPage /> },
      { path: "/inventories/custom-shipments", element: <><CustomShipmentSellingPage /><LocationProbe hidden /></> },
      { path: "/inventories/custom-shipments/new", element: <CustomShipmentFormPage /> },
      { path: "/inventories/custom-shipments/in/:parcelId", element: <><CustomShipmentInboundPage /><LocationProbe hidden /></> },
      marker("/inventories/custom-shipments/:shipmentId", "at-custom-shipment"),
      marker(`${DETAIL}/edit`, "at-restock-edit"),
      marker("/inventories/restock/new", "at-restock-new"),
    ],
    entry,
  );
}

/** The warehouse's incoming list and the inbound parcel's page, at `entry`. */
export function warehouseAt(entry: string) {
  return routedPage(
    [
      { path: "/inventories/restock", element: <><RestockWarehousePage /><LocationProbe hidden /></> },
      { path: "/inventories/custom-shipments/in/:parcelId", element: <><CustomShipmentInboundPage /><LocationProbe hidden /></> },
      marker(DETAIL, "at-restock-detail"),
      marker("/inventories/restock/labels", "at-restock-labels"),
    ],
    entry,
  );
}

const PARAMETERS = { signedIn: true, dataRouter: true, viewport: { options: PHONE_VIEWPORTS } };

/** The accepted prototype's rows on the stub's server — unless the story opens on none. */
function seed(context: StoryContext) {
  if (context.parameters.resolutionSeed === "empty") return;
  seedRestockResolutionsForStory();
  // The seed's settled restocks have had their problem tags taken off, as the settle did.
  for (const id of SETTLED_IN_SEED) takeProblemTagsOff(id);
}

/** Toko Melati (12), its Owner (Ani, 61, writes). */
export const SELLING_META = {
  parameters: PARAMETERS,
  beforeEach: (context: StoryContext) => {
    asTeam(12n)();
    asRole(Role.SELLING_OWNER)();
    toaster.remove();
    seed(context);
  },
};

/** The same, with 507 a second problem restock (3 missing) that the seed holds as SETTLED — the list's three readings. */
export const SELLING_LIST_META = {
  ...SELLING_META,
  beforeEach: (context: StoryContext) => {
    // secondProblemRestock resets the restock stub (and with it the resolutions), so it runs first, the seed after.
    const restore = secondProblemRestock();
    SELLING_META.beforeEach(context);
    return restore;
  },
};

/** Gudang Pusat (11), its Admin (Budi, 62, writes). */
export const WAREHOUSE_META = {
  parameters: PARAMETERS,
  beforeEach: (context: StoryContext) => {
    asTeam(11n)();
    asRole(Role.WAREHOUSE_ADMIN)();
    toaster.remove();
    seed(context);
    restockResolutionScenario.actor = 62n;
  },
};

export const DESKTOP = { viewport: { value: "desktop1440" } };
export const PHONE = { viewport: { value: "phone390" } };

/** Type like a person — a controlled input drops characters at machine speed (CLAUDE.md, Storybook). */
export async function typeInto(el: HTMLElement, value: string) {
  await userEvent.clear(el);
  await userEvent.type(el, value, { delay: 30 });
}

/** Open Catat Resolusi's menu; answers the item test ids it offers. */
export async function recordMenu(canvas: ReturnType<typeof within>): Promise<string[]> {
  await userEvent.click(canvas.getByTestId("resolution-record"));
  const menu = await screen.findByTestId("resolution-record-menu", {}, { timeout: 3000 });
  await waitFor(() => expect(menu).toBeVisible());

  return [...menu.querySelectorAll("[data-testid^='resolution-record-']")].map((el) => el.getAttribute("data-testid")!);
}

/** The rows of the Resolusi section, as their types, in order. */
export const resolutionTypes = (canvasElement: HTMLElement) =>
  [...canvasElement.querySelectorAll("[data-testid^='resolution-row-'][data-type]")].map((el) => el.getAttribute("data-type"));

/** The #101 writes the screens sent, in order — the RPC and the real request (restockResolutionScenario.calls). */
export const resolutionCalls = () => restockResolutionScenario.calls;
