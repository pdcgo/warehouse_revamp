import { useMemo } from "react";
import { personName } from "../../lib/users";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Badge, Box, Flex, Heading, Icon, Spinner, Stack, Table, Text } from "@chakra-ui/react";
import { ArrowRight, History } from "lucide-react";

import { rpcError, userClient } from "../../api/clients";
import { publicUsersByIds, userByIdsRowData } from "../users/adapt";
import { useTermsHistory } from "./queries";
import { GrowingPager } from "../../components/chrome/GrowingPager";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { formatRupiah, isZeroRupiah, type Rupiah } from "../../lib/money";
import { formatUnixDateTimeShort } from "../../lib/datetime";
import { EmptyHint } from "../../components/feedback/EmptyHint";

const PAGE_SIZE = 10;

// One limit, as a person reads it. The three states again — see CreditMeter for why they cannot
// collapse to a number.
function LimitText({ limit }: { limit: Rupiah | undefined }) {
  const { t } = useTranslation();

  if (limit === undefined) return <Text as="span" color="fg.subtle">{t("terms.limitUnlimited")}</Text>;
  if (isZeroRupiah(limit)) return <Text as="span" color="error.fg">{t("terms.limitFrozen")}</Text>;
  return <Text as="span">{formatRupiah(limit)}</Text>;
}

interface ChangeLogPanelProps {
  teamId: bigint;
  /** undefined = every counterparty. ⚠ 0n is the DEFAULT ROW, not "all". */
  counterpartyId: bigint | undefined;
  /** Resolved counterparty names, so a row can say who it is about. */
  nameOf: (id: bigint) => string;
  page: number;
  onPageChange: (page: number) => void;
  /** The pair page's date range — `yyyy-mm-dd` Jakarta days, "" an open end — narrowing on the server (backlog #34). */
  from?: string;
  to?: string;
  /** Each change as a block on a phone (the-team-balance-phone-layout-is-accepted) — the pair page's `useIsMobile()`. */
  phone?: boolean;
}

// ChangeLogPanel is the audit trail for one creditor-debtor pair's CREDIT LIMIT.
//
// ⚠ IT LIVES IN features/, NOT in a page directory, because TWO pages read it: the Credit Terms
// screen (where limits are written) and the pair detail page (where one pair's history is read).
// The moment a second page imported it, it stopped being that page's component — CLAUDE.md.
//
// ⚠ IT EXISTS BECAUSE A RAISE ERASES THE WARNING. A team at 85% whose limit doubles drops to 42%
// and the 80% badge vanishes — with only the current values stored, nothing anywhere would show it
// had ever been warning. The log is also the only record of the negotiation itself: with no
// settlement cycle, raising and lowering the limit IS how a creditor chases, so the latest value
// alone is not a record of what happened.
export function ChangeLogPanel({
  teamId,
  counterpartyId,
  nameOf,
  page,
  onPageChange,
  from = "",
  to = "",
  phone = false,
}: ChangeLogPanelProps) {
  const { t } = useTranslation();

  const query = useTermsHistory({ teamId, counterpartyId, page, pageSize: PAGE_SIZE, from, to });
  const changes = query.data?.changes ?? [];

  // Resolve the actors in one batch — they are users, and this service does not know their names.
  const actorIds = useMemo(
    () => [...new Set(changes.map((c) => c.actorId.toString()))].sort(),
    [changes],
  );
  const actorsQuery = useQuery({
    queryKey: ["user-by-ids", actorIds],
    enabled: actorIds.length > 0,
    queryFn: async () =>
      publicUsersByIds(
        await userClient.userByIDs({
          filter: { ids: actorIds.map((id) => BigInt(id)) },
          dataRequest: userByIdsRowData(),
        }),
      ),
  });
  const actors = actorsQuery.data ?? {};

  return (
    <Stack gap="card" data-testid="terms-history">
      <Heading size="sm">
        {counterpartyId === undefined
          ? t("terms.historyAll")
          : t("terms.historyOne", { name: nameOf(counterpartyId) })}
      </Heading>

      {query.isPending ? (
        <Spinner colorPalette="brand" />
      ) : query.isError ? (
        // ⚠ The RPC is not implemented yet — the handler refuses rather than returning an empty
        // page, because "nobody ever changed a limit" is exactly the false reassurance this panel
        // exists to prevent. The screen says so plainly instead of rendering a reassuring blank.
        <Text color="fg.muted" data-testid="terms-history-error">
          {rpcError(query.error)}
        </Text>
      ) : (
        <RefreshOverlay busy={query.isFetching && !query.isPending}>
          <Stack gap="card">
            {/* ON A PHONE, ONE BLOCK PER CHANGE (a-phone-reads-each-line-as-a-block) — the limit's move and the override
                mark on the first line, when and who on the second, the reason under them. */}
            {phone && changes.length > 0 && (
              <Stack gap="0" data-testid="terms-history-table" data-layout="blocks">
                {changes.map((c) => (
                  <Box
                    key={c.id.toString()}
                    py="2.5"
                    px="1"
                    borderBottomWidth="1px"
                    borderColor="border.muted"
                    data-testid={`terms-change-${c.id}`}
                  >
                    <Flex justify="space-between" align="center" gap="2">
                      <Text fontSize="sm" fontWeight="medium" whiteSpace="nowrap">
                        <LimitText limit={c.oldCreditLimit} />
                        <Icon as={ArrowRight} boxSize="3" mx="2" color="fg.subtle" />
                        <LimitText limit={c.newCreditLimit} />
                      </Text>
                      {c.override && (
                        <Badge colorPalette="purple" data-testid={`terms-override-${c.id}`}>
                          {t("terms.override")}
                        </Badge>
                      )}
                    </Flex>
                    <Text fontSize="xs" color="fg.muted" mt="0.5" lineClamp={1}>
                      {formatUnixDateTimeShort(c.changedAtUnix)} ·{" "}
                      {personName(actors[c.actorId.toString()], t("terms.userFallback", { id: c.actorId.toString() }))}
                    </Text>
                    {c.reason && (
                      <Text fontSize="sm" mt="0.5">
                        {c.reason}
                      </Text>
                    )}
                  </Box>
                ))}
              </Stack>
            )}

            {/* An empty log is the list's hint, not a header over nothing (an-empty-list-shows-a-hint). */}
            {!phone && changes.length > 0 && (
            <Table.Root size="sm" data-testid="terms-history-table">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>{t("terms.colWhen")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("terms.colWho")}</Table.ColumnHeader>
                  {counterpartyId === undefined && (
                    <Table.ColumnHeader>{t("terms.counterparty")}</Table.ColumnHeader>
                  )}
                  <Table.ColumnHeader>{t("terms.colLimitChange")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("terms.colReason")}</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {changes.map((c) => (
                  <Table.Row key={c.id.toString()} data-testid={`terms-change-${c.id}`}>
                    <Table.Cell whiteSpace="nowrap">
                      {formatUnixDateTimeShort(c.changedAtUnix)}
                    </Table.Cell>
                    <Table.Cell>
                      <Text as="span">
                        {personName(actors[c.actorId.toString()], t("terms.userFallback", { id: c.actorId.toString() }))}
                      </Text>
                      {/* An override is a write by somebody outside the creditor team. It is
                          derived by the server from who acted — never claimed by the caller. */}
                      {c.override && (
                        <Badge colorPalette="purple" ml="2" data-testid={`terms-override-${c.id}`}>
                          {t("terms.override")}
                        </Badge>
                      )}
                    </Table.Cell>
                    {counterpartyId === undefined && (
                      <Table.Cell>
                        {c.counterpartyId === 0n ? t("terms.defaultRow") : nameOf(c.counterpartyId)}
                      </Table.Cell>
                    )}
                    <Table.Cell whiteSpace="nowrap">
                      <LimitText limit={c.oldCreditLimit} />
                      <Icon as={ArrowRight} boxSize="3" mx="2" color="fg.subtle" />
                      <LimitText limit={c.newCreditLimit} />
                    </Table.Cell>
                    <Table.Cell>
                      {c.reason ? (
                        <Text>{c.reason}</Text>
                      ) : (
                        <Text color="fg.subtle">—</Text>
                      )}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
            )}

            {changes.length === 0 && (
              <EmptyHint icon={History} size="sm" title={t("terms.historyEmpty")} testId="terms-history-empty" />
            )}

            {/* THE PAGES GROW AS THEY ARE OPENED, and the pager is always on screen (every-list-pages-with-the-growing-pager,
                the-pager-is-always-on-screen). */}
            <GrowingPager
              page={page}
              onPageChange={onPageChange}
              hasNext={query.isPlaceholderData ? undefined : page * PAGE_SIZE < (query.data?.totalItems ?? 0)}
              resetKey={[counterpartyId ?? "all", from, to].join("|")}
              pageSize={PAGE_SIZE}
              testId="terms-history-pager"
            />
          </Stack>
        </RefreshOverlay>
      )}
    </Stack>
  );
}
