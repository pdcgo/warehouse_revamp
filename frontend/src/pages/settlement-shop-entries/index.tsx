import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";
import { Badge, Box, Button, Flex, HStack, Heading, Icon, Link, Span, Stack, Table, Text } from "@chakra-ui/react";
import { SearchX, Store, Undo2 } from "lucide-react";

import { rpcError } from "../../api/clients";
import { MarketplaceBadge } from "../../components/badges/MarketplaceBadge";
import { SettlementSourceBadge } from "../../components/badges/SettlementSourceBadge";
import { FilterBar, FilterField } from "../../components/chrome/FilterBar";
import { GrowingPager } from "../../components/chrome/GrowingPager";
import { DateRangePicker, LAST_MONTH } from "../../components/datetime/DateRangePicker";
import type { DateRange } from "../../components/datetime/DateRangePicker";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { EmptyHint } from "../../components/feedback/EmptyHint";
import { ListSkeleton } from "../../components/feedback/ListSkeleton";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { toaster } from "../../components/feedback/Toaster";
import { ChoiceFilter } from "../../components/pickers/ChoiceFilter";
import { ShopSelect } from "../../components/pickers/ShopSelect";
import { SummaryCard, SummaryStrip } from "../../features/orders/SummaryCard";
import {
  SHOP_ENTRY_KINDS,
  sourceKey,
  useReverseShopEntry,
  useShopSettlementEntries,
  type ShopEntry,
} from "../../features/settlement/shopEntries";
import { jakartaWindowOf } from "../../features/settlement/window";
import { useShopOptions } from "../../features/shops/queries";
import { ShopStatusBadge } from "../../features/shops/ShopStatusBadge";
import { canWrite, useTeam } from "../../features/team/TeamContext";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { SettlementType } from "../../gen/warehouse/settlement/v1/settlement_pb";
import { ShopStatus } from "../../gen/warehouse/selling/v1/selling_pb";
import { useIsMobile } from "../../layouts/shell";
import { formatDayShort } from "../../lib/datetime";
import { formatRupiah, formatSignedRupiah } from "../../lib/money";
import { dateRangeCodec, idCodec, oneOfCodec, useUrlState } from "../../lib/urlState";

const PAGE_SIZE = 20;

/** A kind's URL word — the wire enum's name, lower-cased ("withdrawal", "external_ads_fee"). */
const kindWord = (type: SettlementType): string => SettlementType[type].toLowerCase();
const KIND_WORDS = SHOP_ENTRY_KINDS.map(kindWord);
const KIND_CODEC = oneOfCodec<string>(KIND_WORDS);
const kindOf = (word: string): SettlementType | undefined =>
  SHOP_ENTRY_KINDS.find((type) => kindWord(type) === word);

/** A kind in business words — the order ledger's own names, plus the one type no order ever carries. */
export function kindLabel(t: (key: string) => string, type: SettlementType): string {
  return type === SettlementType.SYSTEM_ADJUSTMENT
    ? t("settlementShopEntries.type.system_adjustment")
    : t(`orderSettlement.type.${kindWord(type)}`);
}

/** Who reverses a row — the order ledger's write set (the-write-set-is-cs-and-up, a-shop-entry-reverses-inline). */
const REVERSERS = new Set<Role>([Role.ROOT, Role.ADMINISTRATOR, Role.SELLING_OWNER, Role.SELLING_ADMIN, Role.SELLING_CS]);

// SettlementShopEntriesPage — Shop Entries (the-shop-entries-page-is-accepted), `/settlement/shop-entries`, *Entri Toko*
// under Penyelesaian. The settlement rows addressed to a SHOP rather than to an order (an-entry-names-an-order-or-a-shop):
// they fold into the report's figures, and no other screen lists them (an-upload-is-never-reverted: "a wrong shop row —
// no screen").
//
// The rules it carries, each an existing decision applied, not a new one:
//   - the window is the day we LEARNED it — `posted_on`, in Jakarta days — so a shop's entries add up to what the report
//     folded for that shop and window (posted-on-buckets-the-report); the other day shows under it when it differs;
//   - Received leaves withdrawals out and Withdrawn stands beside it (the-report-headline-is-position-to-date);
//   - the shop filter offers closed shops, badged (report-filters-offer-closed-shops); filters live in the URL;
//   - a row carries Reverse, behind a confirm, for the order ledger's write set (a-shop-entry-reverses-inline): it posts
//     the opposite row on the same shop (a-correction-is-a-new-row); a row already reversed reads Reversed, no second.
export function SettlementShopEntriesPage() {
  const { t } = useTranslation();
  const { current } = useTeam();
  const phone = useIsMobile();
  const teamId = current?.teamId;
  const mayReverse = current?.role !== undefined && REVERSERS.has(current.role) && canWrite(current);
  const [reversing, setReversing] = useState<ShopEntry | null>(null);
  const reverse = useReverseShopEntry(teamId);

  // THE FILTERS LIVE IN THE URL (a-lists-filters-live-in-the-url) — the report's By shop row opens this list on its shop
  // and its window, and a refresh opens the same list.
  const [shopId, setShopIdRaw] = useUrlState("shop", 0n, idCodec);
  const [kindKey, setKindRaw] = useUrlState<string>("kind", "", KIND_CODEC);
  const [range, setRangeRaw] = useUrlState<DateRange>("range", LAST_MONTH, dateRangeCodec);
  const [page, setPage] = useState(1);

  const refilter =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setPage(1);
    };
  const setShopId = refilter(setShopIdRaw);
  const setKind = refilter(setKindRaw);
  const setRange = refilter(setRangeRaw);

  const kind = kindOf(kindKey);
  const { from, to } = jakartaWindowOf(range);

  const query = useShopSettlementEntries({ teamId, shopId, kind, from, to, page, pageSize: PAGE_SIZE });

  const entries = query.data?.entries ?? [];
  const totals = query.data?.totals;
  const shops = useShopOptions({ teamId: teamId ?? 0n });
  const shopById = useMemo(() => new Map((shops.data ?? []).map((s) => [s.id.toString(), s])), [shops.data]);

  const kindOptions = useMemo(
    () => SHOP_ENTRY_KINDS.map((type) => ({ value: kindWord(type), label: kindLabel(t, type) })),
    [t],
  );

  const filterCount = [shopId > 0n, kind !== undefined, dateRangeCodec.encode(range) !== dateRangeCodec.encode(LAST_MONTH)].filter(
    Boolean,
  ).length;
  const narrowed = shopId > 0n || kind !== undefined;
  const clear = () => {
    setShopIdRaw(0n);
    setKindRaw("");
    setRangeRaw(LAST_MONTH);
    setPage(1);
  };

  if (!current || !teamId) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("settlementShopEntries.title")}</Heading>
        <Text color="fg.muted">{t("settlementShopEntries.selectTeam")}</Text>
      </Stack>
    );
  }

  const countCard = (
    <SummaryCard
      key="count"
      label={t("settlementShopEntries.stat.count")}
      value={<Span data-testid="shop-entries-count">{totals ? totals.count.toString() : "—"}</Span>}
      line={t("settlementShopEntries.stat.countLine")}
      testId="shop-entries-count-card"
    />
  );
  const receivedCard = (
    <SummaryCard
      key="received"
      label={t("settlementShopEntries.stat.received")}
      value={
        <Span color={totals && totals.received < 0 ? "fg.error" : undefined} data-testid="shop-entries-received">
          {totals ? formatSignedRupiah(totals.received) : "—"}
        </Span>
      }
      line={t("settlementShopEntries.stat.receivedLine")}
      emphasis
      wide={phone}
      testId="shop-entries-received-card"
    />
  );
  const withdrawnCard = (
    <SummaryCard
      key="withdrawn"
      label={t("settlementShopEntries.stat.withdrawn")}
      value={<Span data-testid="shop-entries-withdrawn">{totals ? formatRupiah(totals.withdrawn) : "—"}</Span>}
      line={t("settlementShopEntries.stat.withdrawnLine")}
      testId="shop-entries-withdrawn-card"
    />
  );

  const shopName = (id: bigint) => shopById.get(id.toString())?.name ?? `#${id}`;
  // Names come with the rows (the server's user read); an unknown person reads as their id.
  const actorName = (entry: ShopEntry) => entry.actorName || `#${entry.actorId}`;
  const canReverse = (entry: ShopEntry) => mayReverse && entry.reversedById === 0n && entry.reversesId === 0n;

  const confirmReverse = async () => {
    const entry = reversing;
    if (!entry) return;
    try {
      await reverse.mutateAsync(entry);
      toaster.create({ type: "success", title: t("settlementShopEntries.reversed", { id: entry.id.toString() }) });
    } catch (err) {
      toaster.create({ type: "error", title: t("settlementShopEntries.reverseFailed"), description: rpcError(err) });
    }
    setReversing(null);
  };

  return (
    <Stack gap="section" animationStyle="enter" data-testid="shop-entries-page" data-layout={phone ? "phone" : undefined}>
      <Stack gap="1">
        <Flex align="center" gap="card" wrap={phone ? "nowrap" : "wrap"}>
          <Heading size="md">{t("settlementShopEntries.title")}</Heading>
          <Badge colorPalette="brand" {...(phone ? { minW: "0", truncate: true } : {})}>
            {current.teamName}
          </Badge>
        </Flex>
        <Text fontSize="sm" color="fg.muted">
          {t("settlementShopEntries.subtitle")}
        </Text>
      </Stack>

      {/* THE TOTALS, AS THE ORDER LIST'S CARDS (a-list-summary-is-the-order-lists-card-strip) — over the whole filtered
          set, never the page. Received and Withdrawn are the report's own two words for these rows. */}
      <SummaryStrip testId="shop-entries-summary">
        {/* On a phone the lead card spans the row, first, and the two others share the next — never one alone in half a
            row (SummaryCard `wide`). An array, not a fragment: the strip counts its children to size its columns. */}
        {phone ? [receivedCard, countCard, withdrawnCard] : [countCard, receivedCard, withdrawnCard]}
      </SummaryStrip>

      {/* THE STRIP (FilterBar): the shop, the kind, then the window — on a phone all three in the sheet. */}
      <FilterBar active={filterCount > 0} count={filterCount} onClear={clear} testId="shop-entries-filters">
        <FilterField w="15rem" testId="shop-entries-shop-filter">
          <ShopSelect
            // Closed shops too, after the open ones, badged (report-filters-offer-closed-shops).
            asFilter
            teamId={teamId}
            value={shopId > 0n ? shopId : undefined}
            placeholder={t("settlementShopEntries.allShops")}
            onChange={setShopId}
          />
        </FilterField>
        <FilterField testId="shop-entries-kind-filter">
          <ChoiceFilter
            value={kind !== undefined ? kindKey : undefined}
            onChange={(next) => setKind(next ?? "")}
            options={kindOptions}
            placeholder={t("settlementShopEntries.allKinds")}
            testId="shop-entries-kind"
          />
        </FilterField>
        {/* ONE field, shown not offered: it names which day the window means (a-date-range-filter-is-the-order-lists-picker). */}
        <DateRangePicker
          value={range}
          onChange={setRange}
          fields={[{ value: "posted", label: t("settlementShopEntries.learned") }]}
          field="posted"
          testId="shop-entries-range"
        />
      </FilterBar>

      {query.isError && (
        <Text color="fg.error" data-testid="shop-entries-error">
          {rpcError(query.error)}
        </Text>
      )}

      {query.isPending ? (
        <ListSkeleton testId="shop-entries-loading" />
      ) : (
        <Stack gap="card" animationStyle="swap">
          <RefreshOverlay busy={query.isFetching && !query.isPending}>
            {entries.length === 0 ? (
              narrowed ? (
                <EmptyHint
                  icon={SearchX}
                  title={t("settlementShopEntries.emptyFiltered")}
                  description={t("settlementShopEntries.emptyFilteredHint")}
                  action={
                    <Button variant="outline" onClick={clear} data-testid="shop-entries-empty-clear">
                      {t("common.clearFilters")}
                    </Button>
                  }
                  testId="shop-entries-empty"
                />
              ) : (
                <EmptyHint
                  icon={Store}
                  title={t("settlementShopEntries.empty")}
                  description={`${t("settlementShopEntries.emptyHint")} ${t("emptyHint.otherPeriod")}`}
                  testId="shop-entries-empty"
                />
              )
            ) : phone ? (
              // ONE BLOCK PER ENTRY (a-phone-reads-each-line-as-a-block): the kind and the amount, then the day and the
              // shop, then where it came from.
              <Stack gap="0" data-testid="shop-entries-table" data-layout="blocks">
                {entries.map((entry) => (
                  <EntryBlock
                    key={entry.id.toString()}
                    entry={entry}
                    shop={shopName(entry.shopId)}
                    actor={actorName(entry)}
                    onReverse={canReverse(entry) ? () => setReversing(entry) : undefined}
                  />
                ))}
              </Stack>
            ) : (
              <Table.ScrollArea>
                <Table.Root size="sm" interactive data-testid="shop-entries-table">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeader>{t("settlementShopEntries.col.date")}</Table.ColumnHeader>
                      <Table.ColumnHeader>{t("settlementShopEntries.col.shop")}</Table.ColumnHeader>
                      <Table.ColumnHeader>{t("settlementShopEntries.col.kind")}</Table.ColumnHeader>
                      <Table.ColumnHeader>{t("settlementShopEntries.col.reference")}</Table.ColumnHeader>
                      <Table.ColumnHeader>{t("settlementShopEntries.col.statement")}</Table.ColumnHeader>
                      <Table.ColumnHeader textAlign="end">{t("settlementShopEntries.col.amount")}</Table.ColumnHeader>
                      <Table.ColumnHeader />
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {entries.map((entry) => {
                      const shop = shopById.get(entry.shopId.toString());
                      return (
                        <Table.Row
                          key={entry.id.toString()}
                          data-testid={`shop-entry-${entry.id}`}
                          // A REVERSED ROW IS DIMMED, as the order ledger dims one — it still happened.
                          opacity={entry.reversedById !== 0n ? 0.5 : 1}
                        >
                          <Table.Cell whiteSpace="nowrap">
                            <Text fontSize="sm">{formatDayShort(entry.postedOn)}</Text>
                            {entry.occurredOn !== entry.postedOn && (
                              <Text fontSize="xs" color="fg.muted">
                                {t("settlementShopEntries.belongsTo", { date: formatDayShort(entry.occurredOn) })}
                              </Text>
                            )}
                          </Table.Cell>
                          <Table.Cell>
                            <HStack gap="1.5">
                              <Text fontSize="sm">{shop?.name ?? `#${entry.shopId}`}</Text>
                              {shop && <MarketplaceBadge marketplace={shop.marketplace} size="sm" />}
                              {shop?.status === ShopStatus.CLOSED && (
                                <ShopStatusBadge size="xs" testId={`shop-entry-closed-${entry.id}`} />
                              )}
                            </HStack>
                          </Table.Cell>
                          {/* The kind, its source badge under it (a-badge-stacks-under-its-text-when-the-table-is-cramped). */}
                          <Table.Cell>
                            <Text fontSize="sm" data-testid={`shop-entry-kind-${entry.id}`}>
                              {kindLabel(t, entry.settlementType)}
                            </Text>
                            <SettlementSourceBadge source={sourceKey(entry.sourceType)} />
                          </Table.Cell>
                          <Table.Cell maxW="xs">
                            <Text fontSize="sm" lineClamp={2} data-testid={`shop-entry-ref-${entry.id}`}>
                              {referenceOf(t, entry)}
                            </Text>
                          </Table.Cell>
                          <Table.Cell>
                            <StatementCell entry={entry} actor={actorName(entry)} />
                          </Table.Cell>
                          <Table.Cell textAlign="end" whiteSpace="nowrap">
                            <Text
                              fontSize="sm"
                              fontWeight="medium"
                              color={entry.change < 0 ? "fg.error" : entry.change > 0 ? "fg.success" : undefined}
                              data-testid={`shop-entry-amount-${entry.id}`}
                            >
                              {formatSignedRupiah(entry.change)}
                            </Text>
                          </Table.Cell>
                          <Table.Cell textAlign="end" whiteSpace="nowrap">
                            <ReverseCell entry={entry} onReverse={canReverse(entry) ? () => setReversing(entry) : undefined} />
                          </Table.Cell>
                        </Table.Row>
                      );
                    })}
                  </Table.Body>
                </Table.Root>
              </Table.ScrollArea>
            )}
          </RefreshOverlay>

          {/* THE PAGES GROW AS THEY ARE OPENED (every-list-pages-with-the-growing-pager); any filter starts it over. */}
          <GrowingPager
            page={page}
            onPageChange={setPage}
            hasNext={query.isPlaceholderData ? undefined : query.data?.hasNext}
            resetKey={[shopId, kindKey, from, to].join("|")}
            pageSize={PAGE_SIZE}
            testId="shop-entries-pager"
          />
        </Stack>
      )}

      {/* Reversing posts a real, permanent row — so it confirms, naming the row and its amount, like the order ledger. */}
      <ConfirmDialog
        open={reversing !== null}
        onOpenChange={(next) => {
          if (!next) setReversing(null);
        }}
        title={t("orderSettlement.reverseTitle")}
        message={
          reversing
            ? t("settlementShopEntries.reverseBody", {
                amount: formatSignedRupiah(-reversing.change),
                type: kindLabel(t, reversing.settlementType),
                shop: shopName(reversing.shopId),
                date: formatDayShort(reversing.postedOn),
              })
            : ""
        }
        confirmLabel={t("orderSettlement.reverseConfirm")}
        onConfirm={confirmReverse}
      />
    </Stack>
  );
}

/** The row's action: Reverse — or what it already is, a reversed row or a reversal. */
function ReverseCell({ entry, onReverse }: { entry: ShopEntry; onReverse?: () => void }) {
  const { t } = useTranslation();
  if (entry.reversedById !== 0n) {
    return (
      <Badge size="sm" colorPalette="gray" data-testid={`shop-entry-reversed-${entry.id}`}>
        {t("settlementShopEntries.reversedBadge")}
      </Badge>
    );
  }
  if (entry.reversesId !== 0n) {
    return (
      <Text fontSize="xs" color="fg.muted" data-testid={`shop-entry-reversal-${entry.id}`}>
        {t("settlementShopEntries.reversalOf", { id: entry.reversesId.toString() })}
      </Text>
    );
  }
  if (!onReverse) return null;

  return (
    <Button size="xs" variant="ghost" onClick={onReverse} data-testid={`shop-entry-reverse-${entry.id}`}>
      <Icon as={Undo2} boxSize="3.5" />
      {t("orderSettlement.reverse")}
    </Button>
  );
}

/** What the entry IS, in the platform's or the person's words — the reference a reader matches against the statement. */
function referenceOf(t: (key: string, opts?: Record<string, unknown>) => string, entry: ShopEntry): string {
  const line = entry.import;
  if (!line) return entry.note || "—";
  if (line.reason === "no_order") return t("settlementShopEntries.reason.no_order", { ref: line.orderRef });
  if (line.reason === "several_orders") {
    return t("settlementShopEntries.reason.several_orders", {
      ref: line.orderRef,
      count: line.foundOrderIds.length,
      orders: line.foundOrderIds.map((id) => `#${id}`).join(", "),
    });
  }

  return line.description || line.sheet;
}

/** Where it came from: the statement import (a link to its page) and who uploaded it — or a hand post and who made it. */
function StatementCell({ entry, actor }: { entry: ShopEntry; actor: string }) {
  const { t } = useTranslation();
  const line = entry.import;
  const period =
    line && line.periodFrom === line.periodTo
      ? formatDayShort(line.periodFrom)
      : line
        ? `${formatDayShort(line.periodFrom)} – ${formatDayShort(line.periodTo)}`
        : "";

  return (
    <Stack gap="0">
      {line ? (
        <Link asChild fontSize="sm" colorPalette="primary" data-testid={`shop-entry-import-${entry.id}`}>
          <RouterLink to={`/settlement/imports/${line.fileId}`}>{t("settlementShopEntries.statement", { period })}</RouterLink>
        </Link>
      ) : (
        <Text fontSize="sm" data-testid={`shop-entry-import-${entry.id}`}>
          {t("settlementShopEntries.byHand")}
        </Text>
      )}
      {/* Who uploaded the statement — or who posted the row by hand. */}
      <Text fontSize="xs" color="fg.muted" data-testid={`shop-entry-by-${entry.id}`}>
        {t("settlementShopEntries.byPerson", { name: line?.uploadedByName || actor })}
      </Text>
    </Stack>
  );
}

function EntryBlock({
  entry,
  shop,
  actor,
  onReverse,
}: {
  entry: ShopEntry;
  shop: string;
  actor: string;
  onReverse?: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Box
      py="2.5"
      px="1"
      borderBottomWidth="1px"
      borderColor="border.muted"
      opacity={entry.reversedById !== 0n ? 0.5 : 1}
      data-testid={`shop-entry-${entry.id}`}
    >
      <Flex justify="space-between" align="baseline" gap="3">
        <Text fontSize="sm" fontWeight="medium" minW="0" truncate data-testid={`shop-entry-kind-${entry.id}`}>
          {kindLabel(t, entry.settlementType)}
        </Text>
        <Text
          fontSize="sm"
          fontWeight="bold"
          whiteSpace="nowrap"
          color={entry.change < 0 ? "fg.error" : entry.change > 0 ? "fg.success" : undefined}
          data-testid={`shop-entry-amount-${entry.id}`}
        >
          {formatSignedRupiah(entry.change)}
        </Text>
      </Flex>
      <Flex justify="space-between" align="center" gap="3" mt="0.5">
        <Text fontSize="xs" color="fg.muted" minW="0" truncate>
          {formatDayShort(entry.postedOn)}
          {entry.occurredOn !== entry.postedOn &&
            ` (${t("settlementShopEntries.belongsTo", { date: formatDayShort(entry.occurredOn) })})`}
          {` · ${shop}`}
        </Text>
        <SettlementSourceBadge source={sourceKey(entry.sourceType)} />
      </Flex>
      <Flex justify="space-between" align="center" gap="3" mt="0.5">
        <Text fontSize="xs" color="fg.subtle" minW="0" truncate data-testid={`shop-entry-ref-${entry.id}`}>
          {referenceOf(t, entry)}
        </Text>
        <Box flexShrink="0" fontSize="xs">
          {entry.import ? (
            <Link asChild colorPalette="primary" data-testid={`shop-entry-import-${entry.id}`}>
              <RouterLink to={`/settlement/imports/${entry.import.fileId}`}>
                {t("settlementShopEntries.statement", { period: formatDayShort(entry.import.periodTo) })}
              </RouterLink>
            </Link>
          ) : (
            <Text color="fg.muted">{t("settlementShopEntries.byPerson", { name: actor })}</Text>
          )}
        </Box>
      </Flex>
      {(onReverse || entry.reversedById !== 0n || entry.reversesId !== 0n) && (
        <Flex justify="flex-end" mt="0.5">
          <ReverseCell entry={entry} onReverse={onReverse} />
        </Flex>
      )}
    </Box>
  );
}
