import { useTranslation } from "react-i18next";
import { Box, Carousel, Image, Text } from "@chakra-ui/react";

/** One picture — the full image, and the small one the thumbnails draw. */
export interface GalleryImage {
  url: string;
  thumbnailUrl: string;
}

// A PRODUCT'S PICTURES, in the first column of its Info — the product's own page and its discover detail alike (owner:
// *"gambar produk ada"*, the-discover-detail-shows-no-markup). The picture identifies the product without becoming a
// poster.
//
//   none      a sentence — never a blank box
//   one       the picture, square — arrows and a single indicator would promise a second
//   several   one at a time, THUMBNAILS as the indicators: a thumbnail says which picture you are about to get, which is
//             the whole reason to look at a second one. Position 0 is the cover.
//
// Test ids from `prefix`: `<prefix>-images`, `<prefix>-image-<i>`, `<prefix>-no-images`.
export function ProductGallery({ images, name, prefix }: { images: GalleryImage[]; name: string; prefix: string }) {
  const { t } = useTranslation();

  if (images.length === 0) {
    return (
      <Text color="fg.muted" fontSize="sm" data-testid={`${prefix}-no-images`}>
        {t("products.detail.noImages")}
      </Text>
    );
  }

  if (images.length === 1) {
    return (
      <Box data-testid={`${prefix}-images`}>
        <Image
          src={images[0]!.url || images[0]!.thumbnailUrl}
          alt={`${name} image 1`}
          aspectRatio={1}
          objectFit="cover"
          w="full"
          borderWidth="1px"
          borderRadius="md"
          data-testid={`${prefix}-image-0`}
        />
      </Box>
    );
  }

  return (
    <Carousel.Root slideCount={images.length} slidesPerPage={1} loop allowMouseDrag data-testid={`${prefix}-images`}>
      <Carousel.ItemGroup>
        {images.map((img, i) => (
          <Carousel.Item key={`${img.url}-${i}`} index={i}>
            <Image
              src={img.url || img.thumbnailUrl}
              alt={`${name} image ${i + 1}`}
              aspectRatio={1}
              objectFit="cover"
              w="full"
              borderWidth="1px"
              borderRadius="md"
              data-testid={`${prefix}-image-${i}`}
            />
          </Carousel.Item>
        ))}
      </Carousel.ItemGroup>
      <Carousel.IndicatorGroup display="flex" gap="2" mt="2" flexWrap="wrap" justifyContent="flex-start">
        {images.map((img, i) => (
          <Carousel.Indicator
            key={`${img.url}-thumb-${i}`}
            index={i}
            unstyled
            aria-label={t("products.detail.showImage", { n: i + 1 })}
            cursor="pointer"
            boxSize="10"
            p="0"
            borderRadius="md"
            overflow="hidden"
            borderWidth="2px"
            borderColor="transparent"
            opacity="0.55"
            transition="opacity 0.15s, border-color 0.15s"
            _hover={{ opacity: 1 }}
            css={{ "&[data-current]": { opacity: 1, borderColor: "colorPalette.solid" } }}
            colorPalette="brand"
          >
            <Image src={img.thumbnailUrl || img.url} alt="" w="full" h="full" objectFit="cover" />
          </Carousel.Indicator>
        ))}
      </Carousel.IndicatorGroup>
    </Carousel.Root>
  );
}
