import { useState } from "react";
import type { FormEvent } from "react";
import { Button, CloseButton, Dialog, Field, Icon, Portal, Stack, Text } from "@chakra-ui/react";
import { FolderInput } from "lucide-react";
import { useTranslation } from "react-i18next";
import { rpcError } from "../../../api/clients";
import type { Category } from "../../../gen/warehouse/category/v1/category_pb";
import { toaster } from "../../../components/feedback/Toaster";
import { CategorySelect } from "../../../components/pickers/CategorySelect";
import { useSaveCategory } from "../queries";

// MoveCategoryDialog gives a category a new PARENT — or none, to make it top-level — and nothing else
// (the-category-page-is-a-tree). It sends the parent alone, so the name on the server is left as it is.
//
// The picker leaves out THIS category, and with it its whole branch: a category cannot go under itself or under one of
// its own children. ⚠ That is the screen's guard only — the server refuses a category as its own parent, not a deeper
// loop.
export function MoveCategoryDialog({ category, onClose }: { category: Category; onClose: () => void }) {
  const { t } = useTranslation();
  const [error, setError] = useState("");
  const [parentId, setParentId] = useState<bigint>(category.parentId);

  const save = useSaveCategory();
  const busy = save.isPending;

  function submit(event: FormEvent) {
    event.preventDefault();

    setError("");

    save.mutate(
      { categoryId: category.id, parentId },
      {
        onSuccess: () => {
          toaster.create({ type: "success", title: t("catalog.categories.movedToast", { name: category.name }) });
          onClose();
        },
        onError: (err) => setError(rpcError(err)),
      },
    );
  }

  return (
    <Dialog.Root open onOpenChange={(e) => !e.open && onClose()}>
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid="move-category-dialog">
            <form onSubmit={submit}>
              <Dialog.Header>
                <Dialog.Title>{t("catalog.categories.moveTitle", { name: category.name })}</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <Stack gap="card">
                  {error && (
                    <Text color="error.fg" data-testid="move-category-error">
                      {error}
                    </Text>
                  )}

                  <Field.Root>
                    <Field.Label>{t("catalog.categories.newParent")}</Field.Label>
                    <CategorySelect value={parentId} onChange={setParentId} excludeId={category.id} />
                    <Field.HelperText>{t("catalog.categories.moveHelp")}</Field.HelperText>
                  </Field.Root>
                </Stack>
              </Dialog.Body>

              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline">{t("catalog.cancel")}</Button>
                </Dialog.ActionTrigger>

                <Button
                  type="submit"
                  colorPalette="brand"
                  loading={busy}
                  disabled={parentId === category.parentId}
                  data-testid="submit-move-category"
                >
                  <Icon as={FolderInput} boxSize="4" />
                  {t("catalog.categories.move")}
                </Button>
              </Dialog.Footer>

              <Dialog.CloseTrigger asChild>
                <CloseButton size="sm" />
              </Dialog.CloseTrigger>
            </form>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
