import type { ReactNode } from "react";
import { Badge, Button, Center, Flex, HStack, Icon, IconButton, Stack, Text } from "@chakra-ui/react";
import { Bot, Unplug } from "lucide-react";
import { useTranslation } from "react-i18next";

import { rpcError } from "../../api/clients";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { toaster } from "../../components/feedback/Toaster";
import type { AgentConnection } from "../../gen/warehouse/user/v1/agent_pb";
import { useIsMobile } from "../../layouts/shell";
import { formatUnixDateTimeShort } from "../../lib/datetime";

export const description =
  "One AI agent's connection, as its person and its team's owner read it: the name it was given at the connect page, the agent it is (ChatGPT, Claude), a context line — the team it reads on a person's own list, who connected it on a team's — and when it was connected, when it expires and when it last read anything (\"never\" when it has not). Revoke always asks first; the row toasts the outcome, so the two lists that use it say the same thing. On a phone Revoke is its icon and the dates take two lines.";

// ONE CONNECTION, on /profile's AI Agents and on Settings' AI Agents (the-owner-decides-who-connects-an-agent).
//
//   (🤖)  ChatGPT, Heri's laptop  [ChatGPT]                                   [⏏ Revoke]
//         Toko Melati                       ← the team it reads, or who connected it
//         Connected 29 Oct 13:05 · Expires 27 Jan 13:05 · Last used never
//
// The dates are the table cell's short form (a-table-date-is-short-and-every-time-is-wib) — absolute, so a row never
// claims "a minute ago" an hour later. Revoking is not reversible from here (the agent has to be connected again), so it
// goes through ConfirmDialog like every destructive act.
//
// A PHONE GETS ITS OWN ARRANGEMENT: Revoke shrinks to its icon (as a phone header's actions do —
// a-phone-header-action-is-an-icon), giving the name its room back, and the dates break before *Last used* rather than
// wherever the line runs out.
export function AgentConnectionRow({
  connection,
  context,
  revoke,
}: {
  connection: AgentConnection;
  /** The line under the name — the team it reads on a person's own list, who connected it on a team's. */
  context: ReactNode;
  /** Revoke it. A refusal is toasted by the row, never thrown at the dialog. */
  revoke: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const mobile = useIsMobile();
  const id = connection.id.toString();

  async function confirm() {
    try {
      await revoke();
      toaster.create({ type: "success", title: t("agents.row.revoked", { name: connection.name }) });
    } catch (err) {
      toaster.create({ type: "error", title: t("agents.row.revokeFailed"), description: rpcError(err) });
    }
  }

  const span = t("agents.row.span", {
    connected: formatUnixDateTimeShort(connection.createdAtUnix),
    expires: formatUnixDateTimeShort(connection.expiresAtUnix),
  });
  const lastUsed = t("agents.row.lastUsed", {
    lastUsed:
      connection.lastUsedAtUnix > 0n ? formatUnixDateTimeShort(connection.lastUsedAtUnix) : t("agents.row.never"),
  });

  const label = t("agents.row.revoke");
  const trigger = mobile ? (
    <IconButton
      size="xs"
      variant="outline"
      colorPalette="error"
      aria-label={label}
      flexShrink={0}
      data-testid={`agent-revoke-${id}`}
    >
      <Icon as={Unplug} boxSize="4" />
    </IconButton>
  ) : (
    <Button size="xs" variant="outline" colorPalette="error" flexShrink={0} data-testid={`agent-revoke-${id}`}>
      <Icon as={Unplug} boxSize="4" />
      {label}
    </Button>
  );

  return (
    <Flex gap="3" align="flex-start" py="3" data-testid={`agent-connection-${id}`}>
      <Center boxSize="8" rounded="full" bg="brand.subtle" color="brand.fg" flexShrink={0}>
        <Icon as={Bot} boxSize="4" />
      </Center>

      <Stack gap="0.5" flex="1" minW="0">
        <HStack gap="2" minW="0">
          <Text fontWeight="bold" lineClamp={1} minW="0" data-testid={`agent-connection-name-${id}`}>
            {connection.name}
          </Text>
          <Badge size="sm" variant="subtle" flexShrink={0}>
            {connection.clientName}
          </Badge>
        </HStack>

        <Text fontSize="sm" color="fg.muted" lineClamp={1} data-testid={`agent-connection-context-${id}`}>
          {context}
        </Text>

        <Text fontSize="xs" color="fg.muted" data-testid={`agent-connection-dates-${id}`}>
          {span}
          {mobile ? <br /> : " · "}
          {lastUsed}
        </Text>
      </Stack>

      <ConfirmDialog
        trigger={trigger}
        title={t("agents.row.revokeTitle", { name: connection.name })}
        message={t("agents.row.revokeMessage", { client: connection.clientName })}
        confirmLabel={label}
        dismissLabel={t("common.cancel")}
        onConfirm={confirm}
      />
    </Flex>
  );
}
