import { CloseButton, Dialog, Image, Portal, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

// THE PICTURE, BIG ENOUGH TO SEE (owner) — a product's cover, or a shipping label.
//
// A cover in a list is ~32px — enough to tell "there is a product here", not enough to tell two
// similar packs apart, which is exactly the decision somebody is making while substituting a bundle
// slot. Clicking it opens the image at full width.
//
// ⚠ THE TITLE IS THE PRODUCT'S NAME, by instruction — so the dialog says WHICH product is being
// looked at. A picture on its own is the one thing that cannot say that.
//
// It lives in the prototype rather than in `components/feedback/` for now: the pattern is being
// reviewed, and promoting it later is a file move plus its own story.

export interface PreviewTarget {
  src: string;
  /** What is being looked at — the dialog's title. A product's name, a file's name. */
  title: string;
  /** Under the title: the SKU, so a name shared by two packs is still resolvable. */
  caption?: string;
}

export function ImagePreview({
  target,
  onClose,
}: {
  /** `null` closes it — one piece of state on the caller, which is what makes it a preview of
   * WHICHEVER image was clicked rather than one dialog per row. */
  target: PreviewTarget | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Dialog.Root open={target !== null} onOpenChange={(e) => !e.open && onClose()} size="lg">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid="image-preview">
            <Dialog.Header>
              <Dialog.Title>{target?.title}</Dialog.Title>
              <Dialog.CloseTrigger asChild>
                <CloseButton size="sm" aria-label={t("common.close")} />
              </Dialog.CloseTrigger>
            </Dialog.Header>

            <Dialog.Body pb="card">
              {target && (
                <Image
                  src={target.src}
                  alt={target.title}
                  w="full"
                  borderRadius="l2"
                  data-testid="image-preview-image"
                />
              )}
              {target?.caption && (
                <Text fontSize="sm" color="fg.muted" mt="2">
                  {target.caption}
                </Text>
              )}
            </Dialog.Body>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
