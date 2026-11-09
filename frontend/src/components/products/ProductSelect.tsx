import { useEffect, useState } from "react";
import { Badge, Combobox, HStack, Portal, Span, Stack, useListCollection } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { type ProductSearchScope, type SearchedProduct, useProductSearch } from "../../features/products/queries";
import { searchOnlyWhatIsTyped } from "../../lib/comboboxSearch";
import { useDebounced } from "../../lib/useDebounced";

// What a picked product contributes to an order line — a SNAPSHOT (#67): the opaque product id plus
// the sku/name frozen at order time. Price is not here: a product has no catalogue price, so the CS
// person types the buyer-paid unit price on the line itself.
export interface PickedProduct {
  id: bigint;
  productCode: string;
  name: string;
  /** The COVER, carried so a picked product still looks like itself once it is on the line — the
   * picker shows a photo and the list it feeds showed a grey placeholder, which reads as having
   * picked the wrong thing.
   *
   * OPTIONAL, and not part of the snapshot in the way sku/name are: those are frozen onto the record
   * because they are what was ordered, while a picture is only how the product looks NOW. A caller
   * that has no image (ProductSelect emits none) simply leaves them out and gets the placeholder. */
  defaultImageUrl?: string;
  defaultImageThumbnailUrl?: string;
}

export interface ProductSelectProps {
  /** The caller's team. In "team" scope it's the catalogue searched; in "all" scope it only
   * authorizes the request (results are cross-team); in "warehouse" scope it is the WAREHOUSE whose held products are
   * searched. */
  teamId: bigint;
  /** "team" (default) searches this team's catalogue (ProductList); "all" discovers products across
   * ALL teams (ProductDiscover, #110) — the selling roles' only; "warehouse" searches only what THIS warehouse holds or
   * has held, any team's, at 0 or not (WarehouseProductSearch, a-warehouse-picks-only-what-it-has-held) — the picker for
   * every warehouse screen, since a warehouse role may not discover. */
  scope?: ProductSearchScope;
  /** Selected product id (for the checkmark); 0n = none. */
  value?: bigint;
  onChange?: (product: PickedProduct) => void;
  placeholder?: string;
  disabled?: boolean;
  /**
   * Render the list in a portal (the default) or inline. Pass `false` inside a modal Dialog: a portalled listbox
   * renders OUTSIDE the dialog, where the modal makes it inert and aria-hidden — unclickable, and absent from the a11y
   * tree (the reason RackSelect and ShopSelect never portal). Kept on by default so every page-level use is unchanged.
   */
  portalled?: boolean;
}

// ProductSelect is the shared catalogue picker for an order line (#90). Unlike the bounded ShopSelect,
// a catalogue grows without limit, so this searches SERVER-side (ProductList's `q`, min 2 chars) the
// way UserSelect does, and renders each option as "sku — name". It emits the whole PickedProduct so
// the caller can snapshot sku/name onto the line; the buyer-paid unit price is entered separately.
//
// OPENED WITH NOTHING TYPED IT SHOWS THE CATALOGUE'S FIRST PAGE, and it searches ONLY what is typed (owner: *"semua
// combobox kalau sudah select opsinya munculkan semua saat dibuka kembali, selalu bermasalah jika hanya menampilkan
// satu"*, a-search-select-reopens-whole). The picked label the machine writes into the field used to be sent as the
// search, so the list opened again held the one product picked. A catalogue cannot be loaded whole, so "everything" is
// its first page — and the picked product stays on the list, so its label never goes blank.
export const description = "Searchable product picker (Chakra Combobox, server-side). Opened with nothing typed it lists the first page; typing searches it (2 characters or more), and only what is typed — opened again after a pick it shows the list, not the one picked. Emits the picked product's id + product code + name snapshot. `scope`: \"team\" (default, this team's catalogue), \"all\" (cross-team discovery, #110 — selling roles only) or \"warehouse\" (only what this warehouse holds or has held, each with its owner — a-warehouse-picks-only-what-it-has-held).";

export function ProductSelect({
  teamId,
  scope = "team",
  value,
  onChange,
  placeholder = "Search products by name or SKU",
  disabled,
  portalled = true,
}: ProductSelectProps) {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  // The product picked here — kept on the list, so the field can always name it.
  const [picked, setPicked] = useState<SearchedProduct | null>(null);

  const { collection, set } = useListCollection<SearchedProduct>({
    initialItems: [],
    itemToString: (p) => `${p.productCode} — ${p.name}`,
    itemToValue: (p) => p.id.toString(),
  });

  // Server-side search, debounced, >= 2 characters — a catalogue is too large to load whole. The
  // query owns which answer is current; the debounce only keeps the request count down.
  const q = useDebounced(input.trim());
  const results = useProductSearch({ teamId, q, scope });

  // Nothing typed: the first page. One character: nothing yet — a search needs two. The picked product first when the
  // page does not hold it.
  useEffect(() => {
    const found = q.length !== 1 && teamId > 0n ? (results.data ?? []) : [];
    set(picked && !found.some((p) => p.id === picked.id) ? [picked, ...found] : found);
  }, [q, teamId, results.data, picked, set]);

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
          setPicked(product);
          onChange?.({ id: product.id, productCode: product.productCode, name: product.name });
        }
      }}
      // Opens on a click too — it has a first page to show now.
      openOnClick
      {...searchOnlyWhatIsTyped(setInput)}
      data-testid="product-select"
    >
      <Combobox.Control>
        <Combobox.Input placeholder={placeholder} />
        <Combobox.IndicatorGroup>
          <Combobox.ClearTrigger />
          <Combobox.Trigger />
        </Combobox.IndicatorGroup>
      </Combobox.Control>

      <Portal disabled={!portalled}>
        <Combobox.Positioner>
          <Combobox.Content>
            <Combobox.Empty>
              {input.trim().length === 1 ? "Type at least 2 characters" : "No products found"}
            </Combobox.Empty>
            {collection.items.map((p) => (
              <Combobox.Item item={p} key={p.id.toString()} data-testid={`product-select-option-${p.productCode}`}>
                <Stack gap="0">
                  <HStack gap="2">
                    <Span fontWeight="medium">{p.productCode}</Span>
                    {/* Archived by its seller, still on this warehouse's shelf (an-archived-product-held-here-can-be-picked). */}
                    {p.archived && (
                      <Badge size="sm" variant="subtle" data-testid={`product-select-archived-${p.productCode}`}>
                        {t("products.picker.archived")}
                      </Badge>
                    )}
                  </HStack>
                  <Span fontSize="xs" color="fg.muted">
                    {/* The warehouse scope names the OWNER beside the product: a warehouse holds several teams'
                        goods, and two teams' "Kaos Polos" are two products. */}
                    {p.ownerName ? `${p.name} · ${p.ownerName}` : p.name}
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
