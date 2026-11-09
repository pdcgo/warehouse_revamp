import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";

import { OrderStatus } from "../../../gen/warehouse/selling/v1/order_pb";
import { formatUnixDate } from "../../../lib/datetime";
import { DuplicateRefDialog, description } from "./DuplicateRefDialog";
import type { DuplicateFinding } from "./duplicateRef";

// THE DUPLICATE MARKETPLACE-REF WARNING (a-duplicate-ref-is-warned-not-refused, the-duplicate-warning-reads-drafts-too)
// — the dialog alone, with every kind of finding. The page's stories (Pages/Order/OrderCreate) pin WHEN it opens; these
// pin what it says. Dates are the short WIB form ("3 Nov 2026", formatUnixDate).

const DAY = 24n * 60n * 60n;
const yesterday = BigInt(Math.floor(Date.now() / 1000)) - DAY;

const LIVE: DuplicateFinding = {
  ref: "SP-2409-8841",
  orders: [{ id: 101n, status: OrderStatus.PENDING, createdAtUnix: yesterday }],
  drafts: [],
};

// The signed-in person, and a colleague on the same team.
const ME = 1n;
const COLLEAGUE = 2n;

const DRAFT: DuplicateFinding = {
  ref: "MEL-9001",
  orders: [],
  drafts: [{ id: 201n, createdAtUnix: yesterday - DAY, authorUserId: ME }],
};

const meta = {
  title: "Features/Orders/DuplicateRefDialog",
  component: DuplicateRefDialog,
  parameters: { docs: { description: { component: description } } },
  args: { finding: LIVE, placing: false, onCreateAnyway: fn(), onGoBack: fn(), selfUserId: ME },
} satisfies Meta<typeof DuplicateRefDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

// A LIVE ORDER ON THE REF — named as a link to it (a new tab, so the form behind stays), with its status and the day it
// was typed in. No pending mark: drafts are read too.
export const ALiveOrderOnTheRefWarns: Story = {
  play: async () => {
    const dialog = await screen.findByTestId("duplicate-ref-dialog");
    await waitFor(() => expect(dialog).toBeVisible());

    await expect(dialog).toHaveTextContent("This Ref Is Already Recorded");
    await expect(within(dialog).getByTestId("duplicate-ref-lead")).toHaveTextContent("SP-2409-8841");

    const row = within(dialog).getByTestId("duplicate-ref-order-101");
    const link = within(row).getByTestId("duplicate-ref-order-link-101");
    await expect(link).toHaveTextContent("Order #101");
    await expect(link).toHaveAttribute("href", "/orders/101");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(row).toHaveTextContent("Pending");
    await expect(row).toHaveTextContent(`created ${formatUnixDate(yesterday)}`);

    await expect(within(dialog).queryAllByTestId(/^not-implemented-/)).toHaveLength(0);
  },
};

// A DRAFT ON THE REF — named as a link to its page (the order form with `?draft=`), and dated.
export const ADraftOnTheRefWarns: Story = {
  args: { finding: DRAFT },
  play: async () => {
    const dialog = await screen.findByTestId("duplicate-ref-dialog");
    await waitFor(() => expect(dialog).toBeVisible());

    const link = within(dialog).getByTestId("duplicate-ref-draft-link-201");
    await expect(link).toHaveTextContent("Draft #201");
    await expect(link).toHaveAttribute("href", "/orders/new?draft=201");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(within(dialog).getByTestId("duplicate-ref-draft-201")).toHaveTextContent(
      `created ${formatUnixDate(yesterday - DAY)}`,
    );
  },
};

// A COLLEAGUE'S DRAFT ON THE REF — the read is team-wide, so it warns; but only its author can open a draft, so it is
// named "A colleague's draft #202", dated, and is NOT a link. The caller's own draft beside it still links.
export const AColleaguesDraftIsNamedWithoutALink: Story = {
  args: {
    finding: {
      ...DRAFT,
      drafts: [...DRAFT.drafts, { id: 202n, createdAtUnix: yesterday, authorUserId: COLLEAGUE }],
    },
  },
  play: async () => {
    const dialog = await screen.findByTestId("duplicate-ref-dialog");
    await waitFor(() => expect(dialog).toBeVisible());

    const theirs = within(dialog).getByTestId("duplicate-ref-draft-202");
    await expect(theirs).toHaveTextContent("A colleague's draft #202");
    await expect(theirs).toHaveTextContent(`created ${formatUnixDate(yesterday)}`);
    await expect(within(theirs).queryByRole("link")).toBeNull();
    await expect(within(dialog).queryByTestId("duplicate-ref-draft-link-202")).toBeNull();

    const mine = within(dialog).getByTestId("duplicate-ref-draft-link-201");
    await expect(mine).toHaveTextContent("Draft #201");
    await expect(mine).toHaveAttribute("href", "/orders/new?draft=201");
  },
};

// BOTH AT ONCE — a live order and a draft on one ref, each its own row.
export const AnOrderAndADraft: Story = {
  args: { finding: { ...LIVE, drafts: DRAFT.drafts } },
  play: async () => {
    const dialog = await screen.findByTestId("duplicate-ref-dialog");
    await expect(within(dialog).getByTestId("duplicate-ref-order-101")).toBeInTheDocument();
    await expect(within(dialog).getByTestId("duplicate-ref-draft-201")).toBeInTheDocument();
  },
};

// THE DATE IS THE SHORT WIB DAY (formatUnixDate) — 2 Nov 2026 18:30 UTC is already 3 Nov 01:30 in Jakarta, so it reads
// the 3rd ("Nov 3, 2026" in English, "3 Nov 2026" in Indonesian), never the UTC day.
export const TheDateIsTheWibDay: Story = {
  args: {
    finding: {
      ref: "SP-2409-8841",
      orders: [{ id: 101n, status: OrderStatus.PENDING, createdAtUnix: 1_793_644_200n }],
      drafts: [{ id: 201n, createdAtUnix: 1_793_644_200n, authorUserId: ME }],
    },
  },
  play: async () => {
    const dialog = await screen.findByTestId("duplicate-ref-dialog");
    const wibDay = /created (Nov 3, 2026|3 Nov 2026)/;
    await expect(within(dialog).getByTestId("duplicate-ref-order-101")).toHaveTextContent(wibDay);
    await expect(within(dialog).getByTestId("duplicate-ref-draft-201")).toHaveTextContent(wibDay);
  },
};

// A CHECK THAT COULD NOT RUN says so — a warning is not a gate, so Create Anyway stays offered.
export const ALookupThatFailedSaysSo: Story = {
  args: { finding: { ref: "SP-2409-8841", orders: [], drafts: [], error: "unavailable" } },
  play: async () => {
    const dialog = await screen.findByTestId("duplicate-ref-dialog");
    await expect(within(dialog).getByTestId("duplicate-ref-failed")).toHaveTextContent(
      "Could not check whether SP-2409-8841 is already recorded",
    );
    await expect(within(dialog).getByTestId("duplicate-ref-create-anyway")).toBeEnabled();
  },
};

// THE TWO ANSWERS — each calls its own handler, and only that one.
export const CreateAnywayAndGoBackAnswer: Story = {
  play: async ({ args }) => {
    const dialog = await screen.findByTestId("duplicate-ref-dialog");
    await waitFor(() => expect(dialog).toBeVisible());

    await userEvent.click(within(dialog).getByTestId("duplicate-ref-create-anyway"));
    await expect(args.onCreateAnyway).toHaveBeenCalledTimes(1);
    await expect(args.onGoBack).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByTestId("duplicate-ref-go-back"));
    await expect(args.onGoBack).toHaveBeenCalledTimes(1);
  },
};

// ON A PHONE the two answers stack full width, Create Anyway on top, and the dialog keeps inside the screen.
export const Phone: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async () => {
    const dialog = await screen.findByTestId("duplicate-ref-dialog");
    await waitFor(() => expect(dialog).toBeVisible());

    const create = within(dialog).getByTestId("duplicate-ref-create-anyway");
    const back = within(dialog).getByTestId("duplicate-ref-go-back");
    await expect(create.getBoundingClientRect().bottom).toBeLessThanOrEqual(back.getBoundingClientRect().top + 1);
    await expect(Math.abs(create.getBoundingClientRect().width - back.getBoundingClientRect().width)).toBeLessThan(1);

    const box = dialog.getBoundingClientRect();
    await expect(box.left).toBeGreaterThanOrEqual(0);
    await expect(box.right).toBeLessThanOrEqual(window.innerWidth + 1);
  },
};

// ── Try Again's warning (`retry`, a-try-again-always-warns) ─────────────────────────────────────────────────────────

// TRY AGAIN FINDS THE ORDER — after a Create that got no answer, the order on the ref is most likely that Create: the
// lead says so, the order is named as ever, and the answer is still Create Anyway.
export const TryAgainNamesTheFirstOrder: Story = {
  args: { retry: true, onDismiss: fn() },
  play: async () => {
    const dialog = await screen.findByTestId("duplicate-ref-dialog");
    await waitFor(() => expect(dialog).toBeVisible());

    await expect(dialog).toHaveTextContent("This Ref Is Already Recorded");
    const lead = within(dialog).getByTestId("duplicate-ref-lead");
    await expect(lead).toHaveAttribute("data-retry", "found");
    await expect(lead).toHaveTextContent("Your last Create got no answer");
    await expect(within(dialog).getByTestId("duplicate-ref-order-link-101")).toHaveAttribute("target", "_blank");
    await expect(within(dialog).getByTestId("duplicate-ref-create-anyway")).toHaveTextContent("Create Anyway");
  },
};

// TRY AGAIN FINDS NOTHING YET — it still warns: the last Create may still be finishing. A link to the orders list (a new
// tab), and Send Again. Escape is NOT Go Back here: it only closes the warning (`onDismiss`).
export const TryAgainFindsNothingYet: Story = {
  args: { retry: true, onDismiss: fn(), finding: { ref: "SP-LOCK-0001", orders: [], drafts: [] } },
  play: async ({ args }) => {
    const dialog = await screen.findByTestId("duplicate-ref-dialog");
    await waitFor(() => expect(dialog).toBeVisible());

    await expect(dialog).toHaveTextContent("Your Last Create May Still Be Finishing");
    const lead = within(dialog).getByTestId("duplicate-ref-lead");
    await expect(lead).toHaveAttribute("data-retry", "nothing");
    await expect(lead).toHaveTextContent("SP-LOCK-0001");
    const link = within(dialog).getByTestId("duplicate-ref-check-orders");
    await expect(link).toHaveAttribute("href", "/orders");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(within(dialog).getByTestId("duplicate-ref-create-anyway")).toHaveTextContent("Send Again");

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(args.onDismiss).toHaveBeenCalledTimes(1));
    await expect(args.onGoBack).not.toHaveBeenCalled();
  },
};
