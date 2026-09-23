import { Badge, Card, Flex, Icon, Portal, Separator, Stack, Text, Tooltip } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { TriangleAlert } from "lucide-react";

import { CreditMeter, creditWarning, limitStateOf } from "../../../features/liability/CreditMeter";
import { formatRupiah } from "../../../lib/money";
import { NotImplemented } from "./NotImplemented";

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

export type CreditRole = "warehouse" | "owner";

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
  debt: bigint;
  /** undefined = unlimited, 0n = frozen, n = the ceiling. */
  limit?: bigint;
  /** What this order would add to that debt, across every reason it owes this team. */
  adds: bigint;
}

export function CreditLimitPanel({ rows, compact }: { rows: CreditRow[]; compact?: boolean }) {
  const { t } = useTranslation();

  return (
    <Card.Root>
      <Card.Header pb={compact ? "0" : undefined}>
        <Flex align="center" gap="2" wrap="wrap">
          <Card.Title>{t("orderForm.credit.title")}</Card.Title>
          <NotImplemented id="creditLimit" />
        </Flex>
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
            const after = row.debt + row.adds;
            const capped = limitStateOf(row.limit) === "capped";
            // The projection is only a warning where there is a ceiling to cross. Against an
            // unlimited creditor "after this order" is just a bigger number.
            const wouldPass = capped && after > row.limit!;
            // Where the CURRENT debt stands — the comparison the server will actually make.
            const { near, over } = creditWarning(row.limit, row.debt);

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

                <CreditMeter
                  limit={row.limit}
                  debt={row.debt}
                  hideWarningBadge
                  testId={`credit-meter-${row.teamId}`}
                />

                {/* ⚠ THE PROJECTION FOLDS AWAY WITH THE REST (owner) — it is the row's explanation,
                    and the meter above it already says where the debt stands.

                    UNLESS IT CROSSES THE CEILING. Then the same line stops being a projection and
                    becomes the one warning this row has: collapsing hides EXPLANATION, never a
                    warning about the figure beside it. Same rule as the unknown-cost note on the
                    invoice. */}
                {(!compact || wouldPass) && (
                  <Text
                    fontSize="xs"
                    color={wouldPass ? "error.fg" : "fg.muted"}
                    data-testid={`credit-after-${row.teamId}`}
                  >
                    {t("orderForm.credit.after", {
                      adds: formatRupiah(row.adds),
                      after: formatRupiah(after),
                    })}
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
