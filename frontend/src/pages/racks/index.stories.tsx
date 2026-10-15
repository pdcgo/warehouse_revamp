import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { rackRow } from "../../../.storybook/rackStub";
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
  title: "Pages/Racks/RackList",
  component: Routed,
  parameters: { signedIn: true, dataRouter: true, layout: "padded" },
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
  },
};

// Search by code or name.
export const Search: Story = {
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
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId("rack-row-A-01-1"));

    await expect(await canvas.findByTestId("at-rack-detail")).toBeInTheDocument();
  },
};
