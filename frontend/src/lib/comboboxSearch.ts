// What a search select should SEARCH FOR — only what the person typed.
//
// A Combobox sets its input's text for several reasons, and only one of them is a keystroke. After a pick
// the machine writes the picked label into the field (`item-select`), and on blur it writes it back
// (`interact-outside`). Searching on THOSE meant the list, opened again, was filtered by the label of what
// was already chosen — one option left, as if the rest had gone (owner: *"saat sudah select data, ketika
// panel dibuka lagi, dia cuma ada 1 opsi"*). AddressPicker found the same rule first and carries it inline.
export function typedSearch(e: { inputValue: string; reason?: string }): string {
  return e.reason === "input-change" ? e.inputValue : "";
}

/**
 * Both halves, to spread on a `Combobox.Root`: search on a keystroke only, and START OVER whenever the
 * panel is opened by a click or an arrow key.
 *
 * ⚠ THE OPEN HALF IS NOT OPTIONAL. Type "Warehouse Admin" and pick *Warehouse Admin*: the field's text does
 * not change, so no `item-select` change fires and the typed search stays — the reopened panel is one
 * option again. Opening by TYPING keeps the search, or the first keystroke would be thrown away.
 */
export function searchOnlyWhatIsTyped(setSearch: (text: string) => void) {
  return {
    onInputValueChange: (e: { inputValue: string; reason?: string }) => setSearch(typedSearch(e)),
    onOpenChange: (e: { open: boolean; reason?: string }) => {
      if (e.open && e.reason !== "input-change") setSearch("");
    },
  };
}
