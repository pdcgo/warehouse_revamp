import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { products } from "../../../../.storybook/fixtures";
import { asTeam } from "../../../../.storybook/pageStory";
import { ORDER_CREATE_META, RoutedFromDraft, pickProduct, typeQuantity } from "./kit";

// ORDER CREATE — a key renders only the card it is typed in (#135, the-speed-audits-old-findings-are-fixed-smallest-
// first). The page's stories are grouped by the part of the screen they are about (stories-are-grouped-by-the-part-of-
// the-screen); what they share is ./kit.tsx.
//
// The screen does not change, so nothing ON it shows this: it is read from React's own fibers, as React DevTools (and
// `san audit frontend`'s typing pass) read them. A component that renders gets a new props object or a new hook list on
// its fiber; one React skipped keeps both — so a card whose fiber still holds what it held before the keys did not
// render while they were typed. The card the key is typed in is checked to HAVE rendered, so a probe that stopped
// seeing renders fails instead of passing everything.

const meta = {
  title: "Pages/Order/OrderCreate/Renders",
  ...ORDER_CREATE_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

interface Fiber {
  type: unknown;
  return: Fiber | null;
  alternate: Fiber | null;
  memoizedState: unknown;
  memoizedProps: unknown;
}

// The name React DevTools shows for a fiber's type — a function's, or a forwardRef / memo object's.
function nameOf(type: unknown): string | undefined {
  if (typeof type === "function") return (type as { displayName?: string }).displayName || type.name;
  if (!type || typeof type !== "object") return undefined;

  const t = type as { displayName?: string; render?: { displayName?: string; name: string }; type?: unknown };
  return t.displayName || t.render?.displayName || t.render?.name || nameOf(t.type);
}

// The component a DOM element sits in, by its name — the nearest one above the element's own fiber.
function componentOf(el: Element, name: string): Fiber {
  const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
  if (!key) throw new Error(`no React fiber on ${el.tagName}`);

  // The names on the way up, for the error when the component is not there.
  const path: string[] = [];
  for (let f: Fiber | null = (el as unknown as Record<string, Fiber>)[key]!; f; f = f.return) {
    const own = nameOf(f.type);
    if (own === name) return f;
    if (own) path.push(own);
  }

  throw new Error(`no ${name} above the element: ${path.join(" < ")}`);
}

// What both copies of a component's fiber hold now — a render replaces the props or the hook list of one of them.
function marks(f: Fiber): unknown[] {
  return [f.memoizedProps, f.memoizedState, f.alternate?.memoizedProps, f.alternate?.memoizedState];
}

/** The cards this page draws, each found by a test id inside it and its component's name. */
const CARDS = {
  header: ["order-create-back", "OrderCreateHeader"],
  warehouse: ["order-warehouse-band", "WarehouseBand"],
  receipt: ["order-external-ref-id", "ShippingReceiptCard"],
  orderInfo: ["order-marketplace-total", "OrderInfoCard"],
  contents: ["order-contents-field", "OrderContentsField"],
  lines: ["order-create-add-line", "OrderItemCard"],
  returnMap: ["return-map-empty", "ReturnMappingCard"],
  customer: ["order-create-customer-name", "CustomerInfoForm"],
  extra: ["order-create-buyer-username", "ExtraInfoCard"],
  rail: ["order-create-rail-compact", "RailHeader"],
  submit: ["order-create-save", "NoteAndSubmitCard"],
  // Not a card: the sell price's FIELD inside the order information card. A field reads the form lock's fieldset
  // through a context, which reaches past a memoised card — so this one renders whenever the fieldset does.
  sellPriceField: ["order-marketplace-total", "FieldRoot"],
} as const;

type Card = keyof typeof CARDS;

// A look at the cards' fibers (every card, or the ones named); `rendered()` names those that rendered since.
function look(canvasElement: HTMLElement, cards: Card[] = Object.keys(CARDS) as Card[]) {
  const canvas = within(canvasElement);
  const before = new Map<Card, Set<unknown>>();

  for (const card of cards) {
    const [testId, name] = CARDS[card];
    before.set(card, new Set(marks(componentOf(canvas.getByTestId(testId), name))));
  }

  return {
    rendered(): Card[] {
      return cards.filter((card) => {
        const [testId, name] = CARDS[card];
        const seen = before.get(card)!;
        return marks(componentOf(canvas.getByTestId(testId), name)).some((m) => !seen.has(m));
      });
    },
  };
}

// The form as it settles — the default warehouse, the line's stock, the fee, the credit, a draft's address: each answer
// renders the cards it feeds. Looked at until nothing renders for 400ms, so what the keys render is the keys' own.
async function quietLook(canvasElement: HTMLElement, cards?: Card[]) {
  for (let i = 0; i < 20; i++) {
    const probe = look(canvasElement, cards);
    await new Promise((resolve) => setTimeout(resolve, 400));
    if (probe.rendered().length === 0) return look(canvasElement, cards);
  }

  throw new Error("the form never went quiet");
}

// A line on the order, its stock and its fee read — the ground a key is typed on.
async function withALine(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);

  await waitFor(() => expect(canvas.getByTestId("order-create-add-line")).toBeVisible(), { timeout: 5000 });
  await pickProduct(canvasElement, products[0]!.id);
  await waitFor(() => expect(canvas.getByTestId("order-line-stock-0")).toHaveTextContent("40"), { timeout: 5000 });
}

// A KEY IN THE BUYER'S NAME RENDERS THE CUSTOMER CARD — not the lines, the pickers, the calendars, the money rail's
// header or Create (still held: nothing else is filled, so its reason did not change).
export const ABuyerNameKeyRendersOnlyTheCustomerCard: Story = {
  name: "Buyer name renders its card",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await withALine(canvasElement);

    const probe = await quietLook(canvasElement);
    const name = canvas.getByTestId("order-create-customer-name");
    await userEvent.type(name, "Bu Ani", { delay: 40 });
    await waitFor(() => expect(name).toHaveValue("Bu Ani"));

    await expect(probe.rendered()).toEqual(["customer"]);
  },
};

// A QUANTITY RENDERS THE LINES (and, once priced, the money it changes) — never the customer card, the receipt, the
// order's information, the return map (the same products are on the order) or the header.
export const AQuantityKeyLeavesTheOtherCardsAlone: Story = {
  name: "Quantity renders the lines",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await withALine(canvasElement);

    const probe = await quietLook(canvasElement);
    await typeQuantity(canvasElement, 0, "2");
    await waitFor(() => expect(canvas.getByTestId("order-line-qty-0")).toHaveValue("2"));

    const rendered = probe.rendered();
    await expect(rendered).toContain("lines");
    const untouched: Card[] = ["header", "warehouse", "receipt", "orderInfo", "contents", "returnMap", "customer"];
    for (const card of [...untouched, "extra", "rail", "sellPriceField"]) {
      await expect(rendered).not.toContain(card);
    }
  },
};

// ON A DRAFT, A KEY ELSEWHERE LEAVES THE CUSTOMER CARD ALONE — the draft's address as the marketplace wrote it rides
// beside the picker as an element of its own, made once per draft, so a key in the buyer's username renders only its
// card and not the customer card it is handed to.
export const OnADraftTheCustomerCardKeepsItsAddressText: Story = {
  name: "Draft keeps the customer card",
  render: () => <RoutedFromDraft />,
  // The drafts are Toko Melati's.
  beforeEach: asTeam(12n),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-create-customer-name")).toHaveValue("Bu Lestari"), {
      timeout: 4000,
    });
    await waitFor(() => expect(canvas.getByTestId("draft-address-text")).toBeVisible(), { timeout: 4000 });

    const cards: Card[] = ["header", "receipt", "orderInfo", "customer", "extra", "rail", "sellPriceField"];
    const probe = await quietLook(canvasElement, cards);
    const username = canvas.getByTestId("order-create-buyer-username");
    // The draft brought "lestari.shop"; two keys after it.
    await userEvent.type(username, "88", { delay: 40 });
    await waitFor(() => expect(username).toHaveValue("lestari.shop88"));

    await expect(probe.rendered()).toEqual(["extra"]);
  },
};
