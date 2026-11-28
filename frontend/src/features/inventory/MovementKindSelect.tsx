import { useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Box,
  Button,
  CloseButton,
  Combobox,
  Drawer,
  Icon,
  Input,
  InputGroup,
  Portal,
  Stack,
  Text,
  useListCollection,
} from "@chakra-ui/react";
import { Check, ChevronDown, Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { MovementKind } from "../../gen/warehouse/inventory/v1/inventory_pb";
import { useIsMobile } from "../../layouts/shell";
import { searchOnlyWhatIsTyped } from "../../lib/comboboxSearch";
import { kindLabel, kindPalette } from "./movementKind";

// The kinds a ledger can be narrowed to, in the order a stock's life reads: in, out, moved, set right. One list, so a kind
// added to the ledger is offered here by adding it once.
export const LEDGER_KINDS: MovementKind[] = [
  MovementKind.RECEIVE,
  MovementKind.TRANSFER_IN,
  MovementKind.RETURN,
  // #143's split kinds, each where its units went: an order's take put back and a found unit in, a broken unit out.
  MovementKind.CANCEL,
  MovementKind.FOUND,
  MovementKind.PICK,
  MovementKind.TRANSFER_OUT,
  MovementKind.SAMPLE,
  MovementKind.BROKEN,
  MovementKind.MOVE,
  MovementKind.ADJUST,
  MovementKind.REVALUATION,
];

interface KindItem {
  value: string;
  label: string;
  kind: MovementKind;
}

export const description =
  "A ledger's Kegiatan filter (Chakra Combobox). Emits a MovementKind — ONE at a time, as StockHistory's filter takes it — and UNSPECIFIED when empty, which reads *Semua kegiatan*. Each option is the kind's BADGE, in the colour it has in the ledger's rows (kindPalette); typing searches the kinds' words; its × empties it back to every kind.";

// MovementKindSelect narrows a stock ledger to ONE kind of movement (owner, on a batch's Riwayat: *"pakai kindnya"*, then
// *"selectnya pakai badge seperti sebelumnya, ada search juga, lalu ada closeable"*, riwayat-filters-by-one-kind).
//
// A SEARCH SELECT ON THE OWNER'S WORD, though the set is bounded by the code (nine kinds, never data) — the rule would
// make it a plain list; the owner asked for the search. Each option is drawn as the BADGE the kind has in the rows below
// (a-movement-kind-is-a-badge), so the filter and what it narrows read alike. Empty means every kind: no *Semua kegiatan*
// option to pick — the placeholder says it, and the × goes back to it.
export function MovementKindSelect({
  value,
  onChange,
  sheetOnPhone = false,
  testId = "movement-kind-select",
}: {
  value: MovementKind;
  onChange: (kind: MovementKind) => void;
  /**
   * ON A PHONE, A DRAWER FROM THE BOTTOM (owner: *"untuk filter select dan tanggal, di mobile bisa pakai drawer dari
   * bawah?"*, a-phone-filter-opens-from-the-bottom) — the search, then the kinds' badges as rows a thumb can hit.
   */
  sheetOnPhone?: boolean;
  testId?: string;
}) {
  const { t } = useTranslation();
  const phone = useIsMobile();

  const items: KindItem[] = useMemo(
    () => LEDGER_KINDS.map((kind) => ({ value: String(kind), label: kindLabel(t, kind), kind })),
    [t],
  );

  const { collection, filter, set } = useListCollection<KindItem>({
    initialItems: items,
    itemToString: (item) => item.label,
    itemToValue: (item) => item.value,
    filter: (itemText, filterText) => itemText.toLowerCase().includes(filterText.trim().toLowerCase()),
  });

  // The words follow the language — a switch re-labels the options.
  useEffect(() => {
    set(items);
  }, [items, set]);

  if (phone && sheetOnPhone) {
    return <KindSheet value={value} onChange={onChange} items={items} testId={testId} />;
  }

  return (
    <Combobox.Root
      collection={collection}
      // Only a keystroke searches; a pick, a blur or a click-to-open starts over — so the list reopens whole.
      {...searchOnlyWhatIsTyped(filter)}
      selectionBehavior="replace"
      openOnClick
      w="full"
      value={value === MovementKind.UNSPECIFIED ? [] : [String(value)]}
      onValueChange={(e) => {
        // ⚠ CLEARING EMITS UNSPECIFIED — every kind, the none sentinel, never nothing (#131).
        const picked = e.value[0];
        onChange(picked ? (Number(picked) as MovementKind) : MovementKind.UNSPECIFIED);
      }}
    >
      <Combobox.Control>
        <Combobox.Input
          data-testid={testId}
          placeholder={t("warehouseProduct.kind.all")}
          aria-label={t("inventory.movement.what")}
        />
        <Combobox.IndicatorGroup>
          <Combobox.ClearTrigger data-testid={`${testId}-clear`} />
          <Combobox.Trigger />
        </Combobox.IndicatorGroup>
      </Combobox.Control>

      <Portal>
        <Combobox.Positioner>
          <Combobox.Content>
            <Combobox.Empty>{t("warehouseProduct.kind.none")}</Combobox.Empty>
            {collection.items.map((item) => (
              <Combobox.Item item={item} key={item.value} data-testid={`${testId}-${item.value}`}>
                <Badge colorPalette={kindPalette(item.kind)} variant="subtle">
                  {item.label}
                </Badge>
                <Combobox.ItemIndicator />
              </Combobox.Item>
            ))}
          </Combobox.Content>
        </Combobox.Positioner>
      </Portal>
    </Combobox.Root>
  );
}

// A PHONE'S KEGIATAN — the control is the picked kind's BADGE (or *Semua kegiatan*), its × beside it, and a tap opens a
// drawer from the bottom (a-phone-filter-opens-from-the-bottom):
//
//   Kegiatan                                  ×
//   [⌕ Cari kegiatan                        ]
//   (Diterima)                                ✓   ← each kind a row a thumb can hit, 44px; the picked one ticked
//   (Ditransfer masuk)
//   …
//
// A tap on a kind picks it and closes the drawer. Its own state — open, the search — so the desktop's combobox is not
// carried by a phone that never draws it.
function KindSheet({
  value,
  onChange,
  items,
  testId,
}: {
  value: MovementKind;
  onChange: (kind: MovementKind) => void;
  items: KindItem[];
  testId: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  // Where the drawer's focus lands when it opens — its close button, NOT the search: a focused field throws a phone's
  // keyboard up over half the list before anybody asked to type.
  const closeRef = useRef<HTMLButtonElement>(null);
  const picked = items.find((item) => item.kind === value);
  const needle = search.trim().toLowerCase();
  const shown = needle ? items.filter((item) => item.label.toLowerCase().includes(needle)) : items;

  return (
    <>
      <Box position="relative" w="full">
        <Button
          variant="outline"
          w="full"
          justifyContent="start"
          aria-label={t("warehouseProduct.kind.title")}
          data-testid={testId}
          onClick={() => {
            setSearch("");
            setOpen(true);
          }}
        >
          {picked ? (
            <Badge colorPalette={kindPalette(picked.kind)} variant="subtle" data-testid={`${testId}-picked`}>
              {picked.label}
            </Badge>
          ) : (
            <Text as="span" color="fg.muted" fontWeight="normal">
              {t("warehouseProduct.kind.all")}
            </Text>
          )}
          <Icon as={ChevronDown} boxSize="4" ml="auto" color="fg.muted" />
        </Button>
        {/* Its ×, beside the trigger and before the chevron, as the date's — back to every kind
            (a-stock-ledger-filters-by-one-kind). */}
        {picked && (
          <CloseButton
            size="2xs"
            variant="ghost"
            color="fg.muted"
            position="absolute"
            top="50%"
            translate="0 -50%"
            right="8"
            animationStyle="appear"
            aria-label={t("warehouseProduct.kind.all")}
            data-testid={`${testId}-clear`}
            onClick={() => onChange(MovementKind.UNSPECIFIED)}
          />
        )}
      </Box>

      <Drawer.Root
        open={open}
        onOpenChange={(e) => setOpen(e.open)}
        placement="bottom"
        initialFocusEl={() => closeRef.current}
      >
        <Portal>
          <Drawer.Backdrop />
          <Drawer.Positioner>
            <Drawer.Content roundedTop="l3" maxH="88dvh" data-testid={`${testId}-sheet`}>
              <Drawer.Header>
                <Drawer.Title>{t("warehouseProduct.kind.title")}</Drawer.Title>
              </Drawer.Header>
              <Drawer.CloseTrigger asChild>
                <CloseButton ref={closeRef} size="sm" data-testid={`${testId}-close`} />
              </Drawer.CloseTrigger>
              <Drawer.Body>
                <Stack gap="2">
                  <InputGroup startElement={<Icon as={Search} boxSize="4" />}>
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder={t("warehouseProduct.kind.search")}
                      data-testid={`${testId}-search`}
                    />
                  </InputGroup>
                  <Stack gap="0">
                    {shown.length === 0 && (
                      <Text color="fg.muted" py="3" data-testid={`${testId}-none`}>
                        {t("warehouseProduct.kind.none")}
                      </Text>
                    )}
                    {shown.map((item) => {
                      const on = item.kind === value;

                      return (
                        <Button
                          key={item.value}
                          variant="ghost"
                          h="11"
                          w="full"
                          justifyContent="space-between"
                          aria-pressed={on}
                          data-testid={`${testId}-${item.value}`}
                          onClick={() => {
                            onChange(item.kind);
                            setOpen(false);
                          }}
                        >
                          {/* LARGER IN THE DRAWER (owner: *"drawer kegiatan, teksnya buat lebih besar di drawer, biar
                              lebih mudah dibaca"*, then of 16px *"terlalu besar"*) — a md badge, 14px words, a step over
                              the ledger's 12px; the control's own badge and the ledger's stay their size. */}
                          <Badge
                            colorPalette={kindPalette(item.kind)}
                            variant="subtle"
                            size="md"
                            data-testid={`${testId}-${item.value}-badge`}
                          >
                            {item.label}
                          </Badge>
                          {on && <Icon as={Check} boxSize="5" color="brand.fg" />}
                        </Button>
                      );
                    })}
                  </Stack>
                </Stack>
              </Drawer.Body>
            </Drawer.Content>
          </Drawer.Positioner>
        </Portal>
      </Drawer.Root>
    </>
  );
}
