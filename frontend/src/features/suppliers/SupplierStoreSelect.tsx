import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Combobox, Span, Stack, useListCollection } from "@chakra-ui/react";
import type { SupplierChannelRecord } from "./adapt";
import { NO_STORE } from "./products";
import { MarketplaceBadge, marketplaceLabel } from "../../components/badges/MarketplaceBadge";
import { searchOnlyWhatIsTyped } from "../../lib/comboboxSearch";

export interface SupplierStoreSelectProps {
  /** The supplier's stores — already loaded by the page, so nothing is fetched here. */
  stores: SupplierChannelRecord[];
  /** The picked store's id; 0n = none, NO_STORE = "bought with no store" (only offered with `noStoreLabel`). */
  value: bigint;
  onChange: (storeId: bigint) => void;
  placeholder?: string;
  testId?: string;
  /**
   * Offers "no store" as the first option, under this label — the Produk tab, whose rows include products bought with no
   * store (a-line-with-no-store-links-under-the-supplier). Picked, it emits NO_STORE.
   */
  noStoreLabel?: string;
}

interface StoreItem {
  label: string;
  value: string;
  /** null = the "no store" option. */
  store: SupplierChannelRecord | null;
}

const NONE_VALUE = "none";

// ONE OF A SUPPLIER'S STORES — the Produk tab's store filter (owner: *"di produk tambah toko pemasok"*). A SEARCH SELECT,
// not a list: a supplier's stores have no ceiling (CLAUDE.md, a picker over data that grows). They are already on the
// page — the Toko tab's read — so the list is the whole set, FILTERED IN THE FIELD on the store's name or its type,
// as ShopSelect does for a team's own shops. Each option reads as the store does in the tables: its name, its badge
// under it.
export const description =
  "Search select over ONE supplier's stores (Chakra Combobox) — the stores are passed in, already loaded, and filtered in the field by name or store type. Each option shows the store's name with its MarketplaceBadge under it; the Produk tab adds a first \"no store\" option, a dash under its label. Emits a store id, NO_STORE for \"no store\", and 0n when cleared.";

export function SupplierStoreSelect({
  stores,
  value,
  onChange,
  placeholder,
  testId = "supplier-store-select",
  noStoreLabel,
}: SupplierStoreSelectProps) {
  const { t } = useTranslation();

  const items: StoreItem[] = useMemo(
    () => [
      ...(noStoreLabel ? [{ label: noStoreLabel, value: NONE_VALUE, store: null }] : []),
      ...stores.map((store) => ({ label: store.name, value: store.id.toString(), store })),
    ],
    [stores, noStoreLabel],
  );

  const { collection, filter, set } = useListCollection<StoreItem>({
    initialItems: [],
    itemToString: (item) => item.label,
    itemToValue: (item) => item.value,
    // Name OR TYPE — "the Shopee one" is how somebody remembers a store.
    filter: (_itemText, filterText, item) => {
      const needle = filterText.trim().toLowerCase();
      if (!needle) {
        return true;
      }

      return (
        item.label.toLowerCase().includes(needle) ||
        (item.store !== null && marketplaceLabel(item.store.channelType).toLowerCase().includes(needle))
      );
    },
  });

  // ⚠ `filled` tracks the COLLECTION — see the `key` below.
  const [filled, setFilled] = useState(false);

  useEffect(() => {
    set(items);
    setFilled(items.length > 0);
  }, [items, set]);

  return (
    <Combobox.Root
      // REMOUNTED ONCE THE STORES LAND — Zag reads a prefilled value's text only at init (ShopSelect, TeamSelect).
      key={filled ? "ready" : "loading"}
      collection={collection}
      {...searchOnlyWhatIsTyped(filter)}
      selectionBehavior="replace"
      openOnClick
      value={value > 0n ? [value.toString()] : value === NO_STORE && noStoreLabel ? [NONE_VALUE] : []}
      // Clearing emits 0n — the "every store" the filter holds (#131).
      onValueChange={(e) => onChange(e.value[0] === NONE_VALUE ? NO_STORE : e.value[0] ? BigInt(e.value[0]) : 0n)}
    >
      <Combobox.Control>
        <Combobox.Input data-testid={testId} placeholder={placeholder} />
        <Combobox.IndicatorGroup>
          <Combobox.ClearTrigger />
          <Combobox.Trigger />
        </Combobox.IndicatorGroup>
      </Combobox.Control>

      {/* Inline, not portalled — the phone's Filter sheet is a dialog, and a portalled list would render outside it,
          inert (ShopSelect's note). */}
      <Combobox.Positioner>
        <Combobox.Content>
          <Combobox.Empty>{t("supplierChannel.filter.none")}</Combobox.Empty>
          {collection.items.map((item) => (
            <Combobox.Item item={item} key={item.value} data-testid={`${testId}-option-${item.value}`}>
              {/* The name, its type UNDER it — the store reads as it does in the tables (owner: *"select toko, badgenya
                  di bawah"*, a-store-reads-its-name-then-its-type). */}
              <Stack gap="1" align="start" minW="0">
                <Span>{item.label}</Span>
                {/* No store reads as its table cell does — a dash (a-line-with-no-store-links-under-the-supplier). */}
                {item.store ? (
                  <MarketplaceBadge marketplace={item.store.channelType} size="sm" />
                ) : (
                  <Span color="fg.muted">—</Span>
                )}
              </Stack>
              <Combobox.ItemIndicator />
            </Combobox.Item>
          ))}
        </Combobox.Content>
      </Combobox.Positioner>
    </Combobox.Root>
  );
}
