import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { productLogsForStory, teamCodeScenario } from "../../../../.storybook/teamCodeStub";
import { At, PRODUCT_DETAIL_META, loaded } from "./kit";

// PRODUCT DETAIL — THE RIWAYAT PRODUK CARD (backlog #150, LIVE; the-team-code-and-product-tags-prototype-is-accepted,
// *the history*: its own card after Produk Turunan, with a *Riwayat* nav entry). The acceptance's *product history shows
// old code and new code* (team_code.md givens 1–2), read from ProductLogList (`code_changed`: old code, new code, who,
// when), the person named by one UserByIDs. Minyak (700) went TA-ANG-001 → SL-03-ANG-001 two days ago with its team's
// code, Budi Santoso changing it (.storybook/teamCodeStub.ts).

const meta = {
  title: "Pages/Products/ProductDetail/History",
  ...PRODUCT_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const AtGulaMerah = At(704);

/** The Riwayat card: the change, old → new, who made it and when — a nav item of its own — read ONCE, in the owning
 *  team's scope. */
export const TheHistoryCard: Story = {
  name: "Riwayat card",
  globals: { viewport: { value: "desktop1440" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const card = within(await canvas.findByTestId("pd-section-history", {}, { timeout: 5000 }));

    await expect(card.getByText("Product history")).toBeVisible();
    await waitFor(() => expect(card.getByTestId("product-history-line-9001-old")).toHaveTextContent("TA-ANG-001"));
    await expect(card.getByTestId("product-history-line-9001-new")).toHaveTextContent("SL-03-ANG-001");
    await waitFor(() => expect(card.getByTestId("product-history-line-9001-by")).toHaveTextContent("by Budi Santoso"));
    await expect(card.getByTestId("product-history-line-9001")).toHaveTextContent("Code changed");
    await expect(canvas.getByTestId("section-nav")).toHaveTextContent("History");
    // A side card, after Produk Turunan.
    const side = within(canvas.getByTestId("product-detail-side-column"));
    const derived = side.getByTestId("pd-section-derived");
    await expect(derived.compareDocumentPosition(side.getByTestId("pd-section-history")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Not also in Info — the history is its own card.
    await expect(within(canvas.getByTestId("pd-section-info")).queryByTestId("product-history-line-9001")).toBeNull();
    await expect(teamCodeScenario.logReads).toEqual([{ teamId: 15n, productId: 700n, page: 1, limit: 10 }]);
  },
};

/** A product whose code never changed says so. */
export const NoChangeYet: Story = {
  name: "No change yet",
  render: () => <AtGulaMerah />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(await canvas.findByTestId("product-history-none", {}, { timeout: 5000 })).toHaveTextContent("No changes yet.");
  },
};

/** Root or the Administrator changed the code from outside the team: the line carries the shared "by Root team" badge
 *  (an-override-is-stamped-in-every-service). */
export const AnOverrideIsBadged: Story = {
  name: "Override badge",
  beforeEach: productLogsForStory(700n, 1, { override: true }),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const line = await canvas.findByTestId("product-history-line-9100", {}, { timeout: 5000 });

    await waitFor(() => expect(within(line).getByTestId("root-team-badge")).toBeVisible());
  },
};

/** A long history is paged (HARD RULE 9): ten lines, then the pager reads the next page. */
export const ALongHistoryIsPaged: Story = {
  name: "Paged",
  beforeEach: productLogsForStory(700n, 12),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const card = within(await canvas.findByTestId("pd-section-history", {}, { timeout: 5000 }));

    await waitFor(() => expect(card.getByTestId("product-history-line-9100")).toBeVisible());
    await expect(card.queryByTestId("product-history-line-9110")).toBeNull();

    await userEvent.click(card.getByTestId("product-history-pager-next"));

    await waitFor(() => expect(card.getByTestId("product-history-line-9110")).toBeVisible());
    await expect(teamCodeScenario.logReads.map((r) => r.page)).toEqual([1, 2]);
  },
};

/** On a phone the card stacks after Produk Turunan, before the warehouse card; a code is never cut. */
export const OnAPhone: Story = {
  name: "Phone",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const history = await canvas.findByTestId("pd-section-history", {}, { timeout: 5000 });

    const warehouse = canvas.getByTestId("pd-section-warehouse");
    await expect(history.compareDocumentPosition(warehouse) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const code = await within(history).findByTestId("product-history-line-9001-new", {}, { timeout: 5000 });
    await expect(code.scrollWidth).toBeLessThanOrEqual(code.clientWidth + 1);
    await expect(history.scrollWidth).toBeLessThanOrEqual(history.clientWidth);
  },
};
