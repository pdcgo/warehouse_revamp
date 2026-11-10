import type { ReactNode } from "react";
import { Flex, Heading, Icon, IconButton, Stack, Text } from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";

// A BATCH PAGE'S TITLE ROW — back as an icon, the batch's OWN number as the heading (the one in a label's QR) with its
// badges beside it, and the acts held to the right. ONE builder, drawn twice: as the page's title, and as the sticky bar
// once that title has scrolled behind it (the-title-row-is-the-sticky-bar) — so nothing can be done from one that the
// other lacks. The rack page's row (RackTitleRow) with a batch's facts in it.
//
// The bar names the PRODUCT under the number: on the page the product sits under the title row, but once that has
// scrolled away *Batch #5031* alone says nothing about what is being read. So the page watches the whole heading — the
// row AND the product under it — and the bar shows only once both are gone, never the product twice.
//
// Test ids: `batch-detail-back`, `batch-detail-name` on the page's row; `batch-detail-sticky-back` on the bar's. The
// badges and the actions are the caller's, built per row with their own ids.
export function BatchTitleRow({
  stuck,
  title,
  badges,
  productName,
  backLabel,
  onBack,
  actions,
}: {
  /** The bar's copy — smaller, cut to one line, the product under the number. */
  stuck: boolean;
  title: string;
  /** Beside the heading — the origin, and an expiry that is near. The page's row only. */
  badges?: ReactNode;
  /** Under the number on the bar's copy. */
  productName?: string;
  backLabel: string;
  onBack: () => void;
  /** Held to the right. On a phone, `CompactActions` (a-phone-header-action-is-an-icon). */
  actions?: ReactNode;
}) {
  return (
    // On a phone the row is as tight as the bar's (every-phone-title-is-20px).
    <Flex align="center" gap={stuck ? "2" : { base: "2", md: "card" }} minW="0">
      <IconButton
        size="sm"
        variant="ghost"
        flexShrink={0}
        aria-label={backLabel}
        title={backLabel}
        data-testid={stuck ? "batch-detail-sticky-back" : "batch-detail-back"}
        onClick={onBack}
      >
        <Icon as={ArrowLeft} boxSize="4" />
      </IconButton>

      {stuck ? (
        <Stack gap="0" minW="0" flex="1">
          <Heading size="md" truncate minW="0">
            {title}
          </Heading>
          {productName && (
            <Text fontSize="sm" color="fg.muted" truncate>
              {productName}
            </Text>
          )}
        </Stack>
      ) : (
        <Flex align="center" gap="2" wrap="wrap" flex="1" minW="0">
          <Heading size="lg" data-testid="batch-detail-name">
            {title}
          </Heading>
          {badges}
        </Flex>
      )}

      {actions}
    </Flex>
  );
}
