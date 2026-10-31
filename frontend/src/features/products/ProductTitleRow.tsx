import type { ReactNode, RefObject } from "react";
import { Box, Flex, Heading, HStack, Icon, IconButton, Stack } from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";

import { CopyText } from "../../components/chrome/CopyText";

// A PRODUCT PAGE'S TITLE ROW — back as an icon beside the name, the badges after the name, the SKU to copy UNDER it, and
// the actions held to the right (the-title-row-is-the-sticky-bar). ONE builder, drawn twice: as the page's title, and
// as the sticky bar once that title has scrolled behind it — so nothing can be done from one that the other lacks.
//
// The product's own page and the discover detail both (the-discover-detail-is-the-product-page): a reader who opens
// another team's product meets the page they already know from their own.
//
// Test ids from `prefix`: `<prefix>-back`, `<prefix>-name`, `<prefix>-sku` on the page's row, and `<prefix>-sticky-back`,
// `<prefix>-sticky-sku` on the bar's — so the page's own stay unique. The badges and the actions are the caller's, built
// per row with their own ids.
export function ProductTitleRow({
  stuck,
  prefix,
  backLabel,
  onBack,
  name,
  titleRef,
  badges,
  sku,
  actions,
}: {
  /** The bar's copy — smaller, its name cut to one line. */
  stuck: boolean;
  prefix: string;
  backLabel: string;
  onBack: () => void;
  name: string;
  /** The page's own heading — what useStickyTitle watches. Ignored on the bar's copy. */
  titleRef?: RefObject<HTMLHeadingElement>;
  /** Beside the name — the archived badge, a lock, a division. */
  badges?: ReactNode;
  sku: string;
  /** Held to the right. On a phone, pass `CompactActions` (a-phone-header-action-is-an-icon). */
  actions?: ReactNode;
}) {
  return (
    <Flex align="center" gap={stuck ? "2" : "card"} minW="0">
      <IconButton
        size="sm"
        variant="ghost"
        flexShrink={0}
        aria-label={backLabel}
        title={backLabel}
        data-testid={stuck ? `${prefix}-sticky-back` : `${prefix}-back`}
        onClick={onBack}
      >
        <Icon as={ArrowLeft} boxSize="4" />
      </IconButton>

      <Stack gap={stuck ? "0" : "1"} minW="0" flex="1">
        <HStack gap="2" minW="0">
          <Heading
            ref={stuck ? undefined : titleRef}
            size={stuck ? "md" : "lg"}
            truncate={stuck}
            minW="0"
            data-testid={stuck ? undefined : `${prefix}-name`}
          >
            {name}
          </Heading>
          {badges}
        </HStack>
        {/* The SKU to copy, UNDER the name (owner: *"skunya di bawah nama produk"*, *"sku di sticky taruh bawahnya"*). */}
        <Box fontSize="sm" color="fg.muted" data-testid={stuck ? `${prefix}-sticky-sku` : undefined}>
          <CopyText value={sku} testId={stuck ? undefined : `${prefix}-sku`} />
        </Box>
      </Stack>

      {actions}
    </Flex>
  );
}

// THE STICKY STRIP — the section chips on a phone (always), and the title bar under them, drawn over the page once the
// title has gone behind it. On a desktop the strip itself has no height: the bar overlays, nothing moves. The refs and
// `shown` come from useStickyTitle.
export function ProductStickyStrip({
  prefix,
  stripRef,
  barRef,
  shown,
  isMobile,
  chips,
  children,
}: {
  prefix: string;
  stripRef: RefObject<HTMLDivElement>;
  barRef: RefObject<HTMLDivElement>;
  shown: boolean;
  isMobile: boolean;
  /** The compact SectionNav — drawn on a phone only. */
  chips: ReactNode;
  /** The title row, stuck. */
  children: ReactNode;
}) {
  return (
    <Box ref={stripRef} position="sticky" top="0" zIndex={10} h={isMobile ? undefined : "0"} data-testid={`${prefix}-header`}>
      {isMobile && (
        <Box bg="bg" py="2" borderBottomWidth="1px" borderColor="border">
          {chips}
        </Box>
      )}
      <Box
        ref={barRef}
        position="absolute"
        top={isMobile ? "100%" : "0"}
        left="0"
        right="0"
        bg="bg"
        py="2"
        borderBottomWidth="1px"
        borderColor="border"
        opacity={shown ? 1 : 0}
        visibility={shown ? "visible" : "hidden"}
        transition="opacity 120ms"
        aria-hidden={!shown}
        data-testid={`${prefix}-name-bar`}
        data-shown={shown || undefined}
      >
        {children}
      </Box>
    </Box>
  );
}
