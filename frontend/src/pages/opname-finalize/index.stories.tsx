import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { opnameSelfCounted } from "../../../.storybook/opnameStub";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { OpnameFinalizePage } from "./index";

// ⚠ PROTOTYPE for implementation_analysis — what finalize posts (broken-posts-as-written-the-rest-nets).
//
// Count #21 at Gudang Cabang, every row counted by Budi and Eko — so Ani, signed in, may finalize it:
//   Beras    book 8, sellable 7, broken 1 → the rest 0: broken 1 posts from batch #51 @ 62.000, the racks moved
//   Minyak   short 3 → lost 2 @ 30.000 (#31) + 1 @ 32.000 (#34), oldest first
//   Tepung   over 2 → claims the old loss #88 back into #29 @ 14.000, then mints 1 at the newest price, 15.000
//   Gula     matches — not listed
// The warehouse owes 62.000 + 60.000 + 32.000 = Rp 154.000.

const routes = [
  { path: "/inventories/opname/sessions/:sessionId/finalize", element: <OpnameFinalizePage /> },
  marker("/inventories/opname/sessions/:sessionId", "at-session-detail"),
];

const Routed = routedPage(routes, "/inventories/opname/sessions/21/finalize");
const RoutedMidCount = routedPage(routes, "/inventories/opname/sessions/15/finalize");

const meta = {
  title: "Pages/Opname/Finalize",
  component: Routed,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: () => {
    asTeam(14n)();
    asRole(Role.WAREHOUSE_ADMIN)();
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("opname-finalize-summary", {}, { timeout: 4000 });
  return canvas;
}

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("opname-finalize-owed")).toHaveTextContent("Rp 154.000");
    await expect(canvas.getByTestId("opname-finalize-claimed")).toHaveTextContent("Rp 14.000");
    await expect(canvas.getByTestId("opname-finalize-minted")).toHaveTextContent("Rp 15.000");

    // A tear and a move: the rest nets to 0, the broken one still posts.
    await expect(canvas.getByTestId("opname-finalize-rest-74")).toHaveTextContent("0");
    await expect(canvas.getByTestId("opname-finalize-lines-74")).toHaveTextContent("#51");
    // Short 3, oldest batch first.
    const minyak = canvas.getByTestId("opname-finalize-lines-700");
    await expect(minyak).toHaveTextContent("Rp 30.000");
    await expect(minyak).toHaveTextContent("Rp 32.000");
    // Over 2: the old loss is claimed back first, then a new batch.
    await expect(canvas.getByTestId("opname-finalize-lines-702")).toHaveTextContent("claims loss #88");
    // A matching product is left out.
    await expect(canvas.queryByTestId("opname-finalize-product-73")).toBeNull();

    await expect(canvas.getByTestId("opname-finalize-submit")).toBeEnabled();
  },
};

export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // A phone reads each line as a block — no per-product table.
    await expect(canvas.queryByTestId("opname-finalize-lines-700")).toBeNull();
    await expect(canvas.getByTestId("opname-finalize-product-700")).toHaveTextContent("Rp 32.000");
  },
};

// Finalizing is the agreement — confirmed, posted, and back to the watch page.
export const FinalizePosts: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("opname-finalize-submit"));
    const dialog = await screen.findByRole("alertdialog");
    await expect(dialog).toHaveTextContent("Rp 154.000");
    await userEvent.click(within(dialog).getByRole("button", { name: "Finalize" }));
    await canvas.findByTestId("at-session-detail");
  },
};

// Nobody finalizes their own count (nobody-finalizes-their-own-count).
export const OwnCountIsRefused: Story = {
  beforeEach: opnameSelfCounted,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("opname-finalize-block-3")).toHaveTextContent("another Owner or Admin");
    await expect(canvas.getByTestId("opname-finalize-submit")).toBeDisabled();
  },
};

// Count #15 is still being counted — finalize waits.
export const RowsStillCounting: Story = {
  render: () => <RoutedMidCount />,
  beforeEach: asTeam(11n),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("opname-finalize-block-2")).toHaveTextContent("3 rows are not counted yet");
    await expect(canvas.getByTestId("opname-finalize-submit")).toBeDisabled();
  },
};
