import { Heading, HStack, Icon, Stack, Text } from "@chakra-ui/react";
import { Boxes, Receipt, Settings, Wallet } from "lucide-react";
import { Breadcrumb } from "../../components/display/Breadcrumb";
import { Card } from "../../components/display/Card";
import { Button } from "../../components/inputs/Button";
import { ToneBadge } from "../../components/badges/ToneBadge";
import { DateText } from "../../components/text/DateText";
import type { NotificationRow } from "../../fixtures";

const KIND_ICON = {
  stock: Boxes,
  order: Receipt,
  billing: Wallet,
  system: Settings,
} as const;

const KIND_LABEL = {
  stock: "Stock",
  order: "Orders",
  billing: "Billing",
  system: "System",
} as const;

// One notification, in full.
//
// The whole value of this screen over the list entry is the ACTION LINK — every notification exists
// because something needs looking at, and the screen's job is to take you there. A notification you
// can only read is a notification that made you go and find the thing yourself.
//
// So the primary button is the destination, and it is a real link. Where a notification genuinely
// has nowhere to go — a maintenance announcement — the screen says so rather than rendering a dead
// button.
export const description =
  "One notification in full. Its value over the list entry is the ACTION LINK — every notification exists because something needs looking at, so the screen's job is to take you there.";

export interface NotificationDetailPageProps {
  notification: NotificationRow;
  // Where the thing being reported lives. Absent for announcements with nothing to open.
  actionHref?: string;
  actionLabel?: string;
}

export function NotificationDetailPage({
  notification,
  actionHref,
  actionLabel = "Open",
}: NotificationDetailPageProps) {
  return (
    <Stack gap="section" maxW="2xl" data-testid="notification-detail-page">
      <Breadcrumb
        items={[{ href: "/notifications", name: "Notifications" }, { name: notification.title }]}
      />

      <Card>
        <Stack gap="card">
          <HStack gap="3" align="flex-start">
            <Icon
              as={KIND_ICON[notification.kind]}
              boxSize="5"
              mt="1"
              colorPalette="brand"
              color="colorPalette.fg"
            />
            <Stack gap="1" flex="1" minW="0">
              <Heading size="sm">{notification.title}</Heading>
              <HStack gap="2">
                <ToneBadge tone="plain">{KIND_LABEL[notification.kind]}</ToneBadge>
                <DateText value={notification.at} variant="datetime" fontSize="xs" color="fg.muted" />
              </HStack>
            </Stack>
          </HStack>

          <Text>{notification.body}</Text>

          {actionHref ? (
            <HStack>
              <Button href={actionHref} data-testid="notification-action">
                {actionLabel}
              </Button>
            </HStack>
          ) : (
            // Said plainly rather than rendered as a dead button. A disabled primary action on a
            // detail screen reads as something that failed to load.
            <Text fontSize="sm" color="fg.muted" data-testid="notification-no-action">
              Nothing to open — this is an announcement.
            </Text>
          )}
        </Stack>
      </Card>
    </Stack>
  );
}
