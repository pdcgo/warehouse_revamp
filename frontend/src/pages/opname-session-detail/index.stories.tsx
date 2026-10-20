import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { OpnameSessionDetailPage } from "./index";

// ⚠ PROTOTYPE for implementation_analysis — the admin's watch page (opname.md §How Staff Work On Session).
//
// Count #15 at Gudang Pusat, mid-count: Beras was counted by Budi on two racks — short 2 on A-01-1 (broken 1, lost 1)
// and over 1 on A-01-2, each with its reason; Gula matches; Minyak is not counted; Tepung is revealed short, its reasons
// still to write; Minyak Karton is a row at 0.

const Routed = routedPage(
  [
    { path: "/inventories/opname/sessions/:sessionId", element: <OpnameSessionDetailPage /> },
    marker("/inventories/opname/sessions", "at-sessions"),
    marker("/inventories/opname/sessions/:sessionId/count", "at-session-count"),
    marker("/inventories/opname/sessions/:sessionId/finalize", "at-session-finalize"),
  ],
  "/inventories/opname/sessions/15",
);

const RoutedReady = routedPage(
  [
    { path: "/inventories/opname/sessions/:sessionId", element: <OpnameSessionDetailPage /> },
    marker("/inventories/opname/sessions/:sessionId/finalize", "at-session-finalize"),
  ],
  "/inventories/opname/sessions/21",
);

const meta = {
  title: "Pages/Inventory/Opname/SessionDetail",
  component: Routed,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: () => {
    asTeam(11n)();
    asRole(Role.WAREHOUSE_ADMIN)();
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement, rowId = "1501") {
  const canvas = within(canvasElement);
  await canvas.findByTestId(`opname-row-${rowId}`, {}, { timeout: 4000 });
  return canvas;
}

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // The admin sees the book, the count, the difference — and every reason staff wrote.
    await expect(canvas.getByTestId("opname-row-book-1501")).toHaveTextContent("5");
    await expect(canvas.getByTestId("opname-row-difference-1501")).toHaveTextContent("−2");
    const drafts = canvas.getByTestId("opname-row-drafts-1501");
    await expect(drafts).toHaveTextContent("Karung sobek, dibuang");
    await expect(drafts).toHaveTextContent("Tidak ketemu, sudah cek bawah rak");
    // A revealed row whose reasons are not written yet says so.
    await expect(canvas.getByTestId("opname-row-drafts-1505")).toHaveTextContent("Reason not written yet");
    // A row at 0 is counted like any other.
    await expect(canvas.getByTestId("opname-row-book-1506")).toHaveTextContent("0");
    // Finalize waits for every row.
    await expect(canvas.getByTestId("opname-detail-finalize")).toBeDisabled();
    await expect(canvas.getByTestId("opname-detail-finalize-wait")).toHaveTextContent("3 to go");
  },
};

export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("opname-detail-blocks")).toBeInTheDocument();
    await expect(canvas.queryByTestId("opname-detail-table")).toBeNull();
    // The actions fold into ⋯ on a phone.
    await expect(canvas.queryByTestId("opname-detail-cancel")).toBeNull();
    await expect(canvas.getByTestId("opname-detail-menu")).toBeInTheDocument();
  },
};

// A doubtful row goes back to counting: its count and its drafts are cleared (a-counted-row-is-read-only-until-sent-back).
export const SendBackToCount: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("opname-row-send-back-1503"));
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Send Back to Count" }));

    await waitFor(() => expect(within(canvas.getByTestId("opname-row-1503")).getByTestId("opname-row-state-created")).toBeInTheDocument());
    await expect(canvas.queryByTestId("opname-row-send-back-1503")).toBeNull();
  },
};

// Only the differences — the rows the second person has to read.
export const OnlyDifferences: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("opname-detail-only-differences"));
    await waitFor(() => expect(canvas.queryByTestId("opname-row-1503")).toBeNull());
    await expect(canvas.getByTestId("opname-row-1501")).toBeInTheDocument();
  },
};

// Every row of #21 is counted, so Finalize opens.
export const ReadyToFinalize: Story = {
  render: () => <RoutedReady />,
  beforeEach: asTeam(14n),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "2101");

    await expect(canvas.queryByTestId("opname-detail-finalize-wait")).toBeNull();
    await userEvent.click(canvas.getByTestId("opname-detail-finalize"));
    await canvas.findByTestId("at-session-finalize");
  },
};

// Staff never see the book before counting — the watch page is not theirs.
export const StaffAreTurnedAway: Story = {
  beforeEach: asRole(Role.WAREHOUSE_STAFF),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await canvas.findByTestId("opname-detail-forbidden", {}, { timeout: 4000 });
    await expect(canvas.queryByTestId("opname-row-book-1501")).toBeNull();
  },
};
