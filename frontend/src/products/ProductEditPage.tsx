import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Button,
  Card,
  Field,
  Flex,
  Heading,
  Icon,
  IconButton,
  Input,
  Spinner,
  Stack,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";
import { productClient, rpcError } from "../api/clients";
import { useTeam } from "../team/TeamContext";
import { CategorySelect } from "../categories/CategorySelect";
import { toaster } from "../components/Toaster";
import { ProductImagesInput } from "./ProductImagesInput";
import type { ProductImageValue } from "./ProductImagesInput";

// ProductEditPage is the create/edit surface for a product as a DEDICATED PAGE, not a popup
// (issue #60) — because it now carries a category and a gallery of up to 5 images, which need room.
// One component serves both /products/new (create) and /products/:productId/edit (edit); the
// presence of :productId decides which.
export function ProductEditPage() {
  const { productId } = useParams<{ productId: string }>();
  const editing = productId !== undefined;
  const { current } = useTeam();
  const navigate = useNavigate();

  const teamId = current?.teamId;

  const [loading, setLoading] = useState(editing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState<bigint>(0n);
  const [images, setImages] = useState<ProductImageValue[]>([]);

  // On edit, load the full product (including its ordered gallery) so the form is pre-filled and the
  // page is deep-linkable.
  useEffect(() => {
    if (!editing || teamId === undefined) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const res = await productClient.productDetail({ teamId, productId: BigInt(productId) });
        const p = res.product;

        if (!cancelled && p) {
          setSku(p.sku);
          setName(p.name);
          setDescription(p.description);
          setCategoryId(p.categoryId);
          setImages(p.images.map((im) => ({ url: im.url, thumbnailUrl: im.thumbnailUrl })));
        }
      } catch (err) {
        if (!cancelled) {
          setError(rpcError(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [editing, productId, teamId]);

  async function save(event: FormEvent) {
    event.preventDefault();

    if (teamId === undefined) {
      return;
    }

    setSaving(true);
    setError("");

    try {
      if (editing) {
        await productClient.productUpdate({
          teamId,
          productId: BigInt(productId),
          sku,
          name,
          description,
          categoryId,
          // A present wrapper REPLACES the gallery with exactly this set.
          images: { items: images },
        });
      } else {
        await productClient.productCreate({ teamId, sku, name, description, categoryId, images });
      }

      toaster.create({ type: "success", title: editing ? "Product saved" : `Product "${sku}" created` });
      void navigate("/products");
    } catch (err) {
      setError(rpcError(err));
    } finally {
      setSaving(false);
    }
  }

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">Products</Heading>
        <Text color="fg.muted" data-testid="product-edit-no-team">
          Select a team to manage its products.
        </Text>
      </Stack>
    );
  }

  if (loading) {
    return <Spinner colorPalette="brand" />;
  }

  // Category is required; SKU and name too. The backend enforces all three regardless.
  const canSave = sku.trim() !== "" && name.trim() !== "" && categoryId > 0n;

  return (
    <Stack gap="section" maxW="2xl" data-testid="product-edit-page">
      <Flex align="center" gap="card">
        <IconButton
          size="xs"
          variant="ghost"
          aria-label="Back"
          data-testid="product-edit-back"
          onClick={() => navigate("/products")}
        >
          <Icon as={ArrowLeft} boxSize="4" />
        </IconButton>
        <Heading size="md">{editing ? "Edit Product" : "New Product"}</Heading>
      </Flex>

      {error && (
        <Text color="red.fg" data-testid="product-edit-error">
          {error}
        </Text>
      )}

      <form onSubmit={save} noValidate>
        <Stack gap="section">
          <Card.Root>
            <Card.Body>
              <Stack gap="card">
                <Field.Root required>
                  <Field.Label>SKU</Field.Label>
                  <Input value={sku} data-testid="product-edit-sku" onChange={(e) => setSku(e.target.value)} />
                </Field.Root>

                <Field.Root required>
                  <Field.Label>Name</Field.Label>
                  <Input value={name} data-testid="product-edit-name" onChange={(e) => setName(e.target.value)} />
                </Field.Root>

                <Field.Root>
                  <Field.Label>Description</Field.Label>
                  <Textarea
                    value={description}
                    data-testid="product-edit-description"
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </Field.Root>

                <Field.Root required>
                  <Field.Label>Category</Field.Label>
                  <CategorySelect
                    value={categoryId}
                    onChange={setCategoryId}
                    placeholder="Select a category"
                    leafOnly
                  />
                  <Field.HelperText>Every product is filed under an end category.</Field.HelperText>
                </Field.Root>
              </Stack>
            </Card.Body>
          </Card.Root>

          <Card.Root>
            <Card.Body>
              <Stack gap="card">
                <Text fontWeight="medium">Images</Text>
                <ProductImagesInput teamId={teamId ?? 0n} value={images} onChange={setImages} />
              </Stack>
            </Card.Body>
          </Card.Root>

          <Flex justify="end">
            <Button
              type="submit"
              colorPalette="brand"
              loading={saving}
              disabled={!canSave}
              data-testid="product-edit-save"
            >
              {editing ? "Save" : "Create"}
            </Button>
          </Flex>
        </Stack>
      </form>
    </Stack>
  );
}
