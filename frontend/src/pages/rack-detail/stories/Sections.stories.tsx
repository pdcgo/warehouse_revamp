import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "@chakra-ui/react";
import { useNavigate } from "react-router-dom";
import { expect, screen, spyOn, userEvent, waitFor, within } from "storybook/test";

import { routedPage } from "../../../../.storybook/pageStory";
import { callsOf } from "../../../../.storybook/holdRpc";
import { rackStubScenario } from "../../../../.storybook/rackStub";
import { rackClient } from "../../../api/clients";
import { RackDetailPage } from "../index";
import { RACK_DETAIL_META, loaded, openMove, openSample, pickRack, stock, type } from "./kit";

// RACK DETAIL — the page's shape: one page of sections under a nav (a-rack-page-is-one-page-of-sections), the product
// page's and the restock pages' — no tabs. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Racks/RackDetail/Sections",
  ...RACK_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// THREE SECTIONS ON ONE PAGE, IN THE NAV'S ORDER — what is on the shelf first, then the rack's record, then what has
// happened to it; none behind a tab, and no pair reading twice: Produk carries the price and the value (this staff member
// reads them too — the 🔄 2026-11-20 line of a-warehouse-sees-ready-value-but-a-shelf-only-units), Riwayat the Penempatan
// chip. Produk is lit as the page opens.
export const OnePageOfSections: Story = {
  name: "One page of sections",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const nav = canvas.getByTestId("section-nav");

    await expect([...nav.querySelectorAll<HTMLElement>("[data-section]")].map((el) => el.dataset.section)).toEqual([
      "products",
      "info",
      "history",
    ]);
    await expect(canvas.getByTestId("section-nav-products")).toHaveAttribute("aria-current", "location");
    for (const panel of ["products", "info", "history"]) {
      await expect(canvas.getByTestId(`rack-${panel}-panel`)).toBeInTheDocument();
    }
    await expect(canvas.queryByRole("tablist")).toBeNull();

    // Produk is priced — the Harga tab's two columns are its own.
    await waitFor(() => expect(stock(canvas).getByTestId("rack-unit-cost-71")).toHaveTextContent(/^Rp/));
    await expect(stock(canvas).getByTestId("rack-line-value-71")).toHaveTextContent(/^Rp/);
    await expect(canvas.getByTestId("rack-info-code")).toHaveTextContent("A-01-1");
    // Info's three labels are words, never a raw i18n key (`racks.detail.description` was missing from both catalogues).
    const info = canvas.getByTestId("rack-info-panel");
    await expect(info).toHaveTextContent("Code");
    await expect(info).toHaveTextContent("Name");
    await expect(info).toHaveTextContent("Description");
    await expect(info).not.toHaveTextContent("racks.detail");
    await expect(canvas.getByTestId("rack-history-filter-all")).toHaveAttribute("aria-pressed", "true");
  },
};

// A NAV CLICK JUMPS THERE AND LIGHTS IT (a-nav-jump-blinks-where-it-lands) — Riwayat, the last section.
export const TheNavJumps: Story = {
  name: "Nav jumps",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("section-nav-history"));
    await waitFor(() => expect(canvas.getByTestId("section-nav-history")).toHaveAttribute("aria-current", "location"));
    await waitFor(() => expect(canvas.getByTestId("rack-history-panel").getBoundingClientRect().top).toBeLessThan(window.innerHeight));
  },
};

// A REFRESH MOVES NOTHING (motion-is-small-quick-and-shared; HARD RULE 10, never blanks while it refreshes). A write on
// the page — here a sample — reads the header, the shelf and the history again, and the page that is already drawn
// STAYS: no skeleton comes back, nothing re-mounts, and the new figures land in place. The skeleton is the FIRST load's
// alone. (Backlog #45: the page used to swap itself for its loading skeleton on every re-read, then rise in again.)
export const ARefreshKeepsThePageDrawn: Story = {
  name: "A refresh keeps the page drawn",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("rack-history-table")).toBeInTheDocument());

    const page = canvas.getByTestId("rack-detail-page");
    const shelf = canvas.getByTestId("rack-detail-stock");
    const history = canvas.getByTestId("rack-history-table");

    // Every skeleton drawn on the page from here on, however briefly. The dialog portals outside the canvas.
    const skeletons: string[] = [];
    const watch = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          for (const el of [node, ...node.querySelectorAll("[data-testid]")]) {
            const id = el.getAttribute("data-testid") ?? "";
            if (id.endsWith("-loading")) skeletons.push(id);
          }
        }
      }
    });
    watch.observe(canvasElement, { childList: true, subtree: true });

    // A network the re-read has to wait on, as the live app's does — an instant stub answer lands in the same tick as the
    // refetch starts, and a page that swaps itself for its skeleton while it waits would pass unseen.
    rackStubScenario.readLatencyMs = 400;

    try {
      await openSample();
      await type(await screen.findByTestId("sample-qty-71"), "2");
      await type(screen.getByTestId("sample-recipient"), "Pak Budi");
      await userEvent.click(screen.getByTestId("sample-submit"));

      // While it waits — the page reads again before the dialog closes (the sample's invalidation is awaited, #120) — the
      // shelf's rows stay under RefreshOverlay — dimmed, a thin bar above them — never a skeleton.
      await waitFor(() =>
        expect(within(canvas.getByTestId("rack-products-panel")).getByTestId("refresh-overlay")).toHaveAttribute("data-busy", "true"),
      );
      await waitFor(() => expect(screen.queryByTestId("record-sample-dialog")).toBeNull());

      // The re-read landed: the header, the shelf and the history all say so.
      await waitFor(() => expect(canvas.getByTestId("rack-summary-count")).toHaveTextContent("23"));
      await waitFor(() => expect(stock(canvas).getByTestId("rack-stock-onhand-71")).toHaveTextContent("10"));
      await waitFor(() => expect(canvas.getByTestId("rack-history-table")).toHaveTextContent(/sample/i));
    } finally {
      watch.disconnect();
    }

    await expect(skeletons).toEqual([]);
    await expect(canvas.getByTestId("rack-detail-page")).toBe(page);
    await expect(canvas.getByTestId("rack-detail-stock")).toBe(shelf);
    await expect(canvas.getByTestId("rack-history-table")).toBe(history);
  },
};

// Opened on A-01-1 with a way to change the address to A-01-2 inside the page — the page stays mounted, its rack changes
// (the same route, another :rackId), as a link from another screen would change it.
function JumpToRack42() {
  const navigate = useNavigate();

  return (
    <Button size="xs" variant="outline" data-testid="story-jump-42" onClick={() => navigate("/inventories/racks/42")}>
      A-01-2
    </Button>
  );
}

const At41ThenAnother = routedPage(
  [
    {
      path: "/inventories/racks/:rackId",
      element: (
        <>
          <JumpToRack42 />
          <RackDetailPage />
        </>
      ),
    },
  ],
  "/inventories/racks/41",
);

// ANOTHER RACK IS A FIRST LOAD (HARD RULE 10: a refresh keeps the rows, a different subject does not). The address
// changes from A-01-1 to A-01-2 with the page mounted: it draws its skeleton, then A-01-2 — and never A-01-1's rows under
// A-01-2's code, not even while A-01-2's shelf is still on its way (here its header answers at once, its shelf 800 ms
// later). A-01-1 holds Gula (73), A-01-2 does not (#120: the reads keep previous rows only within the same rack).
export const AnotherRackIsAFirstLoad: Story = {
  name: "Another rack is a first load",
  render: () => <At41ThenAnother />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(stock(canvas).getByTestId("rack-stock-row-73")).toBeInTheDocument();

    // Every skeleton drawn from the jump on, however briefly — and whether A-01-1's Gula is ever on screen under A-01-2.
    const skeletons: string[] = [];
    let leaked = false;
    const watch = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          for (const el of [node, ...node.querySelectorAll("[data-testid]")]) {
            const id = el.getAttribute("data-testid") ?? "";
            if (id.endsWith("-loading")) skeletons.push(id);
          }
        }
      }
      const code = canvasElement.querySelector('[data-testid="rack-info-code"]')?.textContent;
      if (code === "A-01-2" && canvasElement.querySelector('[data-testid="rack-stock-row-73"]')) leaked = true;
    });
    watch.observe(canvasElement, { childList: true, subtree: true, characterData: true });

    rackStubScenario.readLatencyOf = { rackStock: 800 };

    try {
      await userEvent.click(canvas.getByTestId("story-jump-42"));

      // A-01-2's header is drawn while its shelf is still asked for: the shelf shows its skeleton, not A-01-1's rows.
      await waitFor(() => expect(canvas.getByTestId("rack-info-code")).toHaveTextContent("A-01-2"));
      await expect(canvas.queryByTestId("rack-stock-row-73")).toBeNull();
      await expect(canvas.getByTestId("rack-stock-loading")).toBeInTheDocument();

      // Then A-01-2's own: Kopi ×6 and Teh Melati.
      await waitFor(() => expect(stock(canvas).getByTestId("rack-stock-onhand-71")).toHaveTextContent("6"), { timeout: 3000 });
      await expect(stock(canvas).getByTestId("rack-stock-row-72")).toBeInTheDocument();
    } finally {
      watch.disconnect();
    }

    await expect(skeletons).toContain("rack-detail-loading");
    await expect(skeletons).toContain("rack-stock-loading");
    await expect(leaked).toBe(false);
    await expect(stock(canvas).queryByTestId("rack-stock-row-73")).toBeNull();
  },
};

// ANOTHER RACK STARTS ON SEMUA, PAGE ONE (#134) — Riwayat's chip and pager belong to ONE rack. They are the page's now
// (useRackLedger: the ledger is asked beside the rack, never after it), so the address changing to another rack must not
// carry A-01-1's Hanya penempatan over to A-01-2 — as when the section mounted afresh under the new rack: its first read
// is every movement.
export const AnotherRackStartsOnSemua: Story = {
  name: "Another rack starts on Semua",
  render: () => <At41ThenAnother />,
  beforeEach: () => {
    const spy = spyOn(rackClient, "rackHistory");

    return () => spy.mockRestore();
  },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(await canvas.findByTestId("rack-history-filter-placement"));
    await expect(canvas.getByTestId("rack-history-filter-placement")).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(canvas.getByTestId("story-jump-42"));
    await waitFor(() => expect(canvas.getByTestId("rack-info-code")).toHaveTextContent("A-01-2"));
    await waitFor(() => expect(canvas.getByTestId("rack-history-filter-all")).toHaveAttribute("aria-pressed", "true"));

    // Every read of A-01-2's ledger asked for every movement, from page one.
    const asked = callsOf(rackClient.rackHistory)
      .map(([req]) => req as { filter: { rackId: bigint; kinds: number[] }; page: { page: number } })
      .filter((req) => req.filter.rackId === 42n);
    await expect(asked.length).toBeGreaterThan(0);
    for (const req of asked) {
      await expect(req.filter.kinds).toEqual([]);
      await expect(req.page.page).toBe(1);
    }
  },
};

// A WRITE READS EACH PART ONCE (#120 — the speed audit's after-save storm): a move re-reads the header, the shelf's page
// and the history, one RackDetail, one RackStock of 20 and one RackHistory — by invalidation, with nothing of the page's
// own to bump — and NOT the dialog's whole-rack RackStock (its 200, the dialog is closing) nor the pickers' RackList (a
// move renames no rack). The move's invalidation is awaited before the dialog closes, so nothing else is on its way.
export const AWriteReadsEachPartOnce: Story = {
  name: "A write reads each part once",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("rack-history-table")).toBeInTheDocument());

    await openMove();
    await pickRack("move-default-to", 42n);
    await type(screen.getByTestId("move-qty-71-0"), "4");

    // From the click on: what the write makes the page read.
    rackStubScenario.reads = [];
    await userEvent.click(screen.getByTestId("move-submit"));
    await waitFor(() => expect(screen.queryByTestId("move-goods-dialog")).toBeNull());

    // The page read again — the header, the shelf and the history all say so.
    await waitFor(() => expect(stock(canvas).getByTestId("rack-stock-onhand-71")).toHaveTextContent("8"));
    await expect(canvas.getByTestId("rack-summary-count")).toHaveTextContent("21");
    await waitFor(() => expect(canvas.getByTestId("rack-history-table")).toHaveTextContent(/moved/i));
    await new Promise((resolve) => setTimeout(resolve, 300));

    const asked = rackStubScenario.reads.map((read) => (read.method === "rackStock" ? `rackStock:${read.limit}` : read.method));
    await expect(asked.sort()).toEqual(["rackDetail", "rackHistory", "rackStock:20"]);
  },
};
