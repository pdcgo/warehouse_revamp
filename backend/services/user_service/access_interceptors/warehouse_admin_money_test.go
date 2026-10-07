package access_interceptors

import (
	"slices"
	"testing"

	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"

	_ "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	_ "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
)

// the-warehouse-admin-equals-the-owner-except-money: the warehouse Admin does what the Owner does, except three
// money acts — the liability terms, transfers between accounts, and capital. Recording, confirming and rejecting a
// payment, and reconciling, stay open to the Admin.
func TestWarehouseAdmin_HoldsEverythingButTheOwnersMoneyActs(t *testing.T) {
	ownerOnly := []string{
		"warehouse.liability.v1.LiabilityTermsSetRequest",
		"warehouse.liability.v1.LiabilityTermsDeleteRequest",
		"warehouse.financial_account.v1.FinancialAccountTransferRequest",
		"warehouse.financial_account.v1.FinancialAccountCapitalRequest",
	}

	stillTheAdmins := []string{
		"warehouse.liability.v1.LiabilityPaymentRecordRequest",
		"warehouse.liability.v1.LiabilityPaymentConfirmRequest",
		"warehouse.liability.v1.LiabilityPaymentRejectRequest",
		"warehouse.financial_account.v1.FinancialAccountReconcileRequest",
		"warehouse.financial_account.v1.FinancialAccountCreateRequest",
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

	for _, name := range ownerOnly {
		got := roles(name)

		if slices.Contains(got, role_basev1.Role_ROLE_WAREHOUSE_ADMIN) {
			t.Errorf("%s is open to the warehouse Admin — it is the Owner's", name)
		}

		if !slices.Contains(got, role_basev1.Role_ROLE_WAREHOUSE_OWNER) {
			t.Errorf("%s is closed to the warehouse Owner too", name)
		}

		// The decision is about the warehouse Admin only; the selling Admin keeps these.
		if !slices.Contains(got, role_basev1.Role_ROLE_SELLING_ADMIN) {
			t.Errorf("%s lost the selling Admin, which the decision does not cover", name)
		}
	}

	for _, name := range stillTheAdmins {
		if !slices.Contains(roles(name), role_basev1.Role_ROLE_WAREHOUSE_ADMIN) {
			t.Errorf("%s is closed to the warehouse Admin — it should stay open", name)
		}
	}
}
