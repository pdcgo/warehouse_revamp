import { useCallback, useEffect, useState } from "react";
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
import { categoryClient, rpcError } from "../api/clients";
import type { Category } from "../gen/warehouse/category/v1/category_pb";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { toaster } from "../components/Toaster";
import { flattenTree } from "./categoryTree";
import { CreateCategoryDialog } from "./CreateCategoryDialog";
import { EditCategoryDialog } from "./EditCategoryDialog";

// CategoriesPage manages the GLOBAL, nested category taxonomy — a single shared tree curated by
// root/admin (see the nav gate). It is not team-scoped, so unlike ProductsPage there is no current
// team in play: the list is flat on the wire and flattenTree assembles the indented tree here.
export function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const res = await categoryClient.categoryList({});
      setCategories(res.categories);
    } catch (err) {
      setError(rpcError(err));
      setCategories([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(category: Category) {
    try {
      await categoryClient.categoryDelete({ categoryId: category.id });
      toaster.create({ type: "success", title: `Category "${category.name}" deleted` });
      await load();
    } catch (err) {
      // The backend refuses to delete a category that still has sub-categories (FailedPrecondition);
      // surface that message rather than pretending it worked.
      toaster.create({ type: "error", title: "Delete failed", description: rpcError(err) });
    }
  }

  const nodes = flattenTree(categories);

  return (
    <Stack gap="section">
      <Flex align="center" gap="card">
        <Heading size="md">Categories</Heading>
        <Spacer />
        <CreateCategoryDialog onDone={() => void load()} />
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
              <Table.ColumnHeader>Name</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">Actions</Table.ColumnHeader>
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
                    <EditCategoryDialog category={category} onDone={() => void load()} />

                    <ConfirmDialog
                      title="Delete Category"
                      message={`Delete "${category.name}"? This cannot be undone.`}
                      confirmLabel="Delete"
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
          No categories yet.
        </Text>
      )}
    </Stack>
  );
}
