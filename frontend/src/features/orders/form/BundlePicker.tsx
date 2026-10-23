import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Box,
  Button,
  Checkbox,
  CloseButton,
  Dialog,
  Flex,
  Icon,
  Input,
  InputGroup,
  Portal,
  Stack,
  Text,
} from "@chakra-ui/react";
import { Boxes, Search } from "lucide-react";

import { useBundleProducts, useBundleSearch } from "../../bundles/queries";
import { useDebounced } from "../../../lib/useDebounced";
import type { PickedBundle } from "./bundles";
import { pickedBundle } from "./bundles";

// ADD BUNDLES THE WAY ITEMS ARE ADDED (owner: *"tambah bundle buat seperti item"*, `bundles-are-added-like-items`) — a
// button under the card's title opening a DIALOG, the shape the items card's product picker has: a search, the bundles as
// ticked rows, and Kosongkan · Batal · Konfirmasi at its foot. It replaced a search box sitting in the card's header,
// which added one bundle per pick and looked like a filter while it waited.
//
// The ticks are WHICH BUNDLES TO ADD NOW, not which are on the order — the same bundle can sit on one order twice, at
// different quantities, so a tick never mirrors a row below; every open starts with none ticked.
//
// THE SEARCH IS THE SERVER'S — `BundleList(q)`, debounced, read only while the dialog is open (HARD RULE 9: the set
// grows). It matches a bundle's name AND its products' names and codes, because somebody after the bundle with the
// coffee in it types "kopi", not a name they are trying to find. Each row says what is IN it under the name, because a
// name may repeat (bundle-names-may-repeat) and the difference has to be readable before the pick.
export function BundlePicker({
  teamId,
  disabled,
  onAdd,
}: {
  /** The selling team whose bundles are offered. */
  teamId: bigint;
  /** No warehouse yet — every figure on a slot would be blank, so the picker does not open. */
  disabled: boolean;
  /** Add these bundles, in the order they are listed. */
  onAdd: (bundles: PickedBundle[]) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [ticked, setTicked] = useState<Set<string>>(new Set());

  const q = useDebounced(query.trim());
  const found = useBundleSearch({ teamId, q, enabled: open });
  const products = useBundleProducts({
    teamId,
    productIds: (found.data ?? []).flatMap((b) => b.lines.map((l) => l.productId)),
  });

  // A row waits for its products: a bundle is read by what is in it, and "#74" reads as nothing.
  const shown = useMemo(() => {
    const bundles = found.data ?? [];
    const ready = bundles.every((b) => b.lines.length === 0) || products.data !== undefined;
    return ready ? bundles.map((b) => pickedBundle(b, products.data)) : [];
  }, [found.data, products.data]);
  const searching = found.isFetching || products.isFetching;

  function onOpenChange(next: boolean) {
    if (next) {
      setQuery("");
      setTicked(new Set());
    }
    setOpen(next);
  }

  function toggle(id: string) {
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function confirm() {
    onAdd(shown.filter((bundle) => ticked.has(bundle.id.toString())));
    setOpen(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={(e) => onOpenChange(e.open)} size="lg" scrollBehavior="inside">
      <Dialog.Trigger asChild>
        <Button type="button" size="xs" variant="outline" disabled={disabled} data-testid="bundle-add">
          <Icon as={Boxes} boxSize="4" />
          {t("orderForm.bundles.add")}
        </Button>
      </Dialog.Trigger>

      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          {/* A FIXED HEIGHT, as the product picker's (a-picker-dialog-keeps-its-height) — on a desktop and a phone
              alike: `min()` of 48rem and 88dvh, so a laptop gets a full panel and a phone never more than its screen. A
              search that narrows the list never moves the footer, and only the list scrolls. */}
          <Dialog.Content data-testid="bundle-picker-dialog" h="min(88dvh, 48rem)">
            <Dialog.Header>
              <Dialog.Title>{t("orderForm.bundles.pickerTitle")}</Dialog.Title>
            </Dialog.Header>

            <Dialog.Body display="flex" flexDirection="column" minH="0" overflow="hidden">
              <Stack gap="card" flex="1" minH="0">
                <InputGroup startElement={<Icon as={Search} boxSize="4" color="fg.muted" />}>
                  <Input
                    value={query}
                    placeholder={t("orderForm.bundles.search")}
                    data-testid="bundle-picker-search"
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </InputGroup>

                {/* THE ONE SCROLLER, its bar on the dialog's edge (layerStyle scrollList, pulled out through the
                    body's padding) — as the product picker's rows are. */}
                <Box flex="1" minH="0" layerStyle="scrollList" me="-6" pe="6" data-testid="bundle-picker-scroll">
                  {shown.length === 0 ? (
                    <Text color="fg.muted" data-testid={searching ? "bundle-picker-searching" : "bundle-picker-empty"}>
                      {searching ? t("orderForm.bundles.searching") : t("orderForm.bundles.noMatch")}
                    </Text>
                  ) : (
                    <Stack gap="0">
                      {shown.map((bundle) => (
                        // The row IS the checkbox's label, so the whole row ticks.
                        <Checkbox.Root
                          key={bundle.id.toString()}
                          checked={ticked.has(bundle.id.toString())}
                          onCheckedChange={() => toggle(bundle.id.toString())}
                          alignItems="center"
                          gap="3"
                          py="2.5"
                          px="2"
                          borderBottomWidth="1px"
                          borderColor="border"
                          cursor="pointer"
                          _hover={{ bg: "bg.muted" }}
                          data-testid={`bundle-pick-${bundle.id}`}
                        >
                          <Checkbox.HiddenInput />
                          <Checkbox.Control flexShrink={0} />
                          <Checkbox.Label flex="1" minW="0">
                            <Stack gap="0.5" minW="0">
                              <Text fontWeight="medium" lineClamp={1}>
                                {bundle.name}
                              </Text>
                              <Text fontSize="xs" color="fg.muted" fontWeight="normal" lineClamp={1}>
                                {bundle.slots.map((slot) => `${slot.ruleQty} × ${slot.name}`).join(" · ")}
                              </Text>
                            </Stack>
                          </Checkbox.Label>
                        </Checkbox.Root>
                      ))}
                    </Stack>
                  )}
                </Box>
              </Stack>
            </Dialog.Body>

            {/* Kosongkan on the left, away from the other two — as the product picker has it. */}
            <Dialog.Footer justifyContent="space-between">
              <Button
                variant="ghost"
                disabled={ticked.size === 0}
                data-testid="bundle-picker-clear"
                onClick={() => setTicked(new Set())}
              >
                {t("productPicker.clear")}
              </Button>
              <Flex gap="3">
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline" data-testid="bundle-picker-cancel">
                    {t("common.cancel")}
                  </Button>
                </Dialog.ActionTrigger>
                <Button colorPalette="brand" disabled={ticked.size === 0} data-testid="bundle-picker-confirm" onClick={confirm}>
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
