import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button, Stack, Text } from "@chakra-ui/react";
import { expect, fn, screen, spyOn, userEvent, waitFor, within } from "storybook/test";

import { products, teams } from "../../../.storybook/fixtures";
import { inventoryClient, productClient } from "../../api/clients";
import { useSaveProduct } from "../../features/products/queries";
import { AllProductPicker } from "./AllProductPicker";
import { AllStockedProductPicker } from "./AllStockedProductPicker";
import { OwnProductPicker } from "./OwnProductPicker";

// THE SHELL'S READS (#121) — every product picker reads through the query cache (features/products/pickerQueries.ts),
// and these stories pin what that buys and what it must not:
//
//   a CATALOGUE page   a picker feed (referenceQuery) — a reopened dialog draws it and asks nothing
//   the STOCK figures  always fresh — re-read on every open, the last answer on screen meanwhile
//   a STOCKED page     stock as a whole — re-read on every open too
//   a search, a page   keeps the rows on screen while the next answer loads; another tab is a first load
//   the seeded ids     resolved on open through the cache; Confirm waits for that answer, never emits blanks
//
// The dialog's own rules (ticks as a draft, Confirm/Cancel, the columns) are pinned in OwnProductPicker.stories.tsx.
const meta = {
  title: "Components/Products/ProductPickerShell",
  component: OwnProductPicker,
  parameters: {
    // The picker chain reads `useTeam()`, which throws outside a TeamProvider.
    signedIn: true,
  },
  args: { teamId: teams[0]!.id, stockWarehouseId: teams[0]!.id, value: [], onChange: fn() },
} satisfies Meta<typeof OwnProductPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

const KOPI = products[0]!; // 71, team 11 — on My Product, matches "Kopi"
const TEH = products[1]!; // 72, team 11 — on My Product, does not
const BERAS = products[3]!; // 74, team 12 — on Other Product, never on team 11's own page

/** How many times a spied client method has been called so far. */
function callsOf(method: unknown): number {
  return (method as { mock: { calls: unknown[] } }).mock.calls.length;
}

/** A promise a story releases by hand — an answer held back to see what the dialog shows while it waits. */
function hold() {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  return { held, release: () => release() };
}

async function openPicker(canvasElement: HTMLElement) {
  await userEvent.click(within(canvasElement).getByTestId("product-picker-trigger"));
  await waitFor(() => expect(screen.getByTestId("product-picker-dialog")).toBeVisible(), { timeout: 5000 });
}

async function cancelPicker() {
  await userEvent.click(screen.getByTestId("product-picker-cancel"));
  await waitFor(() => {
    const dialog = screen.queryByTestId("product-picker-dialog");
    if (dialog) expect(dialog).not.toBeVisible();
  });
}

const rowOf = (id: bigint) => screen.queryByTestId(`product-picker-option-${id}`);

// A REOPENED CATALOGUE ASKS NOTHING. The page is a picker feed (`referenceQuery`, HARD RULE 10's buy-out): the second
// open draws the same rows from the cache with no second ProductList — the effect this replaced re-read on every open.
export const AReopenedCatalogueAsksNothing: Story = {
  name: "A reopened catalogue draws its rows from the cache — no second ProductList",
  beforeEach: () => {
    const spy = spyOn(productClient, "productList");

    return () => spy.mockRestore();
  },
  play: async ({ canvasElement }) => {
    await openPicker(canvasElement);
    await waitFor(() => expect(rowOf(KOPI.id)).toBeVisible(), { timeout: 5000 });
    await expect(callsOf(productClient.productList)).toBe(1);

    await cancelPicker();
    await openPicker(canvasElement);

    await waitFor(() => expect(rowOf(KOPI.id)).toBeVisible(), { timeout: 5000 });
    await expect(callsOf(productClient.productList)).toBe(1);
  },
};

// …BUT THE STOCK FIGURES ARE READ AGAIN. READY and ONGOING are stock, and a stale stock count is not cosmetic: every
// open re-reads them (OwnerStockByIds, once per lens — the warehouse's READY, every warehouse's ONGOING).
export const TheStockFiguresAreReadAgainOnEveryOpen: Story = {
  name: "The READY and ONGOING figures are read again on every open",
  beforeEach: () => {
    const spy = spyOn(inventoryClient, "ownerStockByIds");

    return () => spy.mockRestore();
  },
  play: async ({ canvasElement }) => {
    await openPicker(canvasElement);
    await waitFor(() => expect(screen.getByTestId(`product-picker-ready-${KOPI.id}`)).not.toHaveTextContent("—"), {
      timeout: 5000,
    });
    const firstOpen = callsOf(inventoryClient.ownerStockByIds);
    await expect(firstOpen).toBeGreaterThan(0);

    await cancelPicker();
    await openPicker(canvasElement);

    await waitFor(() => expect(callsOf(inventoryClient.ownerStockByIds)).toBe(firstOpen * 2), { timeout: 5000 });
    await expect(screen.getByTestId(`product-picker-ready-${KOPI.id}`)).not.toHaveTextContent("—");
  },
};

// A STOCKED PAGE IS STOCK — what the building holds, READY with it — so it is re-read on every open as well, the rows
// it had kept on screen meanwhile.
export const AReopenedStockedPickerReadsTheShelfAgain: Story = {
  name: "A reopened stocked picker reads the shelf again",
  beforeEach: () => {
    const spy = spyOn(inventoryClient, "stockedProductList");

    return () => spy.mockRestore();
  },
  render: () => (
    <AllStockedProductPicker teamId={teams[0]!.id} warehouseId={teams[0]!.id} value={[]} onChange={fn()} />
  ),
  play: async ({ canvasElement }) => {
    await openPicker(canvasElement);
    await waitFor(() => expect(rowOf(TEH.id)).toBeVisible(), { timeout: 5000 });
    await expect(callsOf(inventoryClient.stockedProductList)).toBe(1);

    await cancelPicker();
    await openPicker(canvasElement);

    await waitFor(() => expect(callsOf(inventoryClient.stockedProductList)).toBe(2), { timeout: 5000 });
    await waitFor(() => expect(rowOf(TEH.id)).toBeVisible(), { timeout: 5000 });
  },
};

// A SEARCH REFINES THE SAME QUESTION — the rows stay on screen, dimmed under the refresh bar, while the term's answer
// is on its way (HARD RULE 10's pair: always fresh, never blank). Held back here so the wait can be seen.
let searchHeld = hold();

export const ASearchKeepsTheRowsWhileItsAnswerLoads: Story = {
  name: "A search keeps the rows on screen, dimmed, while its answer loads",
  beforeEach: () => {
    searchHeld = hold();
    const real = productClient.productList;
    const spy = spyOn(productClient, "productList").mockImplementation(async (req, options) => {
      if (req.filter?.q) await searchHeld.held;

      return real(req, options);
    });

    return () => {
      searchHeld.release();
      spy.mockRestore();
    };
  },
  play: async ({ canvasElement }) => {
    await openPicker(canvasElement);
    await waitFor(() => expect(rowOf(TEH.id)).toBeVisible(), { timeout: 5000 });

    const search = screen.getByTestId("product-picker-search");
    await userEvent.click(search);
    await userEvent.paste("Kopi");

    // The term is asked (past the debounce) and its answer is held: the last rows are still there, marked as refreshing.
    await waitFor(() => expect(screen.getByTestId("refresh-overlay")).toHaveAttribute("data-busy", "true"), {
      timeout: 5000,
    });
    await expect(rowOf(TEH.id)).toBeInTheDocument();

    searchHeld.release();

    await waitFor(() => expect(rowOf(TEH.id)).toBeNull(), { timeout: 5000 });
    await expect(rowOf(KOPI.id)).toBeInTheDocument();
  },
};

// ANOTHER TAB IS ANOTHER LIST — its first read shows the spinner, never the last tab's rows under the new tab's name.
let otherTabHeld = hold();

export const AnotherTabIsAFirstLoad: Story = {
  name: "Another tab is a first load — the last tab's rows do not stay under it",
  beforeEach: () => {
    otherTabHeld = hold();
    const real = productClient.productDiscover;
    const spy = spyOn(productClient, "productDiscover").mockImplementation(async (req, options) => {
      await otherTabHeld.held;

      return real(req, options);
    });

    return () => {
      otherTabHeld.release();
      spy.mockRestore();
    };
  },
  render: () => (
    <AllProductPicker teamId={teams[0]!.id} stockWarehouseId={teams[0]!.id} value={[]} onChange={fn()} />
  ),
  play: async ({ canvasElement }) => {
    await openPicker(canvasElement);
    await waitFor(() => expect(rowOf(KOPI.id)).toBeVisible(), { timeout: 5000 });

    await userEvent.click(await screen.findByTestId("product-picker-tab-other"));

    // Held: nothing of My Product is drawn under Other Product.
    await waitFor(() => expect(rowOf(KOPI.id)).toBeNull(), { timeout: 5000 });
    await expect(screen.queryByTestId("product-picker-list")).toBeNull();

    otherTabHeld.release();

    await waitFor(() => expect(rowOf(BERAS.id)).toBeInTheDocument(), { timeout: 5000 });
  },
};

// THE SEEDED IDS RESOLVE ON OPEN, AND CONFIRM WAITS FOR THEM. Beras (team 12) is ticked from `value` but never on team
// 11's own page, so its name comes only from the on-open ProductByIds. A Confirm clicked while that answer is held
// spins and then emits the REAL snapshot — never {name: ""} decided by click timing.
let seedHeld = hold();

export const ConfirmWaitsForTheSeededNames: Story = {
  name: "Confirm waits for the seeded ids' names, then emits them",
  args: { value: [BERAS.id] },
  beforeEach: () => {
    seedHeld = hold();
    const real = productClient.productByIds;
    const spy = spyOn(productClient, "productByIds").mockImplementation(async (req, options) => {
      await seedHeld.held;

      return real(req, options);
    });

    return () => {
      seedHeld.release();
      spy.mockRestore();
    };
  },
  play: async ({ args, canvasElement }) => {
    await openPicker(canvasElement);
    await waitFor(() => expect(callsOf(productClient.productByIds)).toBe(1), { timeout: 5000 });

    await userEvent.click(screen.getByTestId("product-picker-confirm"));

    await waitFor(() => expect(screen.getByTestId("product-picker-confirm")).toHaveAttribute("data-loading"));
    await expect(args.onChange).not.toHaveBeenCalled();

    seedHeld.release();

    await waitFor(
      () =>
        expect(args.onChange).toHaveBeenCalledWith([
          expect.objectContaining({ id: BERAS.id, productCode: BERAS.productCode, name: BERAS.name }),
        ]),
      { timeout: 5000 },
    );
    // The one request the wait joined — Confirm sends no second one.
    await expect(callsOf(productClient.productByIds)).toBe(1);
  },
};

// A PRODUCT ADDED ELSEWHERE IS IN THE NEXT OPEN. The catalogue is cached for five minutes, but under `products`: the
// product write's invalidation marks it stale, so the reopened dialog reads again and offers the new one.
function AddThenPick(props: { onChange: (picked: unknown) => void }) {
  const save = useSaveProduct();
  const [added, setAdded] = useState(false);

  return (
    <Stack gap="3" align="start">
      <OwnProductPicker teamId={teams[0]!.id} stockWarehouseId={teams[0]!.id} value={[]} onChange={props.onChange} />
      <Button
        data-testid="story-add-product"
        onClick={async () => {
          await save.mutateAsync({
            fields: {
              teamId: teams[0]!.id,
              productCodePart: "SABUN-1L",
              name: "Sabun Cair 1L",
              description: "",
              categoryId: 0n,
              crossMarkupBps: 0,
              crossLocked: false,
              reservedStock: 0,
            },
          });
          setAdded(true);
        }}
      >
        Add Product Elsewhere
      </Button>
      {added && <Text data-testid="story-product-added">added</Text>}
    </Stack>
  );
}

export const AProductAddedElsewhereIsInTheNextOpen: Story = {
  name: "A product added elsewhere is offered on the next open",
  render: (args) => <AddThenPick onChange={args.onChange} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await openPicker(canvasElement);
    await waitFor(() => expect(rowOf(KOPI.id)).toBeVisible(), { timeout: 5000 });
    await expect(within(screen.getByTestId("product-picker-dialog")).queryByText("Sabun Cair 1L")).toBeNull();
    await cancelPicker();

    await userEvent.click(canvas.getByTestId("story-add-product"));
    await canvas.findByTestId("story-product-added", {}, { timeout: 5000 });

    await openPicker(canvasElement);
    await waitFor(
      () => expect(within(screen.getByTestId("product-picker-dialog")).getByText("Sabun Cair 1L")).toBeVisible(),
      { timeout: 5000 },
    );
  },
};
