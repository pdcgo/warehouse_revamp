import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, spyOn, userEvent, waitFor, within } from "storybook/test";

import { withTheAppsFocusRule } from "../../../../.storybook/appFocusRule";
import { productLeftItsRacksForStory } from "../../../../.storybook/batchStub";
import { noRacksAt } from "../../../../.storybook/rackStub";
import { asRole } from "../../../../.storybook/sessionScenario";
import { rackClient } from "../../../api/clients";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { A_01_1, ACCEPT_META, COFFEE, RICE, count, expectAccept, lineOf, loaded, place } from "./kit";

// RESTOCK ACCEPT — a warehouse with NO rack (the-accept-page-points-to-the-racks-page, owner "C"): the good units have
// nowhere to go, so each placement picker says so and links to the Racks page — for EVERY warehouse role (staff too, who
// are refused the create there, as today) — and Terima cannot finish. The link opens a NEW TAB, and back on this tab the
// racks are read again, every count typed kept (a-helper-link-opens-a-new-tab). Acceptance:
// docs/acceptances/inventory/restock.md given 33.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockAccept/NoRack",
  ...ACCEPT_META,
  // What a return to the tab re-reads is the point here — so the app's own focus rule, not TanStack's default.
  decorators: [withTheAppsFocusRule],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Back on the page's tab: the browser fires `visibilitychange` at the document — TanStack's window-focus event. */
const comeBack = () => document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));

/** A beat for a request that should NOT go out. */
const aBeat = () => new Promise((resolve) => setTimeout(resolve, 300));

/**
 * A warehouse with no rack at all — so no product sits on one either: the "placed here before" chips are as empty as the
 * server's ProductPlaces would leave them (the batch stub otherwise lists every rack).
 */
function noRackHere() {
  noRacksAt(11n);
  productLeftItsRacksForStory(COFFEE.productId);
  productLeftItsRacksForStory(RICE.productId);
}

let rackReads = 0;

function recordRackReads() {
  rackReads = 0;
  const real = rackClient.rackList.bind(rackClient);
  const spy = spyOn(rackClient, "rackList").mockImplementation(async (req, options) => {
    rackReads += 1;
    return real(req, options);
  });

  return () => spy.mockRestore();
}

/** The helper under a line's first placement picker. */
async function helperOf(canvasElement: HTMLElement, productId: bigint) {
  const line = await lineOf(canvasElement, productId);
  return line.findByTestId(`accept-placement-${productId}-0-no-rack`, {}, { timeout: 4000 });
}

async function expectTheRacksLink(canvasElement: HTMLElement, productId: bigint) {
  const help = await helperOf(canvasElement, productId);
  await expect(help).toHaveTextContent("This warehouse has no rack yet.");
  const link = within(help).getByTestId(`accept-placement-${productId}-0-open-racks`);
  await expect(link).toHaveAttribute("href", "/inventories/racks");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await expect(link).toHaveAccessibleName("Open Racks, opens in a new tab");
}

function noRackAs(role: Role): Story {
  return {
    beforeEach: () => {
      asRole(role)();
      noRackHere();
    },
    // Before the box is counted too — the person learns it before typing a count, and every line says it.
    play: async ({ canvasElement }) => {
      await expectTheRacksLink(canvasElement, COFFEE.productId);
      await expectTheRacksLink(canvasElement, RICE.productId);
    },
  };
}

// EVERY WAREHOUSE ROLE GETS THE LINK (given 33, warehouse:all).
export const NoRackLinksStaffToRacks: Story = { name: "No rack · staff → Racks", ...noRackAs(Role.WAREHOUSE_STAFF) };
export const NoRackLinksTheOwnerToRacks: Story = { name: "No rack · owner → Racks", ...noRackAs(Role.WAREHOUSE_OWNER) };
export const NoRackLinksTheAdminToRacks: Story = { name: "No rack · admin → Racks", ...noRackAs(Role.WAREHOUSE_ADMIN) };

// THE ACCEPT CANNOT FINISH — every unit counted in, nothing broken, and still nowhere to put the good ones: Terima stays
// off and the ready line names the placement.
export const NoRackTheAcceptCannotFinish: Story = {
  name: "No rack · Terima cannot finish",
  beforeEach: noRackHere,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    for (const id of [COFFEE.productId, RICE.productId]) {
      const line = await lineOf(canvasElement, id);
      await userEvent.click(line.getByTestId(`accept-all-arrived-${id}`));
      await waitFor(() => expect(line.getByTestId(`accept-unbalanced-${id}`)).toBeInTheDocument());
    }

    await expect(canvas.getByTestId(`accept-ready-line-missing-line-${COFFEE.productId}`)).toHaveTextContent("placement");
    await expectAccept(canvasElement, false);
    await expectTheRacksLink(canvasElement, COFFEE.productId);
  },
};

// BACK FROM THE RACKS TAB (given 33, a-helper-link-opens-a-new-tab) — a rack is made in the other tab while the count
// waits; coming back, the racks are read again (once, for every picker), the new rack can be picked, and the counts
// typed before the trip are exactly as they were. Terima can finish then.
export const BackFromRacksTheNewRackCanBePicked: Story = {
  name: "No rack · back from the new tab → picked, counts kept",
  beforeEach: () => {
    noRackHere();
    return recordRackReads();
  },
  play: async ({ canvasElement }) => {
    const id = COFFEE.productId;
    await count(canvasElement, id, "12", "2");
    await helperOf(canvasElement, id);
    const asked = rackReads;

    // …in the other tab: Tambah Rak.
    const made = await rackClient.rackCreate({ teamId: 11n, code: "C-09-1", name: "", description: "" });
    comeBack();

    await waitFor(() => expect(rackReads).toBe(asked + 1), { timeout: 4000 });
    const line = await lineOf(canvasElement, id);
    await waitFor(() => expect(line.queryByTestId(`accept-placement-${id}-0-no-rack`)).toBeNull(), { timeout: 4000 });
    await expect(line.getByTestId(`accept-received-${id}`)).toHaveValue("12");
    await expect(line.getByTestId(`accept-broken-${id}`)).toHaveValue("2");

    await place(canvasElement, id, 0, made.rack!.id);
    await waitFor(() => expect(line.getByTestId(`accept-balanced-${id}`)).toBeInTheDocument());
  },
};

// A WAREHOUSE WITH RACKS — no helper, and a trip to another tab asks the racks nothing (the re-read is for an empty
// list only; the app's no-refetch-on-focus rule stands, HARD RULE 10).
export const RacksThereNoHelperNoReread: Story = {
  name: "Racks there · no helper, no re-read on return",
  beforeEach: recordRackReads,
  play: async ({ canvasElement }) => {
    const id = COFFEE.productId;
    await count(canvasElement, id, "12");
    const line = await lineOf(canvasElement, id);
    const field = within(line.getByTestId(`accept-placement-${id}-0`));
    await userEvent.click(field.getByTestId("rack-select"));
    await field.findByTestId(`rack-select-option-${A_01_1}`, {}, { timeout: 4000 });
    await userEvent.keyboard("{Escape}");
    const asked = rackReads;

    comeBack();
    await aBeat();
    await expect(rackReads).toBe(asked);
    await expect(line.queryByTestId(`accept-placement-${id}-0-no-rack`)).toBeNull();
  },
};
