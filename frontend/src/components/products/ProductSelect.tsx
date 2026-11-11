import { useEffect, useState } from "react";
import { Avatar, Badge, Combobox, HStack, Icon, Portal, Span, Stack, useListCollection } from "@chakra-ui/react";
import { Package } from "lucide-react";
import { useTranslation } from "react-i18next";
import { type ProductSearchScope, type SearchedProduct, useProductSearch } from "../../features/products/queries";
import { searchOnlyWhatIsTyped } from "../../lib/comboboxSearch";
import { NotImplemented } from "../../features/pending/NotImplemented";
import { PRODUCT_PICKER_PENDING } from "../../features/products/pickerPending";
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
  /** The picked product — or `null` when the × empties the field. A caller holding `value` must clear it on `null`, or
   * the field is put back to the old product and the × never goes away. */
  onChange?: (product: PickedProduct | null) => void;
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
// a catalogue grows without limit, so this searches SERVER-side (ProductList's `q`, from one letter) the
// way UserSelect does, and renders each option as "sku — name". It emits the whole PickedProduct so
// the caller can snapshot sku/name onto the line; the buyer-paid unit price is entered separately.
//
// OPENED WITH NOTHING TYPED IT SHOWS THE CATALOGUE'S FIRST PAGE, and it searches ONLY what is typed (owner: *"semua
// combobox kalau sudah select opsinya munculkan semua saat dibuka kembali, selalu bermasalah jika hanya menampilkan
// satu"*, a-search-select-reopens-whole). The picked label the machine writes into the field used to be sent as the
// search, so the list opened again held the one product picked. A catalogue cannot be loaded whole, so "everything" is
// its first page — and the picked product stays on the list, so its label never goes blank.
export const description = "Searchable product picker (Chakra Combobox, server-side). Opened with nothing typed it lists the first page; typing searches it from one letter, and only what is typed (⚠ a warehouse's search still needs two, marked in the panel) — opened again after a pick it shows the list, not the one picked. Each option shows its picture (the cover, or the package placeholder). Emits the picked product's id + product code + name snapshot, and `null` when the × empties it (a caller holding `value` clears it, so the × goes). `scope`: \"team\" (default, this team's catalogue), \"all\" (cross-team discovery, #110 — selling roles only) or \"warehouse\" (only what this warehouse holds or has held, each with its owner — a-warehouse-picks-only-what-it-has-held).";

export function ProductSelect({
  teamId,
  scope = "team",
  value,
  onChange,
  placeholder = "Search products by name or product code",
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

  // Server-side search, debounced — a catalogue is too large to load whole. The query owns which answer is current; the
  // debounce only keeps the request count down.
  const q = useDebounced(input.trim());
  const results = useProductSearch({ teamId, q, scope });

  // NO TWO-LETTER MINIMUM (owner: *"harusnya tidak perlu minimal 2 huruf"*, a-product-picker-needs-no-two-letters):
  // nothing typed is the first page, one letter is a search. ⚠ A warehouse's search still refuses fewer than two on its
  // server, so there the panel says to type two and carries its mark (pickerPending.ts) — it does not ask.
  const short = scope === "warehouse" && q.length < 2;

  // The picked product first when the page does not hold it.
  useEffect(() => {
    const found = !short && teamId > 0n ? (results.data ?? []) : [];
    set(picked && !found.some((p) => p.id === picked.id) ? [picked, ...found] : found);
  }, [short, teamId, results.data, picked, set]);

  return (
    <Combobox.Root
      collection={collection}
      disabled={disabled}
      value={value !== undefined && value > 0n ? [value.toString()] : []}
      onValueChange={(e) => {
        const picked = e.value[0];
        // THE × EMPTIES IT — said to the caller as `null`, never swallowed (owner: *"produk close ablenya tidak hilang saat
        // produknya sudah close"*). Swallowed, a caller holding `value` kept the old product, so the field was put back,
        // the × stayed, and the dialog still sent the product that was cleared.
        if (picked === undefined) {
          setPicked(null);
          onChange?.(null);
          return;
        }
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
          <Combobox.ClearTrigger data-testid="product-select-clear" />
          <Combobox.Trigger />
        </Combobox.IndicatorGroup>
      </Combobox.Control>

      <Portal disabled={!portalled}>
        <Combobox.Positioner>
          <Combobox.Content>
            <Combobox.Empty>
              {short ? (
                <HStack gap="1.5" data-testid="product-select-type-two">
                  <Span>{t("products.picker.typeTwo")}</Span>
                  <NotImplemented list={PRODUCT_PICKER_PENDING} id="warehouseOpensEmpty" />
                </HStack>
              ) : (
                t("products.picker.none")
              )}
            </Combobox.Empty>
            {collection.items.map((p) => (
              <Combobox.Item item={p} key={p.id.toString()} data-testid={`product-select-option-${p.productCode}`}>
                {/* ITS PICTURE (owner: *"select product ada gambarnya"*, a-product-option-shows-its-picture) — the cover as
                    ProductListItem draws it, smaller for an option row; the package icon when it has none. */}
                <Avatar.Root shape="rounded" size="sm" colorPalette="gray" flexShrink={0}>
                  <Avatar.Fallback>
                    <Icon as={Package} boxSize="3.5" />
                  </Avatar.Fallback>
                  <Avatar.Image
                    src={p.imageUrl || undefined}
                    alt={p.name}
                    data-testid={`product-select-image-${p.productCode}`}
                  />
                </Avatar.Root>
                <Stack gap="0" flex="1" minW="0">
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
