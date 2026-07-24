import { useState } from "react";
import type { FormEvent } from "react";
import {
  Button,
  CloseButton,
  Dialog,
  Field,
  Icon,
  IconButton,
  Input,
  Portal,
  Stack,
  Text,
} from "@chakra-ui/react";
import { Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";
import { rpcError } from "../../../api/clients";
import type { Category } from "../../../gen/warehouse/category/v1/category_pb";
import { toaster } from "../../../components/Toaster";
import { CategorySelect } from "../../../components/CategorySelect";
import { useSaveCategory } from "../queries";

// EditCategoryDialog renames and/or reparents a category. The parent picker excludes THIS node's own
// id so it cannot be made its own parent; the backend still guards against deeper cycles. name and
// parent_id are optional on the wire, but the form holds the current values, so sending both simply
// overwrites with what is on screen (parent_id 0n = make top-level).
export function EditCategoryDialog({ category }: { category: Category }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState(category.name);
  const [parentId, setParentId] = useState<bigint>(category.parentId);

  // Same hook the create dialog uses — one write, one invalidation, whichever form calls it (#177).
  const save = useSaveCategory();
  const busy = save.isPending;

  function submit(event: FormEvent) {
    event.preventDefault();

    setError("");

    save.mutate(
      { categoryId: category.id, name, parentId },
      {
        onSuccess: () => {
          toaster.create({ type: "success", title: t("catalog.categories.updatedToast", { name }) });
          setOpen(false);
        },
        onError: (err) => setError(rpcError(err)),
      },
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={(e) => setOpen(e.open)}>
      <Dialog.Trigger asChild>
        <IconButton
          size="xs"
          variant="ghost"
          aria-label="Edit"
          data-testid={`edit-cat-${category.id}`}
        >
          <Icon as={Pencil} boxSize="4" />
        </IconButton>
      </Dialog.Trigger>

      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <form onSubmit={submit}>
              <Dialog.Header>
                <Dialog.Title>{t("catalog.categories.editTitle", { name: category.name })}</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <Stack gap="card">
                  {error && (
                    <Text color="red.fg" data-testid="edit-category-error">
                      {error}
                    </Text>
                  )}

                  <Field.Root required>
                    <Field.Label>{t("catalog.name")}</Field.Label>
                    <Input
                      value={name}
                      data-testid="edit-category-name"
                      onChange={(e) => setName(e.target.value)}
                    />
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>{t("catalog.categories.parent")}</Field.Label>
                    <CategorySelect
                      value={parentId}
                      onChange={setParentId}
                      excludeId={category.id}
                    />
                    <Field.HelperText>{t("catalog.categories.parentHelpEdit")}</Field.HelperText>
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
                  data-testid="submit-edit-category"
                >
                  {t("catalog.save")}
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
