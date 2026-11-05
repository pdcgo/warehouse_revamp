import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { patchRestock } from "../../../.storybook/restockStub";
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
  title: "Pages/Inventory/Restock/RestockSellingDetail",
  component: At501,
  // No "padded" layout: a page story is framed by its shell's gutter (a-page-story-has-its-shells-gutter).
  parameters: { signedIn: true, dataRouter: true },
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

// ONE PAGE OF SECTIONS now (the-restock-detail-is-the-product-pages-shape): every section is mounted, so "opening" one is
// a jump from the navigation — the nav item for it, as somebody reading the page would click.
async function openTab(canvas: ReturnType<typeof within>, tab: "info" | "products" | "timeline") {
  const key = tab === "info" ? "delivery" : tab;
  await userEvent.click(canvas.getByTestId(`section-nav-${key}`));
  await expect(canvas.getByTestId(`restock-detail-${tab === "info" ? "info" : tab === "products" ? "products" : "timeline"}`)).toBeInTheDocument();
}

async function expectStatus(canvas: ReturnType<typeof within>, status: RestockRequestStatus) {
  await waitFor(() =>
    expect(within(canvas.getByTestId("restock-detail-status")).getByTestId(`restock-status-${status}`)).toBeVisible(),
  );
}

// The action buttons in the header — `restock-action-<kind>-<id>`.
function actionsIn(canvasElement: HTMLElement): string[] {
  // The page's own — the sticky bar's copy of the same actions carries `-sticky`.
  return [...canvasElement.querySelectorAll<HTMLElement>("[data-testid^='restock-action-']")]
    .map((el) => el.dataset.testid ?? "")
    .filter((id) => !id.endsWith("-sticky"));
}

function trailRows(canvasElement: HTMLElement): HTMLElement[] {
  return [...canvasElement.querySelectorAll<HTMLElement>("[data-testid^='restock-timeline-'][data-kind]")];
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {};

// A PHONE (the-restock-detail-follows-the-screen-rules) — the header ONE row that stays: back, the number, the status,
// the actions (three, so one ⋯); the tabs across the top; the product lines as blocks.
export const Mobile: Story = {
  globals: { viewport: { value: "mobile1" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    // The section chips stick at the top; the title row carries the actions — three, so one ⋯.
    const strip = canvas.getByTestId("restock-detail-header");
    await expect(getComputedStyle(strip).position).toBe("sticky");
    await expect(within(strip).getByTestId("section-nav-strip")).toBeVisible();
    await expect(canvas.getByTestId("restock-actions-501")).toBeVisible();
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

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

// THE CANCEL WARNING IS MARKED (a-restock-cancel-warns-it-will-be-checked) — nothing checks a cancellation yet, so the
// warning carries its ⚠, the first of the page's list.
export const TheCancelWarningIsMarked: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("not-implemented-summary")).toBeVisible();
    await userEvent.click(canvas.getByTestId("restock-action-cancel-501"));
    const review = await screen.findByTestId("restock-cancel-review");
    await waitFor(() => expect(review).toBeVisible());
    await expect(within(review).getByTestId("not-implemented-cancelReview")).toHaveTextContent("1");
  },
};

// ONE NOTE PER WRITER (the-notes-are-one-per-writer) — the selling team's note, real, with who and when (⚠ derived: the
// restock's last raise or edit); the warehouse's, not stored yet (⚠ missing); and the system's voice is the Riwayat,
// whose edit rows should say what changed (⚠ missing). A record shows them too.
export const TheNotesAreOnePerWriter: Story = {
  render: () => <At503 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("not-implemented-summary")).toBeVisible();
    const selling = canvas.getByTestId("restock-detail-note-selling");
    await waitFor(() => expect(within(selling).getByTestId("restock-detail-note-selling-by")).toHaveTextContent(/^Ani Rahayu · /));
    // The broken photo is the page's second mark (in Produk, above), so the notes' are third and fifth.
    await expect(within(selling).getByTestId("not-implemented-sellingNoteBy")).toHaveTextContent("3");

    const warehouse = canvas.getByTestId("restock-detail-note-warehouse");
    await expect(warehouse).toHaveTextContent("No note from the warehouse yet.");
    await expect(within(warehouse).getByTestId("not-implemented-warehouseNote")).toHaveTextContent("5");

    await expect(within(canvas.getByTestId("restock-detail-timeline-section")).getByTestId("not-implemented-trailChanges")).toHaveTextContent("6");
  },
};

// THE NOTE IS EDITED ON THE PAGE TOO (owner: *"edit di detailnya?"*, the-note-is-edited-from-a-button) — Ubah in the
// Catatan section, the edit in place, saved and read again; the same SellingNote as the list's dialog.
export const TheNoteIsEditedOnThePage: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const section = canvas.getByTestId("restock-detail-note-section");

    await expect(within(section).getByTestId("restock-detail-note")).toHaveTextContent("Untuk promo 10.10");
    await userEvent.click(within(section).getByTestId("restock-notes-edit"));
    const input = await within(section).findByTestId("restock-notes-input");
    await expect(input).toHaveFocus();
    await userEvent.clear(input);
    await userEvent.type(input, "Urgent", { delay: 30 });
    await userEvent.click(within(section).getByTestId("restock-notes-save"));

    await waitFor(() => expect(within(section).getByTestId("restock-detail-note")).toHaveTextContent("Urgent"));
    await expect(within(section).queryByTestId("restock-notes-input")).toBeNull();
  },
};

// ON A PHONE THE EDIT IS A SHEET (owner: *"edit catatan di mobile tidak bagus"*, a-phone-edits-the-note-in-a-sheet) — Ubah
// opens a bottom sheet with the textarea focused and Batal | Simpan as two equal halves; nothing is edited in the page.
// Simpan shuts it, and the page reads the saved note.
export const OnAPhoneTheNoteIsEditedInASheet: Story = {
  globals: { viewport: { value: "mobile1" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const section = canvas.getByTestId("restock-detail-note-section");

    await userEvent.click(within(section).getByTestId("restock-notes-edit"));
    const sheet = await screen.findByTestId("restock-notes-sheet");
    await waitFor(() => expect(sheet).toBeVisible());
    await expect(within(section).queryByTestId("restock-notes-input")).toBeNull();

    const input = within(sheet).getByTestId("restock-notes-input");
    await waitFor(() => expect(input).toHaveFocus());

    // Two equal halves, together the sheet's width.
    const cancel = within(sheet).getByTestId("restock-notes-cancel-edit").getBoundingClientRect();
    const save = within(sheet).getByTestId("restock-notes-save").getBoundingClientRect();
    await expect(Math.abs(cancel.width - save.width)).toBeLessThan(2);
    await expect(cancel.width + save.width).toBeGreaterThan(sheet.getBoundingClientRect().width * 0.8);

    await userEvent.clear(input);
    await userEvent.type(input, "Urgent", { delay: 30 });
    await userEvent.click(within(sheet).getByTestId("restock-notes-save"));

    await waitFor(() => expect(screen.queryByTestId("restock-notes-sheet")).toBeNull());
    await waitFor(() => expect(within(section).getByTestId("restock-detail-note")).toHaveTextContent("Urgent"));
  },
};

// …and Batal shuts the sheet with the note as it was.
export const OnAPhoneBatalLeavesTheNote: Story = {
  globals: { viewport: { value: "mobile1" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const section = canvas.getByTestId("restock-detail-note-section");

    await userEvent.click(within(section).getByTestId("restock-notes-edit"));
    const sheet = await screen.findByTestId("restock-notes-sheet");
    await waitFor(() => expect(sheet).toBeVisible());
    await userEvent.type(within(sheet).getByTestId("restock-notes-input"), " lagi", { delay: 30 });
    await userEvent.click(within(sheet).getByTestId("restock-notes-cancel-edit"));

    await waitFor(() => expect(screen.queryByTestId("restock-notes-sheet")).toBeNull());
    await expect(within(section).getByTestId("restock-detail-note")).toHaveTextContent("Untuk promo 10.10");
  },
};

// …and a restock past its way still offers Ubah (the-note-is-edited-in-any-status) — marked, since the server does not
// keep the note once the box has arrived.
export const ARecordsNoteHasAMarkedUbah: Story = {
  render: () => <At503 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const section = canvas.getByTestId("restock-detail-note-section");

    await expect(within(section).getByTestId("restock-notes-edit")).toBeVisible();
    await expect(within(section).getByTestId("not-implemented-lateNote")).toHaveTextContent("4");
  },
};

// THE BAR WAITS FOR THE WHOLE TITLE ROW (owner, a screenshot: *"mobile heading bug seperti ini"*) — on a phone the status
// wraps under the order id and the tracking number sits under that; watching the heading alone showed the bar while those
// still stood below it, so both read twice. Scrolled a few pixels at a time: whenever the bar shows, nothing of the
// page's row is left under it — and it does show, once the row has gone.
export const OnAPhoneTheBarWaitsForTheWholeTitle: Story = {
  globals: { viewport: { value: "mobile1" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const bar = canvas.getByTestId("restock-detail-name-bar");
    const row = canvas.getByTestId("restock-detail-back").parentElement!;
    const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    let shownOnce = false;
    for (let y = 0; y <= 480; y += 6) {
      window.scrollTo(0, y);
      await frames();
      if (bar.dataset.shown) {
        shownOnce = true;
        await expect(row.getBoundingClientRect().bottom).toBeLessThanOrEqual(bar.getBoundingClientRect().bottom + 1);
      }
    }
    await expect(shownOnce).toBe(true);
    window.scrollTo(0, 0);
  },
};

// THE TIMELINE LINES UP (the-timeline-is-centred-and-lines-up) — each step's icon at the middle of its step, not its top;
// every person one width, so the rule beside them runs straight down; and the line runs from the first icon's centre to
// the last's, unbroken — not above the first, not short of the last (owner: *"garis riwayatnya masih belum ngikut"*).
export const TheTimelineLinesUp: Story = {
  render: () => <At502 />,
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);
    await waitFor(() => expect(trailRows(canvasElement).length).toBeGreaterThanOrEqual(3));
    const steps = trailRows(canvasElement);

    const widths = steps.map((step) => step.querySelector<HTMLElement>("[data-testid$='-by']")!.getBoundingClientRect().width);
    await expect(new Set(widths.map(Math.round)).size).toBe(1);

    for (const step of steps) {
      const indicator = step.querySelector<HTMLElement>(".chakra-timeline__indicator")!.getBoundingClientRect();
      const content = step.querySelector<HTMLElement>(".chakra-timeline__content")!;
      const box = content.getBoundingClientRect();
      const gap = parseFloat(getComputedStyle(content).paddingBottom);
      const middle = box.top + (box.height - gap) / 2;
      await expect(Math.abs(indicator.top + indicator.height / 2 - middle)).toBeLessThan(3);
    }

    // The line: every icon of the trail (the awaiting step's too), and every piece of line behind them.
    const timeline = canvasElement.querySelector<HTMLElement>("[data-testid='restock-detail-timeline']")!;
    const centres = [...timeline.querySelectorAll<HTMLElement>(".chakra-timeline__indicator")].map((el) => {
      const r = el.getBoundingClientRect();
      return r.top + r.height / 2;
    });
    const pieces = [...timeline.querySelectorAll<HTMLElement>(".chakra-timeline__separator")]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.height > 0)
      .sort((a, b) => a.top - b.top);
    await expect(Math.abs(pieces[0]!.top - centres[0]!)).toBeLessThan(2);
    await expect(Math.abs(pieces.at(-1)!.bottom - centres.at(-1)!)).toBeLessThan(2);
    for (let i = 1; i < pieces.length; i++) {
      await expect(Math.abs(pieces[i]!.top - pieces[i - 1]!.bottom)).toBeLessThan(2);
    }
  },
};

// The server's bare "edited" is not shown on an edit's row — it says nothing the row's title does not. 501 is given the
// row the server writes today: an edit, its description the one word.
export const ABareEditSaysNoMore: Story = {
  beforeEach: () =>
    patchRestock(501n, {
      logs: [
        { id: 1n, fromStatus: RestockRequestStatus.UNSPECIFIED, toStatus: RestockRequestStatus.ONGOING, actorUserId: 61n, description: "created", atUnix: 1_790_000_000n },
        { id: 2n, fromStatus: RestockRequestStatus.ONGOING, toStatus: RestockRequestStatus.ONGOING, actorUserId: 61n, description: "edited", atUnix: 1_790_003_600n },
      ],
    }),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const edit = canvas.getByTestId("restock-timeline-2");

    await expect(edit).toHaveAttribute("data-kind", "edit");
    await expect(within(edit).queryByTestId("restock-timeline-2-description")).toBeNull();
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
// them broken — so 7 good, 2 broken worth 132.333,33 with the warehouse's note, 1 missing worth 66.166,67. Each is the
// landed price, 650.000 ÷ 10 + (30.000 shipping + 5.000 courier's charge) ÷ 30 ordered = 66.166,67
// (the-problem-price-is-filled-by-the-system, all-qty-is-every-unit-ordered).
//
// THE COUNT IS ONE COLUMN, PENYESUAIAN (the-count-is-one-adjustment-column) — the good units and what went wrong as
// badges; its detail, every figure, opens in a dialog. The problem is MISSING (Kurang), never Lost.
export const TheMissingColumn: Story = {
  render: () => <At503 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openTab(canvas, "products");

    const table = canvas.getByTestId("restock-detail-items");
    const headings = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    await expect(headings).toEqual(["Product", "Supplier", "Ordered", "Adjustment", "Unit price", "Line total"]);

    const cell = canvas.getByTestId("restock-detail-adjustment-74");
    await expect(cell).toHaveTextContent(/Good 7.*Broken 2.*Missing 1/);
    await userEvent.click(cell);
    const dialog = await screen.findByTestId("restock-detail-adjustment-74-dialog");
    await waitFor(() => expect(dialog).toBeVisible());

    await expect(within(dialog).getByTestId("restock-detail-ordered-74")).toHaveTextContent("10");
    await expect(within(dialog).getByTestId("restock-detail-received-74")).toHaveTextContent("9");
    await expect(within(dialog).getByTestId("restock-detail-good-74")).toHaveTextContent("7");
    await expect(within(dialog).getByTestId("restock-detail-broken-74-count")).toHaveTextContent("2");
    await expect(within(dialog).getByTestId("restock-detail-broken-74-value")).toHaveTextContent("Rp 132.333");
    await expect(within(dialog).getByTestId("restock-detail-broken-74-note")).toHaveTextContent("Karung sobek");
    await expect(within(dialog).getByTestId("restock-detail-missing-74-count")).toHaveTextContent("1");
    await expect(within(dialog).getByTestId("restock-detail-missing-74-value")).toHaveTextContent("Rp 66.167");
    await expect(canvas.getByTestId("restock-detail-missing")).toHaveTextContent("1 missing");
  },
};

// THE BROKEN UNITS' PHOTO (a-broken-product-carries-a-photo) — under the broken row in the Penyesuaian dialog, a SAMPLE
// marked as one (the page's second mark); a line with nothing broken shows none.
export const TheBrokenRowShowsItsPhoto: Story = {
  render: () => <At503 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openTab(canvas, "products");

    await userEvent.click(canvas.getByTestId("restock-detail-adjustment-74"));
    const dialog = await screen.findByTestId("restock-detail-adjustment-74-dialog");
    await waitFor(() => expect(dialog).toBeVisible());

    const photo = within(dialog).getByTestId("restock-detail-broken-photo-74");
    await expect(within(photo).getByRole("img")).toHaveAttribute("src", expect.stringMatching(/^data:image\/svg\+xml/));
    await expect(within(photo).getByTestId("not-implemented-brokenPhoto")).toHaveTextContent("2");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("restock-detail-adjustment-74-dialog")).toBeNull());

    // The tea came as ordered — its cell opens nothing, and there is no photo for it anywhere.
    await expect(screen.queryByTestId("restock-detail-broken-photo-72")).toBeNull();
  },
};

// …and on a phone, a thumbnail in the line's block that opens the photo whole.
export const OnAPhoneTheBrokenPhotoIsAThumbnail: Story = {
  render: () => <At503 />,
  globals: { viewport: { value: "mobile1" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openTab(canvas, "products");

    const rice = canvas.getByTestId("restock-detail-item-74");
    await userEvent.click(within(rice).getByTestId("restock-detail-broken-photo-74-open"));
    const whole = await screen.findByTestId("restock-detail-broken-photo-74-dialog");
    await waitFor(() => expect(whole).toBeVisible());
    await expect(within(whole).getByRole("img")).toBeVisible();
  },
};

// Before the count, the adjustment is "—" — not counted yet — never the 0 the fields hold, and nothing to open.
export const NotCountedYetReadsAsADash: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openTab(canvas, "products");

    await expect(canvas.getByTestId("restock-detail-adjustment-74")).toHaveTextContent("—");
    await expect(canvas.getByTestId("restock-detail-adjustment-74").tagName).not.toBe("BUTTON");
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

    // An icon at the end of the product — its words in its name and its tooltip, so the cell stays two lines.
    const note = canvas.getByTestId("restock-detail-line-note-71");
    await expect(note).toHaveAccessibleName(/^Note: extra stock/);
    await userEvent.hover(note);
    const text = await screen.findByTestId("restock-detail-line-note-71-text");
    await waitFor(() => expect(text).toBeVisible());
    await expect(text).toHaveTextContent("extra stock");
  },
};

// ── The product page's shape (the-restock-detail-is-the-product-pages-shape) ───────────────────────────────────

// ONE PAGE, NO TABS — every section on it, the left column only the navigation; the ORDER ID is the title, copyable,
// with the tracking number under it; back is its icon; the restock's own number is not shown.
export const OnePageLedByTheOrderId: Story = {
  render: () => <At503 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByRole("tab")).toBeNull();
    for (const key of ["delivery", "payment", "courier", "products", "note", "timeline"]) {
      await expect(canvas.getByTestId(`section-nav-${key}`)).toBeVisible();
    }
    // The value alone, no label before it (the-title-is-the-reference-alone); the tracking number under it, labelled.
    await expect(canvas.getByTestId("restock-detail-title")).toHaveTextContent(/^INV\/2026\/09\/0412$/);
    await expect(canvas.getByTestId("restock-detail-tracking")).toHaveTextContent("SCP5544332211");
    await expect(canvas.getByTestId("restock-detail-page")).not.toHaveTextContent("#503");
    await expect(canvas.getByTestId("restock-detail-back")).toHaveTextContent("");
    await expect(canvas.getByTestId("restock-detail-back")).toHaveAccessibleName("Back to Restock");
  },
};

// THE ORDER ID IS OPTIONAL — with none, the tracking number leads, alone, and there is no second line to repeat it
// (the-title-is-the-reference-alone).
export const WithNoOrderIdTheTrackingNumberLeads: Story = {
  beforeEach: () => patchRestock(501n, { invoiceRefId: "" }),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("restock-detail-title")).toHaveTextContent(/^JNE0123456789$/);
    await expect(canvas.getByTestId("restock-detail-tracking-copy")).toHaveAccessibleName("Copy: JNE0123456789");
    await expect(canvas.getAllByTestId("restock-detail-tracking")).toHaveLength(1);
  },
};

// PEMBAYARAN IS A SMALL RECEIPT (payment-is-a-receipt-on-the-right) — which account, then each line's figure held right on
// its own row, the total last.
export const PaymentIsAReceipt: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const total = canvas.getByTestId("restock-detail-total");
    const label = within(canvas.getByTestId("restock-detail-payment")).getByText("Total");

    await expect(total).toHaveTextContent("Rp 2.080.000");
    await expect(Math.abs(total.getBoundingClientRect().top - label.getBoundingClientRect().top)).toBeLessThan(2);
    await expect(total.getBoundingClientRect().left).toBeGreaterThan(label.getBoundingClientRect().right);
  },
};

// The courier's charge is a section only once accepted — an ongoing restock's nav has no Ongkir COD.
export const OngkirCodIsASectionOnceAccepted: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.queryByTestId("section-nav-courier")).toBeNull();
  },
};

// ── The screen rules (the-restock-detail-follows-the-screen-rules) ─────────────────────────────────────────────

// ON A PHONE ONE ACTION IS ITS ICON (a-phone-header-action-is-an-icon) — arrived offers Edit Lines alone: its pencil,
// not a menu of one.
export const OnAPhoneOneActionIsItsIcon: Story = {
  render: () => <At502 />,
  globals: { viewport: { value: "mobile1" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("restock-action-edit-lines-502")).toHaveAccessibleName("Edit Lines");
    await expect(canvas.queryByTestId("restock-actions-502")).toBeNull();
  },
};

// ON A PHONE EACH LINE IS A BLOCK (a-phone-reads-each-line-as-a-block) — 503's rice: the product, where it was bought,
// 10 × the unit price beside the line's total, what came and was good, and each problem with its worth and note.
export const OnAPhoneEachLineIsABlock: Story = {
  render: () => <At503 />,
  globals: { viewport: { value: "mobile1" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openTab(canvas, "products");

    const items = canvas.getByTestId("restock-detail-items");
    await expect(within(items).queryAllByRole("columnheader")).toHaveLength(0);
    const rice = canvas.getByTestId("restock-detail-item-74");
    await expect(rice).toHaveTextContent(/10 × Rp/);
    await expect(within(rice).getByTestId("restock-detail-received-74")).toHaveTextContent("9");
    await expect(within(rice).getByTestId("restock-detail-good-74")).toHaveTextContent("7");
    await expect(within(rice).getByTestId("restock-detail-broken-74-note")).toHaveTextContent("Karung sobek");
    await expect(within(rice).getByTestId("restock-detail-missing-74-value")).toHaveTextContent("Rp 66.167");
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

// A PRODUCT ROW LIGHTS UP UNDER THE POINTER, every cell (a-table-row-lights-up); a line that came as ordered says so,
// in the success tone (the-count-is-one-adjustment-column).
export const AProductRowLightsUpAndStaysTwoLines: Story = {
  render: () => <At503 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openTab(canvas, "products");

    const row = canvas.getByTestId("restock-detail-item-74");
    const cells = within(row).getAllByRole("cell");
    const resting = getComputedStyle(cells[0]!).backgroundColor;
    row.setAttribute("data-hover", "");
    await waitFor(() => expect(getComputedStyle(cells[0]!).backgroundColor).not.toBe(resting));

    // 503's tea came as ordered.
    await expect(canvas.getByTestId("restock-detail-adjustment-72")).toHaveTextContent("As ordered");
  },
};

// THE REFERENCES COPY (the-restock-list-leads-with-its-references) — the invoice and the tracking number, as on the list.
export const TheReferencesCopy: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("restock-detail-invoice-copy")).toHaveAccessibleName(/^Copy: INV\//);
    await expect(canvas.getByTestId("restock-detail-tracking-copy")).toHaveAccessibleName("Copy: JNE0123456789");
  },
};
