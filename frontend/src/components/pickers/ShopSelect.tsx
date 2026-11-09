import { useEffect, useMemo, useState } from "react";
import { Combobox, HStack, Span, useListCollection } from "@chakra-ui/react";
import { useShopOptions } from "../../features/shops/queries";
import { ShopStatusBadge } from "../../features/shops/ShopStatusBadge";
import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";
import { MarketplaceBadge, marketplaceLabel } from "../badges/MarketplaceBadge";
import { searchOnlyWhatIsTyped } from "../../lib/comboboxSearch";

export interface ShopSelectProps {
  /** The selling team whose shops to list — a shop is team-scoped, so this is required. */
  teamId: bigint;
  /** Selected shop id (0n = none). */
  value?: bigint;
  onChange?: (shopId: bigint) => void;
  /**
   * NARROW the list to one storefront. Omitted (or UNSPECIFIED) = every shop the team runs, which is
   * what every caller but the order form asks for.
   *
   * ⚠ A filter that excludes the CURRENT value clears it — see below. Pass this only where the caller
   * is prepared to receive that `onChange(0n)`.
   */
  marketplace?: Marketplace;
  /**
   * Offer only the shops the signed-in person may WRITE on (a-write-needs-a-grant-or-a-manager) — the picker of a
   * write: the order form, a draft, a statement import. Omitted = every shop of the team, which is what a FILTER over
   * orders or reports asks for (reads stay team-wide).
   */
  writable?: boolean;
  /**
   * ALSO offer the team's CLOSED shops, after the open ones, each badged *Closed* — the picker of something a closed
   * shop still takes (a-closed-shop-refuses-only-new-selling): the statement import (its last payouts arrive after the
   * close), an expense, the order import (its placed orders run to their end). With `writable`, only the closed shops
   * the person may write on. Never on the order form: a closed shop leaves its picker.
   */
  withClosed?: boolean;
  /**
   * KEEP a value that is a closed shop, badged *Closed*, instead of clearing it — and offer no other closed shop. The
   * order form, for a waiting draft whose shop was closed (a-close-leaves-the-drafts-waiting): the draft keeps its
   * shop, the form refuses Create, and the ways out are deleting the draft or reopening the shop — never re-pointing it
   * at another shop unseen (the-close-shop-prototype-is-accepted).
   */
  keepClosed?: boolean;
  /**
   * A read FILTER — a shop to narrow a list or a report by (report-filters-offer-closed-shops): every shop of the team,
   * the closed ones after the open, each badged *Closed* (as `withClosed`), so a closed shop's history stays reachable;
   * and a closed shop once PICKED keeps its *Closed* badge in the field, since on a filter nothing else on screen says
   * so. Never on a form that writes new selling: those offer open shops only.
   */
  asFilter?: boolean;
  placeholder?: string;
  disabled?: boolean;
}

interface ShopItem {
  label: string;
  value: string;
  marketplace: Marketplace;
  /** A closed shop — offered by `withClosed`, or kept by `keepClosed`. */
  closed: boolean;
}

// ShopSelect is the shared marketplace-shop picker for a selling team (#90). It emits a shop id; each
// option shows the shop's name AND its marketplace as the standard-coloured MarketplaceBadge (#84),
// so two shops with similar names stay distinguishable and a shop's marketplace reads the same here
// as everywhere else.
//
// ⚠ IT IS A SEARCH SELECT, not a plain dropdown (owner) — a picker over data that GROWS is typed
// into, and only static, small sets (the marketplaces, a role, a team type) stay plain lists. A team
// runs a handful of shops today and there is no ceiling on that, so the list is loaded whole (one
// request, no paging) and FILTERED IN THE FIELD, on the shop's name or its marketplace: typing
// "shopee" narrows to that storefront's shops without touching the marketplace prop.
export const description = "Searchable marketplace-shop picker for a selling team (Chakra Combobox over ShopList) — type to filter by shop name or marketplace. Emits a shop id, and 0n when cleared. Each option carries the shop's name and its standard-coloured MarketplaceBadge. Optionally narrowed to one marketplace — and a filter that excludes the current value clears it. `writable` offers only the shops the signed-in person may write on (a grant, or the team's owner or admin) — the picker of a write. A closed shop is never offered unless asked: `withClosed` offers the team's closed shops, badged, after the open ones (the statement import, an expense, the order import); `keepClosed` keeps a value that is a closed shop, badged, rather than clearing it (the order form's waiting draft). `asFilter` is a read filter's picker (report-filters-offer-closed-shops): the closed shops after the open ones, badged, and a picked closed shop keeps its badge in the field.";

// One empty list for every render, so "nothing loaded yet" is the SAME value each time — a fresh `[]`
// is a new identity, and any memo or effect keyed on it would re-run on every render.
const NO_SHOPS: NonNullable<ReturnType<typeof useShopOptions>["data"]> = [];

export function ShopSelect({
  teamId,
  value,
  onChange,
  marketplace,
  writable,
  withClosed = false,
  keepClosed = false,
  asFilter = false,
  placeholder = "Select a shop",
  disabled,
}: ShopSelectProps) {
  // Read through the cache rather than fetching here (#176's gap, found via a flaky e2e).
  //
  // The hand-rolled version fetched ONCE in an effect keyed on `teamId`, and on failure set an error
  // and stopped: the effect could not re-run because the team had not changed, so a single transient
  // failure left this control permanently empty — "Shops unavailable" with no way back but a reload.
  // See src/shops/queries.ts for the full note.
  // THE OPEN SHOPS — what every picker offers first (a-shop-is-closed-never-deleted: a closed shop is shown only when
  // asked for).
  const query = useShopOptions({ teamId, writable, status: "open" });
  // A filter offers the closed shops exactly as `withClosed` does.
  const offerClosed = withClosed || asFilter;

  // ⚠ A STABLE EMPTY LIST, not a fresh `[]` — see the loop note on `shops` below.
  const all = query.data ?? NO_SHOPS;
  const error = query.isError;
  // THE CLOSED SHOPS, read only when asked: `withClosed` offers them (the writable ones, when the picker is a write's);
  // `keepClosed` reads them only to keep the one already picked. Neither asked, the read never runs and `closedAll`
  // stays the one stable empty list.
  const closedOn = offerClosed || keepClosed;
  const closedQuery = useShopOptions({
    teamId,
    writable: offerClosed ? writable : false,
    status: "closed",
    enabled: closedOn,
  });
  const closedAll = (closedOn ? closedQuery.data : undefined) ?? NO_SHOPS;
  // Resolved once the list it shows has landed — both lists when it shows both.
  const resolved = query.isSuccess && (!closedOn || closedQuery.isSuccess);

  // NARROWED TO ONE STOREFRONT when the caller asked for it. Filtered here rather than by the RPC: a
  // team runs a handful of shops and they are already loaded, so a second request would buy nothing
  // and cost a spinner on every change of the filter.
  const filtering = marketplace !== undefined && marketplace !== Marketplace.UNSPECIFIED;
  //
  // ⚠ MEMOISED, AND THAT IS LOAD-BEARING — without it this component FROZE THE TAB. `.filter()` returns
  // a new array on every render, so `items` below was recomputed every render, the fill effect saw a
  // "new" list and called `set()`, the collection's state changed, the component re-rendered, and
  // `.filter()` produced another new array: an infinite loop.
  //
  // It only happened WITH a marketplace filter. Unfiltered, `shops` is `query.data` itself — a stable
  // reference from the cache — so the order list's shop filter never tripped it, while the order
  // form's MarketplaceInfoForm (which always narrows to the chosen storefront) hung the browser
  // outright. That is also why it hid for so long: the screen most people opened was fine.
  const shops = useMemo(
    () => (filtering ? all.filter((shop) => shop.marketplace === marketplace) : all),
    [all, filtering, marketplace],
  );
  // `keepClosed` shows ONE closed shop — the value — and offers no other.
  const closedShops = useMemo(() => {
    const narrowed = filtering ? closedAll.filter((shop) => shop.marketplace === marketplace) : closedAll;

    return offerClosed ? narrowed : narrowed.filter((shop) => shop.id === value);
  }, [closedAll, filtering, marketplace, offerClosed, value]);
  // A FILTER'S PICKED CLOSED SHOP says so in the field, not only in the list (report-filters-offer-closed-shops).
  const pickedClosed = asFilter && value !== undefined && value > 0n && closedShops.some((shop) => shop.id === value);

  // A VALUE OUTSIDE THE LIST IS CLEARED, and this is the whole reason the filter is a prop rather
  // than something the caller does around this component.
  //
  // Pick "Melati Store" (Tokopedia), then narrow to Shopee: the trigger goes blank because the option
  // is gone, but `value` still holds that shop — so the form would place a Shopee order against a
  // Tokopedia storefront, and nothing on screen would say so. Emitting the clear makes the visible
  // state and the held state the same fact.
  //
  // Guarded three ways so no existing caller changes behaviour: only when a filter is actually set,
  // only once the list has RESOLVED (mid-load every value looks absent), and only for a real value.
  //
  // `writable` narrows too: a draft pushed onto a shop the person may not write on opens with that shop CLEARED, rather
  // than held invisibly until the create is refused (a-write-needs-a-grant-or-a-manager).
  useEffect(() => {
    if ((!filtering && !writable) || !resolved || value === undefined || value === 0n) {
      return;
    }

    if (!shops.some((shop) => shop.id === value) && !closedShops.some((shop) => shop.id === value)) {
      onChange?.(0n);
    }
  }, [filtering, writable, resolved, shops, closedShops, value, onChange]);

  const items: ShopItem[] = useMemo(
    () => [
      ...shops.map((shop) => ({
        label: shop.name,
        value: shop.id.toString(),
        marketplace: shop.marketplace,
        closed: false,
      })),
      // After the open ones, so the shop a person usually wants is still first.
      ...closedShops.map((shop) => ({
        label: shop.name,
        value: shop.id.toString(),
        marketplace: shop.marketplace,
        closed: true,
      })),
    ],
    [shops, closedShops],
  );

  // THE WHOLE LIST IS THE COLLECTION; the FIELD narrows it. Filtering client-side rather than through
  // the RPC is deliberate — the shops are already loaded, so a request per keystroke would buy nothing
  // and cost a spinner inside the dropdown. (UserSelect searches server-side because it is over EVERY
  // user, which is a different size of question.)
  const { collection, filter, set } = useListCollection<ShopItem>({
    initialItems: [],
    itemToString: (item) => item.label,
    itemToValue: (item) => item.value,
    // Name OR MARKETPLACE, because "which Shopee shop was it?" is how somebody actually remembers an
    // order. The default matcher only sees the string the item renders as, which is the name.
    filter: (_itemText, filterText, item) => {
      const needle = filterText.trim().toLowerCase();

      if (!needle) {
        return true;
      }

      return (
        item.label.toLowerCase().includes(needle) ||
        marketplaceLabel(item.marketplace).toLowerCase().includes(needle)
      );
    },
  });

  // ⚠ `filled` tracks the COLLECTION, not the query — see the `key` below for why the difference
  // decides whether a prefilled field renders blank. It also names the closed shop `keepClosed` holds: that one enters
  // the collection only once the value IS it (a draft loading after the picker), a beat after the value changed — so its
  // arrival remounts the field once more, or it would read blank.
  const [filled, setFilled] = useState<string | null>(null);
  const kept = keepClosed && !offerClosed ? (closedShops[0]?.id.toString() ?? "") : "";

  useEffect(() => {
    if (!resolved) {
      return;
    }

    set(items);
    setFilled(kept);
  }, [items, resolved, set, kept]);

  return (
    <Combobox.Root
      // REMOUNTED ONCE, THE MOMENT THE SHOPS LAND — load-bearing, and the same fix TeamSelect carries
      // with the same note. Zag derives the input's display text when the machine initialises (by
      // looking `value` up in `collection`) and thereafter only when `value` CHANGES; a collection
      // that fills in later does not re-derive it. An edit form that mounts with a shop already
      // selected would therefore show a BLANK field forever, because its value never changes again.
      key={filled === null ? "loading" : `ready-${filled}`}
      collection={collection}
      disabled={disabled}
      // Only a keystroke searches; a pick, a blur or a click-to-open starts over — so the list reopens whole.
      {...searchOnlyWhatIsTyped(filter)}
      // A pick REPLACES what was typed with the shop's name, so the closed field reads as the
      // selection rather than as the search that found it.
      selectionBehavior="replace"
      // Clicking the field opens the list — the control still behaves like the dropdown it replaced
      // for somebody who does not want to type.
      openOnClick
      value={value && value > 0n ? [value.toString()] : []}
      onValueChange={(e) => {
        // ⚠ CLEARING EMITS `0n` — "no shop", the sentinel every caller already holds. Swallowing the
        // empty case is #131's bug: the field goes blank while the parent still filters on a shop.
        const picked = e.value[0];
        onChange?.(picked ? BigInt(picked) : 0n);
      }}
    >
      <Combobox.Control>
        {/* A NARROWED-TO-NOTHING list says which storefront it found nothing on. "Select a shop"
            over an empty dropdown reads as a broken control; "No Shopee shops" is a fact about the
            team, and points at the filter as the thing to change. */}
        <Combobox.Input
          data-testid="shop-select"
          // Room for the badge beside the indicators, so a long name stops before it rather than running under it.
          pe={pickedClosed ? "calc(var(--combobox-input-height) * 1.5 + 4.5rem)" : undefined}
          placeholder={
            error
              ? "Shops unavailable"
              : filtering && query.isSuccess && shops.length === 0 && closedShops.length === 0
                ? `No ${marketplaceLabel(marketplace)} shops`
                : placeholder
          }
        />
        <Combobox.IndicatorGroup>
          {pickedClosed && <ShopStatusBadge size="xs" testId="shop-select-value-closed" />}
          <Combobox.ClearTrigger />
          <Combobox.Trigger />
        </Combobox.IndicatorGroup>
      </Combobox.Control>

      {/* No Portal on purpose: this picker is used inside a modal Dialog (RecordExpenseDialog), and a
          portalled listbox renders OUTSIDE the dialog where the modal makes it inert/aria-hidden —
          invisible to the a11y tree and unclickable. Rendering inline keeps it inside the dialog.
          (Same reasoning as MarketplaceSelect.) */}
      <Combobox.Positioner>
        <Combobox.Content>
          <Combobox.Empty>No shops found</Combobox.Empty>
          {collection.items.map((item) => (
            <Combobox.Item
              item={item}
              key={item.value}
              data-testid={`shop-select-option-${item.value}`}
            >
              <HStack gap="2">
                <Span>{item.label}</Span>
                <MarketplaceBadge marketplace={item.marketplace} size="sm" />
                {item.closed && <ShopStatusBadge size="xs" testId={`shop-select-closed-${item.value}`} />}
              </HStack>
              <Combobox.ItemIndicator />
            </Combobox.Item>
          ))}
        </Combobox.Content>
      </Combobox.Positioner>
    </Combobox.Root>
  );
}
