import { useTranslation } from "react-i18next";
import { Card, Flex, Icon, SimpleGrid, Stack, Text } from "@chakra-ui/react";
import { Check, Equal, Plus, TriangleAlert } from "lucide-react";

import { formatBalance, type BalanceCheckResult } from "../model";

export interface BalanceCheckCardProps {
  result: BalanceCheckResult;
}

// THE EQUATION, SHOWN AS ARITHMETIC — the same idiom the Profit and Statement screens use, for the
// same reason: a bottom line whose inputs are not on the same screen is a number nobody can check.
//
// Here it earns its place twice over, because the equation is not a summary of the sheet — it is the
// sheet's ONLY self-test. Assets are counted one way (stock, debtors, cash), the other side another
// (creditors, capital, profit), and the two agreeing is the evidence that neither is missing
// anything. That is worth the top of the page rather than a footnote.
export function BalanceCheckCard({ result }: BalanceCheckCardProps) {
  const { t } = useTranslation();

  const { assets, liabilities, equity, difference, balanced } = result;

  return (
    <Card.Root
      data-testid="balance-check"
      data-balanced={balanced ? "true" : "false"}
      borderColor={balanced ? undefined : "red.solid"}
    >
      <Card.Body>
        <SimpleGrid columns={{ base: 1, md: 3 }} gap="card" alignItems="center">
          <Stack gap="0">
            <Text fontSize="xs" color="fg.muted">
              {t("balance.section.assets")}
            </Text>
            <Text fontSize="xl" fontWeight="medium" data-testid="balance-check-assets">
              {formatBalance(assets)}
            </Text>
            <Text fontSize="xs" color="fg.muted">
              {t("balance.checkAssetsCaption")}
            </Text>
          </Stack>

          <Stack gap="0">
            <Flex align="center" gap="1">
              <Icon as={Equal} boxSize="4" color="fg.muted" />
              <Text fontSize="xs" color="fg.muted">
                {t("balance.section.liabilities")}
              </Text>
            </Flex>
            <Text fontSize="xl" fontWeight="medium" data-testid="balance-check-liabilities">
              {formatBalance(liabilities)}
            </Text>
            <Text fontSize="xs" color="fg.muted">
              {t("balance.checkLiabilitiesCaption")}
            </Text>
          </Stack>

          <Stack gap="0">
            <Flex align="center" gap="1">
              <Icon as={Plus} boxSize="4" color="fg.muted" />
              <Text fontSize="xs" color="fg.muted">
                {t("balance.section.equity")}
              </Text>
            </Flex>
            <Text fontSize="xl" fontWeight="medium" data-testid="balance-check-equity">
              {formatBalance(equity)}
            </Text>
            <Text fontSize="xs" color="fg.muted">
              {t("balance.checkEquityCaption")}
            </Text>
          </Stack>
        </SimpleGrid>

        {/* ⚠ WHEN IT DOES NOT TIE, THE DIFFERENCE IS NAMED — never absorbed into a line.
            A hand-assembled sheet always tempts a "difference" row that swallows whatever is left
            over, and the moment one exists the sheet balances forever and stops testing anything.
            The number is stated as a FAULT with its size, so it reads as work to do rather than as a
            column that happens to be there. */}
        {balanced ? (
          <Flex align="center" gap="2" mt="card" color="green.fg" data-testid="balance-tie-ok">
            <Icon as={Check} boxSize="4" />
            <Text fontSize="sm">{t("balance.ties")}</Text>
          </Flex>
        ) : (
          <Flex align="center" gap="2" mt="card" color="red.fg" data-testid="balance-tie-broken">
            <Icon as={TriangleAlert} boxSize="4" />
            <Text fontSize="sm">
              {t("balance.doesNotTie", { amount: formatBalance(difference) })}
            </Text>
          </Flex>
        )}
      </Card.Body>
    </Card.Root>
  );
}
