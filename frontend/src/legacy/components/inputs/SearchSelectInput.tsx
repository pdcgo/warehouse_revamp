import { useMemo, type ReactNode } from "react";
import { Combobox, Portal, Spinner, useListCollection } from "@chakra-ui/react";

export interface SearchSelectItem<T extends string> {
  value: T;
  label: string;
  // Optional richer row — a badge, a second line. Falls back to the label.
  render?: ReactNode;
  disabled?: boolean;
}

// SearchSelectInput is a type-to-search picker: you type, the caller looks something up, you choose
// from what comes back.
//
// ⚠ THIS IS FOR SETS TOO LARGE TO LIST. A plain Select is better whenever the options can all be
// shown — it needs no round trip, works offline, and lets the reader see what is available without
// guessing a search term. Reach for this only when the set is unbounded (products, orders,
// customers), because its cost is real: nothing is discoverable until you type something, so a
// reader who does not already know what they are looking for gets an empty box.
//
// The SEARCHING state is therefore not optional. An empty list means two different things — "no
// matches" and "still asking" — and a picker that shows the same blank panel for both reads as
// broken exactly when the network is slow.
export const description =
  "A type-to-search picker for sets too large to list. Distinguishes 'still searching' from 'no matches', because a blank panel that means both reads as broken on a slow connection.";

export interface SearchSelectInputProps<T extends string> {
  value?: T;
  onChange?(value: T | undefined): void;
  // The current search text. The caller owns it, because the caller owns the lookup it drives.
  inputValue?: string;
  onInputChange?(text: string): void;
  items: Array<SearchSelectItem<T>>;
  loading?: boolean;
  placeholder?: string;
  disabled?: boolean;
  // Shown when the search returned nothing. Not used while `loading`.
  emptyText?: string;
}

export function SearchSelectInput<T extends string>({
  value,
  onChange,
  inputValue,
  onInputChange,
  items,
  loading,
  placeholder = "Type to search",
  disabled,
  emptyText = "No matches",
}: SearchSelectInputProps<T>) {
  // The caller has already filtered (server-side), so the collection is the items verbatim —
  // filtering again locally would hide results the server deliberately returned.
  const initialItems = useMemo(() => items, [items]);
  const { collection, set } = useListCollection({
    initialItems,
    itemToString: (item) => item.label,
    itemToValue: (item) => item.value,
  });

  useMemo(() => set(items), [items, set]);

  return (
    <Combobox.Root
      collection={collection}
      value={value ? [value] : []}
      inputValue={inputValue}
      onValueChange={(e) => onChange?.(e.value[0] as T | undefined)}
      onInputValueChange={(e) => onInputChange?.(e.inputValue)}
      disabled={disabled}
      // Off: the list is server-filtered, and re-filtering it in the browser would drop matches the
      // server found by a rule the client does not know (a SKU alias, a fuzzy match).
      openOnClick
      data-testid="search-select"
    >
      <Combobox.Control>
        <Combobox.Input placeholder={placeholder} data-testid="search-select-input" />
        <Combobox.IndicatorGroup>
          {loading && <Spinner size="xs" borderWidth="1.5px" data-testid="search-select-loading" />}
          <Combobox.ClearTrigger />
        </Combobox.IndicatorGroup>
      </Combobox.Control>

      <Portal>
        <Combobox.Positioner>
          <Combobox.Content>
            {/* The two states kept distinct — see the note above. */}
            {loading && items.length === 0 ? (
              <Combobox.Empty data-testid="search-select-searching">Searching…</Combobox.Empty>
            ) : (
              <Combobox.Empty data-testid="search-select-empty">{emptyText}</Combobox.Empty>
            )}

            {items.map((item) => (
              <Combobox.Item
                item={item}
                key={item.value}
                data-testid={`search-select-item-${item.value}`}
              >
                {item.render ?? item.label}
                <Combobox.ItemIndicator />
              </Combobox.Item>
            ))}
          </Combobox.Content>
        </Combobox.Positioner>
      </Portal>
    </Combobox.Root>
  );
}
