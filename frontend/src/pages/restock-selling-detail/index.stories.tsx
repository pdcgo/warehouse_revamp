import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { RestockRequestStatus } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { RestockSellingDetailPage } from "./index";

// ⚠ PROTOTYPE for implementation_analysis — the restock decisions (docs/business/inventory/restock_decision.md).
//
// One restock as Toko Melati (12), the selling team that raised it, sees it. The stub plays the decided rules
// (restockStub.ts): cancel and mark lost from ongoing only, edits by status, every change a trail row. The fixtures
// are one per status — 501 ongoing, 502 arrived (an edit row in its trail), 503 accepted (2 broken, 1 missing, a
// courier's charge of 5.000), 504 lost, 505 cancelled, 507 accepted with a DELETED store on its line.

function routedAt(id: bigint) {
  return routedPage(
    [
      { path: "/inventories/restock/:requestId", element: <RestockSellingDetailPage /> },
      marker("/inventories/restock/:requestId/edit", "at-restock-edit"),
      marker("/inventories/restock", "at-restock-list"),
    ],
    `/inventories/restock/${id}`,
  );
}

// Built ONCE, at module scope — a router built inside `render` is a fresh history on every re-render (pageStory.tsx).
const At501 = routedAt(501n);
const At502 = routedAt(502n);
const At503 = routedAt(503n);
const At504 = routedAt(504n);
const At505 = routedAt(505n);
const At507 = routedAt(507n);

const meta = {
  title: "Pages/Restock/RestockSellingDetail",
  component: At501,
  parameters: { signedIn: true, dataRouter: true, layout: "padded" },
  beforeEach: () => {
    asTeam(12n)();
    asRole(Role.SELLING_OWNER)();
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("restock-detail-page", {}, { timeout: 4000 });
  return canvas;
}

async function openTab(canvas: ReturnType<typeof within>, tab: "info" | "products" | "timeline") {
  await userEvent.click(canvas.getByTestId(`restock-detail-tab-${tab}`));
  await waitFor(() => expect(canvas.getByTestId(`restock-detail-tab-${tab}`)).toHaveAttribute("aria-selected", "true"));
}

async function expectStatus(canvas: ReturnType<typeof within>, status: RestockRequestStatus) {
  await waitFor(() =>
    expect(within(canvas.getByTestId("restock-detail-status")).getByTestId(`restock-status-${status}`)).toBeVisible(),
  );
}

// The action buttons in the header — `restock-action-<kind>-<id>`.
function actionsIn(canvasElement: HTMLElement): string[] {
  return [...canvasElement.querySelectorAll<HTMLElement>("[data-testid^='restock-action-']")].map(
    (el) => el.dataset.testid ?? "",
  );
}

function trailRows(canvasElement: HTMLElement): HTMLElement[] {
  return [...canvasElement.querySelectorAll<HTMLElement>("[data-testid^='restock-timeline-'][data-kind]")];
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Ongoing: Story = {};

export const Arrived: Story = { render: () => <At502 /> };

export const Accepted: Story = { render: () => <At503 /> };

export const AcceptedProducts: Story = {
  render: () => <At503 />,
  play: async ({ canvasElement }) => {
    await openTab(await loaded(canvasElement), "products");
  },
};

export const Lost: Story = { render: () => <At504 /> };

export const Cancelled: Story = { render: () => <At505 /> };

export const ArrivedTimeline: Story = {
  render: () => <At502 />,
  play: async ({ canvasElement }) => {
    await openTab(await loaded(canvasElement), "timeline");
  },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// the-warehouse-signs-and-accepts-the-team-does-the-rest — ongoing: Edit, Cancel, Mark Lost; never the warehouse's acts.
export const OngoingOffersEditCancelMarkLost: Story = {
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);

    await waitFor(() =>
      expect(actionsIn(canvasElement).sort()).toEqual(
        ["restock-action-cancel-501", "restock-action-edit-501", "restock-action-mark-lost-501"].sort(),
      ),
    );
  },
};

// the-lines-stay-editable-until-accepted — arrived: Edit Lines only. Cancel and Mark Lost are gone
// (a-restock-is-cancelled-only-while-ongoing, lost-is-set-only-before-the-box-arrives).
export const ArrivedOffersEditLinesOnly: Story = {
  render: () => <At502 />,
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);

    await waitFor(() => expect(actionsIn(canvasElement)).toEqual(["restock-action-edit-lines-502"]));
  },
};

// Edit Lines opens the SAME edit route — the form applies the arrived rules.
export const EditLinesOpensTheEditForm: Story = {
  render: () => <At502 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("restock-action-edit-lines-502"));
    await expect(await canvas.findByTestId("at-restock-edit")).toBeInTheDocument();
  },
};

// Accepted, lost and cancelled are records — no actions at all, not disabled ones.
export const ARecordOffersNothing: Story = {
  render: () => <At503 />,
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);
    await expect(actionsIn(canvasElement)).toEqual([]);
  },
};

export const LostOffersNothing: Story = {
  render: () => <At504 />,
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);
    await expect(actionsIn(canvasElement)).toEqual([]);
  },
};

// a-restock-names-its-paying-account — Cancel ASKS whether the money came back, will not run until it is answered, and
// the cancel lands in the trail.
export const CancelAsksAboutTheMoney: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openTab(canvas, "timeline");
    await waitFor(() => expect(trailRows(canvasElement)).toHaveLength(1));

    await userEvent.click(canvas.getByTestId("restock-action-cancel-501"));

    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await expect(screen.getByTestId("restock-cancel-money")).toBeVisible();
    await expect(confirm).toBeDisabled();

    await userEvent.click(screen.getByTestId("restock-cancel-money-yes"));
    await waitFor(() => expect(confirm).toBeEnabled());
    await userEvent.click(confirm);

    await expectStatus(canvas, RestockRequestStatus.CANCELLED);
    await waitFor(() => expect(trailRows(canvasElement)).toHaveLength(2));
    const row = trailRows(canvasElement)[1]!;
    await expect(row).toHaveTextContent("money returned");
    await expect(actionsIn(canvasElement)).toEqual([]);
  },
};

// lost-is-set-only-before-the-box-arrives — Mark Lost confirms, takes an optional reason, and moves 501 to lost.
export const MarkLostMovesItToLost: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("restock-action-mark-lost-501"));

    const reason = await screen.findByTestId("restock-lost-reason");
    await waitFor(() => expect(reason).toBeVisible());
    await userEvent.type(reason, "Kurir kehilangan paket", { delay: 20 });
    await userEvent.click(screen.getByTestId("confirm-action"));

    await expectStatus(canvas, RestockRequestStatus.LOST);
    await expect(actionsIn(canvasElement)).toEqual([]);

    await openTab(canvas, "timeline");
    await waitFor(() => expect(trailRows(canvasElement)).toHaveLength(2));
    await expect(trailRows(canvasElement)[1]).toHaveTextContent("Kurir kehilangan paket");
  },
};

// the-couriers-charge-stays-out-of-total — 503's total is goods 950.000 + shipping 30.000; the courier's 5.000 shows on
// its own, with its note, as owed to the warehouse (the-warehouse-cost-is-the-couriers-charge-at-the-door).
export const TheTotalLeavesOutTheCouriersCharge: Story = {
  render: () => <At503 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("restock-detail-subtotal")).toHaveTextContent("Rp 950.000");
    await expect(canvas.getByTestId("restock-detail-shipping")).toHaveTextContent("Rp 30.000");
    await expect(canvas.getByTestId("restock-detail-total")).toHaveTextContent("Rp 980.000");

    await expect(canvas.getByTestId("restock-detail-courier-charge")).toHaveTextContent("Rp 5.000");
    await expect(canvas.getByTestId("restock-detail-courier-charge-note")).toHaveTextContent("Ongkos bongkar di gudang");
  },
};

// Before it is accepted there is no charge to owe, so the card is not there at all.
export const NoCouriersChargeBeforeAccept: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("restock-detail-total")).toHaveTextContent("Rp 2.080.000");
    await expect(canvas.queryByTestId("restock-detail-courier-charge-card")).toBeNull();
  },
};

// The parcel and the payment: the courier by its shipment channel, the tracking number with a photo of the label, the
// paying account by name, the invoice.
export const TheParcelAndThePayment: Story = {
  render: () => <At503 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("restock-detail-paid-from")).toHaveTextContent("BCA Operasional"));
    await expect(canvas.getByTestId("restock-detail-invoice")).toHaveTextContent("INV/2026/09/0412");
    await expect(canvas.getByTestId("restock-detail-tracking")).toHaveTextContent("SCP5544332211");
    await expect(canvas.getByTestId("restock-detail-receipt-photo")).toHaveAttribute(
      "href",
      "https://example.test/labels/scp5544332211.jpg",
    );
    await waitFor(() => expect(canvas.getByTestId("restock-detail-courier")).toHaveTextContent("SiCepat"));
  },
};

// a-short-unit-at-the-door-is-missing — the column is MISSING, never Lost. 503's rice: 10 ordered, 9 in the box, 2 of
// them broken — so 7 good, 2 broken worth 130.000 with the warehouse's note, 1 missing worth 65.000
// (the-problem-price-is-filled-by-the-system).
export const TheMissingColumn: Story = {
  render: () => <At503 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openTab(canvas, "products");

    const table = canvas.getByTestId("restock-detail-items");
    await expect(canvas.getByTestId("restock-detail-col-missing")).toHaveTextContent("Missing");
    await expect(within(table).queryByRole("columnheader", { name: /^Lost/ })).toBeNull();

    await expect(canvas.getByTestId("restock-detail-received-74")).toHaveTextContent("9");
    await expect(canvas.getByTestId("restock-detail-good-74")).toHaveTextContent("7");
    await expect(canvas.getByTestId("restock-detail-broken-74-count")).toHaveTextContent("2");
    await expect(canvas.getByTestId("restock-detail-broken-74-value")).toHaveTextContent("Rp 130.000");
    await expect(canvas.getByTestId("restock-detail-broken-74-note")).toHaveTextContent("Karung sobek");
    await expect(canvas.getByTestId("restock-detail-missing-74-count")).toHaveTextContent("1");
    await expect(canvas.getByTestId("restock-detail-missing-74-value")).toHaveTextContent("Rp 65.000");
    await expect(canvas.getByTestId("restock-detail-missing")).toHaveTextContent("1 missing");
  },
};

// Before the count, the count columns are "—" — not counted yet — never the 0 the fields hold.
export const NotCountedYetReadsAsADash: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openTab(canvas, "products");

    await expect(canvas.getByTestId("restock-detail-received-74")).toHaveTextContent("—");
    await expect(canvas.getByTestId("restock-detail-missing-74")).toHaveTextContent("—");
  },
};

// a-deleted-supplier-still-shows-with-a-badge — 507's line was bought from a store deleted since: still named, badged.
export const ADeletedStoreKeepsItsName: Story = {
  render: () => <At507 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openTab(canvas, "products");

    const supplier = canvas.getByTestId("restock-detail-supplier-72");
    await waitFor(() => expect(within(supplier).getByTestId("deleted-badge")).toBeVisible());
    await expect(supplier).toHaveTextContent("PT Sumber Makmur");
  },
};

// Each line names its own supplier and store, or says it has none — a stall has a supplier and no store
// (a-line-may-name-a-supplier-without-a-channel).
export const EachLineNamesWhereItWasBought: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openTab(canvas, "products");

    await waitFor(() => expect(canvas.getByTestId("restock-detail-supplier-74")).toHaveTextContent("PT Sumber Makmur"));
    await expect(canvas.getByTestId("restock-detail-supplier-71")).toHaveTextContent("Toko Grosir Sinar");
    await expect(canvas.getByTestId("restock-detail-supplier-72")).toHaveTextContent("Not connected to a supplier");
  },
};

// edits-are-in-the-same-trail — 502's trail: raised, signed for, then the selling team's edit (status unchanged, the
// change in its description), and a waiting step at the end.
export const TheTrailShowsTheEdit: Story = {
  render: () => <At502 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openTab(canvas, "timeline");

    await waitFor(() => expect(trailRows(canvasElement)).toHaveLength(3));
    await expect(trailRows(canvasElement).map((row) => row.dataset.kind)).toEqual(["created", "status", "edit"]);

    const edit = trailRows(canvasElement)[2]!;
    await expect(edit).toHaveTextContent("10 → 12");
    await expect(edit).toHaveTextContent("Edited");
    // The status move is drawn on the status row, not on the edit — an edit keeps its status.
    await expect(within(trailRows(canvasElement)[1]!).getByTestId("restock-timeline-2-move")).toBeVisible();
    await waitFor(() => expect(within(edit).getByTestId("restock-timeline-3-by")).toHaveTextContent("Ani"));
    await expect(canvas.getByTestId("restock-timeline-awaiting")).toBeVisible();
  },
};

// The line's own note — the selling team's word on why there are 12 (extra-units-are-added-by-the-selling-teams-edit).
export const TheLineNote: Story = {
  render: () => <At502 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openTab(canvas, "products");

    await expect(canvas.getByTestId("restock-detail-line-note-71")).toHaveTextContent("extra stock");
  },
};
