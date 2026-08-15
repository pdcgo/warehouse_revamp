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
  SimpleGrid,
  Stack,
  Tabs,
  Text,
} from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { inventoryClient, productClient, rpcError, teamClient } from "../api/clients";
import { teamByIdsRowData, teamsByIds } from "../features/teams/adapt";
import type { Product } from "../gen/warehouse/product/v1/product_pb";
import {
  ownerStockFromByIds,
  productByIdsRowData,
  productListRowData,
  productsFromByIds,
  productsFromList,
} from "../features/products/adapt";
import { useTeam } from "../features/team/TeamContext";
import { Pagination } from "./Pagination";
import { ProductListItem } from "./ProductListItem";
import { TeamSelect } from "./TeamSelect";
import type { PickedProduct } from "./ProductSelect";

// PageFilter.limit is validated 1..200 — a dialog page stays small so the list never scrolls far.
const PAGE_SIZE = 10;

// How many catalogue matches a search resolves before it is handed to inventory as a narrowing.
// Deliberately generous and deliberately FINITE: the request has a max_items, and a term matching more
// than this cannot be answered exactly — so the dialog says the search was capped rather than quietly
// answering about the first 200 products it happened to see.
const SEARCH_RESOLVE_LIMIT = 200;

// What this dialog emits for one product. ONE definition, used by both the page load and the seeded-id
// resolve — they used to build the snapshot inline and separately, which is how the cover could reach
// the caller from one path and not the other.
function pickedOf(p: Product): PickedProduct {
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    defaultImageUrl: p.defaultImageUrl,
    defaultImageThumbnailUrl: p.defaultImageThumbnailUrl,
  };
}

// Which catalogue a tab shows. "own" is the team's own products (ProductList); "others" is every
// OTHER team's sellable products (ProductDiscover with own-team rows excluded server-side).
export type Catalog = "own" | "others";

export interface ProductPickerProps {
  /**
   * Offer these catalogues as TABS. Two entries → a tab strip; one → that catalogue with no tabs;
   * omitted → the original behaviour, driven by `teamId` alone.
   *
   * It exists because a selling team can put ANOTHER team's product on an order (cross-selling,
   * #106) — but "mine" and "somebody else's" are different decisions with different consequences, so
   * they are two tabs rather than one merged list where the only clue is a team badge.
   */
  catalogs?: Catalog[];
  /**
   * ONLY what the warehouse in `stockWarehouseId` actually holds, paged by inventory_service.
   *
   * An out-of-stock product is not something this warehouse can sell, so it never reaches the dialog
   * (owner). Requires `stockWarehouseId`; the ready figure then comes from the same response the list
   * was built from, so the badge cannot disagree with the row it sits on.
   *
   * ⚠ In this mode the catalogue TABS and the team filter do not apply: the paging lives in
   * inventory, which knows what is on a shelf and nothing about whose catalogue a product is in. The
   * owning team still shows as a badge on each row. Search survives by resolving the term against the
   * catalogue first — capped, and the dialog says so when the cap bites.
   */
  stockedOnly?: boolean;
  /** Which catalogue to browse. SET → only that team's products (ProductList). UNSET → products
   * from ALL teams (ProductDiscover, authorized with the CURRENT team). A caller that means "this
   * team, none selected yet" passes 0n and gets the no-team state — undefined is "all teams", so
   * a missing team must not silently widen the browse. */
  teamId?: bigint;
  /** Show READY stock from THIS warehouse. Stock is held per building (inventory_service owns it),
   * so there is no "total ready" to show and `teamId` cannot stand in for one — a selling team is
   * not a warehouse. Omit it and no ready figure is shown.
   *
   * ONGOING is not gated on this, and deliberately so (owner): it is totalled across EVERY warehouse
   * holding the team's goods, because "have I already bought this?" is a question about the purchase,
   * not about a building. So it appears as soon as there is a catalogue, warehouse chosen or not. */
  stockWarehouseId?: bigint;
  /**
   * WHICH "ready" the badge means. Two callers, two different truths, and they are not
   * interchangeable:
   *
   * - `"owned"` (default) — what this team OWNS at that warehouse, via `OwnerStockByIds`. The right
   *   answer when you are BUYING: a restock asks "how much of mine is already there".
   * - `"available"` — what a PICK would find there, via `StockAvailability`. The right answer when
   *   you are SELLING: an order takes whatever is on the shelf, regardless of which restock brought
   *   it in, so the ownership figure would show 0 for stock the order would happily draw.
   *
   * Getting this wrong is not cosmetic. An order screen showing the owned figure refuses goods the
   * warehouse can plainly ship; a purchasing screen showing the available figure counts another
   * team's stock as yours.
   */
  readyLens?: "owned" | "available";
  /** The ticked product ids. Re-seeds the draft every time the dialog opens. */
  value: bigint[];
  /** Applied on Confirm with the WHOLE ticked set. An empty array means "cleared" — a legitimate
   * outcome, not an invalid state. */
  onChange: (products: PickedProduct[]) => void;
  disabled?: boolean;
  /** Overrides the default trigger button. */
  trigger?: ReactNode;
}

// ProductPicker is the MULTI-select sibling of ProductSelect (#110): where ProductSelect is an inline
// single-pick Combobox, this is a dialog you browse — a paged list of checkboxes with a server-side
// search — for picking several products at once. Ticks are DRAFT state: seeded from `value` on open,
// applied by Confirm, discarded by Cancel/Esc/close.
export const description =
  "Multi-select product picker in a dialog (#110): searchable, paginated, one ProductListItem per row with a checkbox. `teamId` set browses that team's catalogue; unset discovers products across ALL teams. `catalogs={[\"own\",\"others\"]}` turns it into two TABS — My Products and Other Team Products — the second being cross-team discovery with own-team rows excluded server-side; ticks survive switching tabs. It also shows what you already have: READY stock at `stockWarehouseId`, and ONGOING — on order but not yet accepted — totalled across every warehouse. `readyLens` picks which READY it means: \"owned\" (default, OwnerStockByIds — what this team owns there, right when BUYING) or \"available\" (StockAvailability — what a pick would find, right when SELLING, since an order draws whatever is on the shelf). Ticks are a draft — Confirm applies them (an empty list clears), Cancel discards. Emits each picked product's id + sku + name snapshot.";

export function ProductPicker({
  catalogs,
  stockedOnly = false,
  teamId,
  stockWarehouseId,
  readyLens = "owned",
  value,
  onChange,
  disabled,
  trigger,
}: ProductPickerProps) {
  const { t } = useTranslation();
  const { current } = useTeam();

  const [open, setOpen] = useState(false);

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

  // productId -> READY at `stockWarehouseId`. A MAP, not a lookup on the product: 0n is falsy, so
  // "has the id" is the only way to tell a real zero (→ "Out of stock") from unknown (→ no badge).
  const [onHand, setOnHand] = useState<Map<string, bigint>>(new Map());

  // productId -> ONGOING across every warehouse. Its own map, because it has its own LENS and its own
  // failure: with no warehouse chosen the ready read does not happen at all, and this one still does.
  const [ongoing, setOngoing] = useState<Map<string, bigint>>(new Map());

  // teamId -> name, for the row badge. Batched per page (TeamByIds), never per row.
  const [teamNames, setTeamNames] = useState<Map<string, string>>(new Map());

  // WHICH CATALOGUE the dialog is showing right now. With `catalogs` given, the caller has asked for
  // tabs and this is the active one; without it, the old rule stands — `teamId` set browses that one
  // catalogue, unset discovers across every team.
  const [catalog, setCatalog] = useState<Catalog>(catalogs?.[0] ?? "own");

  // "Others" is ProductDiscover with own-team rows excluded SERVER-SIDE. Dropping them here instead
  // would narrow the loaded page while the pager kept counting them.
  const useDiscover = catalogs ? catalog === "others" : teamId === undefined;
  const excludeOwnTeam = catalogs !== undefined && catalog === "others";

  // WHOSE catalogue, on the other-team tab. 0n = everybody's, the default.
  //
  // Only ever sent while discovering: on "My Products" the catalogue is already one team's, so a team
  // filter there could only ever narrow it to itself or to nothing.
  const [ownerTeamId, setOwnerTeamId] = useState<bigint>(0n);
  const ownerFilter = useDiscover ? ownerTeamId : 0n;

  // Discovery still needs a team on the request — ProductDiscover's team_id is an AUTHORIZATION scope
  // (use_scope), not a filter, so it says who is asking rather than narrowing the results.
  const scopeTeamId = teamId ?? current?.teamId ?? 0n;

  // No team to authorize with — degrade to the no-team state rather than calling with 0.
  const noTeam = scopeTeamId <= 0n;

  // Read inside effects WITHOUT making them dependencies: `value` is typically an inline `.map()` (a
  // fresh array identity every render) and `known` grows as pages load — depending on either would
  // re-seed or re-resolve in the middle of an edit.
  const valueRef = useRef(value);
  valueRef.current = value;
  const knownRef = useRef(known);
  knownRef.current = known;
  const teamNamesRef = useRef(teamNames);
  teamNamesRef.current = teamNames;

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

  // The page load. Only runs while open — a closed dialog costs nothing.
  useEffect(() => {
    if (!open || noTeam) {
      return;
    }

    let cancelled = false;

    setLoading(true);
    setError("");

    void (async () => {
      try {
        let found: Product[];
        let total: number;

        if (stockedOnly) {
          // ── THE WAREHOUSE IS THE LIST ────────────────────────────────────────────────────────
          //
          // Paging happens in inventory_service, over the products that warehouse actually HOLDS —
          // out-of-stock products never reach this dialog at all (owner). Filtering them out of a
          // catalogue page instead would show two rows out of ten while the pager counted all ten.
          //
          // A SEARCH still works, and this is the whole dance: names and SKUs live in the catalogue,
          // which inventory cannot see, so the term is resolved to ids there first and passed in as a
          // narrowing. Discover rather than List, so another team's product is findable too.
          let productIds: bigint[] = [];

          if (q !== "") {
            const matched = await productClient.productDiscover({
              teamId: scopeTeamId,
              filter: { q },
              dataRequest: productListRowData(),
              page: { page: 1, limit: SEARCH_RESOLVE_LIMIT },
            });

            productIds = matched.ids;
            setSearchCapped(Number(matched.pageInfo?.totalItems ?? 0n) > SEARCH_RESOLVE_LIMIT);

            // Nothing in the catalogue matched, so nothing in the warehouse can. Said here rather
            // than sent as an empty filter, which inventory would read as "no narrowing at all".
            if (productIds.length === 0) {
              if (!cancelled) {
                setProducts([]);
                setTotalItems(0);
              }

              return;
            }
          } else {
            setSearchCapped(false);
          }

          const listed = await inventoryClient.stockedProductList({
            teamId: scopeTeamId,
            filter: { warehouseId: stockWarehouseId!, productIds },
            page: { page, limit: PAGE_SIZE },
          });

          if (cancelled) {
            return;
          }

          // The ready figure rides along with the list — it is the number the list was built from, so
          // there is no second read to disagree with it.
          setOnHand(new Map(listed.items.map((it) => [it.productId.toString(), it.available])));

          // The NAMES and covers, for this page's ten ids. ProductByIds resolves whoever owns them,
          // which is what lets a warehouse hold another team's goods and still show them properly.
          const details =
            listed.ids.length === 0
              ? []
              : productsFromByIds(
                  await productClient.productByIds({
                    teamId: scopeTeamId,
                    filter: { ids: listed.ids },
                    dataRequest: productByIdsRowData(),
                  }),
                );

          // Back into the order inventory returned, which is the order the pager is built on — the
          // by-ids response is a map and carries no order of its own.
          const byId = new Map(details.map((p) => [p.id.toString(), p]));
          found = listed.ids.map((id) => byId.get(id.toString())).filter((p): p is Product => !!p);
          total = Number(listed.pageInfo?.totalItems ?? 0n);
        } else {
          const req = {
            teamId: scopeTeamId,
            filter: { q },
            dataRequest: productListRowData(),
            page: { page, limit: PAGE_SIZE },
          };
          const res = useDiscover
            ? await productClient.productDiscover({ ...req, excludeOwnTeam, ownerTeamId: ownerFilter })
            : await productClient.productList(req);

          if (cancelled) {
            return;
          }

          found = productsFromList(res.items, res.ids);
          total = Number(res.pageInfo?.totalItems ?? 0n);
        }

        if (cancelled) {
          return;
        }

        setProducts(found);
        setTotalItems(total);

        // Every product we render is one we can now describe — remember it for Confirm.
        setKnown((prev) => {
          const next = new Map(prev);
          for (const p of found) {
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
  }, [open, scopeTeamId, noTeam, stockedOnly, stockWarehouseId, useDiscover, excludeOwnTeam, ownerFilter, q, page]);

  // READY and ONGOING for the products ON THIS PAGE (owner). Two reads, because they are two
  // different questions:
  //
  //   ready   — `warehouse_id` = the destination. What is on a shelf THERE, which is what says
  //             whether that building needs a delivery at all.
  //   ongoing — `warehouse_id` = 0, every warehouse. What is already bought and not yet accepted
  //             ANYWHERE, which is what stops the same order being placed twice.
  //
  // They cannot share a call: `filter.warehouse_id` is one lens over the whole OwnerStockItem, so a
  // single request would have to answer both figures for the same building.
  //
  // OwnerStockByIds, not StockList, and that is the load-bearing change: StockList is policied to
  // WAREHOUSE roles, so a selling team asking about the destination warehouse was denied every time
  // and the catch below silently swallowed it — the badge has never rendered for the people this
  // dialog is for. OwnerStockByIds answers the SELLING side by construction (it establishes ownership
  // through restock_requests.requesting_team_id), which is the same reason this picker is now scoped
  // to one catalogue: it can only tell the truth about products the team actually owns.
  //
  // Per PAGE, not per open: the ask is the ten ids on screen, so paging re-reads and nothing is
  // pulled that nobody looks at. The old code paged up to 1000 whole-warehouse stock rows on every
  // open and joined them client-side, which also meant the 1001st stocked product silently had no badge.
  useEffect(() => {
    // In stocked mode the READY figure arrived WITH the list, from the same query the list was built
    // from. Reading it again here would be a second answer to a question already answered — and the
    // two could disagree, which is worse than not asking twice.
    if (!open || noTeam || products.length === 0 || stockedOnly) {
      return;
    }

    const productIds = products.map((p) => p.id).filter((id) => id > 0n);
    if (productIds.length === 0) {
      return;
    }

    const wantReady = stockWarehouseId !== undefined && stockWarehouseId > 0n;

    let cancelled = false;

    void (async () => {
      // Each read swallows its own failure, so one lens failing never blanks the other. Stock is
      // DECORATION here — the job of this dialog is picking products, and a read the caller has no
      // role for must not take the picker down.
      const ask = (warehouseId: bigint) =>
        inventoryClient
          .ownerStockByIds({ teamId: scopeTeamId, filter: { productIds, warehouseId } })
          .then(ownerStockFromByIds)
          .catch(() => null);

      // The AVAILABLE lens: what a pick would find, which is a different question from what the team
      // owns — see `readyLens`. Same failure rule: it swallows its own error and simply shows no badge.
      const askAvailable = (warehouseId: bigint) =>
        inventoryClient
          .stockAvailability({ teamId: scopeTeamId, warehouseId, productIds })
          .then((res) => new Map(res.items.map((it) => [it.productId.toString(), it.available])))
          .catch(() => null);

      const readyAsk = () => {
        if (!wantReady) {
          return Promise.resolve(null);
        }

        return readyLens === "available"
          ? askAvailable(stockWarehouseId)
          : ask(stockWarehouseId).then((rows) =>
              rows === null
                ? null
                : new Map(productIds.map((id) => [id.toString(), rows.get(id.toString())?.readyQty ?? 0n])),
            );
      };

      const [readyRes, ongoingRes] = await Promise.all([readyAsk(), ask(0n)]);

      if (cancelled) {
        return;
      }

      // ABSENT means ZERO here, not unknown — and only because we named the ids. The response omits a
      // product the team holds none of ("nothing to say travels lighter"), but we asked about every id
      // on the page, so silence about one IS the answer for it. Unknown is the whole map missing: the
      // read failed, or was never made, and then no badge is shown rather than a fabricated 0.
      const spread = (rows: Map<string, { readyQty: bigint; ongoingQty: bigint }> | null, pick: "readyQty" | "ongoingQty") => {
        if (!rows) {
          return new Map<string, bigint>();
        }

        return new Map(productIds.map((id) => [id.toString(), rows.get(id.toString())?.[pick] ?? 0n]));
      };

      // The ready map is already spread over the asked ids by whichever lens produced it; a null one
      // is the read having failed, and stays empty so no badge is shown rather than a fabricated 0.
      setOnHand(readyRes ?? new Map<string, bigint>());
      setOngoing(spread(ongoingRes, "ongoingQty"));
    })();

    return () => {
      cancelled = true;
    };
  }, [open, noTeam, scopeTeamId, stockWarehouseId, readyLens, stockedOnly, products]);

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

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(e) => handleOpenChange(e.open)}
      // A row carries a lot now — cover, name, SKU, team, and two stock badges — and at `md` the name
      // was the only part that could give way, so it clipped while the badges kept their width.
      size="xl"
      scrollBehavior="inside"
    >
      <Dialog.Trigger asChild data-testid="product-picker-trigger">
        {trigger ?? <Button variant="outline" disabled={disabled}>{t("productPicker.trigger")}</Button>}
      </Dialog.Trigger>

      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid="product-picker-dialog">
            <Dialog.Header>
              <Dialog.Title>{t("productPicker.title")}</Dialog.Title>
            </Dialog.Header>

            <Dialog.Body>
              <Stack gap="card">
                {/* MY PRODUCTS vs OTHER TEAMS' — two catalogues, two tabs (owner).
                    The tab changes WHICH RPC runs, so the search and the pager below always describe
                    the catalogue named above them. TICKS SURVIVE the switch: they are a set of ids,
                    not a filter over the loaded page, so a product picked on one tab is still picked
                    after crossing to the other and back — the same property that already makes them
                    survive paging and searching. */}
                {!stockedOnly && catalogs && catalogs.length > 1 && (
                  <Tabs.Root
                    value={catalog}
                    onValueChange={(e) => {
                      setCatalog(e.value as Catalog);
                      // Page 1: page 4 of my catalogue is not page 4 of everyone else's, and landing
                      // past the end of the new list reads as "there is nothing here".
                      setPage(1);
                    }}
                  >
                    <Tabs.List>
                      {catalogs.map((c) => (
                        <Tabs.Trigger key={c} value={c} data-testid={`product-picker-tab-${c}`}>
                          {t(c === "own" ? "productPicker.tabOwn" : "productPicker.tabOthers")}
                        </Tabs.Trigger>
                      ))}
                    </Tabs.List>
                  </Tabs.Root>
                )}

                {/* THE FILTER ROW — two columns when both are here (owner).

                    They are one decision taken two ways: narrow by WHO owns it, narrow by WHAT it is
                    called. Stacked, the search sat a full control-height below the tabs and the team
                    picker pushed the first product row off the visible part of the dialog. */}
                {!stockedOnly && useDiscover && catalogs && catalogs.length > 1 ? (
                  <SimpleGrid columns={{ base: 1, sm: 2 }} gap="card">
                    <Box data-testid="product-picker-team">
                      <TeamSelect
                        value={ownerTeamId}
                        placeholder={t("productPicker.allTeams")}
                        onChange={(id) => {
                          setOwnerTeamId(id);
                          // Page 1: page 3 of everyone's catalogue is not page 3 of one team's.
                          setPage(1);
                        }}
                      />
                    </Box>

                <Input
                  placeholder={t("products.searchPlaceholder")}
                  value={input}
                  disabled={noTeam}
                  data-testid="product-picker-search"
                  onChange={(e) => setInput(e.target.value)}
                />
                  </SimpleGrid>
                ) : (
                <Input
                  placeholder={t("products.searchPlaceholder")}
                  value={input}
                  disabled={noTeam}
                  data-testid="product-picker-search"
                  onChange={(e) => setInput(e.target.value)}
                />
                )}

                {/* A search that matched more than it could resolve says so. The alternative is a
                    dialog that quietly answers about the first 200 products it happened to see and
                    looks, to the person searching, exactly like "we do not stock that". */}
                {searchCapped && (
                  <Text fontSize="xs" color="orange.fg" data-testid="product-picker-search-capped">
                    {t("productPicker.searchCapped", { limit: SEARCH_RESOLVE_LIMIT })}
                  </Text>
                )}

                {/* The badges carry TWO DIFFERENT SCOPES — ready is this warehouse, ongoing is every
                    warehouse — and side by side on one row they read as one number about one place.
                    Saying it once here is cheaper than lengthening both labels on every row.
                    Rendered only when a figure actually landed, so it never explains absent badges. */}
                {(onHand.size > 0 || ongoing.size > 0) && (
                  <Text fontSize="xs" color="fg.muted" data-testid="product-picker-stock-scope">
                    {t(onHand.size > 0 ? "productPicker.stockScope" : "productPicker.ongoingScope")}
                  </Text>
                )}

                <Flex align="center" justify="space-between" gap="2">
                  <Text fontSize="sm" color="fg.muted" data-testid="product-picker-count">
                    {t("productPicker.selected", { n: count })}
                  </Text>

                  {/* The only way to untick a selection that isn't on the loaded page — including a
                      seeded id this scope cannot show at all. Without it those ticks are unreachable. */}
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={count === 0}
                    data-testid="product-picker-clear"
                    onClick={() => setTicked(new Set())}
                  >
                    {t("productPicker.clear")}
                  </Button>
                </Flex>

                {noTeam ? (
                  <Text color="fg.muted" data-testid="product-picker-no-team">
                    {useDiscover ? t("productPicker.noTeamAll") : t("productPicker.noTeam")}
                  </Text>
                ) : (
                  <>
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

                    {!loading && !error && products.length > 0 && (
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
                              {/* Checkbox.Root is the row's <label>, so the WHOLE row toggles; the
                                  Control LEADS the row rather than trailing it (#110 review): ticking
                                  down a list is a vertical scan of the boxes, and a box parked after
                                  each product's name lands somewhere different on every row. */}
                              <Checkbox.HiddenInput />
                              <Flex align="center" gap="card" w="full">
                                <Checkbox.Control flexShrink={0} />
                                {/* `.has()` then `.get()`, never `.get() ?? undefined`: 0n is a real
                                    answer ("out of stock") and a missing entry is "we don't know",
                                    and the badge renders those two differently. */}
                                <ProductListItem
                                  product={p}
                                  stock={onHand.has(key) ? onHand.get(key) : undefined}
                                  ongoing={ongoing.has(key) ? ongoing.get(key) : undefined}
                                  teamName={teamNames.get(p.teamId.toString())}
                                />
                              </Flex>
                            </Checkbox.Root>
                          );
                        })}
                      </Stack>
                    )}

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

            <Dialog.Footer>
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
