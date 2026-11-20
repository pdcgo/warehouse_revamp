package inventory_v1_test

import (
	"slices"
	"testing"

	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
)

// THE CONTRACT'S LATER PHASES (backlog #88 P2–P3, P6) are all built — List and ReshipOptions (P2:
// custom_shipment_list_test.go, custom_shipment_reship_options_test.go), CostSet, Cancel, Picked and Handover (P3:
// custom_shipment_cost_set_test.go, custom_shipment_cancel_test.go, custom_shipment_picked_test.go,
// custom_shipment_handover_test.go), MissingReport (P6: custom_shipment_missing_report_test.go) — so none answers
// Unimplemented any more.

var (
	csSellingRoles = []role_basev1.Role{
		role_basev1.Role_ROLE_ROOT,
		role_basev1.Role_ROLE_ADMINISTRATOR,
		role_basev1.Role_ROLE_SELLING_OWNER,
		role_basev1.Role_ROLE_SELLING_ADMIN,
		role_basev1.Role_ROLE_SELLING_CS,
	}
	csWarehouseRoles = []role_basev1.Role{
		role_basev1.Role_ROLE_ROOT,
		role_basev1.Role_ROLE_ADMINISTRATOR,
		role_basev1.Role_ROLE_WAREHOUSE_OWNER,
		role_basev1.Role_ROLE_WAREHOUSE_ADMIN,
		role_basev1.Role_ROLE_WAREHOUSE_STAFF,
	}
	csEveryRole = append(slices.Clone(csSellingRoles), csWarehouseRoles[2:]...)
)

// WHO MAY. The owning selling team creates, edits the cost, cancels and asks what a reship can send — the roles that
// create an order (the-selling-team-asks-the-warehouse-ships: the build's default); the shipping warehouse, any member,
// picks and hands over; both sides read. Only the reads are side-effect free (a monitor and an agent may call them).
func TestCustomShipment_PoliciesFollowWhoAsksAndWhoShips(t *testing.T) {
	cases := []struct {
		rpc   string
		roles []role_basev1.Role
		read  bool
	}{
		{"CustomShipmentCreate", csSellingRoles, false},
		{"CustomShipmentList", csEveryRole, true},
		{"CustomShipmentDetail", csEveryRole, true},
		{"CustomShipmentCostSet", csSellingRoles, false},
		{"CustomShipmentCancel", csSellingRoles, false},
		{"CustomShipmentPicked", csWarehouseRoles, false},
		{"CustomShipmentHandover", csWarehouseRoles, false},
		{"CustomShipmentReshipOptions", csSellingRoles, true},
		// P6: the shipping warehouse's roles that pick note goods missing — a write (a trail row), never a monitor's.
		{"CustomShipmentMissingReport", csWarehouseRoles, false},
	}

	for _, c := range cases {
		desc, err := protoregistry.GlobalFiles.FindDescriptorByName(protoreflect.FullName("warehouse.inventory.v1." + c.rpc + "Request"))
		if err != nil {
			t.Fatalf("%s: descriptor: %v", c.rpc, err)
		}

		policy := san_auth.PolicyOf(desc.(protoreflect.MessageDescriptor))
		if policy == nil {
			t.Fatalf("%s has no policy", c.rpc)
		}

		got := slices.Clone(policy.GetRoles())
		want := slices.Clone(c.roles)
		slices.Sort(got)
		slices.Sort(want)

		if !slices.Equal(got, want) {
			t.Fatalf("%s roles = %v, want exactly %v", c.rpc, got, want)
		}

		m, err := protoregistry.GlobalFiles.FindDescriptorByName(protoreflect.FullName("warehouse.inventory.v1.CustomShipmentService." + c.rpc))
		if err != nil {
			t.Fatalf("%s: method: %v", c.rpc, err)
		}

		opts, _ := m.(protoreflect.MethodDescriptor).Options().(*descriptorpb.MethodOptions)
		if read := opts.GetIdempotencyLevel() == descriptorpb.MethodOptions_NO_SIDE_EFFECTS; read != c.read {
			t.Fatalf("%s side-effect free = %v, want %v", c.rpc, read, c.read)
		}
	}
}
