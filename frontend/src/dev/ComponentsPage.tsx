import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, Flex, Heading, Link, SimpleGrid, Stack, Text } from "@chakra-ui/react";
// Each curated component exports its OWN description (a rule — see CLAUDE.md). The gallery reads
// them here so it is documentation generated from the components themselves, not a parallel list
// that can drift.
import { PasswordInput, description as passwordInputDescription } from "../components/PasswordInput";
import { Pagination, description as paginationDescription } from "../components/Pagination";
import { UserItem, description as userItemDescription } from "../components/UserItem";
import { TeamItem, description as teamItemDescription } from "../components/TeamItem";
import { ProductListItem, description as productListItemDescription } from "../components/ProductListItem";
import { ProductCard, description as productCardDescription } from "../components/ProductCard";
import { TeamTypeSelect, description as teamTypeSelectDescription } from "../components/TeamTypeSelect";
import { TeamSelect, description as teamSelectDescription } from "../components/TeamSelect";
import { UserSelect, description as userSelectDescription } from "../components/UserSelect";
import { RoleSelect, description as roleSelectDescription } from "../components/RoleSelect";
import { Role } from "../gen/warehouse/role_base/v1/role_pb";
import { roleLabel } from "../lib/roles";
import { TeamType } from "../gen/warehouse/team/v1/team_pb";
import { ShippingSelect, description as shippingSelectDescription } from "../shipping/ShippingSelect";
import { CategorySelect, description as categorySelectDescription } from "../categories/CategorySelect";
import {
  MarketplaceSelect,
  marketplaceLabel,
  description as marketplaceSelectDescription,
} from "../components/MarketplaceSelect";
import { MarketplaceBadge, description as marketplaceBadgeDescription } from "../components/MarketplaceBadge";
import {
  PaymentTypeSelect,
  paymentTypeLabel,
  description as paymentTypeSelectDescription,
} from "../components/PaymentTypeSelect";
import { ShippingBadge, description as shippingBadgeDescription } from "../components/ShippingBadge";
import { OrderStatusBadge, description as orderStatusBadgeDescription } from "../components/OrderStatusBadge";
import {
  RestockStatusBadge,
  description as restockStatusBadgeDescription,
} from "../components/RestockStatusBadge";
import { ShopSelect, description as shopSelectDescription } from "../components/ShopSelect";
import { SupplierSelect, description as supplierSelectDescription } from "../components/SupplierSelect";
import { CurrencyInput, description as currencyInputDescription } from "../components/CurrencyInput";
import { RackSelect, UNPLACED, description as rackSelectDescription } from "../components/RackSelect";
import {
  ProductSelect,
  description as productSelectDescription,
  type PickedProduct,
} from "../components/ProductSelect";
import { ProductPicker, description as productPickerDescription } from "../components/ProductPicker";
import {
  AddressPicker,
  emptyAddress,
  description as addressPickerDescription,
  type AddressValue,
} from "../components/AddressPicker";
import { Marketplace } from "../gen/warehouse/marketplace/v1/marketplace_pb";
import { OrderStatus } from "../gen/warehouse/selling/v1/order_pb";
import { RestockPaymentType, RestockRequestStatus } from "../gen/warehouse/inventory/v1/restock_request_pb";
import { useTeam } from "../team/TeamContext";

// Each shared component is one entry: a stable id (also the scroll anchor), a title, a description,
// and a live render. The left list and the cards are both driven from this array, so they can't
// drift.
interface Entry {
  id: string;
  title: string;
  description: string;
  render: () => ReactNode;
}

function PasswordDemo() {
  const [value, setValue] = useState("");

  return (
    <PasswordInput value={value} placeholder="Password" onChange={(e) => setValue(e.target.value)} />
  );
}

function PaginationDemo() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  return (
    <Stack gap="1">
      <Pagination
        count={45}
        pageSize={pageSize}
        page={page}
        onPageChange={setPage}
        pageSizeOptions={[10, 20, 50]}
        onPageSizeChange={(n) => {
          setPageSize(n);
          setPage(1);
        }}
      />
      <Text fontSize="xs" color="fg.muted">
        45 items · {pageSize} per page · page {page}
      </Text>
    </Stack>
  );
}

function ShippingDemo() {
  const [code, setCode] = useState("");

  return (
    <>
      <ShippingSelect value={code} onChange={setCode} />
      <Text fontSize="xs" color="fg.muted">
        Selected code: {code || "(none)"}
      </Text>
    </>
  );
}

function CategoryDemo() {
  const [id, setId] = useState(0n);
  const [leafId, setLeafId] = useState(0n);

  return (
    <Stack gap="card">
      <Stack gap="1">
        <Text fontSize="xs" fontWeight="medium">
          Any category selectable (default)
        </Text>
        <CategorySelect value={id} onChange={setId} />
        <Text fontSize="xs" color="fg.muted">
          Selected id: {id.toString()}
        </Text>
      </Stack>

      <Stack gap="1">
        <Text fontSize="xs" fontWeight="medium">
          End categories only — <code>leafOnly</code>
        </Text>
        <CategorySelect value={leafId} onChange={setLeafId} leafOnly />
        <Text fontSize="xs" color="fg.muted">
          Selected id: {leafId.toString()}
        </Text>
      </Stack>
    </Stack>
  );
}

function TeamTypeDemo() {
  const [type, setType] = useState<TeamType>(TeamType.WAREHOUSE);

  return (
    <>
      <TeamTypeSelect value={type} onChange={setType} />
      <Text fontSize="xs" color="fg.muted">
        Selected type: {TeamType[type]}
      </Text>
    </>
  );
}

// Three examples, because `teamType` is the whole point of this picker (#111): unfiltered, and
// narrowed to each of the two team types you actually pick between.
function TeamSelectDemo() {
  const [all, setAll] = useState(0n);
  const [warehouse, setWarehouse] = useState(0n);
  const [selling, setSelling] = useState(0n);

  return (
    <Stack gap="card">
      <Stack gap="1">
        <Text fontSize="xs" fontWeight="medium">
          All teams (default) — no <code>teamType</code>
        </Text>
        <TeamSelect value={all || undefined} onChange={setAll} />
        <Text fontSize="xs" color="fg.muted">
          Selected team id: {all.toString()}
        </Text>
      </Stack>

      <Stack gap="1">
        <Text fontSize="xs" fontWeight="medium">
          Warehouse teams only — <code>teamType={"{TeamType.WAREHOUSE}"}</code>
        </Text>
        <TeamSelect teamType={TeamType.WAREHOUSE} value={warehouse || undefined} onChange={setWarehouse} />
        <Text fontSize="xs" color="fg.muted">
          Selected team id: {warehouse.toString()}
        </Text>
      </Stack>

      <Stack gap="1">
        <Text fontSize="xs" fontWeight="medium">
          Selling teams only — <code>teamType={"{TeamType.SELLING}"}</code>
        </Text>
        <TeamSelect teamType={TeamType.SELLING} value={selling || undefined} onChange={setSelling} />
        <Text fontSize="xs" color="fg.muted">
          Selected team id: {selling.toString()}
        </Text>
      </Stack>
    </Stack>
  );
}

function UserSelectDemo() {
  const [all, setAll] = useState(0n);
  const [scoped, setScoped] = useState(0n);
  const { current } = useTeam();

  return (
    <Stack gap="card">
      <Stack gap="1">
        <Text fontSize="xs" fontWeight="medium">
          All users (default)
        </Text>
        <UserSelect value={all || undefined} onChange={setAll} />
        <Text fontSize="xs" color="fg.muted">
          Selected user id: {all.toString()}
        </Text>
      </Stack>

      <Stack gap="1">
        <Text fontSize="xs" fontWeight="medium">
          Scoped to the current team{current ? ` (${current.teamName || `#${current.teamId}`})` : ""}
        </Text>
        <UserSelect
          value={scoped || undefined}
          onChange={setScoped}
          teamId={current?.teamId}
          placeholder="Search this team's members"
        />
        <Text fontSize="xs" color="fg.muted">
          Selected user id: {scoped.toString()}
        </Text>
      </Stack>
    </Stack>
  );
}

function RoleSelectDemo() {
  const [role, setRole] = useState<Role>(Role.UNSPECIFIED);

  return (
    <>
      <RoleSelect value={role || undefined} onChange={setRole} />
      <Text fontSize="xs" color="fg.muted">
        Selected role: {role ? roleLabel(role) : "(none)"}
      </Text>
    </>
  );
}

function MarketplaceDemo() {
  const [m, setM] = useState<Marketplace>(Marketplace.UNSPECIFIED);

  return (
    <>
      <MarketplaceSelect value={m} onChange={setM} />
      <Text fontSize="xs" color="fg.muted">
        Selected: {m ? marketplaceLabel(m) : "(none)"}
      </Text>
    </>
  );
}

// Unlike the other label helpers, paymentTypeLabel takes `t` — these labels are translated, so the
// demo resolves them through the gallery's own translator.
function PaymentTypeDemo() {
  const { t } = useTranslation();
  const [type, setType] = useState<RestockPaymentType>(RestockPaymentType.UNSPECIFIED);

  return (
    <>
      <PaymentTypeSelect value={type} onChange={setType} />
      <Text fontSize="xs" color="fg.muted">
        Selected: {paymentTypeLabel(t, type) || "(not recorded)"}
      </Text>
    </>
  );
}

function ShopSelectDemo() {
  const [id, setId] = useState(0n);
  const { current } = useTeam();

  return (
    <>
      <ShopSelect teamId={current?.teamId ?? 0n} value={id} onChange={setId} />
      <Text fontSize="xs" color="fg.muted">
        Selected shop id: {id.toString()}
        {current ? "" : " — select a selling team to load shops"}
      </Text>
    </>
  );
}

function CurrencyInputDemo() {
  const [amount, setAmount] = useState("");

  return (
    <>
      <CurrencyInput value={amount} onChange={setAmount} placeholder="0" />
      <Text fontSize="xs" color="fg.muted">
        {/* The RAW value is what the caller holds and what every parse sees — the grouping is display
            only, so nothing downstream has to strip a separator back off. */}
        Raw value sent to the caller: {amount === "" ? "(empty)" : amount}
      </Text>
    </>
  );
}

function SupplierSelectDemo() {
  const [id, setId] = useState(0n);
  const { current } = useTeam();

  return (
    <>
      <SupplierSelect teamId={current?.teamId ?? 0n} value={id} onChange={setId} />
      <Text fontSize="xs" color="fg.muted">
        Selected supplier id: {id.toString()}
        {current ? "" : " — select a team to load suppliers"}
      </Text>
    </>
  );
}

// The demo reads the selected place back in words, because the three states this picker
// distinguishes are exactly what is easy to get wrong: nothing chosen yet, the unplaced pile, and a
// rack. Only the first of those blocks a stock-take.
function RackSelectDemo() {
  const [place, setPlace] = useState("");
  const { current } = useTeam();

  return (
    <>
      <RackSelect warehouseId={current?.teamId ?? 0n} value={place} onChange={setPlace} />
      <Text fontSize="xs" color="fg.muted">
        {place === "" ? "No place chosen yet — a stock-take would be refused" : null}
        {place === UNPLACED ? "The unplaced pile (a real place)" : null}
        {place !== "" && place !== UNPLACED ? `Rack id: ${place}` : null}
        {current ? "" : " — select a warehouse team to load racks"}
      </Text>
    </>
  );
}

function ProductSelectDemo() {
  const [picked, setPicked] = useState<PickedProduct | null>(null);
  const { current } = useTeam();

  return (
    <>
      <ProductSelect
        teamId={current?.teamId ?? 0n}
        value={picked?.id}
        onChange={setPicked}
      />
      <Text fontSize="xs" color="fg.muted">
        Picked: {picked ? `${picked.sku} — ${picked.name}` : "(none)"}
        {current ? "" : " — select a team to search its catalogue"}
      </Text>
    </>
  );
}

function ProductPickerDemo() {
  const [scoped, setScoped] = useState<PickedProduct[]>([]);
  const [all, setAll] = useState<PickedProduct[]>([]);
  const { current } = useTeam();

  // Stock is per WAREHOUSE, so it can only be shown when the current team IS one — a selling team
  // has no stock of its own to show.
  const warehouseId = current?.teamType === TeamType.WAREHOUSE ? current.teamId : undefined;

  const summary = (picked: PickedProduct[]) =>
    picked.length > 0 ? picked.map((p) => p.sku || `#${p.id}`).join(", ") : "(none)";

  return (
    <>
      {/* `teamId` SET → only this team's catalogue. Passing 0n (not undefined) when there is no
          current team is deliberate: undefined would mean "all teams". */}
      <ProductPicker
        teamId={current?.teamId ?? 0n}
        stockWarehouseId={warehouseId}
        value={scoped.map((p) => p.id)}
        onChange={setScoped}
        trigger={<Button variant="outline">Select products (this team)</Button>}
      />
      <Text fontSize="xs" color="fg.muted">
        This team: {summary(scoped)}
        {current ? "" : " — select a team to browse its catalogue"}
        {warehouseId ? " · showing stock (this team is a warehouse)" : " · no stock (not a warehouse)"}
      </Text>

      {/* `teamId` UNSET → products from every team. The current team still rides along inside the
          picker to AUTHORIZE the discover call; it does not filter the results. */}
      <ProductPicker
        value={all.map((p) => p.id)}
        onChange={setAll}
        trigger={<Button variant="outline">Select products (all teams)</Button>}
      />
      <Text fontSize="xs" color="fg.muted">
        All teams: {summary(all)}
        {current ? "" : " — select a team to authorize discovery"}
      </Text>
    </>
  );
}

function AddressPickerDemo() {
  const [address, setAddress] = useState<AddressValue>(emptyAddress);

  return (
    <>
      <AddressPicker value={address} onChange={setAddress} />
      <Text fontSize="xs" color="fg.muted">
        Picked: {address.desaCode ? `${address.desaName} (${address.desaCode})` : "(no village yet)"}
        {address.kodePos ? ` · ${address.kodePos}` : ""}
      </Text>
    </>
  );
}

// A sample product cover for the gallery, inline as a data URI: the gallery is static sample data, so
// it must not depend on a network fetch to show what "has an image" looks like.
const SAMPLE_COVER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">` +
      `<rect width="64" height="64" fill="#3b82f6"/>` +
      `<circle cx="32" cy="25" r="11" fill="#fff" fill-opacity=".85"/>` +
      `<rect x="13" y="41" width="38" height="10" rx="3" fill="#fff" fill-opacity=".85"/>` +
      `</svg>`,
  );

const ENTRIES: Entry[] = [
  {
    id: "password-input",
    title: "PasswordInput",
    description: passwordInputDescription,
    render: () => <PasswordDemo />,
  },
  {
    id: "pagination",
    title: "Pagination",
    description: paginationDescription,
    render: () => <PaginationDemo />,
  },
  {
    id: "user-item",
    title: "UserItem",
    description: userItemDescription,
    render: () => (
      <>
        <UserItem user={{ name: "Ada Lovelace", username: "ada", avatarUrl: "" }} />
        <UserItem user={{ name: "", username: "no_name_user", avatarUrl: "" }} />
      </>
    ),
  },
  {
    id: "team-item",
    title: "TeamItem",
    description: teamItemDescription,
    render: () => (
      <>
        <TeamItem team={{ teamName: "Jakarta Warehouse", teamType: TeamType.WAREHOUSE }} />
        <TeamItem team={{ teamName: "Srengat Selling", teamType: TeamType.SELLING }} />
        <TeamItem team={{ teamName: "Root Team", teamType: TeamType.ROOT }} />
      </>
    ),
  },
  {
    id: "product-list-item",
    title: "ProductListItem",
    description: productListItemDescription,
    render: () => (
      <Stack gap="card">
        {/* Ready stock is the OPTIONAL half of the spec (#128), so all three states are here:
            in stock, zero (the case worth seeing), and omitted entirely. */}
        <ProductListItem
          product={{
            id: 1n,
            teamId: 7n,
            sku: "SKU-001",
            name: "Kaos Polos Hitam",
            defaultImageThumbnailUrl: SAMPLE_COVER,
          }}
          teamName="Srengat Selling"
          stock={42n}
        />
        <ProductListItem
          product={{
            id: 2n,
            teamId: 7n,
            sku: "SKU-002",
            name: "Celana Chino Navy",
            defaultImageThumbnailUrl: SAMPLE_COVER,
          }}
          teamName="Srengat Selling"
          stock={0n}
        />
        {/* No image at all → the package-icon placeholder. No `stock` → no badge. */}
        <ProductListItem
          product={{ id: 3n, teamId: 9n, sku: "SKU-003", name: "Topi Baseball Putih" }}
          teamName="Jakarta Warehouse"
        />
        {/* No `teamName` resolved by the caller → falls back to "Team #<id>". */}
        <ProductListItem product={{ id: 4n, teamId: 12n, sku: "SKU-004", name: "Tas Ransel Kanvas" }} stock={7n} />
      </Stack>
    ),
  },
  {
    id: "product-card",
    title: "ProductCard",
    description: productCardDescription,
    // In a grid, because that is the only place a card makes sense — and because equal card heights
    // across a row are half of what the component is for. Same four states as ProductListItem above,
    // so the two entries can be read against each other.
    render: () => (
      <SimpleGrid columns={{ base: 1, sm: 2, md: 3 }} gap="card">
        <ProductCard
          product={{
            id: 1n,
            teamId: 7n,
            sku: "SKU-001",
            name: "Kaos Polos Hitam",
            defaultImageUrl: SAMPLE_COVER,
          }}
          teamName="Srengat Selling"
          stock={42n}
        />
        <ProductCard
          product={{
            id: 2n,
            teamId: 7n,
            sku: "SKU-002",
            name: "Celana Chino Navy",
            defaultImageUrl: SAMPLE_COVER,
          }}
          teamName="Srengat Selling"
          stock={0n}
        />
        {/* No image at all → the package-icon placeholder. No `stock` → no badge. The long name also
            shows the two-line clamp, and that a taller card doesn't drag the row's covers out of line. */}
        <ProductCard
          product={{
            id: 3n,
            teamId: 9n,
            sku: "SKU-003",
            name: "Topi Baseball Putih Edisi Terbatas Dengan Bordir",
          }}
          teamName="Jakarta Warehouse"
        />
        {/* No `teamName` resolved by the caller → falls back to "Team #<id>". */}
        <ProductCard product={{ id: 4n, teamId: 12n, sku: "SKU-004", name: "Tas Ransel Kanvas" }} stock={7n} />
      </SimpleGrid>
    ),
  },
  {
    id: "shipping-select",
    title: "ShippingSelect",
    description: shippingSelectDescription,
    render: () => <ShippingDemo />,
  },
  {
    id: "category-select",
    title: "CategorySelect",
    description: categorySelectDescription,
    render: () => <CategoryDemo />,
  },
  {
    id: "team-type-select",
    title: "TeamTypeSelect",
    description: teamTypeSelectDescription,
    render: () => <TeamTypeDemo />,
  },
  {
    id: "marketplace-select",
    title: "MarketplaceSelect",
    description: marketplaceSelectDescription,
    render: () => <MarketplaceDemo />,
  },
  {
    id: "payment-type-select",
    title: "PaymentTypeSelect",
    description: paymentTypeSelectDescription,
    render: () => <PaymentTypeDemo />,
  },
  {
    id: "marketplace-badge",
    title: "MarketplaceBadge",
    description: marketplaceBadgeDescription,
    render: () => (
      <Flex gap="2" wrap="wrap">
        {[
          Marketplace.SHOPEE,
          Marketplace.TOKOPEDIA,
          Marketplace.LAZADA,
          Marketplace.TIKTOK,
          Marketplace.BLIBLI,
          Marketplace.BUKALAPAK,
          Marketplace.OTHER,
        ].map((m) => (
          <MarketplaceBadge key={m} marketplace={m} />
        ))}
      </Flex>
    ),
  },
  {
    id: "shipping-badge",
    title: "ShippingBadge",
    description: shippingBadgeDescription,
    render: () => (
      // The seeded catalogue, plus the two edge cases the map has to survive: a courier that isn't in
      // it (gray) and no courier at all ("—").
      <Flex gap="2" wrap="wrap" align="center">
        {[
          "jne",
          "jnt",
          "sicepat",
          "anteraja",
          "ninja",
          "pos",
          "tiki",
          "wahana",
          "lion",
          "idexpress",
          "sap",
          "ncs",
          "unknown-courier",
          "",
        ].map((code) => (
          <ShippingBadge key={code || "empty"} code={code} />
        ))}
      </Flex>
    ),
  },
  {
    id: "order-status-badge",
    title: "OrderStatusBadge",
    description: orderStatusBadgeDescription,
    render: () => (
      <Flex gap="2" wrap="wrap">
        {[OrderStatus.PLACED, OrderStatus.CONFIRMED, OrderStatus.CANCELLED].map((s) => (
          <OrderStatusBadge key={s} status={s} />
        ))}
      </Flex>
    ),
  },
  {
    id: "restock-status-badge",
    title: "RestockStatusBadge",
    description: restockStatusBadgeDescription,
    render: () => (
      <Flex gap="2" wrap="wrap">
        {[
          RestockRequestStatus.PENDING,
          RestockRequestStatus.FULFILLED,
          RestockRequestStatus.CANCELLED,
          RestockRequestStatus.UNSPECIFIED,
        ].map((s) => (
          <RestockStatusBadge key={s} status={s} />
        ))}
      </Flex>
    ),
  },
  {
    id: "shop-select",
    title: "ShopSelect",
    description: shopSelectDescription,
    render: () => <ShopSelectDemo />,
  },
  {
    id: "supplier-select",
    title: "SupplierSelect",
    description: supplierSelectDescription,
    render: () => <SupplierSelectDemo />,
  },
  {
    id: "currency-input",
    title: "CurrencyInput",
    description: currencyInputDescription,
    render: () => <CurrencyInputDemo />,
  },
  {
    id: "rack-select",
    title: "RackSelect",
    description: rackSelectDescription,
    render: () => <RackSelectDemo />,
  },
  {
    id: "product-select",
    title: "ProductSelect",
    description: productSelectDescription,
    render: () => <ProductSelectDemo />,
  },
  {
    id: "product-picker",
    title: "ProductPicker",
    description: productPickerDescription,
    render: () => <ProductPickerDemo />,
  },
  {
    id: "address-picker",
    title: "AddressPicker",
    description: addressPickerDescription,
    render: () => <AddressPickerDemo />,
  },
  {
    id: "team-select",
    title: "TeamSelect",
    description: teamSelectDescription,
    render: () => <TeamSelectDemo />,
  },
  {
    id: "user-select",
    title: "UserSelect",
    description: userSelectDescription,
    render: () => <UserSelectDemo />,
  },
  {
    id: "role-select",
    title: "RoleSelect",
    description: roleSelectDescription,
    render: () => <RoleSelectDemo />,
  },
];

// ComponentsPage is a live gallery of the app's reusable shared components (issue #34). A left list
// navigates between them; each card is anchored so the link scrolls straight to it.
export function ComponentsPage() {
  return (
    <Flex gap="section" align="start" data-testid="components-page">
      <Stack
        as="nav"
        gap="1"
        w="180px"
        flexShrink={0}
        position="sticky"
        top="page"
        display={{ base: "none", md: "flex" }}
      >
        <Text fontSize="xs" fontWeight="semibold" color="fg.muted" textTransform="uppercase" mb="1">
          Components
        </Text>
        {ENTRIES.map((entry) => (
          <Link
            key={entry.id}
            href={`#${entry.id}`}
            fontSize="sm"
            color="fg.muted"
            rounded="md"
            px="2"
            py="1.5"
            _hover={{ bg: "brand.subtle", color: "brand.fg", textDecoration: "none" }}
          >
            {entry.title}
          </Link>
        ))}
      </Stack>

      <Stack gap="section" flex="1" minW="0" maxW="2xl">
        <Stack gap="1">
          <Heading size="md">Shared components</Heading>
          <Text color="fg.muted">A live gallery of the app's reusable components.</Text>
        </Stack>

        {ENTRIES.map((entry) => (
          <Card.Root key={entry.id} id={entry.id} scrollMarginTop="page">
            <Card.Body>
              <Stack gap="card">
                <Stack gap="1">
                  <Heading size="sm">{entry.title}</Heading>
                  <Text fontSize="sm" color="fg.muted">
                    {entry.description}
                  </Text>
                </Stack>

                {entry.render()}
              </Stack>
            </Card.Body>
          </Card.Root>
        ))}
      </Stack>
    </Flex>
  );
}
