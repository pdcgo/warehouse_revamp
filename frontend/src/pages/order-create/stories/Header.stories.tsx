import { useMemo } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Text } from "@chakra-ui/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { expect, screen, spyOn, userEvent, waitFor, within } from "storybook/test";

import { products } from "../../../../.storybook/fixtures";
import { asTeam } from "../../../../.storybook/pageStory";
import { closeShopForStory } from "../../../../.storybook/shopStub";
import { orderDraftClient, productClient } from "../../../api/clients";
import { OrderCreatePage } from "../index";
import {
  ORDER_CREATE_META,
  RoutedFromDraft,
  RoutedFromDraft202,
  asMelatiWithMaps,
  routes,
  typeQuantity,
} from "./kit";

// ORDER CREATE — Back and its guard; the form opened from a draft (and a draft on a closed shop) or from a product's page.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Order/OrderCreate/Header",
  ...ORDER_CREATE_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// A half-typed order is real work — several lines, an address, a customer on the phone — and a
// mis-aimed click on Back threw all of it away silently. The guard only fires while the form is
// DIRTY, so "opened it, changed my mind" is untouched.
export const LeavingWithUnsavedWorkAsksFirst: Story = {
  name: "Unsaved, asks first",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("order-create-customer-name"), "Bu Ani", { delay: 40 });
    await userEvent.click(canvas.getByTestId("order-create-back"));

    // Blocked: the dialog is up and the page is still here.
    await expect(await screen.findByTestId("confirm-action")).toBeInTheDocument();
    await expect(canvas.getByTestId("order-create-page")).toBeInTheDocument();
  },
};

// …and confirming lets it through. The other half of the rule: a guard that cannot be dismissed is a
// trap rather than a safety net.
export const ConfirmingTheDiscardLeaves: Story = {
  name: "Discard leaves",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("order-create-customer-name"), "Bu Ani", { delay: 40 });
    await userEvent.click(canvas.getByTestId("order-create-back"));

    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await userEvent.click(confirm);

    await waitFor(() => expect(screen.getByTestId("at-orders")).toBeInTheDocument());
  },
};

// ── A RE-READ ON DEMAND (no-global-store-every-read-is-a-query-hook — every read is a query, always fresh) ─────────
//
// A button beside the page asks the given reads again, as another screen's write would (an invalidation). The form
// takes each seed ONCE (formState.ts): whatever the read answers next, what is on the form stays the person's.
function StoryReread({ queryKey }: { queryKey: string[] }) {
  const client = useQueryClient();

  return (
    <Button size="xs" mt="4" data-testid="story-reread" onClick={() => void client.invalidateQueries({ queryKey })}>
      Read it again
    </Button>
  );
}

/** The page's routes with the re-read button standing beside the form. */
function withReread(queryKey: string[]) {
  return routes.map((route) =>
    route.path === "/order-create"
      ? {
          ...route,
          element: (
            <>
              <OrderCreatePage />
              <StoryReread queryKey={queryKey} />
            </>
          ),
        }
      : route,
  );
}

/** How many times a spied client method has been called so far. */
function callsOf(method: unknown): number {
  return (method as { mock: { calls: unknown[] } }).mock.calls.length;
}

// ── A draft opens in this form (`the-draft-opens-in-the-order-form`) ──────────────────────────────────────

// SEEDED FROM THE DRAFT — the buyer, the shop, the warehouse; NO line (a draft stores no mapping, a-draft-stores-no-mapping
// — the person picks our products); its scraped lines are a list of TEXT above the products; the header says which
// draft, with Delete Draft beside it; and there is no Save as Draft — a draft is finished here, not drafted again.
export const ADraftOpensInTheForm: Story = {
  name: "From a draft",
  render: () => <RoutedFromDraft />,
  // The drafts are Toko Melati's.
  beforeEach: asTeam(12n),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-create-customer-name")).toHaveValue("Bu Lestari"), {
      timeout: 4000,
    });
    await expect(canvas.getByTestId("order-create-draft-ref")).toHaveTextContent("Draft MEL-9001");
    await expect(canvas.getByTestId("order-create-delete-draft")).toBeVisible();
    await expect(canvas.queryByTestId("order-create-save-draft")).toBeNull();

    const hints = canvas.getByTestId("draft-product-hints");
    await expect(within(hints).getAllByRole("listitem")).toHaveLength(3);
    await expect(canvas.getByTestId("draft-product-hint-0")).toHaveTextContent("2 × Kopi Arabika Gayo 250gr Biji Sangrai");
    await expect(canvas.getByTestId("draft-product-hint-2")).toHaveTextContent("Mug Keramik Motif Batik (bonus)");
    // A hint, not a row: no table, no picker, no input inside it.
    await expect(within(hints).queryAllByRole("textbox")).toHaveLength(0);
    // In a card of its own colour — a faded sand (draftHint.bg), never a role's tint — titled, and naming the app that
    // pushed it.
    await expect(getComputedStyle(hints).backgroundColor).toBe("rgb(251, 247, 239)");
    await expect(hints).toHaveTextContent("Products to Send");
    await expect(canvas.getByTestId("draft-product-hints-source")).toHaveTextContent("From ScraperX");

    // Nothing scraped is on the order: the lines are the person's to pick.
    await expect(canvas.getByTestId("order-create-no-products")).toBeInTheDocument();
    await expect(canvas.queryByTestId("order-line-0")).toBeNull();
  },
};

// The form opened from draft 201, with the re-read button beside it.
function RoutedFromDraftWithReread() {
  const router = useMemo(
    () => createMemoryRouter(withReread(["orderDrafts"]), { initialEntries: ["/order-create?draft=201"] }),
    [],
  );

  return <RouterProvider router={router} />;
}

// The draft answers AGAIN, and differently — another buyer, another phone, another ref — the way a re-read after an edit
// elsewhere would. The ref is what the header reads live, so the story can see the second answer arrive.
function aRereadOfTheDraftDiffers() {
  asTeam(12n)();
  const real = orderDraftClient.orderDraftDetail.bind(orderDraftClient);
  let answers = 0;
  const spy = spyOn(orderDraftClient, "orderDraftDetail").mockImplementation(async (...args) => {
    const res = await real(...args);
    answers += 1;
    if (answers === 1 || !res.draft) return res;

    return {
      ...res,
      draft: { ...res.draft, customerName: "Bu Sekar", customerPhone: "089900001111", externalId: "MEL-9001-B" },
    };
  });

  return () => spy.mockRestore();
}

// SEEDED ONCE (the-draft-opens-in-the-order-form: *"seeded, once … After that the form is the person's"*). The draft is
// read again while the buyer's name is being changed, and answers differently: the name stays as typed, and a field
// nobody touched keeps the FIRST answer — the form never takes a draft's values twice.
export const ARereadOfTheDraftKeepsWhatWasTyped: Story = {
  name: "A re-read of the draft keeps what was typed",
  render: () => <RoutedFromDraftWithReread />,
  beforeEach: aRereadOfTheDraftDiffers,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-create-customer-name")).toHaveValue("Bu Lestari"), {
      timeout: 4000,
    });
    const phone = (canvas.getByTestId("order-create-customer-phone") as HTMLInputElement).value;
    await expect(phone).not.toBe("089900001111");

    const name = canvas.getByTestId("order-create-customer-name");
    await userEvent.clear(name);
    await userEvent.type(name, "Pak Budi", { delay: 40 });

    await userEvent.click(canvas.getByTestId("story-reread"));
    // The second answer is on the page: the header reads the draft live.
    await waitFor(() => expect(canvas.getByTestId("order-create-draft-ref")).toHaveTextContent("Draft MEL-9001-B"), {
      timeout: 5000,
    });
    await expect(callsOf(orderDraftClient.orderDraftDetail)).toBe(2);

    await expect(canvas.getByTestId("order-create-customer-name")).toHaveValue("Pak Budi");
    await expect(canvas.getByTestId("order-create-customer-phone")).toHaveValue(phone);
  },
};

// LEAVING AN UNTOUCHED DRAFT ASKS NOTHING — the form opened filled, but nothing was changed, and the draft is still on
// the list. Only work done here is worth a "discard?".
export const LeavingAnUntouchedDraftAsksNothing: Story = {
  name: "Untouched draft",
  render: () => <RoutedFromDraft />,
  // The drafts are Toko Melati's.
  beforeEach: asTeam(12n),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-create-customer-name")).toHaveValue("Bu Lestari"), {
      timeout: 4000,
    });
    await userEvent.click(canvas.getByTestId("order-create-back"));
    await waitFor(() => expect(canvas.getByTestId("at-orders")).toBeInTheDocument());
  },
};

// DELETE DRAFT CONFIRMS, then goes back to the drafts list.
export const DeletingTheDraftGoesBackToTheList: Story = {
  name: "Delete draft",
  render: () => <RoutedFromDraft />,
  // The drafts are Toko Melati's.
  beforeEach: asTeam(12n),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId("order-create-delete-draft", {}, { timeout: 4000 }));
    const dialog = await screen.findByRole("alertdialog");
    await waitFor(() => expect(dialog).toBeVisible());
    await expect(dialog).toHaveTextContent("MEL-9001");

    await userEvent.click(within(dialog).getByTestId("confirm-action"));
    await waitFor(() => expect(canvas.getByTestId("at-drafts")).toBeInTheDocument());
  },
};

// A WAITING DRAFT ON A CLOSED SHOP (a-close-leaves-the-drafts-waiting, the-close-shop-prototype-is-accepted): draft 202's
// Melati Store was closed. The form keeps the shop — badged, never cleared — says at the top that the shop is closed and
// what the ways out are, and holds Create; Delete Draft is still there.
export const ADraftOnAClosedShopKeepsItAndRefusesCreate: Story = {
  name: "Draft on a closed shop",
  render: () => <RoutedFromDraft202 />,
  beforeEach: [asMelatiWithMaps, () => closeShopForStory(22n)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-create-customer-name")).toHaveValue("Pak Mamat"), {
      timeout: 4000,
    });
    await waitFor(() => expect(canvas.getByTestId("shop-select")).toHaveValue("Melati Store"), { timeout: 4000 });

    const alert = await canvas.findByTestId("order-create-shop-closed");
    await expect(alert).toHaveTextContent("Melati Store is closed");
    await expect(alert).toHaveTextContent(/Delete the draft, or ask the team's owner or admin to reopen the shop/);
    await expect(canvas.getByTestId("order-create-save")).toBeDisabled();
    await expect(canvas.getByTestId("order-create-delete-draft")).toBeVisible();

    await userEvent.click(canvas.getByTestId("shop-select"));
    const kept = await canvas.findByTestId("shop-select-option-22");
    await waitFor(() => expect(kept).toBeVisible());
    await expect(within(kept).getByTestId("shop-select-closed-22")).toBeVisible();
  },
};

// ── Opened from a product's page (a-product-page-opens-the-order-and-restock-forms) ─────────────────────────────────

const GULA_ID = products.find((p) => p.name === "Gula Pasir 1kg")!.id;

// The discover detail of Gula opened this form, with Gudang Pusat picked — so the address carries `?product=` and
// `&warehouse=`, and the navigation's state says where it came from. `reread` stands the re-read button beside it.
function RoutedFromProductPage({ reread }: { reread?: string[] }) {
  const router = useMemo(
    () =>
      createMemoryRouter(
        [
          ...(reread ? withReread(reread) : routes),
          { path: "/products/discover/:productId", element: <Text data-testid="at-product-page">Product</Text> },
        ],
        {
          initialEntries: [
            { pathname: "/order-create", search: `?product=${GULA_ID}&warehouse=11&qty=3`, state: { from: `/products/discover/${GULA_ID}` } },
          ],
        },
      ),
    [],
  );

  return <RouterProvider router={router} />;
}

// THE PRODUCT IS THE FIRST LINE, at the quantity chosen on the page (the-order-and-restock-start-on-the-page) — and Back,
// the form untouched, returns to the page it was opened from without asking whether to discard anything.
export const OpenedFromAProductPageStartsWithIt: Story = {
  name: "From a product page",
  render: () => <RoutedFromProductPage />,
  beforeEach: asTeam(12n),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-line-0")).toHaveTextContent("Gula Pasir 1kg"), { timeout: 4000 });
    await expect(canvas.getByTestId("order-line-qty-0")).toHaveValue("3");

    await userEvent.click(canvas.getByTestId("order-create-back"));
    await waitFor(() => expect(canvas.getByTestId("at-product-page")).toBeInTheDocument());
  },
};

// SEEDED ONCE (a-product-page-opens-the-order-and-restock-forms): the product is the first line ONCE. Read again — as a
// write elsewhere re-reads every product — it puts nothing back: the quantity stays as changed and no second line
// appears.
export const ARereadOfTheProductKeepsTheLineAsChanged: Story = {
  name: "A re-read of the product keeps the line as changed",
  render: () => <RoutedFromProductPage reread={["products"]} />,
  beforeEach: () => {
    asTeam(12n)();
    const spy = spyOn(productClient, "productByIds");

    return () => spy.mockRestore();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-line-0")).toHaveTextContent("Gula Pasir 1kg"), { timeout: 4000 });
    await expect(canvas.getByTestId("order-line-qty-0")).toHaveValue("3");
    await typeQuantity(canvasElement, 0, "5");

    const before = callsOf(productClient.productByIds);
    await userEvent.click(canvas.getByTestId("story-reread"));
    await waitFor(() => expect(callsOf(productClient.productByIds)).toBeGreaterThan(before));
    // The answer is in: give it a render to land on the form.
    await new Promise((resolve) => setTimeout(resolve, 300));

    await expect(canvas.getByTestId("order-line-qty-0")).toHaveValue("5");
    await expect(canvas.queryByTestId("order-line-1")).toBeNull();
  },
};
