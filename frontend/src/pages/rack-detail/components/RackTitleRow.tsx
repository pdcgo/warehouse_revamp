import type { ReactNode, RefObject } from "react";
import { Flex, Heading, Icon, IconButton, Stack, Text } from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";

// A RACK PAGE'S TITLE ROW — back as an icon, the CODE painted on the shelf as the heading with the rack's name small under
// it, and the acts held to the right. ONE builder, drawn twice: as the page's title, and as the sticky bar once that title
// has scrolled behind it (the-title-row-is-the-sticky-bar) — so nothing can be done from one that the other lacks. The
// product page's row (ProductTitleRow) with the rack's two facts in it: a rack has a code and a name, nothing to copy.
//
// Test ids: `rack-detail-back`, `rack-detail-code`, `rack-detail-name` on the page's row; `rack-detail-sticky-back` on the
// bar's. The actions are the caller's, built per row with their own ids.
export function RackTitleRow({
  stuck,
  code,
  name,
  backLabel,
  onBack,
  titleRef,
  actions,
}: {
  /** The bar's copy — smaller, cut to one line. */
  stuck: boolean;
  code: string;
  /** The rack's name — legitimately empty, and then not drawn. */
  name: string;
  backLabel: string;
  onBack: () => void;
  /** The page's own row — what useStickyTitle watches. Ignored on the bar's copy. */
  titleRef?: RefObject<HTMLDivElement>;
  /** Held to the right. On a phone, `CompactActions` (a-phone-header-action-is-an-icon). */
  actions?: ReactNode;
}) {
  return (
    // On a phone the row is as tight as the bar's (every-phone-title-is-20px).
    <Flex ref={stuck ? undefined : titleRef} align="center" gap={stuck ? "2" : { base: "2", md: "card" }} minW="0">
      <IconButton
        size="sm"
        variant="ghost"
        flexShrink={0}
        aria-label={backLabel}
        title={backLabel}
        data-testid={stuck ? "rack-detail-sticky-back" : "rack-detail-back"}
        onClick={onBack}
      >
        <Icon as={ArrowLeft} boxSize="4" />
      </IconButton>

      <Stack gap="0" minW="0" flex="1">
        {/* The CODE is how a person finds this rack in the building, so it is the heading. */}
        <Heading size={stuck ? "md" : "lg"} truncate minW="0" data-testid={stuck ? undefined : "rack-detail-code"}>
          {code}
        </Heading>
        {name && (
          <Text fontSize="sm" color="fg.muted" truncate data-testid={stuck ? undefined : "rack-detail-name"}>
            {name}
          </Text>
        )}
      </Stack>

      {actions}
    </Flex>
  );
}
