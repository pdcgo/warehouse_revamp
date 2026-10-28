import { Badge, Card, Flex, Icon, Portal, Separator, Spinner, Stack, Text, Tooltip } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { TriangleAlert } from "lucide-react";

import { CreditMeter, creditWarning, limitStateOf } from "../../../features/liability/CreditMeter";
import { formatRupiah } from "../../../lib/money";

// HOW MUCH MORE THIS TEAM MAY OWE — one row per creditor.
//
// ⚠ IT IS NEVER ONE NUMBER, and that is the owner's point: this order can put the team in debt to
// the WAREHOUSE that ships it and to EVERY TEAM whose products are on it, and each of those sets its
// own limit. A single "credit used" figure would be the sum of unrelated relationships — a team with
// room at one creditor and none at another would read as comfortably inside a limit that does not
// exist.
//
// The meter shows the CURRENT debt, because that is what the rule is written against: an order is
// refused when the debt ALREADY stands at the limit, so the exposure can end one order beyond it.
// What this order would add is shown beside it, as the thing a person can still act on.
//
// ⚠ THE WARNING IS AN ICON BESIDE THE NAME, NOT A BADGE UNDER THE BAR (owner). The name is what the
// eye runs down a list of creditors, so that is where "this one is close" has to be; a badge below
// the meter is found only by somebody already reading that row. The meter's own badge is suppressed
// (`hideWarningBadge`) so the same fact is not stated twice on one row.
//
// THE FIGURES ARE THE CREDITOR'S OWN (the-debtor-sees-the-limits-set-on-it) — the limit it set on this team and the
// debt already carried, read by LiabilityCreditByIds exactly as the create's check reads them.
//
// ⚠ A ROW STILL READING, OR WHOSE READ FAILED, SAYS SO. It never falls back to "Unlimited": unlimited is a fact a
// creditor states, and a figure nobody has read yet is not that fact.

export type CreditRole = "warehouse" | "owner";

/** One creditor's figures — read, still reading, or failed. `limit` undefined = unlimited, 0n = frozen, n = the ceiling. */
export type CreditFigures =
  | { state: "ready"; debt: bigint; limit?: bigint }
  | { state: "loading" }
  | { state: "failed" };

export interface CreditRow {
  teamId: bigint;
  name: string;
  /**
   * WHAT THIS TEAM IS TO THE ORDER — and it can be BOTH.
   *
   * ⚠ ONE ROW PER TEAM, NEVER PER ROLE. A warehouse that also owns products on the order is one
   * creditor with one limit: `CheckCredit` asks about a team, not about a reason. Two rows would
   * show half the exposure twice and let an order look comfortable against a ceiling it is actually
   * crossing.
   */
  roles: CreditRole[];
  /** The limit this creditor set on us and what we already owe it — once the read has answered. */
  figures: CreditFigures;
  /** What this order would add to that debt, across every reason it owes this team. */
  adds: bigint;
}

export function CreditLimitPanel({ rows, compact }: { rows: CreditRow[]; compact?: boolean }) {
  const { t } = useTranslation();

  return (
    <Card.Root>
      <Card.Header pb={compact ? "0" : undefined}>
        <Card.Title>{t("orderForm.credit.title")}</Card.Title>
        {/* The explanation is the first thing to go when the rail is collapsed: it is read once,
            while the numbers are read on every order. */}
        {!compact && <Card.Description>{t("orderForm.credit.help")}</Card.Description>}
      </Card.Header>

      <Card.Body pt={compact ? "3" : undefined} pb={compact ? "3" : undefined}>
        {rows.length === 0 && (
          <Text fontSize="sm" color="fg.muted" data-testid="credit-empty">
            {t("orderForm.credit.empty")}
          </Text>
        )}

        <Stack gap={compact ? "2" : "card"} separator={<Separator />}>
          {rows.map((row) => {
            const figures = row.figures;
            const ready = figures.state === "ready";
            const limit = ready ? figures.limit : undefined;
            const after = ready ? figures.debt + row.adds : 0n;
            const capped = ready && limitStateOf(limit) === "capped";
            // The projection is only a warning where there is a ceiling to cross. Against an
            // unlimited creditor "after this order" is just a bigger number.
            const wouldPass = capped && after > limit!;
            // Where the CURRENT debt stands — the comparison the server will actually make. Nothing is
            // near anything until the figures are read.
            const { near, over } = ready ? creditWarning(limit, figures.debt) : { near: false, over: false };

            return (
              <Stack key={row.teamId.toString()} gap="1" data-testid={`credit-row-${row.teamId}`}>
                <Flex align="center" gap="2" justify="space-between" wrap="wrap">
                  <Flex align="center" gap="1.5" minW="0">
                    <Text fontSize="sm" fontWeight="bold" truncate>
                      {row.name}
                    </Text>

                    {/* THE MARK, BESIDE THE NAME. Amber for "close", red for "already at it" — and
                        here the status colours are right, because this is a fact about the order,
                        not about the build. */}
                    {near && (
                      <Tooltip.Root openDelay={100} closeDelay={80}>
                        <Tooltip.Trigger asChild>
                          <Icon
                            as={TriangleAlert}
                            boxSize="4"
                            color={over ? "error.fg" : "warning.fg"}
                            flexShrink="0"
                            // The words, for touch and for a screen reader: a tooltip needs a hover
                            // nobody has on a phone, so the label carries the same sentence.
                            aria-label={over ? t("terms.warnOver") : t("terms.warnNear")}
                            data-testid={`credit-warn-${row.teamId}`}
                          />
                        </Tooltip.Trigger>
                        <Portal>
                          <Tooltip.Positioner>
                            <Tooltip.Content>
                              {over ? t("terms.warnOver") : t("terms.warnNear")}
                            </Tooltip.Content>
                          </Tooltip.Positioner>
                        </Portal>
                      </Tooltip.Root>
                    )}
                  </Flex>

                  {/* WHY this team is a creditor — one badge per reason, because a team can be both
                      the building that ships the order and the owner of goods on it. Categorical
                      colour, so a hue rather than a status role. */}
                  <Flex gap="1" wrap="wrap">
                    {row.roles.map((role) => (
                      <Badge
                        key={role}
                        size="sm"
                        variant="subtle"
                        colorPalette={role === "warehouse" ? "amber" : "indigo"}
                      >
                        {t(`orderForm.credit.role.${role}`)}
                      </Badge>
                    ))}
                  </Flex>
                </Flex>

                {figures.state === "ready" && (
                  <CreditMeter
                    limit={figures.limit}
                    debt={figures.debt}
                    hideWarningBadge
                    testId={`credit-meter-${row.teamId}`}
                  />
                )}

                {/* STILL READING — a spinner and words, never the "Unlimited" a missing limit would draw. */}
                {figures.state === "loading" && (
                  <Flex align="center" gap="1.5" data-testid={`credit-loading-${row.teamId}`}>
                    <Spinner size="xs" colorPalette="brand" />
                    <Text fontSize="xs" color="fg.muted">
                      {t("orderForm.credit.loading")}
                    </Text>
                  </Flex>
                )}

                {/* THE READ FAILED — said in the row, because the row is where somebody would have read
                    "Unlimited" otherwise. The create still checks the limit on its own. */}
                {figures.state === "failed" && (
                  <Text fontSize="xs" color="error.fg" data-testid={`credit-failed-${row.teamId}`}>
                    {t("orderForm.credit.failed")}
                  </Text>
                )}

                {/* ⚠ THE PROJECTION FOLDS AWAY WITH THE REST (owner) — it is the row's explanation,
                    and the meter above it already says where the debt stands.

                    UNLESS IT CROSSES THE CEILING. Then the same line stops being a projection and
                    becomes the one warning this row has: collapsing hides EXPLANATION, never a
                    warning about the figure beside it. Same rule as the unknown-cost note on the
                    invoice.

                    With no figures yet there is no "after" to state, so it says only what this order
                    adds — the one number on the row that does not depend on the read. */}
                {(!compact || wouldPass) && (
                  <Text
                    fontSize="xs"
                    color={wouldPass ? "error.fg" : "fg.muted"}
                    data-testid={`credit-after-${row.teamId}`}
                  >
                    {ready
                      ? t("orderForm.credit.after", {
                          adds: formatRupiah(row.adds),
                          after: formatRupiah(after),
                        })
                      : t("orderForm.credit.adds", { adds: formatRupiah(row.adds) })}
                    {wouldPass && ` · ${t("orderForm.credit.wouldPass")}`}
                  </Text>
                )}
              </Stack>
            );
          })}
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}
