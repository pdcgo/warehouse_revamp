import { useLocation, useNavigate } from "react-router-dom";
import { Button, Text } from "@chakra-ui/react";
import { expect, waitFor, within } from "storybook/test";

import { orders, teams } from "../../../../.storybook/fixtures";
import { LocationProbe, asTeam, marker, routedPage } from "../../../../.storybook/pageStory";
import { withReturnWarehouse } from "../../../../.storybook/returnConfigurationStub";
import { returnAcceptScenario } from "../../../../.storybook/sessionScenario";
import { PHONE_VIEWPORTS } from "../../../features/warehouseTransfer/storyPhone";
import { ReturnsPage } from "../index";

// STORY-ONLY — what Inventaris › Retur's stories share (index.stories.tsx and ./*.stories.tsx). Imported by stories only.
//
// THE LIVE PAGE ON THE REAL STUBS: OrderList / OrderStat in .storybook/stubTransport.ts answer by status and statuses with
// the server's scope (`readsOrder` — the orders a warehouse ships, and a return addressed to it as a selling team's
// return warehouse), its search, its filters and the asked-date window. No fixture order is a return, so `withReturns`
// reads some in `return` / `return_completed` through the return accept's scenario (returnAcceptStub.ts) for the story.
//
// GUDANG PUSAT (11) reads. Toko Melati (12) returns to Gudang Pusat (the seed); Toko Kenanga (13) to Gudang Cabang (14)
// here — so Gudang Pusat lists Kenanga's returns of the orders IT shipped and cannot accept them.
//
//   waiting  (`return`)            110 Kenanga's, going to Gudang Cabang · 109 Melati's, SHIPPED by Gudang Cabang and
//                                  coming back here · 108 asked 120 days ago · 105 · 102 · 101
//   accepted (`return_completed`)  111 Kenanga's · 104 · 103
//   not a return                   106 (shipping) and the rest — on the warehouse's order list, never here

export const WAREHOUSE = teams[0]!.id; // Gudang Pusat (11)
export const MELATI = 12n;
export const KENANGA = 13n;
export const CABANG = 14n; // Gudang Cabang

/** Gudang Pusat's waiting returns, newest order first — as OrderList answers. */
export const WAITING_HERE = [110n, 109n, 108n, 105n, 102n, 101n];
/** Its accepted returns, newest order first. */
export const ACCEPTED_HERE = [111n, 104n, 103n];
/** Waiting returns addressed to Gudang Cabang — listed (Gudang Pusat shipped them), never accepted here. */
export const GOING_ELSEWHERE = [110n];
/** The one asked long ago — outside a 30-day window. */
export const ASKED_LONG_AGO = 108n;

export const orderById = (id: bigint) => orders.find((o) => o.id === id)!;

/**
 * A `beforeEach`: the stub reads `waiting` in `return` and `accepted` in `return_completed`, and Toko Kenanga returns to
 * `kenangaTo` (0n = no return warehouse). preview.tsx's beforeEach resets all of it before the next story.
 */
export function withReturns({
  waiting = WAITING_HERE,
  accepted = ACCEPTED_HERE,
  kenangaTo = CABANG,
}: { waiting?: bigint[]; accepted?: bigint[]; kenangaTo?: bigint } = {}) {
  return () => {
    returnAcceptScenario.inReturn = [...waiting];
    returnAcceptScenario.accepted = [...accepted];
    withReturnWarehouse(KENANGA, kenangaTo)();
  };
}

/** Where a row landed, the address it carries back — and a Back that goes there, as the accept page's does. */
function Arrived({ testId }: { testId: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const from = (location.state as { from?: string } | null)?.from ?? "";

  return (
    <>
      <Text data-testid={testId}>{location.pathname}</Text>
      <Text data-testid={`${testId}-from`}>{from}</Text>
      <Button data-testid={`${testId}-back`} onClick={() => navigate(from)}>
        Back
      </Button>
    </>
  );
}

const routes = [
  {
    path: "/inventories/returns",
    element: (
      <>
        <ReturnsPage />
        <LocationProbe hidden />
      </>
    ),
  },
  // The accept page (the-return-accept-page-is-accepted) and the order's page have their own stories.
  { path: "/warehouse-orders/:orderId/accept-return", element: <Arrived testId="at-return-accept" /> },
  { path: "/warehouse-orders/:orderId", element: <Arrived testId="at-order" /> },
  marker("/warehouse-orders", "at-warehouse-orders"),
];

/** The list at its own address — the menu's link. */
export const Routed = routedPage(routes, "/inventories/returns");
/** The list opened at an address — a reload, a bookmark. Build it ONCE, at module scope (routedPage). */
export const routedAt = (search: string) => routedPage(routes, `/inventories/returns${search}`);

export const PHONE = { viewport: { value: "phone390" } };
const DESKTOP_1366 = { desktop1366: { name: "Desktop 1366", styles: { width: "1366px", height: "900px" }, type: "desktop" } };

/** The meta every Retur story file spreads — `title` is written in each file (read statically). */
export const RETURNS_META = {
  component: ReturnsPage,
  // No "padded" layout: a page story is framed by its shell's gutter (a-page-story-has-its-shells-gutter).
  parameters: { signedIn: true, dataRouter: true, viewport: { options: { ...PHONE_VIEWPORTS, ...DESKTOP_1366 } } },
  beforeEach: () => {
    asTeam(WAREHOUSE)();
    withReturns()();
  },
  render: () => <Routed />,
};

/** A return's row (desktop) or block (phone), waited for. */
export async function rowOf(canvasElement: HTMLElement, id: bigint): Promise<HTMLElement> {
  return waitFor(
    () => {
      const el = canvasElement.querySelector<HTMLElement>(
        `[data-testid='return-list-row-${id}'], [data-testid='return-list-block-${id}']`,
      );
      if (!el) throw new Error(`return ${id} is not listed`);
      return el;
    },
    { timeout: 4000 },
  );
}

export async function noRowOf(canvasElement: HTMLElement, id: bigint) {
  const canvas = within(canvasElement);
  await waitFor(() => {
    expect(canvas.queryByTestId(`return-list-row-${id}`)).toBeNull();
    expect(canvas.queryByTestId(`return-list-block-${id}`)).toBeNull();
  });
}

/** The returns listed, top to bottom, by order id. */
export function listedIds(canvasElement: HTMLElement): string[] {
  return [...canvasElement.querySelectorAll("[data-testid^='return-list-row-'], [data-testid^='return-list-block-']")].map(
    (el) => el.getAttribute("data-testid")!.replace(/^return-list-(row|block)-/, ""),
  );
}

/** The three tabs' counts — Semua is the two together. */
export async function counts(canvasElement: HTMLElement, waiting: number, accepted: number) {
  const canvas = within(canvasElement);
  const exactly = (n: number) => new RegExp(`^${n}$`);
  await waitFor(() => expect(canvas.getByTestId("return-list-tab-count-waiting")).toHaveTextContent(exactly(waiting)));
  await waitFor(() => expect(canvas.getByTestId("return-list-tab-count-accepted")).toHaveTextContent(exactly(accepted)));
  await expect(canvas.getByTestId("return-list-tab-count-all")).toHaveTextContent(exactly(waiting + accepted));
}
