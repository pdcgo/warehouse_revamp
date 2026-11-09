import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { create } from "@bufbuild/protobuf";

import { orderDetailFor, teams } from "../../../.storybook/fixtures";
import { returnAcceptScenario, withOrdersInReturn } from "../../../.storybook/sessionScenario";
import { OrderSchema, OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";
import { AcceptReturnDialog, description } from "./AcceptReturnDialog";

// THE RETURN ACCEPT (the-accept-is-the-status-return-completed) — the crew has the returned parcel in its hands. Opened
// from the pick screen's Accept Return, so its rules are pinned once here:
//
//   | story                              | the rule it pins                                                          |
//   | ---------------------------------- | ------------------------------------------------------------------------- |
//   | Default                            | every line, nothing typed — a whole parcel is the common case              |
//   | AWholeParcelIsAcceptedAsIs         | nothing missing, no charge: the accept sends exactly that, and closes      |
//   | AShortParcelNamesItsMissingUnits   | a missing unit is named on its line, and said to be noted for the claim    |
//   | AChargeNeedsWhatItWasFor           | a charge with no note does not press (an-incidental-line-must-say-…)       |
//   | ABorrowedLineAnswersItsLabel       | the labels to print come after the accept, one per unit in hand            |
//   | ARefusalIsSaidInTheDialog          | an unmapped borrowed product refuses, in the server's words, and nothing closes |

// Toko Melati's order 101 — three lines (2 × KPH-M, 1 × KPP-L, 1 × TOP-01) — read back in `return`. It ships from
// Gudang Pusat, the team accepting it.
const ORDER = create(OrderSchema, { ...orderDetailFor(101n)!, status: OrderStatus.RETURN });
const WAREHOUSE = teams[0]!; // Gudang Pusat (11)
const FIRST = ORDER.items[0]!;

function Open() {
  const [open, setOpen] = useState(true);

  return <AcceptReturnDialog open={open} onOpenChange={setOpen} teamId={WAREHOUSE.id} order={ORDER} />;
}

const meta = {
  title: "Features/Orders/AcceptReturnDialog",
  component: AcceptReturnDialog,
  parameters: { docs: { description: { component: description } } },
  beforeEach: withOrdersInReturn(ORDER.id),
  args: { open: true, onOpenChange: () => {}, teamId: WAREHOUSE.id, order: ORDER },
  render: () => <Open />,
} satisfies Meta<typeof AcceptReturnDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {
  play: async () => {
    const lines = await screen.findByTestId("accept-return-lines");

    for (const item of ORDER.items) {
      await expect(within(lines).getByTestId(`accept-return-line-${item.id}`)).toHaveTextContent(item.name);
    }

    // Nothing is typed, and nothing has to be: the whole parcel is the common case.
    await expect(screen.getByTestId("accept-return-submit")).toBeEnabled();
    await expect(screen.queryByTestId("accept-return-short")).not.toBeInTheDocument();

    // ON A DESKTOP IT IS A DIALOG, NOT A SHEET — as tall as its lines, never stretched to the window (full screen is the
    // phone's, by the JS breakpoint).
    const dialog = screen.getByTestId("accept-return-dialog");
    await expect(dialog.getBoundingClientRect().height).toBeLessThan(window.innerHeight * 0.95);
    await expect(dialog.getBoundingClientRect().width).toBeLessThan(window.innerWidth);
  },
};

// THE DIALOG ON A PHONE-SHAPED CANVAS — full screen, each line a block. For looking: the runner has one viewport.
export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

/** A WHOLE PARCEL, NO CHARGE: the accept sends no missing line and a charge of 0, and the dialog closes — no labels. */
export const AWholeParcelIsAcceptedAsIs: Story = {
  play: async () => {
    await userEvent.click(await screen.findByTestId("accept-return-submit"));

    await waitFor(() => expect(screen.queryByTestId("accept-return-dialog")).not.toBeInTheDocument());
    await expect(returnAcceptScenario.last).toEqual({
      orderId: ORDER.id,
      missing: [],
      courierCharge: 0,
      courierChargeNote: "",
    });
  },
};

/**
 * A SHORT PARCEL (a-short-return-is-accepted-and-the-gap-written-off): the missing unit is typed on its own line, the
 * dialog says it will be noted for customer service's claim, and only that line is sent.
 */
export const AShortParcelNamesItsMissingUnits: Story = {
  play: async () => {
    const missing = await screen.findByTestId(`accept-return-missing-${FIRST.id}`);

    await userEvent.type(missing, "1", { delay: 40 });
    await expect(await screen.findByTestId("accept-return-short")).toBeVisible();

    await userEvent.click(screen.getByTestId("accept-return-submit"));

    await waitFor(() => expect(returnAcceptScenario.last?.missing).toEqual([{ orderItemId: FIRST.id, quantity: 1 }]));
  },
};

/**
 * THE COURIER'S CHARGE NEEDS WHAT IT WAS FOR (an-incidental-line-must-say-what-it-was-for): typed without a note, the
 * field says so and Accept does not press; with one, both go — the note trimmed.
 */
export const AChargeNeedsWhatItWasFor: Story = {
  play: async () => {
    await userEvent.type(await screen.findByTestId("accept-return-charge"), "15000", { delay: 40 });

    await expect(await screen.findByTestId("accept-return-charge-note-error")).toBeVisible();
    await expect(screen.getByTestId("accept-return-submit")).toBeDisabled();

    await userEvent.type(screen.getByTestId("accept-return-charge-note"), " ongkir retur J&T ", { delay: 20 });
    await expect(screen.queryByTestId("accept-return-charge-note-error")).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("accept-return-submit"));

    await waitFor(() =>
      expect(returnAcceptScenario.last).toMatchObject({ courierCharge: 15_000, courierChargeNote: "ongkir retur J&T" }),
    );
  },
};

/**
 * A BORROWED LINE ANSWERS ITS LABEL (a-returned-borrowed-unit-is-relabelled-at-the-accept): after the accept the dialog
 * stays open on what to print — the selling team's own code, how many, and the lender's label it goes over.
 */
export const ABorrowedLineAnswersItsLabel: Story = {
  beforeEach: () => {
    returnAcceptScenario.labels = [
      {
        orderItemId: FIRST.id,
        borrowedProductId: FIRST.productId,
        borrowedProductCode: FIRST.productCode,
        ownProductId: 74n,
        ownProductCode: "MLT-KAOS-01",
        ownProductName: "Kaos Polos Hitam — M (Melati)",
        quantity: 2,
      },
    ];
  },
  play: async () => {
    await userEvent.click(await screen.findByTestId("accept-return-submit"));

    const labels = await screen.findByTestId("accept-return-labels");
    const label = within(labels).getByTestId(`accept-return-label-${FIRST.id}`);

    await expect(label).toHaveTextContent("MLT-KAOS-01");
    await expect(label).toHaveTextContent(FIRST.productCode);
    await expect(within(label).getByTestId(`accept-return-label-count-${FIRST.id}`)).toHaveTextContent("2 labels");

    await userEvent.click(screen.getByTestId("accept-return-done"));
    await waitFor(() => expect(screen.queryByTestId("accept-return-dialog")).not.toBeInTheDocument());
  },
};

/** AN UNMAPPED BORROWED PRODUCT REFUSES THE ACCEPT (a-return-never-clones-a-product), said in the dialog, which stays. */
export const ARefusalIsSaidInTheDialog: Story = {
  beforeEach: () => {
    returnAcceptScenario.refusal =
      "the selling team has not mapped these borrowed products for returns — the return cannot be accepted until it does: TKB-KAOS-01";
  },
  play: async () => {
    await userEvent.click(await screen.findByTestId("accept-return-submit"));

    await expect(await screen.findByTestId("accept-return-error")).toHaveTextContent("TKB-KAOS-01");
    await expect(screen.getByTestId("accept-return-dialog")).toBeInTheDocument();
  },
};
