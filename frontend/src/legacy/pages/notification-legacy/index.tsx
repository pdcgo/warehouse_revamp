import { Heading, Stack, Text } from "@chakra-ui/react";
import { Bell } from "lucide-react";
import { DataTable, type TableColumn } from "../../components/display/DataTable";
import { DateCell } from "../../components/cells/DateCell";
import { EmptyHint } from "../../components/feedback/EmptyHint";
import { ToneBadge } from "../../components/badges/ToneBadge";
import type { NotificationRow } from "../../fixtures";

// The PREVIOUS notification screen, still routed in the legacy system.
//
// Ported for completeness, and it is instructive next to its replacement: this one is a TABLE. Every
// notification is a row with a title column and a body column, and the body — which is the part that
// says what actually happened — is truncated to whatever fits.
//
// That is the failure the card list fixed. A notification is a short message to READ, not a record
// to compare against its neighbours, and a table is the wrong shape for reading: it optimises for
// scanning one column down, which is exactly what nobody does with an alert.
//
// It also has no unread state at all — everything looks the same, so there is no way to tell what is
// new without remembering.
export const description =
  "The PREVIOUS notification screen — a table, where the body text is truncated to whatever fits and nothing marks what is unread. Kept beside its replacement to show what the card list fixed.";

export interface NotificationLegacyPageProps {
  notifications: NotificationRow[];
  loading?: boolean;
}

export function NotificationLegacyPage({ notifications, loading }: NotificationLegacyPageProps) {
  const columns: Array<TableColumn<NotificationRow>> = [
    { name: "Title", key: "title" },
    {
      name: "Kind",
      render: (n) => <ToneBadge tone="plain">{n.kind}</ToneBadge>,
    },
    {
      name: "Message",
      // Truncated — the original behaviour, and the reason the screen was replaced.
      render: (n) => (
        <Text fontSize="sm" color="fg.muted" truncate maxW="80" data-testid="legacy-body">
          {n.body}
        </Text>
      ),
    },
    { name: "When", render: (n) => <DateCell value={n.at} grain="datetime" /> },
  ];

  if (!loading && notifications.length === 0) {
    return (
      <Stack gap="section" data-testid="notification-legacy-page">
        <Heading size="md">Notifications</Heading>
        <EmptyHint icon={Bell} title="No notifications" />
      </Stack>
    );
  }

  return (
    <Stack gap="section" data-testid="notification-legacy-page">
      <Heading size="md">Notifications</Heading>

      <DataTable
        columns={columns}
        items={notifications}
        loading={loading}
        emptyTitle="No notifications"
        aria-label="Notifications"
      />
    </Stack>
  );
}
