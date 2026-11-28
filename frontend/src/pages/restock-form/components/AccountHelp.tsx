import { useTranslation } from "react-i18next";
import { Flex, Icon, Text } from "@chakra-ui/react";
import { CircleAlert } from "lucide-react";

import { HelperLink } from "../../../components/feedback/HelperLink";
import { canWrite, useTeam } from "../../../features/team/TeamContext";
import { nothingToPick, useFinancialAccountOptions } from "../../../features/financialAccount/queries";
import { canMoveAccountMoney } from "../../../lib/roles";

/** What the account box says is missing — and who can fix it. */
export type AccountHelpCase = "none" | "unmarked" | "ask";

const ACCOUNTS_PAGE = "/financial-accounts";

// THE ACCOUNT BOX POINTS TO THE ACCOUNTS PAGE (the-account-box-points-to-the-accounts-page) — with no operational account
// there is nothing *Paid from* can pick, and the restock cannot be raised (a-restock-names-its-paying-account). So the
// box says what is missing, to the person who can fix it:
//
//   the owner and admin   no account at all              → *create one and mark it operational* · Open Financial Accounts ↗
//   (canMoveAccountMoney) accounts, none marked          → *mark one operational*               · Open Financial Accounts ↗
//   CS                    either                          → *ask your owner or admin* — no link: making and marking an
//                                                           account is admin and up (seeing-is-team-wide-moving-is-admin-and-up)
//
// The link opens a NEW TAB (a-helper-link-opens-a-new-tab), and the picker reads its accounts again on the way back, so
// the account just made or marked can be picked with every line still typed.
//
// Which of the two is missing takes a second read — every active account, not only the operational ones — asked ONLY
// for the owner and admin, and only while there is nothing to pick: a form with an account to pick asks nothing more.
// It too reads again on return, so an account made but not marked turns *create one* into *mark one*.
export function useAccountHelp(teamId: bigint): AccountHelpCase | null {
  const { current } = useTeam();
  const manages = canWrite(current) && canMoveAccountMoney(current?.role);

  // The picker's own read — the same cache entry, so nothing more is asked here.
  const operational = useFinancialAccountOptions({ teamId, operationalOnly: true });
  const nothing = operational.isSuccess && nothingToPick(operational.data);

  const every = useFinancialAccountOptions({ teamId, enabled: nothing && manages, rereadOnReturn: true });

  if (!nothing) return null;
  if (!manages) return "ask";
  if (!every.isSuccess) return null;

  return nothingToPick(every.data) ? "none" : "unmarked";
}

/** The account box's line under the picker — what is missing, and the link to fix it for those who can. */
export function AccountHelp({ teamId }: { teamId: bigint }) {
  const { t } = useTranslation();
  const helpCase = useAccountHelp(teamId);

  if (helpCase === null) return null;

  // One literal key per case — keys.test.ts can only see a key written out.
  const said =
    helpCase === "none"
      ? t("restock.form.accountNoneYet")
      : helpCase === "unmarked"
        ? t("restock.form.accountNoneOperational")
        : t("restock.form.accountAskOwner");

  return (
    <Flex
      align="center"
      gap="1.5"
      wrap="wrap"
      rowGap="0.5"
      data-testid="restock-finance-account-missing"
      data-case={helpCase}
    >
      <Icon as={CircleAlert} boxSize="3.5" color="warning.fg" flexShrink={0} />
      <Text fontSize="xs" color="warning.fg" data-testid="restock-finance-account-missing-text">
        {said}
      </Text>
      {helpCase !== "ask" && (
        <HelperLink href={ACCOUNTS_PAGE} label={t("restock.form.openAccounts")} testId="restock-finance-account-open" />
      )}
    </Flex>
  );
}
