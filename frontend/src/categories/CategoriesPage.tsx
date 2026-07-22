import {
  Box,
  Flex,
  HStack,
  Heading,
  Icon,
  IconButton,
  Spacer,
  Spinner,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { rpcError } from "../api/clients";
import type { Category } from "../gen/warehouse/category/v1/category_pb";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { toaster } from "../components/Toaster";
import { flattenTree } from "./categoryTree";
import { CreateCategoryDialog } from "./CreateCategoryDialog";
import { EditCategoryDialog } from "./EditCategoryDialog";
import { useCategories, useDeleteCategory } from "./queries";

// CategoriesPage manages the GLOBAL, nested category taxonomy — a single shared tree curated by
// root/admin (see the nav gate). It is not team-scoped, so unlike ProductsPage there is no current
// team in play: the list is flat on the wire and flattenTree assembles the indented tree here.
export function CategoriesPage() {
  const { t } = useTranslation();
  const query = useCategories();
  const deleteCategory = useDeleteCategory();

  const categories = query.data ?? [];
  const loading = query.isPending;
  const error = query.isError ? rpcError(query.error) : "";

  // mutateAsync because ConfirmDialog awaits onConfirm — see the note in expenses/ExpensesPage.tsx.
  async function remove(category: Category) {
    try {
      await deleteCategory.mutateAsync({ categoryId: category.id });
      toaster.create({
        type: "success",
        title: t("catalog.categories.deletedToast", { name: category.name }),
      });
    } catch (err) {
      // The backend refuses to delete a category that still has sub-categories (FailedPrecondition);
      // surface that message rather than pretending it worked.
      toaster.create({ type: "error", title: t("catalog.deleteFailed"), description: rpcError(err) });
    }
  }

  const nodes = flattenTree(categories);

  return (
    <Stack gap="section">
      <Flex align="center" gap="card">
        <Heading size="md">{t("catalog.categories.title")}</Heading>
        <Spacer />
        <CreateCategoryDialog />
      </Flex>

      {error && (
        <Text color="red.fg" data-testid="categories-error">
          {error}
        </Text>
      )}

      {loading ? (
        <Spinner colorPalette="brand" />
      ) : (
        <Table.Root size="sm" data-testid="categories-table">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>{t("catalog.name")}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">{t("catalog.actions")}</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>

          <Table.Body>
            {nodes.map(({ category, depth }) => (
              <Table.Row key={category.id.toString()} data-testid={`category-row-${category.id}`}>
                <Table.Cell>
                  <Box as="span" ps={depth * 4} color={depth === 0 ? "fg" : "fg.muted"}>
                    {depth > 0 ? "— " : ""}
                    {category.name}
                  </Box>
                </Table.Cell>

                <Table.Cell textAlign="end">
                  <HStack justify="end" gap="1">
                    <EditCategoryDialog category={category} />

                    <ConfirmDialog
                      title={t("catalog.categories.deleteTitle")}
                      message={t("catalog.categories.deleteMessage", { name: category.name })}
                      confirmLabel={t("catalog.delete")}
                      onConfirm={() => remove(category)}
                      trigger={
                        <IconButton
                          size="xs"
                          variant="ghost"
                          colorPalette="red"
                          aria-label="Delete"
                          data-testid={`delete-cat-${category.id}`}
                        >
                          <Icon as={Trash2} boxSize="4" />
                        </IconButton>
                      }
                    />
                  </HStack>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      )}

      {!loading && nodes.length === 0 && !error && (
        <Text color="fg.muted" data-testid="categories-empty">
          {t("catalog.categories.empty")}
        </Text>
      )}
    </Stack>
  );
}
