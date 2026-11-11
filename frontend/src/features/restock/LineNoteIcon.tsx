import { useTranslation } from "react-i18next";
import { Box, Icon, Portal, Tooltip } from "@chakra-ui/react";
import { MessageSquareText } from "lucide-react";

// A LINE'S NOTE, AS AN ICON — at the end of the product, its words in the tooltip and in its name, so the product cell
// stays two lines (one-context-per-column-and-never-three-lines). A note is rare (a line added after arrival carries one),
// so a line without one shows nothing. Both restock pages draw it (the-restock-detail-follows-the-screen-rules,
// the-warehouse-restock-detail-follows-the-screen-rules).
export function LineNoteIcon({ note, productId }: { note: string; productId: bigint }) {
  const { t } = useTranslation();
  const text = t("restock.detail.lineNote", { note });

  return (
    <Tooltip.Root openDelay={150} closeDelay={80}>
      <Tooltip.Trigger asChild>
        <Box
          as="span"
          tabIndex={0}
          display="inline-flex"
          color="fg.muted"
          flexShrink={0}
          aria-label={text}
          data-testid={`restock-detail-line-note-${productId}`}
        >
          <Icon as={MessageSquareText} boxSize="4" />
        </Box>
      </Tooltip.Trigger>
      <Portal>
        <Tooltip.Positioner>
          <Tooltip.Content maxW="xs" data-testid={`restock-detail-line-note-${productId}-text`}>
            {text}
          </Tooltip.Content>
        </Tooltip.Positioner>
      </Portal>
    </Tooltip.Root>
  );
}
