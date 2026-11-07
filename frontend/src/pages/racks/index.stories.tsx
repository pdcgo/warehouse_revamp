import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { noRacksAt, rackRow, rackService } from "../../../.storybook/rackStub";
import { asRole } from "../../../.storybook/sessionScenario";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { RacksPage } from "./index";

// The Racks page — the PLACEMENT LIST (the-racks-page-is-the-placement-list): the screen says Racks, the table is
// `placements`. Built against the real server; its stock column is new with the placement pass
// (a-rack-shows-its-stock-count-for-now). Gudang Pusat (11) as its Admin, who may create, edit and delete.
//
// The registry (rackStub.ts): A-01-1 holds 25 (three teams' goods), A-01-2 holds 9, B-02-1 is empty. Gudang Cabang's
// C-01-1 and C-01-2 never show here — a warehouse only ever sees its own racks.

const Routed = routedPage(
  [
    { path: "/inventories/racks", element: <RacksPage /> },
    marker("/inventories/racks/:rackId", "at-rack-detail"),
  ],
  "/inventories/racks",
);

const meta = {
  title: "Pages/Inventory/Racks/RackList",
  component: Routed,
  // No "padded" layout: a page story is framed by its shell's gutter (a-page-story-has-its-shells-gutter).
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: () => {
    asTeam(11n)();
    asRole(Role.WAREHOUSE_ADMIN)();
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function type(el: HTMLElement, value: string) {
  await userEvent.clear(el);
  await userEvent.type(el, value, { delay: 30 });
}

// The list: ordered by code, each rack with how many products it holds and its stock count — 0 shown, not blanked,
// because the empty rack is the one that can be deleted. A-01-1 holds three products (25 units), A-01-2 two (9).
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("rack-row-A-01-1")).toBeInTheDocument();
    await waitFor(() => expect(canvas.getByTestId("rack-stock-A-01-1")).toHaveTextContent("25"));
    await expect(canvas.getByTestId("rack-stock-A-01-2")).toHaveTextContent("9");
    await expect(canvas.getByTestId("rack-stock-B-02-1")).toHaveTextContent("0");
    await expect(canvas.getByTestId("rack-products-A-01-1")).toHaveTextContent("3");
    await expect(canvas.getByTestId("rack-products-A-01-2")).toHaveTextContent("2");
    await expect(canvas.getByTestId("rack-products-B-02-1")).toHaveTextContent("0");
    await expect(canvas.queryByTestId("rack-row-C-01-1")).toBeNull();

    // THE SCREEN RULES (the-racks-follow-the-screen-rules): the page names itself with a line under it, Rak Baru carries
    // its icon, and the growing pager is on screen.
    await expect(canvas.getByRole("heading", { name: "Racks" })).toBeVisible();
    await expect(canvas.getByTestId("open-create-rack").querySelector("svg")).not.toBeNull();
    await expect(canvas.getByTestId("racks-pager")).toBeVisible();

    // THE FIGURES OVER THE LIST (the-rack-list-leads-with-its-figures) — 3 racks, 2 holding stock, 1 empty, 34 pieces;
    // every rack fits the page, so nothing is marked. KOSONG (an-empty-rack-says-so) on B-02-1 alone, under its code.
    await expect(canvas.getByTestId("racks-stat-racks")).toHaveTextContent("3");
    await expect(canvas.getByTestId("racks-stat-filled")).toHaveTextContent("2");
    await expect(canvas.getByTestId("racks-stat-empty")).toHaveTextContent("1");
    await expect(canvas.getByTestId("racks-stat-stock")).toHaveTextContent("34 pcs");
    await expect(canvas.queryByTestId("not-implemented-summary")).toBeNull();
    await expect(canvas.getByTestId("rack-empty-B-02-1")).toHaveTextContent("Empty");
    await expect(canvas.queryByTestId("rack-empty-A-01-1")).toBeNull();
  },
};

// A PHONE (every-page-has-a-mobile-story) — Rak Baru is its icon (a-phone-header-action-is-an-icon), each rack a block:
// its code and name, then how many products and pieces (a-phone-reads-each-line-as-a-block); nothing runs past the
// screen's edge (nothing-runs-past-a-phones-edge).
export const Mobile: Story = {
  name: "Mobile",
  globals: { viewport: { value: "mobile1" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const row = await canvas.findByTestId("rack-row-A-01-1", {}, { timeout: 4000 });
    await waitFor(() => expect(row).toHaveTextContent("3 products · 25 pcs"));
    await expect(canvas.getByTestId("open-create-rack")).toHaveAccessibleName("New Rack");
    await expect(canvas.getByTestId("open-create-rack")).toHaveTextContent("");
    await expect(canvas.queryAllByRole("columnheader")).toHaveLength(0);
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

// Search by code or name.
export const Search: Story = {
  name: "Search",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("rack-row-A-01-1");

    await type(canvas.getByTestId("rack-search"), "b-02");

    await waitFor(() => expect(canvas.queryByTestId("rack-row-A-01-1")).toBeNull());
    await expect(canvas.getByTestId("rack-row-B-02-1")).toBeInTheDocument();
  },
};

// THE SEARCH LIVES IN THE URL (a-lists-filters-live-in-the-url) — opened at a URL, the list is narrowed by it; a new
// search is written back.
const AtFilteredUrl = routedPage(
  [{ path: "/inventories/racks", element: <><RacksPage /><LocationProbe /></> }],
  "/inventories/racks?q=b-02",
);

export const FiltersLiveInTheUrl: Story = {
  name: "In the URL",
  render: () => <AtFilteredUrl />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const search = await canvas.findByTestId("rack-search", {}, { timeout: 4000 });
    const location = canvas.getByTestId("location-search");

    await expect(search).toHaveValue("b-02");
    await expect(await canvas.findByTestId("rack-row-B-02-1")).toBeInTheDocument();
    await expect(canvas.queryByTestId("rack-row-A-01-1")).toBeNull();

    await type(search, "a-01");
    await waitFor(() => expect(location).toHaveTextContent("?q=a-01"));
  },
};

// A new rack is listed at once, holding nothing.
export const CreateRack: Story = {
  name: "Create",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("rack-row-A-01-1");

    await userEvent.click(canvas.getByTestId("open-create-rack"));
    await type(await screen.findByTestId("rack-code"), "C-03-1");
    await type(screen.getByTestId("rack-name"), "Rak dekat pintu");
    await userEvent.click(screen.getByTestId("submit-rack"));

    await expect(await canvas.findByTestId("rack-row-C-03-1")).toBeInTheDocument();
    await expect(canvas.getByTestId("rack-stock-C-03-1")).toHaveTextContent("0");
    await expect(canvas.getByTestId("rack-products-C-03-1")).toHaveTextContent("0");
    await expect(rackRow(11n, "C-03-1")?.name).toBe("Rak dekat pintu");
  },
};

// A code is unique among the warehouse's racks: the form says so, and nothing is created.
export const DuplicateCodeIsRefused: Story = {
  name: "Duplicate code",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("rack-row-A-01-1");

    await userEvent.click(canvas.getByTestId("open-create-rack"));
    await type(await screen.findByTestId("rack-code"), "A-01-1");
    await userEvent.click(screen.getByTestId("submit-rack"));

    await expect(await screen.findByTestId("rack-form-error")).toHaveTextContent(/already exists/i);
  },
};

// Edit is the same form, re-opened on the rack.
export const EditRack: Story = {
  name: "Edit",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("rack-row-B-02-1");

    await userEvent.click(canvas.getByTestId("edit-rack-B-02-1"));
    await type(await screen.findByTestId("rack-name"), "Aisle B cadangan");
    await userEvent.click(screen.getByTestId("submit-rack"));

    await waitFor(() => expect(canvas.getByTestId("rack-row-B-02-1")).toHaveTextContent("Aisle B cadangan"));
  },
};

// An empty rack deletes, after a confirm, and leaves the list.
export const DeleteAnEmptyRack: Story = {
  name: "Delete an empty rack",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("rack-row-B-02-1");

    await userEvent.click(canvas.getByTestId("delete-rack-B-02-1"));
    await userEvent.click(await screen.findByTestId("confirm-action"));

    await waitFor(() => expect(canvas.queryByTestId("rack-row-B-02-1")).toBeNull());
    await expect(rackRow(11n, "B-02-1")).toBeUndefined();
  },
};

// A rack holding stock is refused — move the goods off it first, which is what Move Goods on Rack detail is for.
export const DeleteRefusedWhileItHoldsStock: Story = {
  name: "Delete refused, holds stock",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("rack-row-A-01-1");

    await userEvent.click(canvas.getByTestId("delete-rack-A-01-1"));
    await userEvent.click(await screen.findByTestId("confirm-action"));

    await expect(await screen.findByText(/still holds stock/i)).toBeInTheDocument();
    await expect(canvas.getByTestId("rack-row-A-01-1")).toBeInTheDocument();
  },
};

// A row opens the rack's detail page.
export const OpensRackDetail: Story = {
  name: "Opens its detail",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId("rack-row-A-01-1"));

    await expect(await canvas.findByTestId("at-rack-detail")).toBeInTheDocument();
  },
};

// AN EMPTY LIST SAYS WHAT NEXT (an-empty-list-shows-a-hint) — a search with no match offers to clear it.
export const NothingMatches: Story = {
  name: "Nothing matches",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("rack-row-A-01-1");

    await type(canvas.getByTestId("rack-search"), "zzz");
    const empty = await canvas.findByTestId("racks-empty", {}, { timeout: 4000 });
    await expect(empty).toHaveTextContent("No racks found");
    await userEvent.click(within(empty).getByRole("button", { name: "Clear Filters" }));
    await expect(await canvas.findByTestId("rack-row-A-01-1")).toBeInTheDocument();
  },
};

// …and a warehouse with no racks yet is told to register the first, from the hint itself.
export const NoRacksYet: Story = {
  name: "No racks yet",
  beforeEach: () => noRacksAt(11n),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const empty = await canvas.findByTestId("racks-empty", {}, { timeout: 4000 });
    await expect(empty).toHaveTextContent("No racks yet");
    await userEvent.click(within(empty).getByRole("button", { name: "New Rack" }));
    await expect(await screen.findByTestId("rack-code")).toBeVisible();
  },
};

// THE FORM (every-form-field-shows-an-example, a-limited-field-shows-its-count) — every field an example and its count
// against the proto's limit: the code 32, the name 200, the description 500, two rows.
export const FormExamplesAndCounts: Story = {
  name: "Form, examples and counts",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("rack-row-A-01-1");

    await userEvent.click(canvas.getByTestId("open-create-rack"));
    const code = await screen.findByTestId("rack-code");
    await expect(code).toHaveAttribute("placeholder", "e.g. A-01-1");
    await expect(screen.getByTestId("rack-name")).toHaveAttribute("placeholder", expect.stringMatching(/^e.g. /));
    await expect(screen.getByTestId("rack-description")).toHaveAttribute("rows", "2");
    await expect(screen.getByTestId("rack-code-count")).toHaveTextContent("0/32");
    await type(code, "A-09");
    await expect(screen.getByTestId("rack-code-count")).toHaveTextContent("4/32");
    await expect(screen.getByTestId("rack-description-count")).toHaveTextContent("0/500");
  },
};

// PAST ONE PAGE (the-rack-list-leads-with-its-figures) — 18 more racks, 21 in all, 20 a page: *Rak* is the server's 21,
// while Terisi, Kosong and Stok di rak are the page's 20 — and say so, marked `missing`, with the strip over them.
export const FiguresPastOnePage: Story = {
  name: "Figures past one page",
  beforeEach: async () => {
    for (let i = 1; i <= 18; i++) {
      await rackService.rackCreate!(
        { teamId: 11n, code: `C-${String(i).padStart(2, "0")}-1`, name: "", description: "" } as never,
        {} as never,
      );
    }
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("rack-row-A-01-1", {}, { timeout: 4000 });

    await waitFor(() => expect(canvas.getByTestId("racks-stat-racks")).toHaveTextContent("21"));
    await expect(canvas.getByTestId("racks-stat-empty")).toHaveTextContent("18");
    await expect(within(canvas.getByTestId("racks-stat-filled")).getByTestId("not-implemented-pageTotals")).toBeVisible();
    await expect(within(canvas.getByTestId("racks-stat-racks")).queryByTestId("not-implemented-pageTotals")).toBeNull();
    await expect(canvas.getByTestId("not-implemented-summary")).toHaveTextContent("1 part of this screen is not implemented yet");
  },
};
