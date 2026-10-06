import { useTranslation } from "react-i18next";
import { Flex, Icon, Text } from "@chakra-ui/react";
import { ShieldAlert } from "lucide-react";
import { useTeam } from "../features/team/TeamContext";
import { roleLabel } from "../lib/roles";

// NotMemberStrip says, on every page, that the person is acting in a team they are NOT in — Root or the
// System Administrator, who picked it from the switcher's All teams (a-non-member-root-acts-under-a-strip).
// What they do here is an override, so it must never look like ordinary membership. The strip does NOT say
// "recorded as an override" yet: stamping it in every service is its own build item
// (an-override-is-stamped-in-every-service), and a screen must not promise what the system does not do.
//
// Shared by both shells, so a phone and a desktop cannot disagree about whether to say it.
export function NotMemberStrip() {
  const { t } = useTranslation();
  const { current } = useTeam();

  if (!current?.notMember) {
    return null;
  }

  return (
    <Flex
      align="center"
      gap="2"
      px="card"
      py="1.5"
      bg="warning.subtle"
      color="warning.fg"
      borderBottomWidth="1px"
      borderColor="warning.muted"
      data-testid="not-member-strip"
    >
      <Icon as={ShieldAlert} boxSize="4" flexShrink={0} />
      <Text textStyle="sm">{t("shell.notMember", { role: roleLabel(current.role) })}</Text>
    </Flex>
  );
}
