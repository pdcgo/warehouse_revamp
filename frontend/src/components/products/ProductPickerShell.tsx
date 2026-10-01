import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Box,
  Button,
  Checkbox,
  CloseButton,
  Dialog,
  Flex,
  Input,
  Portal,
  Spinner,
  Grid,
  Stack,
  Table,
  Tabs,
  Text,
} from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { productClient, rpcError, teamClient } from "../../api/clients";
import { teamByIdsRowData, teamsByIds } from "../../features/teams/adapt";
import type { Product } from "../../gen/warehouse/product/v1/product_pb";
import { productByIdsRowData, productsFromByIds } from "../../features/products/adapt";
import { Pagination } from "../chrome/Pagination";
import { ProductListItem } from "./ProductListItem";
import type { PickedProduct } from "./ProductSelect";

// The DIALOG half of every product picker: the browse, the ticks, and the Confirm.
//
// It knows nothing about WHICH products it is showing. Four pickers sit on top of it, one per
// catalogue source, and the only thing they vary is a `load` function:
//
//                        product_service              inventory_service
//                        (a catalogue)                (one warehouse)
//     own                OwnProductPicker             OwnStockedProductPicker
//     all                AllProductPicker             AllStockedProductPicker
//
// This used to be ONE component with `catalogs`, `stockedOnly`, `teamId`-as-mode and `readyLens`
// interacting — `stockedOnly` silently switched off two of the others, and `stockWarehouseId` was
// required by a comment rather than by the type. The parts that are genuinely shared (ticks are a
// draft, a search is debounced, a page is ten rows) live here exactly once; the parts that differ
// are four small files where the difference is the whole file.

// PageFilter.limit is validated 1..200 — a dialog page stays small so the list never scrolls far.
export const PAGE_SIZE = 10;

// How many catalogue matches a search resolves before it is handed to inventory as a narrowing.
// Deliberately generous and deliberately FINITE: the request has a max_items, and a term matching
// more than this cannot be answered exactly — so the dialog says the search was capped rather than
// quietly answering about the first 200 products it happened to see.
export const SEARCH_RESOLVE_LIMIT = 200;

// What a picker emits for one product. ONE definition, used by both the page load and the seeded-id
// resolve — they used to build the snapshot inline and separately, which is how the cover could
// reach the caller from one path and not the other.
export function pickedOf(p: Product): PickedProduct {
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    defaultImageUrl: p.defaultImageUrl,
    defaultImageThumbnailUrl: p.defaultImageThumbnailUrl,
  };
}

/** One page of results, as a picker's `load` answers it. */
export interface PickerPage {
  products: Product[];
  /** Total across every page, for the pager. */
  total: number;
  /** The search matched more than it could resolve — surfaced to the person, never swallowed. */
  capped?: boolean;
  /**
   * READY stock per product id, when the SOURCE already knows it.
   *
   * The stocked pickers fill this because the figure is the number their list was built from — asking
   * again would be a second answer to a settled question, and the two could disagree. The catalogue
   * pickers leave it undefined and use `loadBadges` instead.
   */
  ready?: Map<string, bigint>;
}

/** The stock badges for a loaded page, for pickers whose source cannot supply them. */
export interface PickerBadges {
  ready?: Map<string, bigint>;
  ongoing?: Map<string, bigint>;
}

/**
 * One CATALOGUE the dialog can show, as a tab.
 *
 * Several sources become a tab strip, and the tab changes WHICH RPC runs — so the search and the
 * pager below always describe the catalogue named above them.
 *
 * ⚠ TICKS SURVIVE THE SWITCH, and that is the whole reason tabs live INSIDE this component rather
 * than as three sibling pickers a page arranges. A tick is a set of ids, not a filter over the loaded
 * page — the same property that already makes it survive paging and searching. Three separate pickers
 * would be three dialogs, and the selection would die every time somebody crossed a tab.
 */
export interface PickerSource {
  /** Stable identity — the tab's value, and the part of the load key that changes with it. */
  key: string;
  label: string;
  load: (args: { page: number; q: string }) => Promise<PickerPage>;
  loadBadges?: (products: Product[]) => Promise<PickerBadges>;
  /** Extra controls beside the search box, for THIS tab only. */
  filters?: ReactNode;
}

export interface ProductPickerShellProps {
  /**
   * The team the CALL is authorized as — a scope, not a filter. `<= 0n` renders the no-team state
   * rather than calling with a zero, because a missing team must never silently widen a browse.
   */
  scopeTeamId: bigint;
  /** Copy for the no-team state — the two catalogues word it differently. */
  noTeamMessage: string;
  /**
   * Re-run `load` when this changes, and reset to page 1.
   *
   * ⚠ A KEY RATHER THAN THE FUNCTION'S IDENTITY, deliberately. `load` is a closure a variant rebuilds
   * every render, so depending on it would re-fetch forever; depending on nothing would ignore a
   * changed warehouse. The key is the variant stating what its answer actually depends on.
   */
  loadKey: string;
  /** The single source. Ignored when `sources` is given — the active tab supplies its own. */
  load?: (args: { page: number; q: string }) => Promise<PickerPage>;
  /** Fetch READY/ONGOING for the loaded page. Omitted when `load` already returned `ready`. */
  loadBadges?: (products: Product[]) => Promise<PickerBadges>;
  /** Extra controls beside the search box — the owner-team filter, on the all-teams picker. */
  filters?: ReactNode;
  /**
   * SEVERAL catalogues, as tabs. Supersedes `load`/`loadBadges`/`filters`, which then come from
   * whichever tab is active. One entry renders no tab strip — a single catalogue does not need a tab
   * announcing that it is the only one.
   */
  sources?: PickerSource[];
  /**
   * How a row is drawn.
   *
   * - `"list"` (default) — one tappable row per product, the stock figures riding as BADGES on
   *   `ProductListItem`. Compact, and right when the numbers are context for a name.
   * - `"table"` — product, on-the-way and ready as their own COLUMNS. Right when the numbers are
   *   what the decision rests on and rows get compared down a column, which is what buying is.
   *
   * ⚠ The two disagree about ZERO, deliberately. A badge reading "On the way 0" on every row is
   * noise, so the list hides it; a table cell left blank is a HOLE — it reads as "we did not check",
   * which is a different claim. So the table prints 0 and reserves "—" for genuinely unknown.
   */
  layout?: "list" | "table";
  /** The ticked product ids. Re-seeds the draft every time the dialog opens. */
  value: bigint[];
  /** Applied on Confirm with the WHOLE ticked set. An empty array means "cleared" — a legitimate
   * outcome, not an invalid state. */
  onChange: (products: PickedProduct[]) => void;
  disabled?: boolean;
  /** Overrides the default trigger button. */
  trigger?: ReactNode;
}

export function ProductPickerShell({
  scopeTeamId,
  noTeamMessage,
  loadKey,
  load,
  loadBadges,
  filters,
  sources,
  layout = "list",
  value,
  onChange,
  disabled,
  trigger,
}: ProductPickerShellProps) {
  const { t } = useTranslation();

  const [open, setOpen] = useState(false);

  // WHICH CATALOGUE the dialog is showing right now. Held as the source's key rather than an index,
  // so a source list that gains or loses a tab (Priority, once a team has the feature) cannot silently
  // change which tab is selected.
  const [tab, setTab] = useState<string>(sources?.[0]?.key ?? "");

  // The active source, falling back to the first — a `tab` naming a source that has since disappeared
  // must land somewhere real rather than rendering an empty dialog.
  const active = sources?.find((s) => s.key === tab) ?? sources?.[0];

  // One resolved set of behaviour, whether this picker has tabs or not, so everything below is
  // written once. `loadKey` gains the tab, which is what makes a tab change re-fetch and reset paging
  // through the machinery that already exists for a changed warehouse.
  const activeLoad = active?.load ?? load;
  const activeLoadBadges = active?.loadBadges ?? loadBadges;
  const activeFilters = active?.filters ?? filters;
  const activeKey = active ? `${loadKey}:${active.key}` : loadKey;

  // The draft: ticked ids ONLY. Keeping ids (not a filter over the loaded page) is what lets a tick
  // survive paging and searching — page 2 replaces `products`, never `ticked`.
  const [ticked, setTicked] = useState<Set<string>>(new Set());

  // Everything we have ever seen: id -> its sku/name snapshot. Grows from every loaded page, every
  // search hit, and the on-open resolve below; it outlives paging, searching, and closing, so a tick
  // can always be emitted with real data once its product has been seen ONCE.
  const [known, setKnown] = useState<Map<string, PickedProduct>>(new Map());

  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  const [products, setProducts] = useState<Product[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Whether the last search matched more products than it could resolve — surfaced, never swallowed.
  const [searchCapped, setSearchCapped] = useState(false);

  // productId -> READY at the picker's warehouse. A MAP, not a lookup on the product: 0n is falsy, so
  // "has the id" is the only way to tell a real zero (→ "Out of stock") from unknown (→ no badge).
  const [onHand, setOnHand] = useState<Map<string, bigint>>(new Map());

  // productId -> ONGOING across every warehouse. Its own map, because it has its own LENS and its own
  // failure: with no warehouse chosen the ready read does not happen at all, and this one still does.
  const [ongoing, setOngoing] = useState<Map<string, bigint>>(new Map());

  // teamId -> name, for the row badge. Batched per page (TeamByIds), never per row.
  const [teamNames, setTeamNames] = useState<Map<string, string>>(new Map());

  // THE ONE SCROLLER (owner). Held so a new page can be shown from its FIRST row — see below.
  const rowsRef = useRef<HTMLDivElement>(null);

  const noTeam = scopeTeamId <= 0n;

  // Read inside effects WITHOUT making them dependencies: `value` is typically an inline `.map()` (a
  // fresh array identity every render), `known` grows as pages load, and `load`/`loadBadges` are
  // rebuilt every render by the variant — depending on any of them would re-seed, re-resolve or
  // re-fetch in the middle of an edit. `loadKey` is what says when a re-fetch is actually warranted.
  const valueRef = useRef(value);
  valueRef.current = value;
  const knownRef = useRef(known);
  knownRef.current = known;
  const teamNamesRef = useRef(teamNames);
  teamNamesRef.current = teamNames;
  const loadRef = useRef(activeLoad);
  loadRef.current = activeLoad;
  const loadBadgesRef = useRef(activeLoadBadges);
  loadBadgesRef.current = activeLoadBadges;

  // The in-flight on-open resolve, so confirm() can wait for it instead of emitting blanks.
  const resolveRef = useRef<Promise<PickedProduct[]> | null>(null);
  const [confirming, setConfirming] = useState(false);

  // A seeded id has no sku/name until its product is loaded. Resolve the missing ones on open, so a
  // selection the user never scrolls to still Confirms with a real snapshot instead of a blank one.
  //
  // ProductByIds (#138), in ONE call: it resolves ids the caller ALREADY HOLDS whoever owns them,
  // which is exactly this. It replaces a per-id ProductDetail loop — N round-trips for N ticks, and
  // team-scoped, so while browsing all teams a cross-team id could not resolve at all and that tick
  // stayed id-only. An id that still does not come back is preserved as a tick regardless, never
  // dropped (see confirm()).
  //
  // The promise is kept so confirm() can AWAIT it. Confirm is live from the first frame, and a click
  // landing inside this window used to read the not-yet-populated `known` and emit {sku:"", name:""}
  // for ids that were about to resolve — silently replacing the caller's good snapshot with blanks,
  // outcome decided purely by click timing.
  //
  // It resolves TO the products rather than only writing state: after `await`, this render's `known`
  // is still the stale captured value, so confirm() has to read the resolved data itself.
  useEffect(() => {
    if (!open || noTeam) {
      return;
    }

    let cancelled = false;

    const missing = valueRef.current.filter((id) => !knownRef.current.has(id.toString()));
    if (missing.length === 0) {
      resolveRef.current = null;

      return;
    }

    const resolving = (async () => {
      try {
        const res = await productClient.productByIds({
          teamId: scopeTeamId,
          filter: { ids: missing },
          dataRequest: productByIdsRowData(),
        });

        return productsFromByIds(res).map(pickedOf);
      } catch {
        // Deleted, or a scope that cannot see them. The ticks survive; only their labels are unknown.
        //
        // The catch swallows the whole call, so this never rejects — confirm() can await it without a
        // catch of its own, and it always settles, so the button can never hang.
        return [];
      }
    })();

    resolveRef.current = resolving;

    void resolving.then((found) => {
      if (cancelled) {
        return;
      }

      setKnown((prev) => {
        const next = new Map(prev);
        for (const p of found) {
          next.set(p.id.toString(), p);
        }

        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [open, scopeTeamId, noTeam]);

  // Server-side search, debounced, >= 2 characters — mirroring ProductSelect. Below the threshold the
  // term is dropped rather than sent, so the dialog falls back to BROWSING the catalogue (q: "")
  // instead of going blank: a picker with nothing in it is useless.
  useEffect(() => {
    const term = input.trim();
    const effective = term.length >= 2 ? term : "";

    if (effective === q) {
      return;
    }

    const timer = setTimeout(() => {
      setQ(effective);
      setPage(1);
    }, 250);

    return () => clearTimeout(timer);
  }, [input, q]);

  // A changed source is a different list, so page 4 of the old one is meaningless in the new one —
  // and landing past the end of a shorter list reads as "there is nothing here".
  useEffect(() => {
    setPage(1);
  }, [activeKey]);

  // The page load. Only runs while open — a closed dialog costs nothing.
  useEffect(() => {
    if (!open || noTeam || !loadRef.current) {
      return;
    }

    let cancelled = false;

    setLoading(true);
    setError("");

    void (async () => {
      try {
        const res = await loadRef.current!({ page, q });

        if (cancelled) {
          return;
        }

        setProducts(res.products);
        setTotalItems(res.total);
        setSearchCapped(res.capped === true);

        // A source that already knows READY says so, and nothing asks again.
        if (res.ready) {
          setOnHand(res.ready);
          setOngoing(new Map());
        } else if (!loadBadgesRef.current) {
          // Neither the list nor a badge reader can answer — so CLEAR, rather than leaving the
          // previous tab's figures sitting beside a different catalogue's rows. Crossing from a tab
          // that shows stock to one that cannot is the only way to reach this, and stale numbers
          // under new names is the worst of the three possible states.
          setOnHand(new Map());
          setOngoing(new Map());
        }

        // Every product we render is one we can now describe — remember it for Confirm.
        setKnown((prev) => {
          const next = new Map(prev);
          for (const p of res.products) {
            next.set(p.id.toString(), pickedOf(p));
          }
          return next;
        });
      } catch (err) {
        if (!cancelled) {
          setError(rpcError(err));
          setProducts([]);
          setTotalItems(0);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, noTeam, activeKey, q, page]);

  // READY and ONGOING for the products ON THIS PAGE (owner) — for the pickers whose list did not
  // carry them. Per PAGE, not per open: the ask is the ten ids on screen, so paging re-reads and
  // nothing is pulled that nobody looks at.
  //
  // Stock is DECORATION here — the job of this dialog is picking products — so the variant's
  // `loadBadges` swallows its own failures and simply yields no badge.
  useEffect(() => {
    if (!open || noTeam || products.length === 0 || !loadBadgesRef.current) {
      return;
    }

    let cancelled = false;

    void (async () => {
      const badges = await loadBadgesRef.current!(products);

      if (cancelled) {
        return;
      }

      // An empty map is "the read failed or was never made" and shows NO badge, rather than a
      // fabricated 0. The variant is what decides which ids get a real zero — see its `spread`.
      setOnHand(badges.ready ?? new Map<string, bigint>());
      setOngoing(badges.ongoing ?? new Map<string, bigint>());
    })();

    return () => {
      cancelled = true;
    };
  }, [open, noTeam, products]);

  // The owning team's NAME for the row badge. Browsing all teams, a page's rows come from many teams,
  // so this resolves the page's ids in ONE batch and caches them for the component's life — paging
  // back costs nothing. It deliberately does NOT gate `loading`: rows render immediately with
  // ProductListItem's "Team #<id>" fallback and upgrade in place when the names land.
  useEffect(() => {
    if (products.length === 0) {
      return;
    }

    // Unique, non-zero, not already known. TeamByIds requires min_items:1 and unique ids, so an
    // empty set must not become a call.
    const missing = [
      ...new Set(
        products
          .map((p) => p.teamId)
          .filter((id) => id > 0n && !teamNamesRef.current.has(id.toString())),
      ),
    ];

    if (missing.length === 0) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const teams = teamsByIds(await teamClient.teamByIds({ filter: { ids: missing }, dataRequest: teamByIdsRowData() }));

        if (cancelled) {
          return;
        }

        setTeamNames((prev) => {
          const next = new Map(prev);
          for (const [id, team] of Object.entries(teams)) {
            next.set(id, team.name);
          }

          return next;
        });
      } catch {
        // A name is decoration: ProductListItem falls back to "Team #<id>".
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [products]);

  // A NEW SET OF ROWS IS SHOWN FROM ITS FIRST ROW.
  //
  // The rows scroll inside their own box now, and a browser preserves a container's scrollTop across a
  // content swap — so turning the page from halfway down page 1 opened page 2 halfway down, with rows
  // 1..n above the fold nobody had scrolled past. Reading a list from the middle looks like the list
  // starting there.
  //
  // Keyed on `products` rather than on page/q/tab: it is the arrival of the new rows that has to be
  // scrolled to the top, and one dependency covers a page turn, a search and a tab crossing alike.
  useEffect(() => {
    rowsRef.current?.scrollTo({ top: 0 });
  }, [products]);

  // Opening re-seeds the draft from `value` and resets the browse — so a draft discarded by Cancel
  // never leaks into the next open.
  function handleOpenChange(next: boolean) {
    if (next) {
      if (disabled) {
        return;
      }

      setTicked(new Set(valueRef.current.map((id) => id.toString())));
      setInput("");
      setQ("");
      setPage(1);
      setError("");
    }

    setOpen(next);
  }

  function toggle(id: bigint, checked: boolean) {
    const key = id.toString();

    setTicked((prev) => {
      const next = new Set(prev);

      if (checked) {
        next.add(key);
      } else {
        next.delete(key);
      }

      return next;
    });
  }

  // Confirm is ALWAYS available — including at zero ticks, which means "cleared". An id we never
  // managed to resolve is still emitted (id only): the caller asked for it, so dropping it here would
  // quietly delete their selection.
  //
  // It waits for the on-open resolve first. Without that, a click landing while those lookups are in
  // flight emits {sku:"", name:""} for ids that were ABOUT to resolve, and the caller cannot tell
  // that apart from a genuinely unresolvable one — so it overwrites a good snapshot with blanks,
  // decided purely by click timing. The resolve never rejects and always settles, so this cannot
  // hang; the button only shows a spinner while it lands.
  async function confirm() {
    let resolved: PickedProduct[] = [];

    if (resolveRef.current) {
      setConfirming(true);

      try {
        // The resolved value, not `known`: after the await, this render's `known` is still stale.
        resolved = await resolveRef.current;
      } finally {
        setConfirming(false);
      }
    }

    const lookup = new Map(known);
    for (const p of resolved) {
      lookup.set(p.id.toString(), p);
    }

    const picked = [...ticked].map(
      (key) => lookup.get(key) ?? { id: BigInt(key), sku: "", name: "" },
    );

    onChange(picked);
    setOpen(false);
  }

  const count = ticked.size;

  const search = (
    <Input
      placeholder={t("products.searchPlaceholder")}
      value={input}
      disabled={noTeam}
      data-testid="product-picker-search"
      onChange={(e) => setInput(e.target.value)}
    />
  );

  // ⚠ `.has()` then `.get()`, never `.get() ?? undefined`. 0n is a REAL answer ("out of stock") and a
  // missing entry is "we did not manage to ask", and both layouts below render those two
  // differently. Collapsing them is how a failed read starts reading as an empty shelf.
  const readyOf = (key: string) => (onHand.has(key) ? onHand.get(key) : undefined);
  const ongoingOf = (key: string) => (ongoing.has(key) ? ongoing.get(key) : undefined);

  // A column of numbers, right-aligned so the digits line up down the page — and an em dash for
  // unknown, which is a different claim from 0.
  const figure = (n: bigint | undefined) => (n === undefined ? "—" : n.toString());

  const listRows = (
    <Stack gap="1" data-testid="product-picker-list">
      {products.map((p) => {
        const key = p.id.toString();

        return (
          <Checkbox.Root
            key={key}
            checked={ticked.has(key)}
            onCheckedChange={(e) => toggle(p.id, !!e.checked)}
            data-testid={`product-picker-option-${p.id}`}
            w="full"
            px="2"
            py="1"
            borderRadius="md"
            cursor="pointer"
            _hover={{ bg: "bg.subtle" }}
          >
            {/* Checkbox.Root is the row's <label>, so the WHOLE row toggles; the Control LEADS the
                row rather than trailing it (#110 review): ticking down a list is a vertical scan of
                the boxes, and a box parked after each product's name lands somewhere different on
                every row. */}
            <Checkbox.HiddenInput />
            <Flex align="center" gap="card" w="full">
              <Checkbox.Control flexShrink={0} />
              <ProductListItem
                product={p}
                stock={readyOf(key)}
                ongoing={ongoingOf(key)}
                teamName={teamNames.get(p.teamId.toString())}
              />
            </Flex>
          </Checkbox.Root>
        );
      })}
    </Stack>
  );

  // THE TABLE LAYOUT — product, on the way, ready (owner).
  //
  // The two figures stop being decoration on a name and become COLUMNS, because that is how the
  // decision is actually made: buying scans down "what is already coming" and "what is already
  // here", comparing rows against each other rather than reading each row on its own.
  //
  // ⚠ A <label> cannot wrap a <tr>, so the whole-row-toggles behaviour the list layout gets for free
  // has to be wired by hand — see the row's onClick. The checkbox stays a real, focusable control so
  // keyboard use is unaffected.
  // The header rides along at the top of the rows box as it scrolls. A column of bare numbers whose
  // heading has scrolled away is two columns that cannot be told apart — and "on the way" and "ready"
  // are exactly the pair that must never be confused for one another.
  //
  // ⚠ ON THE CELLS, not on `Table.Header`. A sticky `<thead>` is honoured unevenly, and the background
  // has to be painted by whatever is sticky or the rows show through it as they pass under.
  const stickyHead = { position: "sticky", top: "0", zIndex: 1, bg: "bg.panel" } as const;

  const tableRows = (
    // No scroller of its own — the box below owns BOTH axes, so the horizontal bar sits at the bottom
    // of the visible rows instead of at the bottom of a table that is mostly below the fold.
    <Box>
      <Table.Root size="sm" data-testid="product-picker-list">
        <Table.Header>
          <Table.Row>
            {/* The tick column carries no label — the checkbox says what it is. */}
            <Table.ColumnHeader w="0" {...stickyHead} />
            <Table.ColumnHeader {...stickyHead}>{t("productPicker.colProduct")}</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end" {...stickyHead}>{t("productPicker.colOngoing")}</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end" {...stickyHead}>{t("productPicker.colReady")}</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>

        <Table.Body>
          {products.map((p) => {
            const key = p.id.toString();
            const checked = ticked.has(key);

            return (
              <Table.Row
                key={key}
                data-testid={`product-picker-option-${p.id}`}
                cursor="pointer"
                _hover={{ bg: "bg.subtle" }}
                onClick={(e) => {
                  // The checkbox already toggles on its own click. Without this guard the two fire
                  // in the same gesture and cancel out, so ticking a row by its box does nothing —
                  // a bug that looks like a broken checkbox rather than a duplicated handler.
                  if ((e.target as HTMLElement).closest("[data-scope='checkbox']")) {
                    return;
                  }

                  toggle(p.id, !checked);
                }}
              >
                <Table.Cell>
                  <Checkbox.Root
                    checked={checked}
                    onCheckedChange={(e) => toggle(p.id, !!e.checked)}
                    aria-label={p.name || p.sku || key}
                  >
                    <Checkbox.HiddenInput />
                    <Checkbox.Control />
                  </Checkbox.Root>
                </Table.Cell>

                {/* No `stock`/`ongoing` passed: they have their own columns now, and the badges
                    would say the same thing twice on one row. */}
                <Table.Cell>
                  <ProductListItem product={p} teamName={teamNames.get(p.teamId.toString())} />
                </Table.Cell>

                <Table.Cell textAlign="end" data-testid={`product-picker-ongoing-${p.id}`}>
                  {figure(ongoingOf(key))}
                </Table.Cell>

                <Table.Cell textAlign="end" data-testid={`product-picker-ready-${p.id}`}>
                  {figure(readyOf(key))}
                </Table.Cell>
              </Table.Row>
            );
          })}
        </Table.Body>
      </Table.Root>
    </Box>
  );

  const rows = layout === "table" ? tableRows : listRows;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(e) => handleOpenChange(e.open)}
      // A row carries a lot now — cover, name, SKU, team, and two stock badges — and at `md` the name
      // was the only part that could give way, so it clipped while the badges kept their width.
      size="xl"
      scrollBehavior="inside"
    >
      {/* ── THE OVERFLOW RULE: ONLY THE TABLE SCROLLS (owner) ──────────────────────────────────────
          The dialog is a fixed PANEL, and the rows are the one thing inside it that moves:

            ┌ header ─────────────────────────┐  pinned
            │ tabs · [team ▾][search] · notes │  pinned — a filter you cannot see cannot be cleared
            │ ╭ rows ───────────────── ▲ ╮    │  THE ONLY SCROLLER, both axes
            │ ╰──────────────────────── ╯    │
            │ ‹ 3 of 5 ›                      │  pinned — paging never means scrolling first
            └ Cancel  Confirm ────────────────┘  pinned

          `scrollBehavior="inside"` alone gave the whole Body one scrollbar, which scrolled the search
          box, the tab strip and the pager away with the rows: refining a search meant scrolling back
          up to find the box, and turning a page meant scrolling down to find the pager.

          The height is CONSTANT rather than fitted to the rows, and that is the deliberate half. A page
          holds ten rows and the last page holds however many are left, so a fitted dialog changed
          height on the page turn — the footer, and the Confirm button in it, moving out from under the
          cursor that had just clicked Next. A browse surface that keeps its shape is worth the empty
          space a two-row catalogue leaves. */}
      <Dialog.Trigger asChild data-testid="product-picker-trigger">
        {trigger ?? <Button variant="outline" disabled={disabled}>{t("productPicker.trigger")}</Button>}
      </Dialog.Trigger>

      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content
            data-testid="product-picker-dialog"
            // `min()` and not a bare `dvh`: tall enough for a full page of ten on a laptop, and never
            // taller than the viewport on a phone, where `dvh` is also what survives the address bar
            // sliding away mid-scroll.
            h="min(88dvh, 48rem)"
          >
            <Dialog.Header>
              <Dialog.Title>{t("productPicker.title")}</Dialog.Title>
            </Dialog.Header>

            {/* The body itself must NOT scroll — it only divides its height between the pinned chrome
                and the rows box. `minH="0"` is what allows that box to be shorter than its content;
                without it a flex child refuses to shrink below its intrinsic height and the overflow
                pops back out to the body, which is the bug this whole change is about. */}
            <Dialog.Body
              data-testid="product-picker-body"
              display="flex"
              flexDirection="column"
              minH="0"
              overflow="hidden"
            >
              <Stack gap="card" flex="1" minH="0">
                {/* THE FILTER ROW — ONE THIRD to the filter, TWO THIRDS to the search (owner).
                    Today only AllProductPicker brings a filter, and this is its row.

                    They are one decision taken two ways: narrow by WHO owns it, narrow by WHAT it is
                    called. Stacked, the search sat a full control-height below, and the team picker
                    pushed the first product row off the visible part of the dialog.

                    NOT equal halves. The two controls are not equally used: the team filter is a
                    short, occasional narrowing picked from a list, while the search is typed on
                    nearly every visit and holds a product name long enough to be worth reading back.
                    Splitting the row down the middle gave the rarely-touched control the same room
                    as the one carrying the text.

                    It collapses to one column below `sm`, where a third of a phone is not a usable
                    select. */}
                {/* THE CATALOGUE TABS. The tab changes WHICH RPC runs, so the search and the pager
                    below always describe the catalogue named above them — and the ticks cross with
                    you (see PickerSource).

                    One source renders no strip: a tab announcing that it is the only tab is chrome
                    that says nothing. */}
                {sources && sources.length > 1 && (
                  <Tabs.Root value={tab} onValueChange={(e) => setTab(e.value)}>
                    <Tabs.List>
                      {sources.map((s) => (
                        <Tabs.Trigger key={s.key} value={s.key} data-testid={`product-picker-tab-${s.key}`}>
                          {s.label}
                        </Tabs.Trigger>
                      ))}
                    </Tabs.List>
                  </Tabs.Root>
                )}

                {activeFilters ? (
                  <Grid templateColumns={{ base: "1fr", sm: "1fr 2fr" }} gap="card">
                    <Box data-testid="product-picker-filters">{activeFilters}</Box>
                    {search}
                  </Grid>
                ) : (
                  search
                )}

                {/* A search that matched more than it could resolve says so. The alternative is a
                    dialog that quietly answers about the first 200 products it happened to see and
                    looks, to the person searching, exactly like "we do not stock that". */}
                {searchCapped && (
                  <Text fontSize="xs" color="orange.fg" data-testid="product-picker-search-capped">
                    {t("productPicker.searchCapped", { limit: SEARCH_RESOLVE_LIMIT })}
                  </Text>
                )}

                {noTeam ? (
                  <Text color="fg.muted" data-testid="product-picker-no-team">
                    {noTeamMessage}
                  </Text>
                ) : (
                  <>
                    {/* THE SCROLLER. Every state the browse can be in lives inside it — rows, the
                        spinner, the empty line, an error — so the box keeps its place in the layout
                        whichever one is showing, and the pager below never moves. */}
                    <Box
                      ref={rowsRef}
                      flex="1"
                      minH="0"
                      overflow="auto"
                      data-testid="product-picker-scroll"
                    >
                      {error && (
                        <Text color="red.fg" data-testid="product-picker-error">
                          {error}
                        </Text>
                      )}

                      {loading && <Spinner colorPalette="brand" />}

                      {!loading && !error && products.length === 0 && (
                        <Text color="fg.muted" data-testid="product-picker-empty">
                          {t("products.empty")}
                        </Text>
                      )}

                      {!loading && !error && products.length > 0 && rows}
                    </Box>

                    <Pagination
                      count={totalItems}
                      pageSize={PAGE_SIZE}
                      page={page}
                      onPageChange={setPage}
                    />
                  </>
                )}
              </Stack>
            </Dialog.Body>

            {/* CLEAR SITS ON THE LEFT, AWAY FROM THE OTHER TWO (owner).
                It is the only way to untick a selection that is not on the loaded page — including a
                seeded id this scope cannot show at all — so it has to be reachable from every page,
                which is what the pinned footer gives it. The gap is not decoration: Clear discards
                work, and a discard parked next to Confirm is a mis-click away from it. */}
            <Dialog.Footer justifyContent="space-between">
              <Button
                variant="ghost"
                disabled={count === 0}
                data-testid="product-picker-clear"
                onClick={() => setTicked(new Set())}
              >
                {t("productPicker.clear")}
              </Button>

              <Flex gap="3">
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline" data-testid="product-picker-cancel">
                    {t("common.cancel")}
                  </Button>
                </Dialog.ActionTrigger>

                {/* Never disabled by `count` — confirming zero ticks is how a selection gets cleared.
                    `confirming` only shows a spinner while the on-open resolve lands: that always
                    settles, so it cannot become the dead end this component was rolled back for once
                    already. */}
                <Button
                  colorPalette="brand"
                  onClick={() => void confirm()}
                  loading={confirming}
                  data-testid="product-picker-confirm"
                >
                  {t("common.confirm")}
                </Button>
              </Flex>
            </Dialog.Footer>

            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
