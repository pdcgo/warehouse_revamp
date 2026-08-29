import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Badge, Heading, Icon, Spinner, Stack, Table, Text } from "@chakra-ui/react";
import { ArrowRight } from "lucide-react";

import { rpcError, userClient } from "../../../api/clients";
import { publicUsersByIds, userByIdsRowData } from "../../../features/users/adapt";
import { useTermsHistory } from "../../../features/liability/queries";
import { Pagination } from "../../../components/chrome/Pagination";
import { RefreshOverlay } from "../../../components/feedback/RefreshOverlay";
import { formatRupiah } from "../../../lib/money";

const PAGE_SIZE = 10;

// One limit, as a person reads it. The three states again — see CreditMeter for why they cannot
// collapse to a number.
function LimitText({ limit }: { limit: bigint | undefined }) {
  const { t } = useTranslation();

  if (limit === undefined) return <Text as="span" color="fg.subtle">{t("terms.limitUnlimited")}</Text>;
  if (limit === 0n) return <Text as="span" color="red.fg">{t("terms.limitFrozen")}</Text>;
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
}

// ChangeLogPanel is the audit trail behind the Credit Terms screen.
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
}: ChangeLogPanelProps) {
  const { t } = useTranslation();

  const query = useTermsHistory({ teamId, counterpartyId, page, pageSize: PAGE_SIZE });
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
                      {new Date(Number(c.changedAtUnix) * 1000).toLocaleString()}
                    </Table.Cell>
                    <Table.Cell>
                      <Text as="span">
                        {actors[c.actorId.toString()]?.name ??
                          t("terms.userFallback", { id: c.actorId.toString() })}
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

            {changes.length === 0 ? (
              <Text color="fg.muted" data-testid="terms-history-empty">
                {t("terms.historyEmpty")}
              </Text>
            ) : (
              <Pagination
                page={page}
                pageSize={PAGE_SIZE}
                count={query.data?.totalItems ?? 0}
                onPageChange={onPageChange}
              />
            )}
          </Stack>
        </RefreshOverlay>
      )}
    </Stack>
  );
}
