package access_interceptors

import (
	"slices"
	"testing"

	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"

	_ "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
)

// the-product-writes-drop-the-warehouse-roles: a warehouse owns no product (only-a-selling-team-owns-a-catalogue), so
// no warehouse role may create, edit, archive or restore one — while the reads stay open to it, because a warehouse
// sees the products it stocks. A selling role is held only in a selling team (member_rules.go), so with the warehouse
// roles gone a team-scoped write can only land in a selling team; root and the administrator keep their bypass.
func TestProductWrites_AreTheSellingTeamsAlone(t *testing.T) {
	writes := []string{
		"warehouse.product.v1.ProductCreateRequest",
		"warehouse.product.v1.ProductUpdateRequest",
		"warehouse.product.v1.ProductDeleteRequest",
		"warehouse.product.v1.ProductRestoreRequest",
	}

	reads := []string{
		"warehouse.product.v1.ProductListRequest",
		"warehouse.product.v1.ProductDetailRequest",
		"warehouse.product.v1.ProductByIdsRequest",
	}

	warehouseRoles := []role_basev1.Role{
		role_basev1.Role_ROLE_WAREHOUSE_OWNER,
		role_basev1.Role_ROLE_WAREHOUSE_ADMIN,
	}

	roles := func(name string) []role_basev1.Role {
		t.Helper()

		desc, err := protoregistry.GlobalFiles.FindDescriptorByName(protoreflect.FullName(name))
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}

		policy := san_auth.PolicyOf(desc.(protoreflect.MessageDescriptor))
		if policy == nil {
			t.Fatalf("%s has no policy", name)
		}

		return policy.GetRoles()
	}

	for _, name := range writes {
		got := roles(name)

		for _, role := range warehouseRoles {
			if slices.Contains(got, role) {
				t.Errorf("%s is open to %s — a warehouse owns no product", name, role)
			}
		}

		if !slices.Contains(got, role_basev1.Role_ROLE_SELLING_OWNER) {
			t.Errorf("%s is closed to the selling Owner", name)
		}
	}

	for _, name := range reads {
		got := roles(name)

		for _, role := range warehouseRoles {
			if !slices.Contains(got, role) {
				t.Errorf("%s is closed to %s — a warehouse still reads the products it stocks", name, role)
			}
		}
	}
}
