import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  CloseButton,
  Dialog,
  Flex,
  HStack,
  Icon,
  Input,
  InputGroup,
  Portal,
  RadioCard,
  SimpleGrid,
  Spinner,
  Stack,
  Text,
} from "@chakra-ui/react";
import { Link2, Search, Store } from "lucide-react";

import { rpcError } from "../../api/clients";
import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";
import { type DiscoverSupplier, useDiscoverSupplier, useDiscoverSuppliers } from "../../features/suppliers/discover";
import { useSupplierChannels } from "../../features/suppliers/queries";
import { useDebounced } from "../../lib/useDebounced";
import { MarketplaceBadge } from "../badges/MarketplaceBadge";
import { Pagination } from "../chrome/Pagination";
import { RefreshOverlay } from "../feedback/RefreshOverlay";
import { useIsMobile } from "../../layouts/shell";

/** What a pick is: a supplier, and one of its stores — `0n` when it was bought from no store. */
export interface SupplierChannelPick {
  supplierId: bigint;
  /** `0n` = the supplier alone — a market stall, a purchase in person (a-line-may-name-a-supplier-without-a-channel). */
  supplierChannelId: bigint;
}

export interface SupplierChannelPickerProps {
  /** The CALLER's team — the scope the search is authorised in. The search itself spans every team. */
  teamId: bigint;
  /** What the line names now; re-seeds the dialog each time it opens. Omit (or 0n) for nothing yet. */
  value?: SupplierChannelPick;
  /** Called on Connect only. Cancel and closing call nothing. */
  onChange: (pick: SupplierChannelPick) => void;
  /** The button that opens it. Defaults to a "Connect Supplier Channel" button. */
  trigger?: ReactNode;
  disabled?: boolean;
  /** Prefix for every test id inside — two pickers on one screen must not share ids. */
  testId?: string;
}

const PAGE_SIZE = 8;
const NO_STORE = "none";

export const description =
  "Dialog that connects something to ANY team's supplier and, optionally, one of its stores (a-line-connects-to-any-teams-supplier-from-a-popup). Searches every team's suppliers on the server, debounced; each row shows the supplier, the team that keeps it and how many live stores it has. Picking a supplier lists its live stores (marketplace badge + name) plus an explicit \"No store — bought offline\" choice, pre-chosen when the supplier has no store at all. Connect emits { supplierId, supplierChannelId } — 0n for no store; Cancel emits nothing.";

// SupplierChannelPicker — WHERE SOMETHING WAS BOUGHT, picked from every team's suppliers.
//
// Two decisions shape it (docs/business/inventory/restock_decision.md):
//
//   a-line-connects-to-any-teams-supplier-from-a-popup   the search reaches EVERY team's suppliers, not only the
//                                                       caller's — a team often buys from a vendor another team
//                                                       already found. That is Discover's read (SupplierList,
//                                                       EVERY_TEAM scope), reused rather than re-written.
//   a-line-may-name-a-supplier-without-a-channel        a store is OPTIONAL — a stall has a supplier and no store.
//                                                       So "no store" is a real choice with its own card, not the
//                                                       absence of one: a person who meant a store and forgot to
//                                                       pick it would otherwise connect the supplier alone without
//                                                       noticing. Confirm waits for an explicit choice — except
//                                                       when the supplier HAS no store, where "no store" is the
//                                                       only answer and asking would be ceremony.
//
// A DIALOG, not a combobox: the pick is two-level (a supplier, then its store), and each level needs room to show
// what tells two candidates apart — the team behind a supplier, the marketplace behind a store. The draft lives
// in the dialog; Connect applies it, Cancel throws it away.
//
// It portals (a Dialog always does), so a story finds its contents on `screen`.
export function SupplierChannelPicker({
  teamId,
  value,
  onChange,
  trigger,
  disabled,
  testId = "supplier-channel-picker",
}: SupplierChannelPickerProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  // On a phone the stores sit UNDER a page of suppliers — a pick brings them into view, or the next step is off-screen.
  const storesRef = useRef<HTMLDivElement>(null);
  const [scrollToStores, setScrollToStores] = useState(false);

  // The draft.
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [supplierId, setSupplierId] = useState<bigint>(0n);
  // The row the supplier was picked from — its name and team, without a second read. Absent when the draft
  // was SEEDED from `value`, which is when `useDiscoverSupplier` below fills in.
  const [pickedRow, setPickedRow] = useState<DiscoverSupplier | null>(null);
  // A store id as a string, `NO_STORE`, or null = not chosen yet.
  const [storeChoice, setStoreChoice] = useState<string | null>(null);

  const term = useDebounced(q.trim());

  // Reads only while open — a closed picker on every line of a form must cost nothing.
  const scope = open ? teamId : undefined;

  const suppliers = useDiscoverSuppliers({
    teamId: scope,
    q: term,
    channelType: Marketplace.UNSPECIFIED,
    ownerTeamId: 0n,
    page,
    pageSize: PAGE_SIZE,
  });
  const rows = suppliers.data?.suppliers ?? [];
  const totalItems = suppliers.data?.totalItems ?? 0;

  // The picked supplier's LIVE stores — its whole list (a supplier has a handful), read for whichever supplier
  // is picked, so a seeded pick shows its stores even when it is not on the current page of results.
  const stores = useSupplierChannels({ teamId: scope, supplierId });
  const storeRows = stores.data ?? [];

  // Name and team for a supplier seeded from `value` — it may be nowhere on the search's first page.
  const seeded = useDiscoverSupplier({ teamId: scope && !pickedRow ? scope : undefined, supplierId });
  const picked = pickedRow ?? seeded.data ?? null;

  // A supplier with NO store has one possible answer, so it is chosen for the person.
  const choice = storeChoice ?? (stores.isSuccess && storeRows.length === 0 ? NO_STORE : null);
  const canConnect = supplierId > 0n && choice !== null;

  function seed() {
    const id = value?.supplierId ?? 0n;

    setQ("");
    setPage(1);
    setSupplierId(id);
    setPickedRow(null);
    setStoreChoice(id === 0n ? null : (value?.supplierChannelId ?? 0n) > 0n ? value!.supplierChannelId.toString() : NO_STORE);
  }

  function pickSupplier(id: string) {
    const row = rows.find((s) => s.id.toString() === id) ?? null;
    if (!row) return;

    setSupplierId(row.id);
    setPickedRow(row);
    // A different supplier's stores are a different question.
    setStoreChoice(null);
    if (isMobile) setScrollToStores(true);
  }

  useEffect(() => {
    if (!scrollToStores) return;
    storesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setScrollToStores(false);
  }, [scrollToStores]);

  function connect() {
    if (!canConnect) return;

    onChange({ supplierId, supplierChannelId: choice === NO_STORE ? 0n : BigInt(choice!) });
    setOpen(false);
  }

  const teamLabel = (s: { teamId: bigint; teamName: string }) =>
    s.teamName || t("restock.supplierPicker.teamUnknown", { id: s.teamId.toString() });

  function supplierList() {
    if (suppliers.isPending) {
      return <Spinner size="sm" colorPalette="brand" />;
    }

    if (suppliers.isError) {
      return (
        <Text fontSize="sm" color="error.fg" data-testid={`${testId}-error`}>
          {rpcError(suppliers.error)}
        </Text>
      );
    }

    if (rows.length === 0) {
      return (
        <Text fontSize="sm" color="fg.muted" data-testid={`${testId}-empty`}>
          {term ? t("restock.supplierPicker.noMatch") : t("restock.supplierPicker.empty")}
        </Text>
      );
    }

    return (
      <RefreshOverlay busy={suppliers.isFetching && !suppliers.isPending}>
        <RadioCard.Root
          size="sm"
          value={supplierId > 0n ? supplierId.toString() : null}
          onValueChange={(e) => e.value && pickSupplier(e.value)}
          aria-label={t("restock.supplierPicker.supplier")}
        >
          <Stack gap="2" data-testid={`${testId}-suppliers`}>
            {rows.map((s) => (
              <RadioCard.Item key={s.id.toString()} value={s.id.toString()} data-testid={`${testId}-supplier-${s.id}`}>
                <RadioCard.ItemHiddenInput />
                <RadioCard.ItemControl>
                  <RadioCard.ItemContent minW="0">
                    <RadioCard.ItemText lineClamp={1}>{s.name}</RadioCard.ItemText>
                    <RadioCard.ItemDescription>
                      <HStack gap="2" wrap="wrap">
                        <Text as="span" lineClamp={1}>
                          {teamLabel(s)}
                        </Text>
                        {s.teamId === teamId && (
                          <Badge size="sm" variant="subtle" colorPalette="primary">
                            {t("restock.supplierPicker.yourTeam")}
                          </Badge>
                        )}
                        <HStack as="span" gap="1" data-testid={`${testId}-supplier-${s.id}-stores`}>
                          <Icon as={Store} boxSize="3" />
                          {s.channels.length === 0
                            ? t("restock.supplierPicker.noStores")
                            : t("restock.supplierPicker.storeCount", { count: s.channels.length })}
                        </HStack>
                      </HStack>
                    </RadioCard.ItemDescription>
                  </RadioCard.ItemContent>
                  <RadioCard.ItemIndicator />
                </RadioCard.ItemControl>
              </RadioCard.Item>
            ))}
          </Stack>
        </RadioCard.Root>
      </RefreshOverlay>
    );
  }

  function storeList() {
    if (supplierId === 0n) {
      return (
        <Text fontSize="sm" color="fg.muted" data-testid={`${testId}-pick-supplier-first`}>
          {t("restock.supplierPicker.pickSupplierFirst")}
        </Text>
      );
    }

    if (stores.isPending) {
      return <Spinner size="sm" colorPalette="brand" />;
    }

    return (
      <Stack gap="card">
        {picked && (
          <Stack gap="0" data-testid={`${testId}-picked`}>
            <Text fontWeight="bold" lineClamp={1}>
              {picked.name}
            </Text>
            <Text fontSize="xs" color="fg.muted">
              {teamLabel(picked)}
            </Text>
          </Stack>
        )}

        {stores.isError && (
          <Text fontSize="sm" color="error.fg">
            {rpcError(stores.error)}
          </Text>
        )}

        <RadioCard.Root
          size="sm"
          value={choice}
          onValueChange={(e) => e.value && setStoreChoice(e.value)}
          aria-label={t("restock.supplierPicker.store")}
        >
          <Stack gap="2" data-testid={`${testId}-stores`}>
            {storeRows.map((c) => (
              <RadioCard.Item key={c.id.toString()} value={c.id.toString()} data-testid={`${testId}-store-${c.id}`}>
                <RadioCard.ItemHiddenInput />
                <RadioCard.ItemControl alignItems="center">
                  <RadioCard.ItemContent minW="0">
                    <HStack gap="2" minW="0">
                      <MarketplaceBadge marketplace={c.channelType} />
                      <RadioCard.ItemText lineClamp={1}>{c.name}</RadioCard.ItemText>
                    </HStack>
                  </RadioCard.ItemContent>
                  <RadioCard.ItemIndicator />
                </RadioCard.ItemControl>
              </RadioCard.Item>
            ))}

            <RadioCard.Item value={NO_STORE} data-testid={`${testId}-no-store`}>
              <RadioCard.ItemHiddenInput />
              <RadioCard.ItemControl>
                <RadioCard.ItemContent>
                  <RadioCard.ItemText>{t("restock.supplierPicker.noStore")}</RadioCard.ItemText>
                  <RadioCard.ItemDescription>{t("restock.supplierPicker.noStoreHelp")}</RadioCard.ItemDescription>
                </RadioCard.ItemContent>
                <RadioCard.ItemIndicator />
              </RadioCard.ItemControl>
            </RadioCard.Item>
          </Stack>
        </RadioCard.Root>
      </Stack>
    );
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(e) => {
        if (e.open) seed();
        setOpen(e.open);
      }}
      size="lg"
      scrollBehavior="inside"
    >
      <Dialog.Trigger asChild data-testid={`${testId}-trigger`}>
        {trigger ?? (
          <Button type="button" size="xs" variant="outline" disabled={disabled}>
            <Icon as={Link2} boxSize="4" />
            {t("restock.supplierPicker.trigger")}
          </Button>
        )}
      </Dialog.Trigger>

      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid={`${testId}-dialog`}>
            <Dialog.Header>
              <Dialog.Title>{t("restock.supplierPicker.title")}</Dialog.Title>
            </Dialog.Header>

            <Dialog.Body>
              <Stack gap="card">
                <InputGroup startElement={<Icon as={Search} boxSize="4" />}>
                  <Input
                    value={q}
                    placeholder={t("restock.supplierPicker.searchPlaceholder")}
                    aria-label={t("restock.supplierPicker.searchPlaceholder")}
                    data-testid={`${testId}-search`}
                    onChange={(e) => {
                      setQ(e.target.value);
                      // A new search is a new question — it starts at page one.
                      setPage(1);
                    }}
                  />
                </InputGroup>

                {/* Side by side from `md` — the supplier and its stores read as one decision. Stacked on a phone,
                    where the stores follow the supplier they belong to. */}
                <SimpleGrid columns={{ base: 1, md: 2 }} gap="section" alignItems="start">
                  <Stack gap="2" minW="0">
                    <Text fontSize="sm" fontWeight="bold" color="fg.label">
                      {t("restock.supplierPicker.supplier")}
                    </Text>
                    {supplierList()}
                    {totalItems > PAGE_SIZE && (
                      <Pagination count={totalItems} pageSize={PAGE_SIZE} page={page} onPageChange={setPage} />
                    )}
                  </Stack>

                  <Stack gap="2" minW="0" ref={storesRef}>
                    <Text fontSize="sm" fontWeight="bold" color="fg.label">
                      {t("restock.supplierPicker.store")}
                    </Text>
                    {storeList()}
                  </Stack>
                </SimpleGrid>
              </Stack>
            </Dialog.Body>

            <Dialog.Footer>
              <Flex gap="2" justify="end" w="full">
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline" data-testid={`${testId}-cancel`}>
                    {t("common.cancel")}
                  </Button>
                </Dialog.ActionTrigger>
                <Button
                  colorPalette="brand"
                  disabled={!canConnect}
                  data-testid={`${testId}-confirm`}
                  onClick={connect}
                >
                  {t("restock.supplierPicker.connect")}
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
