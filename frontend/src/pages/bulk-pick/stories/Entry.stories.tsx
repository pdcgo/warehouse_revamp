import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { PickQueuePage } from "../../pick-queue";
import { DESKTOP, ListThenPage, PHONE, SCENE, VIEWPORTS, bulkPickScene, fitsTheScreen } from "./kit";

// THE WAY IN — the warehouse list's bulk bar on the Dikonfirmasi tab (the-bulk-pick-list-prototype-is-accepted). The bar
// is on screen from the start and an action that needs a tick waits for one (the-bulk-actions-are-always-on-screen);
// Daftar Ambil (en "Pick List") opens the ticked Dikonfirmasi orders, in the list's order, and skips the others as Hand
// Over skips what is not picked. Every action the bar had before stays beside it.

const meta = {
  title: "Pages/Warehouse/BulkPick/Entry",
  component: PickQueuePage,
  parameters: { signedIn: true, dataRouter: true, layout: "fullscreen", viewport: { options: VIEWPORTS } },
  beforeEach: bulkPickScene,
  render: () => <ListThenPage />,
} satisfies Meta<typeof PickQueuePage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A row's tick box — a table row on a desktop canvas, a block on a phone; the row is waited for first. */
async function tick(canvasElement: HTMLElement, id: bigint) {
  const canvas = within(canvasElement);
  const box = await canvas.findByTestId(`pick-queue-select-${id}`, {}, { timeout: 5000 });
  await userEvent.click(within(box).getByRole("checkbox", { hidden: true }));
}

/** The ticked ids in the order the list shows them. */
function listedOrder(canvasElement: HTMLElement, ids: bigint[]): string[] {
  const wanted = new Set(ids.map(String));
  return [...canvasElement.querySelectorAll("[data-testid^='pick-queue-select-']")]
    .map((el) => el.getAttribute("data-testid")!.replace("pick-queue-select-", ""))
    .filter((id) => wanted.has(id));
}

/**
 * THE BAR ON DIKONFIRMASI, THREE TICKED — the scene's five orders listed, Pick List beside Change Step and on once a row
 * is ticked. The picture of the way in; nothing is clicked.
 */
export const TheBarWithThreeTicked: Story = {
  name: "The bar on Dikonfirmasi, three ticked",
  globals: DESKTOP,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    for (const id of SCENE) await canvas.findByTestId(`pick-queue-select-${id}`, {}, { timeout: 5000 });
    for (const id of [SCENE[0], SCENE[2], SCENE[3]]) await tick(canvasElement, id);

    await expect(canvas.getByTestId("pick-queue-bulk-count")).toHaveTextContent("3 selected");
    await waitFor(() => expect(canvas.getByTestId("pick-queue-bulk-pick-list")).toBeEnabled());
  },
};

/**
 * PICK LIST WAITS FOR A TICK, THEN OPENS THE TICKED ORDERS — on Dikonfirmasi, off with nothing ticked (the bar's hint says
 * why); three ticked → the page with those three, in the list's order, Per Produk first.
 */
export const PickListOpensTheTickedOrders: Story = {
  name: "Pick List opens the ticked orders",
  globals: DESKTOP,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = await canvas.findByTestId("pick-queue-bulk-pick-list", {}, { timeout: 5000 });

    await expect(button).toHaveTextContent("Pick List");
    await expect(button).toBeDisabled();
    await expect(canvas.getByTestId("pick-queue-bulk-hint")).toBeInTheDocument();

    const ticked = [SCENE[0], SCENE[2], SCENE[3]];
    for (const id of ticked) await tick(canvasElement, id);
    const inListOrder = listedOrder(canvasElement, [...ticked]);
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);

    await canvas.findByTestId("bulk-pick-page", {}, { timeout: 5000 });
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent(`?ids=${inListOrder.join(",")}`));
    await expect(canvas.getByTestId("bulk-pick-count")).toHaveTextContent("3 orders");
    await expect(canvas.getByTestId("bulk-pick-by-product")).toBeInTheDocument();
  },
};

/**
 * WHAT IS NOT DIKONFIRMASI IS SKIPPED, AND SAID — on Semua, a picked order ticked beside a confirmed one: the toast counts
 * the skipped one, and the page lists the confirmed one alone.
 */
export const ItSkipsWhatIsNotConfirmed: Story = {
  name: "It skips what is not Dikonfirmasi",
  globals: DESKTOP,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByTestId("pick-tab-all", {}, { timeout: 5000 }));

    await tick(canvasElement, 103n);
    await tick(canvasElement, 105n); // picked
    await userEvent.click(canvas.getByTestId("pick-queue-bulk-pick-list"));

    await expect((await screen.findAllByText("1 not Confirmed — skipped")).length).toBeGreaterThan(0);
    await canvas.findByTestId("bulk-pick-page", {}, { timeout: 5000 });
    await expect(canvas.getByTestId("location-search")).toHaveTextContent("?ids=103");
    await expect(canvas.getByTestId("bulk-pick-count")).toHaveTextContent("1 order · 3 units");
  },
};

/** NOTHING DIKONFIRMASI TICKED — the toast says so and the list stays where it is. */
export const NothingConfirmedOpensNothing: Story = {
  name: "Nothing Dikonfirmasi opens nothing",
  globals: DESKTOP,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByTestId("pick-tab-all", {}, { timeout: 5000 }));

    await tick(canvasElement, 105n); // picked
    await userEvent.click(canvas.getByTestId("pick-queue-bulk-pick-list"));

    await expect((await screen.findAllByText("None of the ticked orders is Confirmed")).length).toBeGreaterThan(0);
    await expect(canvas.queryByTestId("bulk-pick-page")).toBeNull();
    await expect(canvas.getByTestId("pick-queue-bulk-bar")).toBeInTheDocument();
  },
};

/** ON A 390 PHONE — the bar wraps and keeps Pick List; nothing runs past the edge. */
export const OnAPhone: Story = {
  name: "Phone · the bar keeps Pick List",
  globals: PHONE,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(window.innerWidth).toBe(390);
    await tick(canvasElement, SCENE[2]);
    await waitFor(() => expect(canvas.getByTestId("pick-queue-bulk-pick-list")).toBeEnabled());
    await fitsTheScreen();
  },
};

/**
 * NOTHING THE BAR HAD IS GONE — with three ticked, Change Step, Print Labels, Hand Over and Export are all still there
 * beside Daftar Ambil, which sits right after Change Step.
 */
export const TheBarKeepsEveryOtherAction: Story = {
  name: "The bar keeps every other action",
  globals: DESKTOP,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await tick(canvasElement, SCENE[0]);
    await tick(canvasElement, SCENE[2]);
    await tick(canvasElement, SCENE[3]);
    await expect(canvas.getByTestId("pick-queue-bulk-count")).toHaveTextContent("3 selected");

    const ids = [
      "pick-queue-bulk-move",
      "pick-queue-bulk-pick-list",
      "pick-queue-bulk-print",
      "pick-queue-bulk-handover",
      "pick-queue-bulk-export",
    ];
    const bar = canvas.getByTestId("pick-queue-bulk-bar");
    const drawn = [...bar.querySelectorAll("[data-testid^='pick-queue-bulk-']")]
      .map((el) => el.getAttribute("data-testid")!)
      .filter((id) => ids.includes(id));
    await expect(drawn).toEqual(ids);
  },
};
