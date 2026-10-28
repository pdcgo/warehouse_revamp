import { Stat, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

import { CreditMeter } from "../../../features/liability/CreditMeter";
import { useLiabilityCredit } from "../../../features/liability/queries";

export interface LimitSetOnYouProps {
  /** The team reading the page — the DEBTOR here. */
  teamId: bigint;
  /** The counterparty — the CREDITOR whose limit this is. */
  creditorId: bigint;
  creditorName: string;
}

// THE LIMIT THE COUNTERPARTY SET ON YOU (the-debtor-sees-the-limits-set-on-it) — the same meter and the same 80%
// badge the creditor sees on its Terms tab, worded from the side it is set ON: "87% of the limit Toko Anggrek set".
// A limit that can stop your orders is not kept from you.
//
// ⚠ IT SHOWS ONLY WHEN THIS TEAM IS THE DEBTOR ON THE PAIR — when it owes the counterparty, or the counterparty has
// set a limit on it. Otherwise it renders nothing, so the creditor's page is unchanged by it. Setting the limit stays
// the creditor's (terms-are-team-scoped-root-is-global): there is nothing to edit here.
export function LimitSetOnYou({ teamId, creditorId, creditorName }: LimitSetOnYouProps) {
  const { t } = useTranslation();
  const query = useLiabilityCredit(teamId, [creditorId]);

  // Said, not hidden: a failed read could be hiding a limit that is about to stop an order.
  if (query.isError) {
    return (
      <Stat.Root data-testid="limit-on-you">
        <Stat.Label>{t("liabilityDetail.limitOnYouLabel")}</Stat.Label>
        <Text fontSize="sm" color="error.fg" data-testid="limit-on-you-error">
          {t("liabilityDetail.limitOnYouError", { name: creditorName })}
        </Text>
      </Stat.Root>
    );
  }

  const credit = query.data?.get(creditorId.toString());
  if (!credit || (credit.debt === 0n && credit.creditLimit === undefined)) {
    return null;
  }

  return (
    <Stat.Root data-testid="limit-on-you">
      <Stat.Label>{t("liabilityDetail.limitOnYouLabel")}</Stat.Label>
      <CreditMeter
        limit={credit.creditLimit}
        debt={credit.debt}
        setBy={creditorName}
        testId="limit-on-you-meter"
      />
      <Stat.HelpText>{t("liabilityDetail.limitOnYouHint", { name: creditorName })}</Stat.HelpText>
    </Stat.Root>
  );
}
