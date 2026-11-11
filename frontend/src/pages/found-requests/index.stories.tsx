import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, asTeam, routedPage } from "../../../.storybook/pageStory";
import { asAdminTeam, asRole } from "../../../.storybook/sessionScenario";
import { foundRequestsNoneWaiting } from "../../../.storybook/foundRequestStub";
import { FoundRequestStatus } from "../../gen/warehouse/inventory/v1/found_request_pb";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { FoundRequestsPage } from "./index";

// FOUND STOCK — the approval list of an-adjust-found-waits-for-the-owner-or-admin. foundRequestStub.ts plays the
// server's rules (inventory_v1/found_request_*.go). A TABLE, one request a row, its note and its posting lines behind a
// click on the row (the-found-list-is-a-table).
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

const row = (canvas: ReturnType<typeof within>, id: string) => within(canvas.getByTestId(`found-request-${id}`));

const rowIds = (canvas: ReturnType<typeof within>) =>
  within(canvas.getByTestId("found-requests-list"))
    .getAllByTestId(/^found-request-\d+$/)
    .map((el) => el.dataset.testid);

/** Opens a request's Rincian by clicking its row — a dialog on a desktop, a sheet on a phone. */
async function openDetail(canvas: ReturnType<typeof within>, id: string) {
  await userEvent.click(canvas.getByTestId(`found-request-${id}`));
  const detail = await screen.findByTestId("found-detail");
  await waitFor(() => expect(detail).toBeVisible());
  return within(detail);
}

// ONE REQUEST A ROW (the-found-list-is-a-table) — the reference with its status under it, the product with its picture
// and code, whose goods, what was found where, who reported it, and what approving it would post; Setujui and Tolak at
// its end. Two lines a row, not a card that opened everything (owner: *"desainnya kok gemuk begini"*).
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // Newest report first.
    await expect(rowIds(canvas)).toEqual(["found-request-302", "found-request-301", "found-request-303"]);

    const beras = row(canvas, "301");
    // THE PRODUCT AS EVERY LIST SHOWS ONE (the-found-list-follows-the-screen-rules) — its picture, its name, its code to
    // copy; whose goods they are as the small avatar and the name, no type badge (a-team-of-a-known-type-shows-no-badge).
    const product = beras.getByTestId("product-list-item-74");
    await expect(product).toHaveTextContent("Beras Pandan Wangi 5kg");
    await expect(beras.getByTestId("product-list-item-sku-74")).toHaveTextContent("SKU-BERAS-5K");
    await waitFor(() => expect(within(product).getByRole("img")).toHaveAttribute("src", expect.stringMatching(/^data:image/)));
    const owner = beras.getByTestId("found-request-owner-301");
    await waitFor(() => expect(owner).toHaveTextContent("Toko Melati"));
    await expect(owner).not.toHaveTextContent("Selling");

    await expect(beras.getByTestId("found-request-units-301")).toHaveTextContent("4 units");
    await expect(beras.getByTestId("found-request-units-301")).toHaveTextContent("B-02-1");
    await expect(beras.getByTestId("found-request-reported-301")).toHaveTextContent("Budi Santoso");
    await expect(beras.getByTestId("found-request-claimed-301")).toHaveTextContent("Claimed back Rp 189.000");
    await expect(beras.getByTestId("found-request-minted-301")).toHaveTextContent("New stock Rp 65.000");
    await expect(beras.getByTestId("found-request-approve-301")).toBeEnabled();
    // The note and the posting lines are the Rincian's, not the row's.
    await expect(beras.queryByText("Behind the cartons on the bottom shelf")).toBeNull();
    // Nothing is decided yet, so there is no Decided column.
    await expect(canvas.queryByRole("columnheader", { name: "Decided" })).toBeNull();

    // A ROW IS A ROW — a product's two lines, never the twelve of the card it replaced.
    await expect(canvas.getByTestId("found-request-301").getBoundingClientRect().height).toBeLessThan(110);

    // THE TAB ROW DOES NOT SCROLL (the-found-tab-row-never-scrolls) — nothing past its height, so no bar beside the tabs.
    const tabs = canvas.getByTestId("found-requests-tabs");
    await expect(getComputedStyle(tabs).overflowY).toBe("hidden");
    await expect(tabs.scrollWidth).toBeLessThanOrEqual(tabs.clientWidth);
  },
};

// A PHONE (every-page-has-a-mobile-story) — each request is a block (a-phone-reads-each-line-as-a-block), and its Rincian
// a sheet from the bottom whose posting lines are blocks too; nothing runs past the screen's edge.
export const Mobile: Story = {
  name: "Mobile",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByRole("table")).toBeNull();
    await expect(row(canvas, "301").getByTestId("found-request-units-301")).toHaveTextContent("4 units · B-02-1");
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);

    const detail = await openDetail(canvas, "301");
    await expect(detail.getByTestId("found-detail-line-0")).toHaveTextContent("2 × Rp 62.000");
    await expect(detail.queryByRole("table")).toBeNull();
  },
};

// THE RINCIAN — a click on the row opens what it leaves out: the reporter's note, and what approving posts line by line,
// the oldest loss first back into its batch at its price, then the rest minted at the newest price here. Setujui at its
// foot shuts it and asks to confirm.
export const TheRincian: Story = {
  name: "Rincian",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const detail = await openDetail(canvas, "301");
    await expect(screen.getByTestId("found-detail")).toHaveTextContent("Found #301 Details");
    await expect(detail.getByTestId("found-detail-units")).toHaveTextContent("4 units on B-02-1");
    await expect(detail.getByTestId("found-detail-reported")).toHaveTextContent("Reported by Budi Santoso");
    await expect(detail.getByTestId("found-detail-note")).toHaveTextContent("Behind the cartons on the bottom shelf");
    await expect(detail.getByTestId("found-detail-lines")).toHaveTextContent("If approved");
    await expect(detail.getByTestId("found-detail-line-0")).toHaveTextContent("#7 · loss #91");
    await expect(detail.getByTestId("found-detail-line-0")).toHaveTextContent("Rp 62.000");
    await expect(detail.getByTestId("found-detail-line-1")).toHaveTextContent("#9 · loss #95");
    await expect(detail.getByTestId("found-detail-line-2")).toHaveTextContent("New batch");
    await expect(detail.getByTestId("found-detail-line-2")).toHaveTextContent("Rp 65.000");

    await userEvent.click(detail.getByTestId("found-detail-approve"));
    const confirm = await screen.findByRole("alertdialog");
    await expect(confirm).toHaveTextContent("Approve Found Stock #301");
    await waitFor(() => expect(screen.queryByTestId("found-detail")).toBeNull());
  },
};

// Approving confirms what posts, then posts it: the losses claimed back, the rest minted as a batch of its own.
export const ApproveClaimsTheOldestLossFirst: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("found-request-approve-301"));
    // A click on the row's button never opens the row.
    await expect(screen.queryByTestId("found-detail")).toBeNull();
    const dialog = await screen.findByRole("alertdialog");
    await expect(dialog).toHaveTextContent("Approve Found Stock #301");
    await expect(dialog).toHaveTextContent("claimed back Rp 189.000, new stock Rp 65.000");
    await userEvent.click(within(dialog).getByTestId("confirm-action"));

    await expect(await screen.findByText("Found stock #301 approved — transaction #5100")).toBeInTheDocument();
    await waitFor(() => expect(canvas.queryByTestId("found-request-301")).toBeNull());

    // The history keeps who decided, and what it posted.
    await userEvent.click(canvas.getByTestId("found-requests-tab-approved"));
    await canvas.findByTestId("found-request-301");
    await expect(row(canvas, "301").getByTestId("found-request-decided-301")).toHaveTextContent("Ani Rahayu");
    const detail = await openDetail(canvas, "301");
    await expect(detail.getByTestId("found-detail-decided")).toHaveTextContent("Approved by Ani Rahayu");
    await expect(detail.getByTestId("found-detail-lines")).toHaveTextContent("Posted in transaction #5100");
    await expect(detail.getByTestId("found-detail-line-2")).toHaveTextContent("New batch #100");
  },
};

// The person who reported it never approves it — checked against the person, not the role. Approve is off, and says why,
// under it. They may WITHDRAW it (the-reporter-may-withdraw-their-found): a rejection with a reason, said as theirs.
export const TheReporterCannotApproveButMayWithdraw: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const own = row(canvas, "302");

    await expect(own.getByTestId("found-request-approve-302")).toBeDisabled();
    await expect(own.getByTestId("found-request-block-302")).toHaveTextContent(
      "You reported it — another Owner or Admin approves it.",
    );
    // Clicking the disabled button reaches nothing — neither the write nor the row.
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
    await canvas.findByTestId("found-request-302");
    const withdrawn = row(canvas, "302");
    await expect(withdrawn.getByTestId(`found-request-status-${FoundRequestStatus.REJECTED}`)).toHaveTextContent("Withdrawn");
    await expect(withdrawn.getByTestId("found-request-decided-302")).toHaveTextContent("Ani Rahayu");
  },
};

// A count holding the product on the rack: the approval waits for it (a-lock-stops-sales-and-cancels-too).
export const ACountedProductWaitsForTheCount: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const counted = row(canvas, "303");

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

    // A rejected row shows why, where an approved one shows its money — and posts nothing.
    await userEvent.click(canvas.getByTestId("found-requests-tab-rejected"));
    await canvas.findByTestId("found-request-301");
    const rejected = row(canvas, "301");
    await expect(rejected.getByTestId("found-request-reject-reason-301")).toHaveTextContent("Why: Order parcel, not stock");
    await expect(rejected.queryByTestId("found-request-claimed-301")).toBeNull();
  },
};

// The history filter: approved ones keep their transaction and lines, rejected ones their reason. The tab lives in the
// URL (a-lists-filters-live-in-the-url), and nothing there can be decided again.
export const TheHistory: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("found-requests-tab-approved"));
    await canvas.findByTestId("found-request-290");
    await expect(row(canvas, "290").getByTestId("found-request-decided-290")).toHaveTextContent("Dewi Lestari");
    await expect(row(canvas, "290").queryByTestId("found-request-approve-290")).toBeNull();
    await expect(canvas.getByRole("columnheader", { name: "Decided" })).toBeInTheDocument();
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("?status=approved"));
    const approved = await openDetail(canvas, "290");
    await expect(approved.getByTestId("found-detail-lines")).toHaveTextContent("Posted in transaction #4810");
    await expect(approved.queryByTestId("found-detail-approve")).toBeNull();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("found-detail")).toBeNull());

    await userEvent.click(canvas.getByTestId("found-requests-tab-rejected"));
    await canvas.findByTestId("found-request-285");
    await expect(row(canvas, "285").getByTestId("found-request-reject-reason-285")).toHaveTextContent("Order #900's parcel");
    await expect(row(canvas, "285").queryByTestId("found-request-reject-285")).toBeNull();
    // A reporter's own rejection reads as their withdrawal.
    await expect(row(canvas, "288").getByTestId(`found-request-status-${FoundRequestStatus.REJECTED}`)).toHaveTextContent(
      "Withdrawn",
    );
    await expect(row(canvas, "288").getByTestId("found-request-decided-288")).toHaveTextContent("Ani Rahayu");

    // Under All, the one a stock count settled names the count and links to it (a-count-settles-the-found-it-counted).
    await userEvent.click(canvas.getByTestId("found-requests-tab-all"));
    await canvas.findByTestId("found-request-286");
    const settled = row(canvas, "286");
    await expect(settled.getByTestId(`found-request-status-${FoundRequestStatus.SETTLED_BY_COUNT}`)).toHaveTextContent(
      "Settled by count",
    );
    const link = settled.getByTestId("found-request-settled-link-286");
    await expect(link).toHaveTextContent("Settled by count #12");
    await expect(link).toHaveAttribute("href", "/inventories/opname/sessions/12");
    const detail = await openDetail(canvas, "286");
    await expect(detail.getByTestId("found-detail-decided")).toHaveTextContent("Closed by Dewi Lestari's finalize");
    await expect(detail.getByTestId("found-detail-settled-link")).toHaveAttribute("href", "/inventories/opname/sessions/12");
    await expect(detail.queryByTestId("found-detail-lines")).toBeNull();
    await expect(detail.queryByTestId("found-detail-approve")).toBeNull();
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

// The admin team monitors read-only: every request and what it would post, and no Approve or Reject — not on the row, not
// in the Rincian, and no Actions column.
export const AMonitorDecidesNothing: Story = {
  beforeEach: asAdminTeam(),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("found-request-claimed-301")).toBeInTheDocument();
    await expect(canvas.queryByTestId("found-request-approve-301")).toBeNull();
    await expect(canvas.queryByTestId("found-request-reject-301")).toBeNull();
    await expect(canvas.queryByRole("columnheader", { name: "Actions" })).toBeNull();

    const detail = await openDetail(canvas, "301");
    await expect(detail.getByTestId("found-detail-lines")).toBeInTheDocument();
    await expect(screen.queryByTestId("found-detail-approve")).toBeNull();
    await expect(screen.queryByTestId("found-detail-reject")).toBeNull();
  },
};

// STAFF SEE AND WITHDRAW THEIR OWN (staff-may-report-a-found, the-reporter-may-withdraw-their-found): the server hands
// them only what they reported; they approve nothing and may withdraw a waiting one. Accepted 2026-11-03 (the-staff-found-screens-are-accepted).
export const StaffSeeAndWithdrawTheirOwn: Story = {
  beforeEach: asRole(Role.WAREHOUSE_STAFF),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "found-request-302");

    await expect(rowIds(canvas)).toEqual(["found-request-302"]);

    const own = row(canvas, "302");
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
    await waitFor(() => expect(rowIds(canvas)).toEqual(["found-request-302", "found-request-288"]));
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
