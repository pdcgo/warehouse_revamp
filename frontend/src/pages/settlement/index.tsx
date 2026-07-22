import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Box,
  Checkbox,
  Flex,
  Heading,
  HStack,
  Spacer,
  Spinner,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { rpcError, teamClient } from "../../api/clients";
import { Pagination } from "../../components/Pagination";
import { useTeam } from "../../features/team/TeamContext";
import { daysSince, directionCopy, directionPalette } from "../../features/settlement/direction";
import { useSettlementPositions } from "../../features/settlement/queries";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// SettlementPage is the position list (#185) — the screen a manager opens first, and the only one
// most of them need: one row per counterparty, BOTH DIRECTIONS in one list.
//
// Two rules shape it, and both are about the reader rather than the data:
//
//   - DIRECTION IS WORDS. "They owe you Rp 2.400.000" / "You owe them Rp 180.000" — never a bare
//     −180.000 that somebody has to decode into a direction.
//   - AGEING IS THE POINT, not the total. "Rp 2.4m, oldest unsettled 47 days" is actionable in a way
//     a balance alone is not, so the oldest debt sorts first and the age sits beside the money.
export function SettlementPage() {
  const { t } = useTranslation();
  const { current } = useTeam();
  const navigate = useNavigate();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [unsettledOnly, setUnsettledOnly] = useState(true);

  const teamId = current?.teamId;

  const query = useSettlementPositions({ teamId, page, pageSize, unsettledOnly });

  const positions = useMemo(() => query.data?.positions ?? [], [query.data]);
  const totalItems = query.data?.totalItems ?? 0;
  const loading = query.isPending;
  const error = query.isError ? rpcError(query.error) : "";

  // A counterparty is an id; a person needs a NAME. Resolved in ONE batch per page (TeamByIds),
  // never per row, and deliberately not gating `loading` — the rows render immediately with the
  // "Team #<id>" fallback and upgrade in place when the names land.
  const [teamNames, setTeamNames] = useState<Map<string, string>>(new Map());
  const knownRef = useRef(teamNames);
  knownRef.current = teamNames;

  useEffect(() => {
    const missing = [
      ...new Set(
        positions
          .map((p) => p.counterpartyId)
          .filter((id) => id > 0n && !knownRef.current.has(id.toString())),
      ),
    ];

    if (missing.length === 0) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const res = await teamClient.teamByIds({ ids: missing });

        if (cancelled) {
          return;
        }

        setTeamNames((prev) => {
          const next = new Map(prev);
          for (const [id, team] of Object.entries(res.data)) {
            next.set(id, team.name);
          }

          return next;
        });
      } catch {
        // A name is decoration; the id still identifies the row.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [positions]);

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("settlement.title")}</Heading>
        <Text color="fg.muted" data-testid="settlement-no-team">
          {t("settlement.selectTeamView")}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="section">
      <Flex align="center" gap="card">
        <Heading size="md">{t("settlement.title")}</Heading>
        <Badge colorPalette="brand">
          {current.teamName || t("orders.teamFallback", { id: current.teamId.toString() })}
        </Badge>
        <Spacer />

        <Checkbox.Root
          size="sm"
          checked={unsettledOnly}
          onCheckedChange={() => {
            setUnsettledOnly((v) => !v);
            setPage(1);
          }}
          data-testid="settlement-unsettled-only"
        >
          <Checkbox.HiddenInput />
          <Checkbox.Control />
          <Checkbox.Label>{t("settlement.unsettledOnly")}</Checkbox.Label>
        </Checkbox.Root>
      </Flex>

      <Text color="fg.muted" fontSize="sm">
        {t("settlement.intro")}
      </Text>

      {error && (
        <Text color="red.fg" data-testid="settlement-error">
          {error}
        </Text>
      )}

      {loading ? (
        <Spinner colorPalette="brand" />
      ) : (
        <Table.Root size="sm" data-testid="settlement-table">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>{t("settlement.counterparty")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("settlement.position")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("settlement.ageing")}</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>

          <Table.Body>
            {positions.map((p) => {
              const copy = directionCopy(p.balance);
              const days = daysSince(p.oldestUnsettledAtUnix);

              return (
                <Table.Row
                  key={p.counterpartyId.toString()}
                  data-testid={`settlement-row-${p.counterpartyId}`}
                >
                  <Table.Cell>
                    <HStack gap="2">
                      <Box
                        cursor="pointer"
                        fontWeight="medium"
                        data-testid={`open-counterparty-${p.counterpartyId}`}
                        onClick={() => navigate(`/settlement/${p.counterpartyId}`)}
                      >
                        {teamNames.get(p.counterpartyId.toString()) ??
                          t("orders.teamFallback", { id: p.counterpartyId.toString() })}
                      </Box>

                      {/* A payment waiting for THIS team to confirm. A payment nobody notices is a
                          debt that stays open for no reason, so it is on the row, not behind a tab. */}
                      {p.awaitingConfirmation > 0 && (
                        <Badge
                          colorPalette="purple"
                          data-testid={`awaiting-${p.counterpartyId}`}
                        >
                          {t("settlement.awaiting", { count: p.awaitingConfirmation })}
                        </Badge>
                      )}
                    </HStack>
                  </Table.Cell>

                  {/* WORDS, NEVER A SIGN. The colour supports the sentence; it does not replace it. */}
                  <Table.Cell>
                    <Badge
                      colorPalette={directionPalette(p.balance)}
                      data-testid={`position-${p.counterpartyId}`}
                    >
                      {t(copy.key, { amount: copy.amount })}
                    </Badge>
                  </Table.Cell>

                  <Table.Cell>
                    {p.oldestUnsettledAtUnix === 0n ? (
                      <Text color="fg.muted">—</Text>
                    ) : (
                      <Text data-testid={`ageing-${p.counterpartyId}`}>
                        {t("settlement.oldestUnsettled", { days })}
                      </Text>
                    )}
                  </Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table.Root>
      )}

      {!loading && positions.length === 0 && !error && (
        <Text color="fg.muted" data-testid="settlement-empty">
          {unsettledOnly ? t("settlement.allSquare") : t("settlement.noCounterparties")}
        </Text>
      )}

      {!loading && (
        <Pagination
          count={totalItems}
          pageSize={pageSize}
          page={page}
          onPageChange={setPage}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          onPageSizeChange={(n) => {
            setPageSize(n);
            setPage(1);
          }}
        />
      )}
    </Stack>
  );
}
