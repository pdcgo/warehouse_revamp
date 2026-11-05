import type { ReactNode } from "react";
import { Box, CloseButton, Dialog, HStack, Image, Portal, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

// THE PHOTO OF A LINE'S BROKEN UNITS, READ BACK (a-broken-product-carries-a-photo) — the selling team's and the
// warehouse's detail pages show it beside the broken row, the same way.
//
//   full   the photo at the dialog's width, under the row's note — inside the selling page's Penyesuaian dialog,
//          which is already the "look closer" step
//   thumb  a small square in a cell or a phone block; it opens the photo whole in a dialog
//
// The pages pass the URL — today the SAMPLE (brokenPhotoSample.ts), marked by each page's own pending mark.
export function BrokenPhotoView({
  url,
  name,
  variant,
  mark,
  testId,
}: {
  url: string;
  /** The product, for the dialog's title and the picture's alt. */
  name: string;
  variant: "full" | "thumb";
  mark?: ReactNode;
  /** `<testId>` on the picture; `<testId>-open` on the thumb, `<testId>-dialog` on what it opens. */
  testId: string;
}) {
  const { t } = useTranslation();
  const alt = t("restock.detail.brokenPhoto.alt", { name });

  if (variant === "full") {
    return (
      <Stack gap="1" data-testid={testId}>
        <Image src={url} alt={alt} w="full" maxH="56" objectFit="cover" borderRadius="md" borderWidth="1px" />
        <HStack gap="1.5" justify="end">
          <Text fontSize="xs" color="fg.muted">
            {t("restock.detail.brokenPhoto.caption")}
          </Text>
          {mark}
        </HStack>
      </Stack>
    );
  }

  return (
    <HStack gap="1.5" data-testid={testId}>
      <Dialog.Root size="md" lazyMount unmountOnExit placement="center">
        <Dialog.Trigger asChild>
          <Box
            as="button"
            flexShrink={0}
            borderRadius="md"
            overflow="hidden"
            borderWidth="1px"
            cursor="zoom-in"
            aria-label={t("restock.detail.brokenPhoto.open", { name })}
            data-testid={`${testId}-open`}
            onClick={(e) => e.stopPropagation()}
          >
            <Image src={url} alt={alt} boxSize="10" objectFit="cover" />
          </Box>
        </Dialog.Trigger>
        <Portal>
          <Dialog.Backdrop onClick={(e) => e.stopPropagation()} />
          <Dialog.Positioner onClick={(e) => e.stopPropagation()}>
            <Dialog.Content data-testid={`${testId}-dialog`}>
              <Dialog.Header>
                <Stack gap="0.5" minW="0">
                  <Dialog.Title>{t("restock.detail.brokenPhoto.title")}</Dialog.Title>
                  <Text fontSize="sm" color="fg.muted" truncate>
                    {name}
                  </Text>
                </Stack>
              </Dialog.Header>
              <Dialog.CloseTrigger asChild>
                <CloseButton size="sm" />
              </Dialog.CloseTrigger>
              <Dialog.Body pb="6">
                <Image src={url} alt={alt} w="full" borderRadius="md" />
              </Dialog.Body>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
      {mark}
    </HStack>
  );
}
