import { useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { Button, FileUpload, Flex, HStack, Icon, IconButton, Image, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { Camera, X } from "lucide-react";

// ONE PHOTO TAKEN AT THE DOOR — the broken units' (a-broken-product-carries-a-photo) and the courier's slip
// (the-courier-slip-has-an-optional-photo). One per thing, replaced rather than added to, as the restock's Foto resi is.
// Optional wherever it sits: it never holds an act up.
//
// On a phone the picker opens the CAMERA (`capture`): the person is standing over the box, and a gallery is one more step
// between them and the picture.
//
// ⚠ NOT KEPT, AND NOT UPLOADED. Neither the arrival nor the accept carries a photo, so the picked file is shown here and
// goes no further — an upload nothing points at is a file nobody can find again. The mark beside it is the page's, and
// the act's toast says what was not kept.
export function PhotoPick({
  file,
  onChange,
  alt,
  mark,
  testId,
}: {
  file: File | null;
  onChange: (file: File | null) => void;
  /** What the picture shows — said to a screen reader. */
  alt: string;
  mark?: ReactNode;
  /** `<testId>-pick`, `<testId>-input`, `<testId>-shown`, `<testId>-remove`. */
  testId: string;
}) {
  const { t } = useTranslation();
  // A local preview of the picked file, released when it is replaced or the control goes.
  const url = useMemo(() => (file ? URL.createObjectURL(file) : ""), [file]);
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);

  return (
    <Flex gap="2" align="center" wrap="wrap" data-testid={testId}>
      {file && (
        <HStack gap="2" minW="0" flex="1" data-testid={`${testId}-shown`}>
          <Image src={url} alt={alt} boxSize="12" objectFit="cover" borderRadius="md" />
          <Text fontSize="xs" color="fg.muted" lineClamp={1} minW="0">
            {file.name}
          </Text>
          <IconButton
            size="xs"
            variant="ghost"
            aria-label={t("restock.photo.remove")}
            data-testid={`${testId}-remove`}
            onClick={() => onChange(null)}
          >
            <Icon as={X} boxSize="4" />
          </IconButton>
        </HStack>
      )}

      {/* Remounted per pick, so picking the same file twice is still a pick. */}
      <FileUpload.Root
        key={file ? `${file.name}:${file.lastModified}` : "none"}
        accept="image/*"
        capture="environment"
        maxFiles={1}
        onFileChange={(details) => {
          const picked = details.acceptedFiles[0];
          if (picked) onChange(picked);
        }}
        w="auto"
      >
        <FileUpload.HiddenInput data-testid={`${testId}-input`} />
        <FileUpload.Trigger asChild>
          <Button size="xs" variant="outline" data-testid={`${testId}-pick`}>
            <Icon as={Camera} boxSize="4" />
            {file ? t("restock.photo.replace") : t("restock.photo.add")}
          </Button>
        </FileUpload.Trigger>
      </FileUpload.Root>

      {mark}
    </Flex>
  );
}
