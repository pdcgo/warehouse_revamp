import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { orderDrafts, orders, products, shops, users } from "../../../../.storybook/fixtures";
import {
  duplicateRefScenario,
  withFailingRefLookup,
  withRefDrafts,
  withRefOrders,
} from "../../../../.storybook/duplicateRefStub";
import { OrderStatus } from "../../../gen/warehouse/selling/v1/order_pb";
import { formatUnixDate } from "../../../lib/datetime";
import {
  ORDER_CREATE_META,
  RoutedFromDraft202,
  asMelatiWithMaps,
  fillPlaceableOrder,
  mapDraftLines,
  passTheChecks,
} from "./kit";

// ORDER CREATE — the duplicate marketplace ref: a live order or a draft on this shop + ref is named before Create, and
// Create Anyway or Go Back is the person's call.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Order/OrderCreate/DuplicateRef",
  ...ORDER_CREATE_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// ── The duplicate marketplace ref (a-duplicate-ref-is-warned-not-refused) ─────────────────────────────────────────────
//
// Before Create — a new order or a draft being finalized — the form asks OrderByExternalRefs and
// OrderDraftByExternalRefs whether this shop and ref are already recorded. A live order or a draft on them is NAMED in a
// warning with Create Anyway and Go Back; a cancelled order, another shop's, or the draft being finalized is not;
// nothing found goes straight through. The server refuses nothing for a repeated ref.
//
// ⚠ THE NEW-ORDER STORIES RUN AS THE FIRST MEMBERSHIP, Gudang Pusat (11), like every other new-order story of this
// page — the product picker's fixtures are read from there. The lookup answers only the CALLER's team's orders (the
// handler's `team_id = ?`), so each story puts the order it needs on a ref for that team: order 101 — pending, typed in
// yesterday — on SP-2409-8841 in Melati Official (shops[0]).
const STORY_TEAM = 11n;
const LIVE_REF = "SP-2409-8841";
const LIVE_ORDER = orders.find((o) => o.id === 101n)!;
const onLiveRef = withRefOrders({
  orderId: LIVE_ORDER.id,
  teamId: STORY_TEAM,
  shopId: shops[0]!.id,
  ref: LIVE_REF,
  status: OrderStatus.PENDING,
});

async function warning() {
  const dialog = await screen.findByTestId("duplicate-ref-dialog", {}, { timeout: 4000 });
  await waitFor(() => expect(dialog).toBeVisible());

  return dialog;
}

// NOTHING ON THE REF → NO DIALOG AT ALL. TK-88120347 IS recorded — order 102, in Melati STORE — but not in this shop,
// and another shop's order is not this one's double: the lookup runs once, and Create goes straight to the order.
export const NoDuplicateCreatesStraightAway: Story = {
  name: "No duplicate",
  beforeEach: withRefOrders({ orderId: 102n, teamId: STORY_TEAM, shopId: 22n, ref: "TK-88120347", status: OrderStatus.PENDING }),
  play: async ({ canvasElement }) => {
    await userEvent.click(await fillPlaceableOrder(canvasElement, "TK-88120347"));
    await passTheChecks();

    await waitFor(() => expect(screen.getByTestId("at-order-detail")).toBeInTheDocument());
    await expect(duplicateRefScenario.calls).toEqual([["TK-88120347"]]);
    await expect(screen.queryByTestId("duplicate-ref-dialog")).toBeNull();
  },
};

// A CANCELLED ORDER ON THE REF IS NOT WARNED ABOUT — cancel and re-create is the normal path.
export const ACancelledOrderOnTheRefDoesNotWarn: Story = {
  name: "Cancelled, no warning",
  beforeEach: withRefOrders({
    orderId: 107n,
    teamId: STORY_TEAM,
    shopId: shops[0]!.id,
    ref: "SP-2409-9999",
    status: OrderStatus.CANCEL,
  }),
  play: async ({ canvasElement }) => {
    await userEvent.click(await fillPlaceableOrder(canvasElement, "SP-2409-9999"));
    await passTheChecks();

    await waitFor(() => expect(screen.getByTestId("at-order-detail")).toBeInTheDocument());
    await expect(duplicateRefScenario.calls).toHaveLength(1);
    await expect(screen.queryByTestId("duplicate-ref-dialog")).toBeNull();
  },
};

// A LIVE ORDER ON THE SHOP + REF WARNS, naming it: a link to order 101 (a new tab — the form stays), its status and
// the day it was typed in (the short WIB date, straight off the lookup). Nothing is sent until the person answers.
export const ALiveOrderOnTheRefWarns: Story = {
  name: "Live order warns",
  beforeEach: onLiveRef,
  play: async ({ canvasElement }) => {
    await userEvent.click(await fillPlaceableOrder(canvasElement, LIVE_REF));

    const dialog = await warning();
    await expect(within(dialog).getByTestId("duplicate-ref-lead")).toHaveTextContent(LIVE_REF);

    const link = within(dialog).getByTestId("duplicate-ref-order-link-101");
    await expect(link).toHaveTextContent("Order #101");
    await expect(link).toHaveAttribute("href", "/orders/101");
    await expect(link).toHaveAttribute("target", "_blank");
    const row = within(dialog).getByTestId("duplicate-ref-order-101");
    await expect(row).toHaveTextContent("Pending");
    await expect(row).toHaveTextContent(`created ${formatUnixDate(LIVE_ORDER.createdAtUnix)}`);
    await expect(within(dialog).queryAllByTestId(/^not-implemented-/)).toHaveLength(0);

    // Still here, nothing placed.
    await expect(screen.queryByTestId("at-order-detail")).toBeNull();
  },
};

// A DRAFT ON THE REF WARNS (the-duplicate-warning-reads-drafts-too) — a colleague's scrape of MEL-9001 in Melati
// Official (draft 201's ref, put on the story's team), and no live order on it: the warning names it "A colleague's
// draft #201", dated, with NO link — only its author can open a draft; Create Anyway still places the order.
const DRAFT_201 = orderDrafts.find((d) => d.id === 201n)!;

export const ADraftOnTheRefWarns: Story = {
  name: "Draft warns",
  beforeEach: withRefDrafts({
    draftId: 201n,
    teamId: STORY_TEAM,
    shopId: shops[0]!.id,
    ref: "MEL-9001",
    createdAtUnix: DRAFT_201.createdAtUnix,
    source: "ScraperX",
    authorUserId: 62n,
  }),
  play: async ({ canvasElement }) => {
    await userEvent.click(await fillPlaceableOrder(canvasElement, "MEL-9001"));

    const dialog = await warning();
    const row = within(dialog).getByTestId("duplicate-ref-draft-201");
    await expect(row).toHaveTextContent("A colleague's draft #201");
    await expect(within(row).queryByRole("link")).toBeNull();
    await expect(row).toHaveTextContent(`created ${formatUnixDate(DRAFT_201.createdAtUnix)}`);
    await expect(within(dialog).queryAllByTestId(/^duplicate-ref-order-/)).toHaveLength(0);
    await expect(duplicateRefScenario.draftCalls).toEqual([{ shopId: shops[0]!.id, refs: ["MEL-9001"] }]);

    await userEvent.click(within(dialog).getByTestId("duplicate-ref-create-anyway"));
    await passTheChecks();
    await waitFor(() => expect(screen.getByTestId("at-order-detail")).toBeInTheDocument());
  },
};

// THE CALLER'S OWN DRAFT ON THE REF — the same warning, and this one IS a link to its page (a new tab), since its author
// is the person in front of the screen.
export const YourOwnDraftOnTheRefLinks: Story = {
  name: "Own draft links",
  beforeEach: withRefDrafts({
    draftId: 201n,
    teamId: STORY_TEAM,
    shopId: shops[0]!.id,
    ref: "MEL-9001",
    createdAtUnix: DRAFT_201.createdAtUnix,
    source: "ScraperX",
    authorUserId: users[0]!.id,
  }),
  play: async ({ canvasElement }) => {
    await userEvent.click(await fillPlaceableOrder(canvasElement, "MEL-9001"));

    const dialog = await warning();
    const link = within(dialog).getByTestId("duplicate-ref-draft-link-201");
    await expect(link).toHaveTextContent("Draft #201");
    await expect(link).toHaveAttribute("href", "/orders/new?draft=201");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(within(dialog).queryByTestId("duplicate-ref-draft-colleague-201")).toBeNull();
  },
};

// …BUT ANOTHER SHOP'S DRAFT ON THE SAME REF IS NOT THIS ORDER'S DOUBLE — the lookup asks for this shop only.
export const AnotherShopsDraftDoesNotWarn: Story = {
  name: "Another shop's draft",
  beforeEach: withRefDrafts({
    draftId: 203n,
    teamId: STORY_TEAM,
    shopId: 22n,
    ref: "MEL-9003",
    createdAtUnix: DRAFT_201.createdAtUnix,
  }),
  play: async ({ canvasElement }) => {
    await userEvent.click(await fillPlaceableOrder(canvasElement, "MEL-9003"));
    await passTheChecks();

    await waitFor(() => expect(screen.getByTestId("at-order-detail")).toBeInTheDocument());
    await expect(screen.queryByTestId("duplicate-ref-dialog")).toBeNull();
  },
};

// CREATE ANYWAY GOES THROUGH — the warning is a question, not a refusal: the order is placed and opened.
export const CreateAnywayGoesThrough: Story = {
  name: "Create Anyway",
  beforeEach: onLiveRef,
  play: async ({ canvasElement }) => {
    await userEvent.click(await fillPlaceableOrder(canvasElement, LIVE_REF));

    const dialog = await warning();
    await userEvent.click(within(dialog).getByTestId("duplicate-ref-create-anyway"));
    await passTheChecks();

    await waitFor(() => expect(screen.getByTestId("at-order-detail")).toBeInTheDocument());
    // No discard question on the way out.
    await expect(screen.queryByTestId("confirm-action")).toBeNull();
  },
};

// GO BACK KEEPS THE FORM — exactly as typed, and Create still offered; pressing it again asks again.
export const GoBackKeepsTheForm: Story = {
  name: "Go Back keeps the form",
  beforeEach: onLiveRef,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const create = await fillPlaceableOrder(canvasElement, LIVE_REF);
    await userEvent.click(create);

    const dialog = await warning();
    await userEvent.click(within(dialog).getByTestId("duplicate-ref-go-back"));

    await waitFor(() => expect(screen.queryByTestId("duplicate-ref-dialog")).toBeNull());
    await expect(canvas.getByTestId("order-create-page")).toBeInTheDocument();
    await expect(canvas.getByTestId("order-create-customer-name")).toHaveValue("Bu Ani");
    await expect(canvas.getByTestId("order-external-ref-id")).toHaveValue(LIVE_REF);
    await expect(canvas.getByTestId("order-line-0")).toHaveTextContent(products[0]!.name);
    await expect(create).toBeEnabled();
    await expect(screen.queryByTestId("at-order-detail")).toBeNull();

    // A second Create re-reads — the warning is asked fresh, never remembered.
    await userEvent.click(create);
    await warning();
    await expect(duplicateRefScenario.calls).toHaveLength(2);
  },
};

// A LOOKUP THAT FAILS STILL WARNS — it says the check could not run, and Create Anyway is still the person's call.
export const AFailedLookupSaysSoAndStillCreates: Story = {
  name: "Lookup failed",
  beforeEach: [onLiveRef, withFailingRefLookup()],
  play: async ({ canvasElement }) => {
    await userEvent.click(await fillPlaceableOrder(canvasElement, LIVE_REF));

    const dialog = await warning();
    await expect(within(dialog).getByTestId("duplicate-ref-failed")).toHaveTextContent(
      `Could not check whether ${LIVE_REF} is already recorded`,
    );
    await userEvent.click(within(dialog).getByTestId("duplicate-ref-create-anyway"));
    await passTheChecks();

    await waitFor(() => expect(screen.getByTestId("at-order-detail")).toBeInTheDocument());
  },
};

// FINALIZING A DRAFT DOES NOT WARN ABOUT ITSELF (the-duplicate-warning-reads-drafts-too). Draft 202 (MEL-9002, Melati
// Store) is ready as it stands: Create runs the check on its ref, finds nothing to name, and the draft is promoted —
// order 902 — with no dialog.
export const FinalizingADraftDoesNotWarnAboutItself: Story = {
  name: "Draft, not itself",
  render: () => <RoutedFromDraft202 />,
  beforeEach: asMelatiWithMaps,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-create-customer-name")).toHaveValue("Pak Mamat"), {
      timeout: 4000,
    });
    await mapDraftLines(canvasElement);
    const create = canvas.getByTestId("order-create-save");
    await waitFor(() => expect(create).toBeEnabled(), { timeout: 4000 });
    await userEvent.click(create);
    await passTheChecks();

    await waitFor(() => expect(screen.getByTestId("at-order-detail")).toHaveAttribute("data-order", "902"));
    await expect(duplicateRefScenario.calls).toEqual([["MEL-9002"]]);
    // The draft read ran, and answered draft 202 itself — which the form dropped.
    await expect(duplicateRefScenario.draftCalls).toEqual([{ shopId: 22n, refs: ["MEL-9002"] }]);
    await expect(screen.queryByTestId("duplicate-ref-dialog")).toBeNull();
  },
};

// …BUT ANOTHER DRAFT ON THE DRAFT'S SHOP + REF IS NAMED — a second app scraped the same order. Draft 205 (another app,
// a colleague's) is put on MEL-9002 in Melati Store; the warning names it, and never draft 202.
export const FinalizingADraftNamesAnotherDraft: Story = {
  name: "Draft, another draft",
  render: () => <RoutedFromDraft202 />,
  beforeEach: [
    asMelatiWithMaps,
    withRefDrafts({
      draftId: 205n,
      teamId: 12n,
      shopId: 22n,
      ref: "MEL-9002",
      createdAtUnix: DRAFT_201.createdAtUnix,
      source: "OtherApp",
      authorUserId: 62n,
    }),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-create-customer-name")).toHaveValue("Pak Mamat"), {
      timeout: 4000,
    });
    await mapDraftLines(canvasElement);
    const create = canvas.getByTestId("order-create-save");
    await waitFor(() => expect(create).toBeEnabled(), { timeout: 4000 });
    await userEvent.click(create);

    const dialog = await warning();
    await expect(within(dialog).getByTestId("duplicate-ref-draft-205")).toBeInTheDocument();
    await expect(within(dialog).queryByTestId("duplicate-ref-draft-202")).toBeNull();
  },
};

// …BUT A LIVE ORDER ON THE DRAFT'S REF IS NAMED — the scrape most likely already became an order. Order 102 is put on
// MEL-9002 in Melati Store; the warning names it, and not draft 202.
export const FinalizingADraftWarnsAboutALiveOrder: Story = {
  name: "Draft, a live order",
  render: () => <RoutedFromDraft202 />,
  beforeEach: [
    asMelatiWithMaps,
    withRefOrders({ orderId: 102n, teamId: 12n, shopId: 22n, ref: "MEL-9002", status: OrderStatus.PROCESSED }),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-create-customer-name")).toHaveValue("Pak Mamat"), {
      timeout: 4000,
    });
    await mapDraftLines(canvasElement);
    const create = canvas.getByTestId("order-create-save");
    await waitFor(() => expect(create).toBeEnabled(), { timeout: 4000 });
    await userEvent.click(create);

    const dialog = await warning();
    await expect(within(dialog).getByTestId("duplicate-ref-order-102")).toHaveTextContent("Processed");
    await expect(within(dialog).queryByTestId("duplicate-ref-draft-202")).toBeNull();
  },
};

// ON A PHONE — the same warning inside the screen, its two answers stacked full width with Create Anyway on top.
export const Phone: Story = {
  name: "Phone",
  globals: { viewport: { value: "mobile2" } },
  beforeEach: onLiveRef,
  play: async ({ canvasElement }) => {
    await userEvent.click(await fillPlaceableOrder(canvasElement, LIVE_REF));

    const dialog = await warning();
    await expect(within(dialog).getByTestId("duplicate-ref-order-101")).toBeVisible();

    const create = within(dialog).getByTestId("duplicate-ref-create-anyway");
    const back = within(dialog).getByTestId("duplicate-ref-go-back");
    await expect(create.getBoundingClientRect().bottom).toBeLessThanOrEqual(back.getBoundingClientRect().top + 1);
    await expect(Math.abs(create.getBoundingClientRect().width - back.getBoundingClientRect().width)).toBeLessThan(1);

    const box = dialog.getBoundingClientRect();
    await expect(box.left).toBeGreaterThanOrEqual(0);
    await expect(box.right).toBeLessThanOrEqual(window.innerWidth + 1);
  },
};
