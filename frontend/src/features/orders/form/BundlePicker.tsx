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

import type { BundleTemplate } from "./mockData";

// ADD BUNDLES THE WAY ITEMS ARE ADDED (owner: *"tambah bundle buat seperti item"*, `bundles-are-added-like-items`) — a
// button under the card's title opening a DIALOG, the shape the items card's product picker has: a search, the bundles as
// ticked rows, and Kosongkan · Batal · Konfirmasi at its foot. It replaced a search box sitting in the card's header,
// which added one bundle per pick and looked like a filter while it waited.
//
// The ticks are WHICH BUNDLES TO ADD NOW, not which are on the order — the same bundle can sit on one order twice, at
// different quantities, so a tick never mirrors a row below; every open starts with none ticked.
export function BundlePicker({
  bundles,
  disabled,
  onAdd,
}: {
  /** The bundles a team can sell. */
  bundles: BundleTemplate[];
  /** No warehouse yet — every figure on a slot would be blank, so the picker does not open. */
  disabled: boolean;
  /** Add these bundles, in the order they are listed. */
  onAdd: (templateIds: string[]) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [ticked, setTicked] = useState<Set<string>>(new Set());

  // The slot labels are searchable too: somebody looking for the bundle with the coffee in it types "coffee", not the
  // bundle's name — which they are trying to find.
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return bundles;
    return bundles.filter(
      (bundle) => bundle.name.toLowerCase().includes(q) || bundle.slots.some((slot) => slot.label.toLowerCase().includes(q)),
    );
  }, [bundles, query]);

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
    onAdd(bundles.filter((bundle) => ticked.has(bundle.id)).map((bundle) => bundle.id));
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
                    <Text color="fg.muted" data-testid="bundle-picker-empty">
                      {t("orderForm.bundles.noMatch")}
                    </Text>
                  ) : (
                    <Stack gap="0">
                      {shown.map((bundle) => (
                        // The row IS the checkbox's label, so the whole row ticks.
                        <Checkbox.Root
                          key={bundle.id}
                          checked={ticked.has(bundle.id)}
                          onCheckedChange={() => toggle(bundle.id)}
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
                                {t("orderForm.bundles.slotCount", { count: bundle.slots.length })} ·{" "}
                                {bundle.slots.map((slot) => slot.label).join(", ")}
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
