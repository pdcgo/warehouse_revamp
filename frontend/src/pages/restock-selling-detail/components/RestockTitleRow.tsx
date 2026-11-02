import type { ReactNode, RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Box, Flex, Heading, HStack, Icon, IconButton, Span, Stack } from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";

import type { RestockRequest } from "../../../gen/warehouse/inventory/v1/restock_request_pb";
import { CopyText } from "../../../components/chrome/CopyText";

// A RESTOCK PAGE'S TITLE ROW — the product page's shape (owner: *"kalau menggunakan yang sesuai dengan produk detail, untuk
// restok id tidak penting ditampilkan, kembali cuma icon saja, yang utama di restok adalah order id dan resi"*,
// the-restock-detail-is-the-product-pages-shape):
//
//   ←  INV/2026/10/1001 ⧉   [Dalam Perjalanan] [kurang 1]                         [✎ Ubah] [⊘ Batalkan] …
//      Resi JNE0123456789 ⧉
//
//   ←  JNE0123456789 ⧉   [Dalam Perjalanan]          ← no order id (it is optional): the tracking number leads, alone
//
// Back is its icon alone. The ORDER ID is the title — what a buyer quotes to the store — copyable, its value alone
// (the-title-is-the-reference-alone), and the tracking number under it, labelled, as a product's SKU sits under its
// name. The restock's own #id is not shown: a restock with no order id is titled by its tracking number, and only one
// with neither falls back to its number. ONE builder, drawn twice: as the page's title, and as the sticky bar once that
// title has scrolled behind it.
export function RestockTitleRow({
  stuck,
  request,
  backLabel,
  onBack,
  titleRef,
  badges,
  actions,
}: {
  /** The bar's copy — smaller, its ids suffixed so the page's stay unique. */
  stuck: boolean;
  request: RestockRequest;
  backLabel: string;
  onBack: () => void;
  /** The page's own row — what useStickyTitle watches, all of it. Ignored on the bar's copy. */
  titleRef?: RefObject<HTMLDivElement>;
  badges?: ReactNode;
  actions?: ReactNode;
}) {
  const { t } = useTranslation();
  const orderId = request.invoiceRefId.trim();
  const receipt = request.receipt.trim();
  // The page's copy carries the test ids; the bar's carries none of the copy controls', so nothing is found twice.
  const id = (base: string) => (stuck ? undefined : base);

  // What heads the row: the order id; with none, the tracking number; with neither, the restock's number.
  const lead = orderId !== "" ? "orderId" : receipt !== "" ? "receipt" : "number";

  return (
    <Flex ref={stuck ? undefined : titleRef} align="center" gap={stuck ? "2" : "card"} minW="0">
      <IconButton
        size="sm"
        variant="ghost"
        flexShrink={0}
        aria-label={backLabel}
        title={backLabel}
        data-testid={stuck ? "restock-detail-sticky-back" : "restock-detail-back"}
        onClick={onBack}
      >
        <Icon as={ArrowLeft} boxSize="4" />
      </IconButton>

      <Stack gap={stuck ? "0" : "1"} minW="0" flex="1">
        <HStack gap="2" minW="0" wrap={stuck ? "nowrap" : "wrap"}>
          <Heading
            size={stuck ? "md" : "lg"}
            minW="0"
            maxW="full"
            data-testid={id("restock-detail-title")}
          >
            {/* THE VALUE ALONE, NO LABEL BEFORE IT (owner: *"untuk judul ada order ID dan resinya keliatan jelek"*,
                the-title-is-the-reference-alone) — as a product's name has none. It is the order id when there is one; the
                tracking number when there is not, in its own face, so the two never read alike. */}
            <HStack gap="1.5" minW="0">
              {lead === "number" ? (
                <Span>{t("restock.detail.requestTitle", { id: request.id.toString() })}</Span>
              ) : (
                <Box minW="0" data-testid={id(lead === "orderId" ? "restock-detail-invoice" : "restock-detail-tracking")}>
                  <CopyText
                    value={lead === "orderId" ? orderId : receipt}
                    mono={lead === "receipt"}
                    fontSize="inherit"
                    maxW={stuck ? "14rem" : "full"}
                    testId={id(lead === "orderId" ? "restock-detail-invoice-copy" : "restock-detail-tracking-copy")}
                  />
                </Box>
              )}
            </HStack>
          </Heading>
          {badges}
        </HStack>

        {/* The tracking number to copy, UNDER the order id — as a product's SKU sits under its name. */}
        {lead === "orderId" && (
          <HStack gap="1.5" fontSize="sm" color="fg.muted" minW="0">
            <Span fontSize="xs" flexShrink={0}>
              {t("restock.table.receiptLabel")}
            </Span>
            {receipt !== "" ? (
              <Box minW="0" data-testid={id("restock-detail-tracking")}>
                <CopyText value={receipt} mono maxW={stuck ? "12rem" : "full"} testId={id("restock-detail-tracking-copy")} />
              </Box>
            ) : (
              <Span data-testid={id("restock-detail-tracking")}>—</Span>
            )}
          </HStack>
        )}
      </Stack>

      {actions}
    </Flex>
  );
}
