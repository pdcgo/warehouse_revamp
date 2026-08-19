import { useMemo, useState } from "react";
import { Heading, HStack, Icon, Stack, Text } from "@chakra-ui/react";
import { Bell, Boxes, CheckCheck, Receipt, Settings, Wallet } from "lucide-react";
import { Card } from "../../components/display/Card";
import { ChoiceTabs } from "../../components/display/ChoiceTabs";
import { EmptyHint } from "../../components/feedback/EmptyHint";
import { Button } from "../../components/inputs/Button";
import { DateText } from "../../components/text/DateText";
import { SkeletonBlock } from "../../components/feedback/SkeletonBlock";
import type { NotificationRow } from "../../fixtures";

// The notification list — and the shell for the notification detail beneath it.
//
// It is a LIST OF CARDS rather than a table, for the same reason a mail client is: each entry is a
// short message to read, not a record with columns to compare. A table would give a title column and
// a body column, and the body would be truncated to nothing.
//
// Two decisions:
//
//  1. UNREAD IS A WEIGHT, NOT A BADGE. Unread entries are heavier and carry a dot; read ones recede.
//     A badge per row would put a second thing to scan beside the thing you are scanning.
//  2. "MARK ALL READ" IS ALWAYS AVAILABLE, and it does not need a confirm. It is reversible in the
//     only sense that matters — the notifications are still there — and requiring a confirmation for
//     the action people take most often on this screen is friction with nothing behind it.
export const description =
  "Notifications as a list of cards, not a table — each entry is a message to read, not a record to compare. Unread is expressed as weight rather than a badge, and Mark all read needs no confirmation.";

const KIND_ICON = {
  stock: Boxes,
  order: Receipt,
  billing: Wallet,
  system: Settings,
} as const;

type Filter = "unread" | undefined;

export interface NotificationListPageProps {
  notifications: NotificationRow[];
  loading?: boolean;
  onOpen?(id: bigint): void;
  onMarkAllRead?(): void;
}

export function NotificationListPage({
  notifications,
  loading,
  onOpen,
  onMarkAllRead,
}: NotificationListPageProps) {
  const [filter, setFilter] = useState<Filter>();

  const rows = useMemo(
    () => (filter === "unread" ? notifications.filter((n) => !n.read) : notifications),
    [notifications, filter],
  );

  const unread = notifications.filter((n) => !n.read).length;

  return (
    <Stack gap="section" data-testid="notification-list-page">
      <HStack justify="space-between" wrap="wrap" gap="card">
        <Heading size="md">Notifications</Heading>
        <Button
          tone="plain"
          variant="outline"
          icon={CheckCheck}
          // Nothing unread means nothing to do — a live button that does nothing is worse than a
          // disabled one, because it invites the click.
          disabled={unread === 0}
          onClick={onMarkAllRead}
          data-testid="mark-all-read"
        >
          Mark all read
        </Button>
      </HStack>

      <ChoiceTabs
        items={[
          { value: undefined, name: "All" },
          { value: "unread" as const, name: `Unread${unread > 0 ? ` (${unread})` : ""}` },
        ]}
        value={filter}
        onChange={(v) => setFilter(v as Filter)}
      />

      {loading ? (
        <Stack gap="2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <SkeletonBlock shape="text" lines={2} />
            </Card>
          ))}
        </Stack>
      ) : rows.length === 0 ? (
        <EmptyHint icon={Bell} title={filter === "unread" ? "Nothing unread" : "No notifications"}>
          {filter === "unread" ? "You are up to date." : "Alerts about stock, orders and billing appear here."}
        </EmptyHint>
      ) : (
        <Stack gap="2">
          {rows.map((n) => (
            <Card
              key={n.id.toString()}
              hoverable
              onClick={() => onOpen?.(n.id)}
              data-testid={`notification-${n.id}`}
              data-unread={n.read ? undefined : "true"}
            >
              <HStack gap="3" align="flex-start">
                <Icon
                  as={KIND_ICON[n.kind]}
                  boxSize="4"
                  mt="0.5"
                  color={n.read ? "fg.subtle" : "colorPalette.fg"}
                  colorPalette="brand"
                />

                <Stack gap="0.5" flex="1" minW="0">
                  <HStack justify="space-between" gap="2">
                    {/* Decision 1: unread is WEIGHT. */}
                    <Text fontWeight={n.read ? "normal" : "bold"} color={n.read ? "fg.muted" : "fg"}>
                      {n.title}
                    </Text>
                    <DateText value={n.at} variant="relative" fontSize="xs" color="fg.muted" />
                  </HStack>
                  <Text fontSize="sm" color="fg.muted" lineClamp={2}>
                    {n.body}
                  </Text>
                </Stack>

                {!n.read && (
                  <Stack
                    boxSize="2"
                    borderRadius="full"
                    bg="colorPalette.solid"
                    colorPalette="brand"
                    mt="2"
                    flexShrink="0"
                    aria-label="Unread"
                  />
                )}
              </HStack>
            </Card>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
