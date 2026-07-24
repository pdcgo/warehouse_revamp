import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { rpcError } from "../../api/clients";
import type { Category } from "../../gen/warehouse/category/v1/category_pb";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { IconButton } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Spinner";
import { Table } from "../../components/ui/Table";
import { toaster } from "../../components/Toaster";
import { flattenTree } from "../../features/categories/categoryTree";
import { CreateCategoryDialog } from "./components/CreateCategoryDialog";
import { EditCategoryDialog } from "./components/EditCategoryDialog";
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
    <div className="flex flex-col gap-section">
      <div className="flex items-center gap-card">
        <h1 className="text-[22px] font-bold">{t("catalog.categories.title")}</h1>
        <div className="flex-1" />
        <CreateCategoryDialog />
      </div>

      {error && (
        <p className="text-red-600 dark:text-red-400" data-testid="categories-error">
          {error}
        </p>
      )}

      {loading ? (
        <Spinner />
      ) : (
        <Table.Root data-testid="categories-table">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>{t("catalog.name")}</Table.ColumnHeader>
              <Table.ColumnHeader className="text-right">{t("catalog.actions")}</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>

          <Table.Body>
            {nodes.map(({ category, depth }) => (
              <Table.Row key={category.id.toString()} data-testid={`category-row-${category.id}`}>
                <Table.Cell>
                  <span
                    className={depth === 0 ? "text-fg" : "text-fg-muted"}
                    style={{ paddingInlineStart: `${depth}rem` }}
                  >
                    {depth > 0 ? "— " : ""}
                    {category.name}
                  </span>
                </Table.Cell>

                <Table.Cell className="text-right">
                  <div className="flex items-center justify-end gap-1">
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
                          <Trash2 className="size-4" />
                        </IconButton>
                      }
                    />
                  </div>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      )}

      {!loading && nodes.length === 0 && !error && (
        <p className="text-fg-muted" data-testid="categories-empty">
          {t("catalog.categories.empty")}
        </p>
      )}
    </div>
  );
}
