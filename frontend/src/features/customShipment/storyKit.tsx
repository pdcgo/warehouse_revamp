import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, asTeam, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { customShipmentScenario } from "../../../.storybook/customShipmentScenario";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { PHONE_VIEWPORTS } from "../warehouseTransfer/storyPhone";
import { CustomShipmentSellingPage, CustomShipmentWarehousePage } from "../../pages/custom-shipments";
import { CustomShipmentFormPage } from "../../pages/custom-shipment-form";
import { CustomShipmentDetailPage } from "../../pages/custom-shipment-detail";
import { CustomShipmentPickPage } from "../../pages/custom-shipment-pick";
import { toaster } from "../../components/feedback/Toaster";
import { CUSTOM_SHIPMENTS_PATH } from "./customShipments";

// STORY-ONLY — what the custom shipments' story files share (backlog #88). Imported by `*.stories.tsx` only. Each file
// keeps its own `title` literal (Storybook reads it statically) and spreads one of the metas below.
//
// The pages are mounted under ONE router per side with their real neighbours, so a story walks the screens as a person
// would — the list opens a parcel, Paket Baru opens the form, the form's create lands on the parcel's page — and the stub
// transport (.storybook/customShipmentStub.ts) plays CustomShipmentService across all of them through the real proto.
// What it heard and sent is in customShipmentScenario.ts, reset before every story by preview.tsx.

/** The selling team's three screens, opened at `entry`. */
export function sellingAt(entry: string) {
  return routedPage(
    [
      { path: CUSTOM_SHIPMENTS_PATH, element: <><CustomShipmentSellingPage /><LocationProbe hidden /></> },
      { path: `${CUSTOM_SHIPMENTS_PATH}/new`, element: <CustomShipmentFormPage /> },
      { path: `${CUSTOM_SHIPMENTS_PATH}/:shipmentId`, element: <CustomShipmentDetailPage /> },
    ],
    entry,
  );
}

/** The warehouse's two screens, opened at `entry`. */
export function warehouseAt(entry: string) {
  return routedPage(
    [
      { path: CUSTOM_SHIPMENTS_PATH, element: <><CustomShipmentWarehousePage /><LocationProbe hidden /></> },
      { path: `${CUSTOM_SHIPMENTS_PATH}/:shipmentId`, element: <CustomShipmentPickPage /> },
    ],
    entry,
  );
}

const PARAMETERS = { signedIn: true, dataRouter: true, viewport: { options: PHONE_VIEWPORTS } };

/** Toko Melati (12), its Owner. */
export const SELLING_META = {
  parameters: PARAMETERS,
  beforeEach: () => {
    asTeam(12n)();
    asRole(Role.SELLING_OWNER)();
  },
};

/** Gudang Pusat (11), its Admin. */
export const WAREHOUSE_META = {
  parameters: PARAMETERS,
  beforeEach: () => {
    asTeam(11n)();
    asRole(Role.WAREHOUSE_ADMIN)();
  },
};

/** The phone the transfer lists were accepted at. */
export const PHONE = { viewport: { value: "phone390" } };

/** Type like a person — a controlled input drops characters at machine speed (CLAUDE.md, Storybook). */
export async function typeInto(el: HTMLElement, value: string) {
  await userEvent.clear(el);
  await userEvent.type(el, value, { delay: 30 });
}

// TeamSelect REMOUNTS once its list lands, and each portals its own listbox — so the option is looked up in the listbox
// THIS field's input names, re-read until it is there (the transfer form's pickTeamIn).
export async function pickTeamIn(field: HTMLElement, teamCode: string) {
  let input!: HTMLElement;
  let option: HTMLElement | null = null;
  await waitFor(() => {
    input = within(field).getByRole("combobox");
    const listbox = document.getElementById(input.getAttribute("aria-controls") ?? "");
    option = listbox?.querySelector<HTMLElement>(`[data-testid="team-select-option-${teamCode}"]`) ?? null;
    expect(option).not.toBeNull();
  });

  await userEvent.click(input);
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option!);
}

/** ShipmentChannelSelect portals — its options are on `screen`. */
export async function pickCourier(canvasElement: HTMLElement, code: string) {
  await userEvent.click(within(within(canvasElement).getByTestId("shipment-channel-select")).getByRole("combobox"));
  const option = await screen.findByTestId(`shipment-channel-option-${code}`, {}, { timeout: 4000 });
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option);
}

/** A FinancialAccountSelect by its test id — its options carry `<testId>-option-<id>`. */
export async function pickAccount(testId: string, accountId: bigint) {
  await userEvent.click(await screen.findByTestId(testId));
  const option = await screen.findByTestId(`${testId}-option-${accountId}`, {}, { timeout: 4000 });
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option);
}

/**
 * WHAT THE STUB SENT team `teamId` about parcel `id` by `rpc` — its money fields, the last answer of that kind. A story
 * pins on it that a warehouse is ANSWERED no seller money (a-warehouse-sees-no-seller-money): a screen that merely does
 * not DRAW a field would pass a look at the page while the field still crossed the wire.
 */
export function moneySent(rpc: string, teamId: bigint, id: bigint) {
  const sent = customShipmentScenario.answered.filter((a) => a.rpc === rpc && a.teamId === teamId && a.shipment.id === id).at(-1);

  return sent
    ? {
        total: sent.shipment.total,
        itemTotals: sent.shipment.items.map((item) => item.total),
        financeAccountId: sent.shipment.financeAccountId,
        shippingCost: sent.shipment.shippingCost,
      }
    : null;
}

/** Toasts outlive a story's page — a story asserting one clears them first (the Toaster is app-wide). */
export const clearToasts = () => toaster.remove();
