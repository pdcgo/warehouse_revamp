import type { ReactNode } from "react";
import { Box, CloseButton, Dialog, HStack, Image, Portal, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

// A PHOTO TAKEN AT THE DOOR, READ BACK — the broken units' (the-detail-pages-show-the-broken-photo) and the courier's
// slip (the-detail-pages-show-the-slip-and-the-broken-rack). The selling team's and the warehouse's detail pages show it
// the same way: A SMALL SQUARE THAT OPENS THE PHOTO WHOLE, in a dialog of its own — in a cell, a card, a phone's block, and
// in the selling page's Penyesuaian dialog too (owner: *"gambar rusak di selling perkecil saja, nanti bisa preview lagi,
// soalnya sepertinya yang sekarang kepotong"*, a-door-photo-is-a-thumbnail-that-opens-whole). It was drawn there at the
// dialog's width and cut to fit; the photo is only ever shown whole when it is opened.
//
// The pages pass the URL — today a SAMPLE (photoSamples.ts), marked by each page's own pending mark.
export function PhotoView({
  url,
  title,
  alt,
  subject,
  mark,
  testId,
}: {
  url: string;
  /** The opened dialog's title — Title Case. */
  title: string;
  /** What the picture shows — said to a screen reader. */
  alt: string;
  /** What it belongs to — the product, the restock — under the dialog's title. */
  subject: string;
  mark?: ReactNode;
  /** `<testId>` on the thumbnail's row; `<testId>-open` on the thumb, `<testId>-dialog` on what it opens. */
  testId: string;
}) {
  const { t } = useTranslation();

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
            aria-label={t("restock.detail.photoOpen", { what: alt })}
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
                  <Dialog.Title>{title}</Dialog.Title>
                  <Text fontSize="sm" color="fg.muted" truncate>
                    {subject}
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
