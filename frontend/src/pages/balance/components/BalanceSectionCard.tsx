import { useTranslation } from "react-i18next";
import { Card, Flex, Icon, Table, Text } from "@chakra-ui/react";
import { ChevronRight, TriangleAlert } from "lucide-react";

import {
  formatBalance,
  formatChange,
  sectionPrior,
  sectionTotal,
  type BalanceSection,
} from "../model";

export interface BalanceSectionCardProps {
  section: BalanceSection;
  /** The two column headings — already formatted for a human. */
  asOfLabel: string;
  priorLabel: string;
  /** Mark the lines nothing in this system can serve. Off is the ideal screen, on is the gap analysis. */
  showGaps: boolean;
  onOpen: (to: string) => void;
}

// One section of the sheet — Assets, Liabilities or Equity — as a card with its own total.
//
// FOUR COLUMNS, and the third and fourth are not decoration. A balance sheet with a single column is
// a photograph: it says what is true today and nothing about whether that is normal. The comparison
// date and the movement are what turn "we hold 96 million of stock" into "we hold 8 million more
// stock than we did at the end of last month", which is the sentence somebody can act on.
export function BalanceSectionCard({
  section,
  asOfLabel,
  priorLabel,
  showGaps,
  onOpen,
}: BalanceSectionCardProps) {
  const { t } = useTranslation();

  const total = sectionTotal(section);
  const prior = sectionPrior(section);

  return (
    <Card.Root data-testid={`balance-section-${section.id}`}>
      <Card.Body>
        <Text textStyle="sm" fontWeight="semibold" mb="card">
          {t(`balance.section.${section.id}`)}
        </Text>

        <Table.Root size="sm">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>{t("balance.colLine")}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">{asOfLabel}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">{priorLabel}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">{t("balance.colChange")}</Table.ColumnHeader>
              <Table.ColumnHeader w="6" />
            </Table.Row>
          </Table.Header>

          <Table.Body>
            {section.lines.map((line) => {
              const untracked = line.source === "none";
              const openable = !!line.drillTo;

              return (
                <Table.Row
                  key={line.id}
                  data-testid={`balance-line-${line.id}`}
                  {...(showGaps && untracked ? { "data-untracked": "true" } : {})}
                  cursor={openable ? "pointer" : undefined}
                  _hover={openable ? { bg: "bg.muted" } : undefined}
                  opacity={showGaps && untracked ? 0.65 : 1}
                  onClick={openable ? () => onOpen(line.drillTo!) : undefined}
                >
                  <Table.Cell>
                    <Flex align="center" gap="2">
                      <Text as="span">{t(`balance.line.${line.id}`)}</Text>
                      {/* The gap marker. Present only in gap mode — on the ideal screen these lines
                          are ordinary, because the point of the ideal screen is what it would look
                          like if the ledger existed. */}
                      {showGaps && untracked && (
                        <Flex align="center" gap="1" color="orange.fg">
                          <Icon as={TriangleAlert} boxSize="3.5" />
                          <Text as="span" fontSize="xs">
                            {t("balance.notTracked")}
                          </Text>
                        </Flex>
                      )}
                    </Flex>
                  </Table.Cell>

                  <Table.Cell textAlign="end" data-testid={`balance-amount-${line.id}`}>
                    {formatBalance(line.amount)}
                  </Table.Cell>
                  <Table.Cell textAlign="end" color="fg.muted">
                    {formatBalance(line.prior)}
                  </Table.Cell>
                  {/* THE MOVEMENT IS NOT COLOURED GOOD OR BAD, and that is a decision. Stock up is
                      healthy on a growing month and a warning on a slow one; receivables up means
                      either more trade or slower payment. A green arrow would be the screen guessing
                      which, on the one report that is supposed to state rather than interpret. */}
                  <Table.Cell
                    textAlign="end"
                    color="fg.muted"
                    data-testid={`balance-change-${line.id}`}
                  >
                    {formatChange(line.amount - line.prior)}
                  </Table.Cell>
                  <Table.Cell>
                    {openable && <Icon as={ChevronRight} boxSize="4" color="fg.subtle" />}
                  </Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>

          <Table.Footer>
            <Table.Row>
              <Table.Cell fontWeight="medium">{t(`balance.total.${section.id}`)}</Table.Cell>
              <Table.Cell
                textAlign="end"
                fontWeight="medium"
                data-testid={`balance-total-${section.id}`}
              >
                {formatBalance(total)}
              </Table.Cell>
              <Table.Cell textAlign="end" color="fg.muted">
                {formatBalance(prior)}
              </Table.Cell>
              <Table.Cell textAlign="end" color="fg.muted">
                {formatChange(total - prior)}
              </Table.Cell>
              <Table.Cell />
            </Table.Row>
          </Table.Footer>
        </Table.Root>
      </Card.Body>
    </Card.Root>
  );
}
