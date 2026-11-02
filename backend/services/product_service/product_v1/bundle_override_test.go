package product_v1_test

import (
	"testing"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
)

// AN OVERRIDE IS STAMPED (an-override-is-stamped-in-every-service): a bundle Root makes from outside the team says so;
// one the team's own CS makes does not. The scope rides in ctx as the interceptor leaves it.
func TestBundleCreate_StampsAnOverride(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	beras := insertProduct(t, db, melati, "BRS", "Beras")

	root := san_auth.WithScope(asPerson(1, role_basev1.Role_ROLE_UNSPECIFIED), melati)
	cs := san_auth.WithScope(asPerson(ani, role_basev1.Role_ROLE_SELLING_CS), melati)

	byRoot := createBundle(t, svc, root, melati, "Paket Root", lines(beras, 1))
	byCS := createBundle(t, svc, cs, melati, "Paket CS", lines(beras, 2))

	for _, c := range []struct {
		name string
		id   uint64
		want bool
	}{{"Root's bundle", byRoot.GetId(), true}, {"the CS's bundle", byCS.GetId(), false}} {
		var row product_service_models.Bundle

		err := db.First(&row, c.id).Error
		if err != nil {
			t.Fatalf("read %s: %v", c.name, err)
		}

		if row.IsOverride != c.want {
			t.Errorf("%s: is_override = %v, want %v", c.name, row.IsOverride, c.want)
		}
	}
}
