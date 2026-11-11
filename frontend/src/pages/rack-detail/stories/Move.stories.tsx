import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { lastRackWrite, rackShelf, rackStubScenario } from "../../../../.storybook/rackStub";
import { At42, RACK_DETAIL_META, openMove, pickRack, stock, type } from "./kit";

// RACK DETAIL — Move Goods (placement_decision.md): to one rack or two, everything, the refusals, a counted product. The
// page's stories are grouped by the part of the screen they are about (stories-are-grouped-by-the-part-of-the-screen);
// what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Racks/RackDetail/Move",
  ...RACK_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// Two teams' goods to one rack: the shelves change and the server writes one transaction per owning team
// (a-move-writes-one-transaction-per-owning-team). Every product starts at 0, so only what is typed moves.
export const MoveToOneRack: Story = {
  name: "Move to one rack",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openMove();
    // ON A DESKTOP IT IS A DIALOG, NOT A SHEET — as tall as its lines, never held to the window's height (full screen
    // is the phone's, by the JS breakpoint; a responsive `size` once kept full's min-height here).
    await waitFor(() => {
      const box = screen.getByTestId("move-goods-dialog");
      expect(box.getBoundingClientRect().height).toBeLessThan(window.innerHeight * 0.95);
      expect(parseFloat(getComputedStyle(box).minHeight) || 0).toBeLessThan(window.innerHeight * 0.5);
    });

    await pickRack("move-default-to", 42n);
    await type(screen.getByTestId("move-qty-71-0"), "4");
    await type(screen.getByTestId("move-qty-73-0"), "5");

    await expect(screen.getByTestId("move-to-default-71-0")).toHaveTextContent("A-01-2");
    await expect(screen.getByTestId("move-summary")).toHaveTextContent("9 units of 2 product(s) to 1 rack(s)");
    await userEvent.click(screen.getByTestId("move-submit"));

    await waitFor(() => expect(screen.queryByTestId("move-goods-dialog")).toBeNull());
    await expect(rackShelf(41n, 71n)).toBe(8n);
    await expect(rackShelf(42n, 71n)).toBe(10n);
    await expect(rackShelf(42n, 73n)).toBe(5n);
    await expect(lastRackWrite()?.transactions.map((t) => t.teamId)).toEqual([11n, 13n]);

    // The page reads again: Gula has left this rack, Kopi is down to 8.
    await waitFor(() => expect(stock(canvas).getByTestId("rack-stock-onhand-71")).toHaveTextContent("8"));
    await expect(stock(canvas).queryByTestId("rack-stock-row-73")).toBeNull();
  },
};

// A to B and C: one product split over two racks (a-move-is-one-rack-to-one-or-more-racks). The first line keeps the
// default rack; the split line names its own.
export const SplitOverTwoRacks: Story = {
  name: "Split over two racks",
  play: async () => {
    await openMove();

    await pickRack("move-default-to", 42n);
    await type(screen.getByTestId("move-qty-74-0"), "5");
    await userEvent.click(screen.getByTestId("move-split-74"));
    await pickRack("move-to-74-1", 43n);
    await type(screen.getByTestId("move-qty-74-1"), "3");

    await expect(screen.getByTestId("move-summary")).toHaveTextContent("8 units of 1 product(s) to 2 rack(s)");
    await userEvent.click(screen.getByTestId("move-submit"));

    await waitFor(() => expect(screen.queryByTestId("move-goods-dialog")).toBeNull());
    await expect(rackShelf(41n, 74n)).toBe(0n);
    await expect(rackShelf(42n, 74n)).toBe(5n);
    await expect(rackShelf(43n, 74n)).toBe(3n);
    await expect(lastRackWrite()?.transactions.map((t) => t.teamId)).toEqual([12n]);
  },
};

// "Move Everything" fills each product up to its stock count — and until a rack is chosen, Move waits and says why.
export const MoveEverythingNeedsARack: Story = {
  name: "Move everything, needs a rack",
  play: async () => {
    await openMove();

    await userEvent.click(screen.getByTestId("move-everything"));

    await expect(screen.getByTestId("move-qty-71-0")).toHaveValue("12");
    await expect(screen.getByTestId("move-qty-73-0")).toHaveValue("5");
    await expect(screen.getByTestId("move-qty-74-0")).toHaveValue("8");
    await expect(screen.getAllByTestId("move-problem")[0]).toHaveTextContent(/choose where/i);
    await expect(screen.getByTestId("move-submit")).toBeDisabled();

    await pickRack("move-default-to", 43n);
    await waitFor(() => expect(screen.getByTestId("move-submit")).toBeEnabled());
  },
};

// The source rack is never a destination: it is not even offered.
export const TheSourceRackIsNotOffered: Story = {
  name: "Source rack not offered",
  play: async () => {
    await openMove();

    const trigger = screen.getByTestId("move-default-to");
    const root = trigger.closest<HTMLElement>('[data-scope="select"][data-part="root"]')!;
    await userEvent.click(trigger);
    await within(root).findByTestId("rack-select-option-42");

    await expect(within(root).queryByTestId("rack-select-option-41")).toBeNull();
  },
};

// One product to the same rack twice is one line, not two: Move waits and names it.
export const SameRackTwiceIsOneLine: Story = {
  name: "Same rack twice",
  play: async () => {
    await openMove();

    await pickRack("move-default-to", 42n);
    await type(screen.getByTestId("move-qty-74-0"), "4");
    await userEvent.click(screen.getByTestId("move-split-74"));
    await pickRack("move-to-74-1", 42n);
    await type(screen.getByTestId("move-qty-74-1"), "2");

    await expect(screen.getByTestId("move-problem")).toHaveTextContent(/A-01-2 twice/);
    await expect(screen.getByTestId("move-submit")).toBeDisabled();
  },
};

// ALL OR NOTHING (a-move-is-all-or-nothing): somebody took two Gula a second before the click. The dialog allowed 5;
// the server refuses the WHOLE move and names the product — Kopi did not move either.
export const RefusedWholeWhenALineChanged: Story = {
  name: "Refused whole",
  play: async () => {
    await openMove();

    await pickRack("move-default-to", 42n);
    await type(screen.getByTestId("move-qty-71-0"), "4");
    await type(screen.getByTestId("move-qty-73-0"), "5");

    rackStubScenario.raceBeforeNextWrite = { rackId: 41n, productId: 73n, onHand: 3n };
    await userEvent.click(screen.getByTestId("move-submit"));

    await expect(await screen.findByTestId("move-error")).toHaveTextContent(/Gula Pasir 1kg: only 3 on A-01-1/);
    await expect(screen.getByTestId("move-goods-dialog")).toBeInTheDocument();
    await expect(rackShelf(41n, 71n)).toBe(12n);
    await expect(rackShelf(42n, 71n)).toBe(6n);
  },
};

// A product being counted is LOCKED AT 0 — shown, not hidden, and the server refuses moving it too (RackMove answers
// "being counted"; a-lock-stops-sales-and-cancels-too).
export const ACountedProductIsLocked: Story = {
  name: "Counted product locked",
  render: () => <At42 />,
  play: async () => {
    await userEvent.click(await screen.findByTestId("rack-action-move"));

    await expect(await screen.findByTestId("move-counting-72")).toHaveTextContent(/being counted/i);
    await expect(screen.queryByTestId("move-qty-72-0")).toBeNull();
    await expect(screen.getByTestId("move-qty-71-0")).toBeInTheDocument();
  },
};
