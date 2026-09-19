import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor } from "storybook/test";

import { AddEntryDialog, type EntryDraft } from "./components/AddEntryDialog";
import { MANUAL_TYPES, type PostingRole } from "./model";
import { awaiting, noEstimate, worked } from "./fixtures";

// ADDING A SETTLEMENT ENTRY BY HAND — `context.md` §What Frontend Expected 1.
//
// ⚠ A PROTOTYPE. Hands a draft to its caller and writes nothing.
//
// ── WHO MAY POST WHAT — decided, and it is TWO conditions, not one ──────────────────────────────
//
// `the-write-set-is-cs-and-up` puts five roles in front of this form. `initial-total-is-postable-by-
// cs-and-owners` then lets four of them author the SALE FIGURE — root, admin, team_owner and CS —
// and withholds it from team_admin.
//
// But the role is only half of it. `initial_total` is a LEDGER ROW like any other, so a second one
// ADDS to the account rather than replacing the first: post one where the automatic row already
// landed and the sale doubles, which reads on every screen as catastrophic loss. So the type is
// offered only when BOTH hold:
//
//   | condition                                      | why                                          |
//   | ---------------------------------------------- | -------------------------------------------- |
//   | the role may author a sale                      | it is the marketplace relationship, not ops  |
//   | the account holds no live `initial_total` yet   | a second is a duplicate, not a correction    |
//
// ⚠ The dialog PORTALS, so every query below goes through `screen`, not `within(canvasElement)`.
const meta = {
  title: "Pages/Order Settlement/Add Entry",
  component: AddEntryDialog,
} satisfies Meta<typeof AddEntryDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The ordinary case: an account that already has its sale, so the sale is not on offer. */
const base = {
  open: true as const,
  today: "2026-01-10",
  settlement: worked,
  role: "team_admin" as PostingRole,
  onOpenChange: () => {},
  onSubmit: () => {},
};

/** A harness that keeps the dialog open and shows whatever draft came back. */
function Harness(props: { onDraft?: (d: EntryDraft) => void; role?: PostingRole }) {
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState<EntryDraft | null>(null);

  return (
    <>
      <AddEntryDialog
        open={open}
        onOpenChange={setOpen}
        today="2026-01-10"
        settlement={worked}
        role={props.role ?? "team_admin"}
        onSubmit={(d) => {
          setDraft(d);
          props.onDraft?.(d);
        }}
      />
      {draft && (
        <div data-testid="draft">
          {draft.settlementType}:{String(draft.change)}:{draft.occurredOn}
        </div>
      )}
    </>
  );
}

// ── Who may post what ───────────────────────────────────────────────────────────────────────────

/**
 * TEAM_ADMIN NEVER SEES THE SALE FIGURE.
 *
 * The one role in the write set that may post every type except `initial_total`. It is the
 * operational seat — it moves orders, it does not author what the buyer paid.
 */
export const TeamAdminCannotAuthorTheSale: Story = {
  args: base,
  play: async () => {
    const select = await screen.findByTestId("entry-type");
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.value);

    await expect(options).toEqual(MANUAL_TYPES);
    await expect(options).not.toContain("initial_total");
    await expect(options).toHaveLength(5);
  },
};

/**
 * CS MAY AUTHOR THE SALE — on an account that has none.
 *
 * ⚠ This is the answer that REVERSED the earlier proposal that nobody may type it, and the reasoning
 * is the marketplace relationship: CS is who talks to the platform and reads what the buyer actually
 * paid. `noEstimate` is the order that needs it — a phone order whose `marketplace_total` was never
 * recorded, which is exactly the gap a person is there to close.
 */
export const CustomerServiceMayAuthorTheSale: Story = {
  args: { ...base, settlement: noEstimate, role: "customer_service" },
  play: async () => {
    const select = await screen.findByTestId("entry-type");
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.value);

    // First in the list — it is the thing this account is missing.
    await expect(options[0]).toBe("initial_total");
    await expect(options).toHaveLength(6);
  },
};

/**
 * ⚠ THE ACCOUNT VETOES THE ROLE — and this is the assertion that matters most on this form.
 *
 * `awaiting` already holds its automatic `initial_total`. A second one would not correct it, it would
 * ADD to it: `UNIQUE (order_id, unique_id)` cannot tell that two rows mean the same sale, and
 * `a-correction-is-a-new-row` means the duplicate can never be removed. So even for CS the type is
 * withheld — the permission is real, there is simply nothing left to author.
 */
export const SaleAlreadyAuthoredHidesTheType: Story = {
  args: { ...base, settlement: awaiting, role: "customer_service" },
  play: async () => {
    const select = await screen.findByTestId("entry-type");
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.value);

    await expect(options).not.toContain("initial_total");
    await expect(options).toHaveLength(5);
  },
};

/**
 * PICKING THE SALE FIGURE RAISES ITS OWN WARNING.
 *
 * Every other type is one line in a long account. This one is the DENOMINATOR — it moves the loss,
 * the margin and the take rate on every screen at once — so it says so at the moment of typing,
 * separately from the append-only notice every entry carries.
 */
export const TheSaleFigureWarnsLouder: Story = {
  args: { ...base, settlement: noEstimate, role: "customer_service" },
  play: async () => {
    // Not shown for an ordinary type…
    await expect(screen.queryByTestId("initial-total-warning")).not.toBeInTheDocument();

    await userEvent.selectOptions(await screen.findByTestId("entry-type"), "initial_total");
    await waitFor(async () => {
      await expect(screen.getByTestId("initial-total-warning")).toBeVisible();
    });
    await expect(screen.getByTestId("initial-total-warning")).toHaveTextContent(
      /every loss on this order is measured against/i,
    );
  },
};

// ── The form's own rules ────────────────────────────────────────────────────────────────────────

/**
 * THE SIGN IS TWO BUTTONS, NEVER A TYPED MINUS.
 *
 * `change` is signed, and a signed text field is how somebody eventually posts −45.000 meaning
 * +45.000 — in a ledger where `a-residual-balance-is-normal` hides the mistake and
 * `a-correction-is-a-new-row` makes it permanent. So the amount is always positive and the direction
 * is a choice, with the signed result previewed in words before anything is written.
 */
export const DirectionIsAChoice: Story = {
  args: base,
  render: () => <Harness />,
  play: async () => {
    await userEvent.type(await screen.findByTestId("entry-amount"), "45000", { delay: 20 });

    // Default is money taken FROM us — the common case for a hand-typed row.
    await waitFor(async () => {
      await expect(screen.getByTestId("entry-preview")).toHaveTextContent(
        /take Rp 45\.000 from the order/i,
      );
    });

    await userEvent.click(screen.getByTestId("direction-in"));
    await waitFor(async () => {
      await expect(screen.getByTestId("entry-preview")).toHaveTextContent(
        /add Rp 45\.000 to the order/i,
      );
    });

    // The field itself never holds a minus — CurrencyInput strips anything that is not a digit.
    await expect(screen.getByTestId("entry-amount")).toHaveValue("45.000");
  },
};

/** The direction chosen is what reaches the caller, as a signed figure. */
export const SubmitsASignedDraft: Story = {
  args: base,
  render: () => <Harness />,
  play: async () => {
    await userEvent.type(await screen.findByTestId("entry-amount"), "45000", { delay: 20 });
    await userEvent.click(screen.getByTestId("direction-out"));
    await userEvent.click(screen.getByTestId("entry-submit"));

    await waitFor(async () => {
      await expect(screen.getByTestId("draft")).toHaveTextContent(
        "marketplace_adjustment:-45000:2026-01-10",
      );
    });
  },
};

/**
 * NOTHING TYPED, NOTHING POSTABLE.
 *
 * A zero-amount entry is not a correction of anything — it is a row that moves no money and can never
 * be removed. The button stays disabled rather than accepting it.
 */
export const AmountIsRequired: Story = {
  args: base,
  render: () => <Harness />,
  play: async () => {
    await expect(await screen.findByTestId("entry-submit")).toBeDisabled();

    await userEvent.type(screen.getByTestId("entry-amount"), "1", { delay: 20 });
    await waitFor(async () => {
      await expect(screen.getByTestId("entry-submit")).toBeEnabled();
    });
  },
};

/**
 * THE DATE DEFAULTS TO TODAY AND SAYS IT MEANS SOMETHING ELSE.
 *
 * `two-dates-occurred-and-posted`: the person supplies the day the charge BELONGS to, and the server
 * stamps the day it was recorded. Backdating a fee somebody just noticed is the ordinary case (`§3`),
 * so the field cannot silently mean "now".
 */
export const BelongsToNotToday: Story = {
  args: base,
  render: () => <Harness />,
  play: async () => {
    await expect(await screen.findByTestId("entry-date")).toHaveValue("2026-01-10");
    await expect(screen.getByTestId("add-entry-dialog")).toHaveTextContent(
      /the day the charge belongs to, not today/i,
    );
  },
};

/** The append-only rule is stated where it applies — at the moment of typing, not only under the table. */
export const WarnsBeforeWriting: Story = {
  args: base,
  play: async () => {
    await expect(await screen.findByTestId("entry-preview")).toHaveTextContent(
      /cannot be edited or deleted/i,
    );
  },
};
