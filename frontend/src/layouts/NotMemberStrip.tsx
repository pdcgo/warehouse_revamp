import { useTranslation } from "react-i18next";
import { Flex, Icon, Text } from "@chakra-ui/react";
import { Eye, ShieldAlert } from "lucide-react";
import { useTeam } from "../features/team/TeamContext";
import { roleLabel } from "../lib/roles";

// NotMemberStrip says, on every page, that the person is in a team they are NOT in — and which of the two ways.
//
//   | who                                   | the strip                                   | tone    |
//   | ------------------------------------- | ------------------------------------------- | ------- |
//   | Root, the System Administrator        | Not a member — acting as Root               | warning |
//   | the admin team (admin_owner, _admin)  | Monitoring — read-only                      | info    |
//
// Root acts (a-non-member-root-acts-under-a-strip): what they do here is an override, so it must never look like
// ordinary membership. The strip does NOT say "recorded as an override" yet — stamping it in every service is its own
// build item (an-override-is-stamped-in-every-service), and a screen must not promise what the system does not do.
//
// The admin team only READS (the-admin-team-monitors-read-only): every write control is gone (canWrite), and the
// strip is what says why — so it is calm, not a warning: nothing here can go wrong.
//
// Shared by both shells, so a phone and a desktop cannot disagree about whether to say it.
export function NotMemberStrip() {
  const { t } = useTranslation();
  const { current } = useTeam();

  if (!current?.notMember) {
    return null;
  }

  const monitoring = current.readOnly === true;
  const tone = monitoring ? "info" : "warning";

  return (
    <Flex
      align="center"
      gap="2"
      px="card"
      py="1.5"
      bg={`${tone}.subtle`}
      color={`${tone}.fg`}
      borderBottomWidth="1px"
      borderColor={`${tone}.muted`}
      data-testid={monitoring ? "monitoring-strip" : "not-member-strip"}
    >
      <Icon as={monitoring ? Eye : ShieldAlert} boxSize="4" flexShrink={0} />
      <Text textStyle="sm">
        {monitoring ? t("shell.monitoring") : t("shell.notMember", { role: roleLabel(current.role) })}
      </Text>
    </Flex>
  );
}
