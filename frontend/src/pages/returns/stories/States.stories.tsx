import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { asTeam } from "../../../../.storybook/pageStory";
import { ACCEPTED_HERE, RETURNS_META, counts, rowOf, withReturns } from "./kit";

// INVENTARIS › RETUR — WHAT THE LIST SAYS WHEN IT HAS LITTLE OR MUCH: an empty tab says what fills it, a filter that
// matches nothing clears from the hint (an-empty-list-shows-a-hint), the list pages (HARD RULE 9,
// every-list-pages-with-the-growing-pager), and a selling team is told Retur is a warehouse's.

const meta = {
  title: "Pages/Warehouse/ReturnsPage/States",
  ...RETURNS_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** NO RETURN WAITING — the tab says so, and how one arrives; the counts still read the accepted ones. */
export const AnEmptyTabSaysWhatFillsIt: Story = {
  name: "An empty tab says what fills it",
  beforeEach: withReturns({ waiting: [] }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const empty = await canvas.findByTestId("return-list-empty", {}, { timeout: 4000 });

    await expect(empty).toHaveTextContent("No return is waiting to be accepted.");
    await expect(empty).toHaveTextContent("Receive a Return");
    await expect(canvas.queryByTestId("return-list-empty-clear")).toBeNull();
    await expect(canvas.queryByTestId("return-list-table")).toBeNull();
    await counts(canvasElement, 0, ACCEPTED_HERE.length);

    // Sudah diterima has them.
    await userEvent.click(canvas.getByTestId("return-list-tab-accepted"));
    await rowOf(canvasElement, 103n);
    await expect(canvas.queryByTestId("return-list-empty")).toBeNull();
  },
};

/** NOTHING ACCEPTED YET — Sudah diterima says so. */
export const NothingAcceptedYet: Story = {
  name: "Nothing accepted yet",
  beforeEach: withReturns({ accepted: [] }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await rowOf(canvasElement, 101n);
    await userEvent.click(canvas.getByTestId("return-list-tab-accepted"));

    await waitFor(() => expect(canvas.getByTestId("return-list-empty")).toHaveTextContent("No return has been accepted yet."));
  },
};

/** NOTHING MATCHES — the hint says so, clears from here, and the pager stays (an-empty-list-shows-a-hint). */
export const NothingMatchesSaysSoAndClears: Story = {
  name: "Nothing matches says so and clears",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await rowOf(canvasElement, 101n);

    await userEvent.type(canvas.getByTestId("return-list-search"), "zzzz", { delay: 20 });
    await waitFor(() => expect(canvas.getByTestId("return-list-empty")).toHaveTextContent("No orders match these filters."));
    await expect(canvas.queryByTestId("return-list-table")).toBeNull();
    await expect(canvas.getByTestId("return-list-pager")).toBeInTheDocument();
    await counts(canvasElement, 0, 0);

    await userEvent.click(canvas.getByTestId("return-list-empty-clear"));
    await rowOf(canvasElement, 101n);
  },
};

/** THE LIST PAGES (HARD RULE 9): eleven waiting returns at ten a page are ten, then one. */
export const TheListPages: Story = {
  name: "The list pages",
  beforeEach: withReturns({
    waiting: [101n, 102n, 103n, 104n, 105n, 106n, 107n, 108n, 109n, 110n, 111n],
    accepted: [],
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const rows = () => canvasElement.querySelectorAll("[data-testid^='return-list-row-']");
    await rowOf(canvasElement, 101n);
    await waitFor(() => expect(rows()).toHaveLength(11));
    await counts(canvasElement, 11, 0);

    await userEvent.click(canvas.getByTestId("return-list-pager-size"));
    const ten = await canvas.findByRole("option", { name: "10" });
    await waitFor(() => expect(ten).toBeVisible());
    await userEvent.click(ten);

    await waitFor(() => expect(rows()).toHaveLength(10));
    await userEvent.click(canvas.getByTestId("return-list-pager-next"));
    await waitFor(() => expect(rows()).toHaveLength(1));
    await rowOf(canvasElement, 101n);
  },
};

/** A SELLING TEAM reaching the address is told Retur is a warehouse's — it has no menu entry for it. */
export const ASellingTeamIsTold: Story = {
  name: "A selling team is told",
  beforeEach: asTeam(12n),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("returns-not-warehouse", {}, { timeout: 4000 })).toBeInTheDocument();
    await expect(canvas.queryByTestId("return-list-page")).toBeNull();
  },
};
