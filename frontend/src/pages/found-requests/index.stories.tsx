import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, asTeam, routedPage } from "../../../.storybook/pageStory";
import { asAdminTeam, asRole } from "../../../.storybook/sessionScenario";
import { foundRequestsNoneWaiting } from "../../../.storybook/foundRequestStub";
import { FoundRequestStatus } from "../../gen/warehouse/inventory/v1/found_request_pb";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { FoundRequestsPage } from "./index";

// FOUND STOCK — the approval list of an-adjust-found-waits-for-the-owner-or-admin. foundRequestStub.ts plays the
// server's rules (inventory_v1/found_request_*.go).
//
// Gudang Pusat (11). The signed-in person is Ani, the warehouse Admin here (foundRequestFixtures.ts):
//
//   #302  Minyak ×1 on B-02-1           reported by ANI — she may not approve it (nobody-finalizes-their-own-count),
//                                       and may withdraw it (the-reporter-may-withdraw-their-found)
//   #301  Beras ×4 on B-02-1            claims loss #91 (2 @ 62.000) then #95 (1 @ 65.000), mints 1 @ 65.000
//   #303  Gula Pasir ×2 on A-01-2       stock count #15 holds it there — not yet
//   history: #290 approved (transaction #4810), #288 withdrawn by Ani, #286 settled by count #12, #285 rejected

const Routed = routedPage(
  [
    {
      path: "/inventories/found-stock",
      element: (
        <>
          <FoundRequestsPage />
          <LocationProbe />
        </>
      ),
    },
  ],
  "/inventories/found-stock",
);

const meta = {
  title: "Pages/Inventory/FoundStock",
  component: Routed,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: () => {
    asTeam(11n)();
    asRole(Role.WAREHOUSE_ADMIN)();
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement, first = "found-request-301") {
  const canvas = within(canvasElement);
  await canvas.findByTestId(first, {}, { timeout: 4000 });
  return canvas;
}

const card = (canvas: ReturnType<typeof within>, id: string) => within(canvas.getByTestId(`found-request-${id}`));

// Waiting first: each request says what was found where, by whom, its note — and what approving it would post.
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // Newest report first.
    const order = within(canvas.getByTestId("found-requests-list"))
      .getAllByTestId(/^found-request-\d+$/)
      .map((el) => el.dataset.testid);
    await expect(order).toEqual(["found-request-302", "found-request-301", "found-request-303"]);

    const beras = card(canvas, "301");
    await expect(beras.getByTestId("found-request-units-301")).toHaveTextContent("4 units on B-02-1");
    await expect(beras.getByTestId("found-request-reported-301")).toHaveTextContent("Reported by Budi Santoso");
    await expect(beras.getByTestId("found-request-note-301")).toHaveTextContent("Behind the cartons on the bottom shelf");
    // The oldest loss first, back into its batch at its price — then the rest minted at the newest price here.
    await expect(beras.getByTestId("found-request-line-301-0")).toHaveTextContent("#7 · loss #91");
    await expect(beras.getByTestId("found-request-line-301-0")).toHaveTextContent("Rp 62.000");
    await expect(beras.getByTestId("found-request-line-301-1")).toHaveTextContent("#9 · loss #95");
    await expect(beras.getByTestId("found-request-line-301-2")).toHaveTextContent("New batch");
    await expect(beras.getByTestId("found-request-line-301-2")).toHaveTextContent("Rp 65.000");
    await expect(beras.getByTestId("found-request-claimed-301")).toHaveTextContent("Claimed back Rp 189.000");
    await expect(beras.getByTestId("found-request-minted-301")).toHaveTextContent("New stock Rp 65.000");
    await expect(beras.getByTestId("found-request-approve-301")).toBeEnabled();
  },
};

// A phone reads each posting line as a block, not a squeezed table.
export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const beras = card(canvas, "301");

    await expect(beras.getByTestId("found-request-line-301-0")).toHaveTextContent("2 × Rp 62.000");
    await expect(beras.queryByRole("table")).toBeNull();
  },
};

// Approving confirms what posts, then posts it: the losses claimed back, the rest minted as a batch of its own.
export const ApproveClaimsTheOldestLossFirst: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("found-request-approve-301"));
    const dialog = await screen.findByRole("alertdialog");
    await expect(dialog).toHaveTextContent("Approve Found Stock #301");
    await expect(dialog).toHaveTextContent("claimed back Rp 189.000, new stock Rp 65.000");
    await userEvent.click(within(dialog).getByTestId("confirm-action"));

    await expect(await screen.findByText("Found stock #301 approved — transaction #5100")).toBeInTheDocument();
    await waitFor(() => expect(canvas.queryByTestId("found-request-301")).toBeNull());

    // The history keeps what it posted.
    await userEvent.click(canvas.getByTestId("found-requests-tab-approved"));
    const approved = within(await canvas.findByTestId("found-request-301"));
    await expect(approved.getByTestId("found-request-decided-301")).toHaveTextContent("Approved by Ani Rahayu");
    await expect(approved.getByTestId("found-request-lines-301")).toHaveTextContent("Posted in transaction #5100");
    await expect(approved.getByTestId("found-request-line-301-2")).toHaveTextContent("New batch #100");
  },
};

// The person who reported it never approves it — checked against the person, not the role. Approve is off, and says why.
// They may WITHDRAW it (the-reporter-may-withdraw-their-found): a rejection with a reason, said as theirs.
export const TheReporterCannotApproveButMayWithdraw: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const own = card(canvas, "302");

    await expect(own.getByTestId("found-request-approve-302")).toBeDisabled();
    await expect(own.getByTestId("found-request-block-302")).toHaveTextContent(
      "You reported it — another Owner or Admin approves it.",
    );
    // Clicking the disabled button reaches nothing.
    await userEvent.click(own.getByTestId("found-request-approve-302"), { pointerEventsCheck: 0 });
    await expect(screen.queryByRole("alertdialog")).toBeNull();

    const withdraw = own.getByTestId("found-request-reject-302");
    await expect(withdraw).toHaveTextContent("Withdraw");
    await userEvent.click(withdraw);
    const dialog = await screen.findByRole("alertdialog");
    await expect(dialog).toHaveTextContent("Withdraw Found Stock #302");
    await expect(within(dialog).getByTestId("confirm-action")).toBeDisabled();
    await userEvent.type(within(dialog).getByTestId("found-request-reject-reason"), "It was Rak A's", { delay: 20 });
    await userEvent.click(within(dialog).getByTestId("confirm-action"));

    await expect(await screen.findByText("Found stock #302 withdrawn")).toBeInTheDocument();
    await userEvent.click(canvas.getByTestId("found-requests-tab-rejected"));
    const withdrawn = within(await canvas.findByTestId("found-request-302"));
    await expect(withdrawn.getByTestId(`found-request-status-${FoundRequestStatus.REJECTED}`)).toHaveTextContent("Withdrawn");
    await expect(withdrawn.getByTestId("found-request-decided-302")).toHaveTextContent("Withdrawn by Ani Rahayu");
  },
};

// A count holding the product on the rack: the approval waits for it (a-lock-stops-sales-and-cancels-too).
export const ACountedProductWaitsForTheCount: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const counted = card(canvas, "303");

    await expect(counted.getByTestId("found-request-approve-303")).toBeDisabled();
    await expect(counted.getByTestId("found-request-block-303")).toHaveTextContent(
      "Stock count #15 is counting this product on A-01-2 — approve it once the count is finalized or cancelled.",
    );
  },
};

// Reject is destructive: it confirms, and it needs a reason — the reporter reads it. Nothing posts.
export const RejectNeedsAReason: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("found-request-reject-301"));
    const dialog = await screen.findByRole("alertdialog");
    await expect(dialog).toHaveTextContent("Reject Found Stock #301");
    await expect(dialog).toHaveTextContent("Budi Santoso, who reported it, reads your reason.");
    await expect(within(dialog).getByTestId("confirm-action")).toBeDisabled();

    await userEvent.type(within(dialog).getByTestId("found-request-reject-reason"), "Order parcel, not stock", { delay: 20 });
    await expect(within(dialog).getByTestId("confirm-action")).toBeEnabled();
    await userEvent.click(within(dialog).getByTestId("confirm-action"));

    await expect(await screen.findByText("Found stock #301 rejected")).toBeInTheDocument();
    await waitFor(() => expect(canvas.queryByTestId("found-request-301")).toBeNull());

    await userEvent.click(canvas.getByTestId("found-requests-tab-rejected"));
    const rejected = within(await canvas.findByTestId("found-request-301"));
    await expect(rejected.getByTestId("found-request-reject-reason-301")).toHaveTextContent("Why: Order parcel, not stock");
    await expect(rejected.queryByTestId("found-request-lines-301")).toBeNull();
  },
};

// The history filter: approved ones keep their transaction and lines, rejected ones their reason. The tab lives in the
// URL (a-lists-filters-live-in-the-url), and nothing there can be decided again.
export const TheHistory: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("found-requests-tab-approved"));
    const approved = within(await canvas.findByTestId("found-request-290"));
    await expect(approved.getByTestId("found-request-lines-290")).toHaveTextContent("Posted in transaction #4810");
    await expect(approved.getByTestId("found-request-decided-290")).toHaveTextContent("Approved by Dewi Lestari");
    await expect(approved.queryByTestId("found-request-approve-290")).toBeNull();
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("?status=approved"));

    await userEvent.click(canvas.getByTestId("found-requests-tab-rejected"));
    const rejected = within(await canvas.findByTestId("found-request-285"));
    await expect(rejected.getByTestId("found-request-reject-reason-285")).toHaveTextContent("Order #900's parcel");
    await expect(rejected.queryByTestId("found-request-reject-285")).toBeNull();
    // A reporter's own rejection reads as their withdrawal.
    await expect(canvas.getByTestId("found-request-decided-288")).toHaveTextContent("Withdrawn by Ani Rahayu");

    // Under All, the one a stock count settled names the count and links to it (a-count-settles-the-found-it-counted).
    await userEvent.click(canvas.getByTestId("found-requests-tab-all"));
    const settled = within(await canvas.findByTestId("found-request-286"));
    await expect(settled.getByTestId(`found-request-status-${FoundRequestStatus.SETTLED_BY_COUNT}`)).toHaveTextContent(
      "Settled by count",
    );
    const link = settled.getByTestId("found-request-settled-link-286");
    await expect(link).toHaveTextContent("Settled by count #12");
    await expect(link).toHaveAttribute("href", "/inventories/opname/sessions/12");
    await expect(settled.getByTestId("found-request-decided-286")).toHaveTextContent("Closed by Dewi Lestari's finalize");
    await expect(settled.queryByTestId("found-request-lines-286")).toBeNull();
    await expect(settled.queryByTestId("found-request-approve-286")).toBeNull();
  },
};

// Nothing waiting: the empty hint says what lands here.
export const NothingWaiting: Story = {
  beforeEach: foundRequestsNoneWaiting,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("found-requests-empty", {}, { timeout: 4000 })).toHaveTextContent(
      "Nothing is waiting",
    );
  },
};

// The admin team monitors read-only: every request and what it would post, and no Approve or Reject.
export const AMonitorDecidesNothing: Story = {
  beforeEach: asAdminTeam(),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("found-request-lines-301")).toBeInTheDocument();
    await expect(canvas.queryByTestId("found-request-approve-301")).toBeNull();
    await expect(canvas.queryByTestId("found-request-reject-301")).toBeNull();
  },
};

// STAFF SEE AND WITHDRAW THEIR OWN (staff-may-report-a-found, the-reporter-may-withdraw-their-found): the server hands
// them only what they reported; they approve nothing and may withdraw a waiting one. Accepted 2026-11-03 (the-staff-found-screens-are-accepted).
export const StaffSeeAndWithdrawTheirOwn: Story = {
  beforeEach: asRole(Role.WAREHOUSE_STAFF),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "found-request-302");

    const order = within(canvas.getByTestId("found-requests-list"))
      .getAllByTestId(/^found-request-\d+$/)
      .map((el) => el.dataset.testid);
    await expect(order).toEqual(["found-request-302"]);

    const own = card(canvas, "302");
    await expect(own.queryByTestId("found-request-approve-302")).toBeNull();
    await userEvent.click(own.getByTestId("found-request-reject-302"));
    const dialog = await screen.findByRole("alertdialog");
    await expect(dialog).toHaveTextContent("Withdraw Found Stock #302");
    await userEvent.type(within(dialog).getByTestId("found-request-reject-reason"), "Counted it twice", { delay: 20 });
    await userEvent.click(within(dialog).getByTestId("confirm-action"));
    // Withdrawn, it leaves the Waiting tab.
    await waitFor(() => expect(canvas.queryByTestId("found-request-302")).toBeNull());

    // Their history is their own too: the two Ani reported, nobody else's.
    await userEvent.click(canvas.getByTestId("found-requests-tab-all"));
    await waitFor(() =>
      expect(
        within(canvas.getByTestId("found-requests-list"))
          .getAllByTestId(/^found-request-\d+$/)
          .map((el) => el.dataset.testid),
      ).toEqual(["found-request-302", "found-request-288"]),
    );
  },
};

// A selling team's people never read a warehouse's found stock — told so, and nothing is read for them.
export const NotForASellingRole: Story = {
  beforeEach: asRole(Role.SELLING_OWNER),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("found-requests-not-for-you")).toHaveTextContent(
      "Found stock is the warehouse's — its Owner, Admin and Staff read it.",
    );
    await expect(canvas.queryByTestId("found-requests-list")).toBeNull();
  },
};
