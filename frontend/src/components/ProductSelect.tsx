import { useEffect, useState } from "react";
import { Combobox, Portal, Span, Stack, useListCollection } from "@chakra-ui/react";
import { useProductSearch } from "../features/products/queries";
import { useDebounced } from "../lib/useDebounced";

// What a picked product contributes to an order line — a SNAPSHOT (#67): the opaque product id plus
// the sku/name frozen at order time. Price is not here: a product has no catalogue price, so the CS
// person types the buyer-paid unit price on the line itself.
export interface PickedProduct {
  id: bigint;
  sku: string;
  name: string;
}

interface SelectableProduct {
  id: bigint;
  sku: string;
  name: string;
}

export interface ProductSelectProps {
  /** The caller's team. In "team" scope it's the catalogue searched; in "all" scope it only
   * authorizes the request (results are cross-team). */
  teamId: bigint;
  /** "team" (default) searches this team's catalogue (ProductList); "all" discovers products across
   * ALL teams (ProductDiscover, #110). */
  scope?: "team" | "all";
  /** Selected product id (for the checkmark); 0n = none. */
  value?: bigint;
  onChange?: (product: PickedProduct) => void;
  placeholder?: string;
  disabled?: boolean;
}

// ProductSelect is the shared catalogue picker for an order line (#90). Unlike the bounded ShopSelect,
// a catalogue grows without limit, so this searches SERVER-side (ProductList's `q`, min 2 chars) the
// way UserSelect does, and renders each option as "sku — name". It emits the whole PickedProduct so
// the caller can snapshot sku/name onto the line; the buyer-paid unit price is entered separately.
export const description = "Searchable product picker (Chakra Combobox, server-side). Emits the picked product's id + sku + name snapshot. `scope`: \"team\" (default, this team's catalogue) or \"all\" (cross-team discovery, #110).";

export function ProductSelect({
  teamId,
  scope = "team",
  value,
  onChange,
  placeholder = "Search products by name or SKU",
  disabled,
}: ProductSelectProps) {
  const [input, setInput] = useState("");

  const { collection, set } = useListCollection<SelectableProduct>({
    initialItems: [],
    itemToString: (p) => `${p.sku} — ${p.name}`,
    itemToValue: (p) => p.id.toString(),
  });

  // Server-side search, debounced, >= 2 characters — a catalogue is too large to load whole. The
  // query owns which answer is current; the debounce only keeps the request count down.
  const q = useDebounced(input.trim());
  const results = useProductSearch({ teamId, q, scope });

  useEffect(() => {
    set(q.length >= 2 && teamId > 0n ? (results.data ?? []) : []);
  }, [q, teamId, results.data, set]);

  return (
    <Combobox.Root
      collection={collection}
      disabled={disabled}
      value={value !== undefined && value > 0n ? [value.toString()] : []}
      onValueChange={(e) => {
        const picked = e.value[0];
        if (picked === undefined) return;
        const product = collection.items.find((p) => p.id.toString() === picked);
        if (product) {
          onChange?.({ id: product.id, sku: product.sku, name: product.name });
        }
      }}
      onInputValueChange={(e) => setInput(e.inputValue)}
      data-testid="product-select"
    >
      <Combobox.Control>
        <Combobox.Input placeholder={placeholder} />
        <Combobox.IndicatorGroup>
          <Combobox.ClearTrigger />
          <Combobox.Trigger />
        </Combobox.IndicatorGroup>
      </Combobox.Control>

      <Portal>
        <Combobox.Positioner>
          <Combobox.Content>
            <Combobox.Empty>
              {input.trim().length < 2 ? "Type at least 2 characters" : "No products found"}
            </Combobox.Empty>
            {collection.items.map((p) => (
              <Combobox.Item item={p} key={p.id.toString()} data-testid={`product-select-option-${p.sku}`}>
                <Stack gap="0">
                  <Span fontWeight="medium">{p.sku}</Span>
                  <Span fontSize="xs" color="fg.muted">
                    {p.name}
                  </Span>
                </Stack>
                <Combobox.ItemIndicator />
              </Combobox.Item>
            ))}
          </Combobox.Content>
        </Combobox.Positioner>
      </Portal>
    </Combobox.Root>
  );
}
