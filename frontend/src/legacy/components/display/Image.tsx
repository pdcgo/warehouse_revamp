import { useEffect, useState } from "react";
import { Box, Icon, Image as ChakraImage } from "@chakra-ui/react";
import type { ImageProps as ChakraImageProps } from "@chakra-ui/react";
import { ImageOff } from "lucide-react";
import { Modal } from "../feedback/Modal";

// Image is the app's picture element: it degrades to a placeholder when the source is missing or
// broken, and can open full-size on click.
//
// The fallback is the reason it exists. Product photos here come from marketplace imports and
// operator uploads, so a meaningful fraction of them are absent, expired or 404 — and a broken
// <img> renders as the browser's torn-page glyph plus the alt text, at whatever size the alt text
// happens to be. In a product table that means rows of different heights, which is far more
// disruptive than the missing photo itself. A fixed-size placeholder keeps the grid intact.
//
// `preview` is opt-in because it is only right where the picture carries information a thumbnail
// cannot: is this the right variant, is the damage visible, does the receipt say what it should.
// Everywhere else it just puts a click target on something nobody wants to click.
export const description =
  "A picture that degrades to a fixed-size placeholder when the source is missing or broken, so a table of rows keeps its grid. Optionally opens full-size on click.";

export interface ImageProps extends Omit<ChakraImageProps, "fallback"> {
  // Open the full-size image in a dialog on click. Off by default — see above.
  preview?: boolean;
}

export function Image({ preview, src, alt, onClick, ...rest }: ImageProps) {
  const [broken, setBroken] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  // A new src deserves a fresh attempt: without this, one broken image poisons the slot for every
  // product that later scrolls into the same recycled row.
  useEffect(() => setBroken(false), [src]);

  const showPlaceholder = !src || broken;

  if (showPlaceholder) {
    return (
      <Box
        bg="bg.muted"
        color="fg.subtle"
        display="flex"
        alignItems="center"
        justifyContent="center"
        borderRadius="l2"
        // The caller's sizing props still apply, so the placeholder occupies exactly the space the
        // real image would have.
        data-testid="image-placeholder"
        aria-label={alt}
        role="img"
        {...rest}
      >
        <Icon as={ImageOff} boxSize="4" />
      </Box>
    );
  }

  return (
    <>
      <ChakraImage
        src={src}
        alt={alt}
        objectFit="cover"
        borderRadius="l2"
        bg="bg.muted"
        cursor={preview ? "zoom-in" : undefined}
        onError={() => setBroken(true)}
        data-testid="image"
        onClick={(e) => {
          if (preview) {
            // Product images live inside clickable rows; opening the preview must not also open the
            // row behind it.
            e.preventDefault();
            e.stopPropagation();
            setPreviewing(true);
          }

          onClick?.(e);
        }}
        {...rest}
      />

      {preview && (
        <Modal open={previewing} onOpenChange={setPreviewing} title={alt} size="lg">
          <ChakraImage src={src} alt={alt} w="full" borderRadius="l2" />
        </Modal>
      )}
    </>
  );
}
