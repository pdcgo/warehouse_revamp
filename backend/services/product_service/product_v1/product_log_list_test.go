package product_v1_test

import (
	"context"
	"errors"
	"slices"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// THE PRODUCT'S HISTORY (backlog #149): the lines a team code change writes, newest first, paged; the owning team's — a
// product of another team is NotFound, an archived one answers.
func TestProductLogList_NewestFirstPagedTheTeamsOwn(t *testing.T) {
	db := san_testdb.DB(t)
	svc := rcService(db, &fakeStock{})

	id := insertProduct(t, db, rcTeam, "PL-A-SHOE", "Sepatu")
	theirs := insertProduct(t, db, rcOther, "PL-Z-SHOE", "Bukan kita")

	for _, step := range [][2]string{{"PL-A", "PL-B"}, {"PL-B", "PL-C"}, {"PL-C", "PL-D"}} {
		_, err := svc.RecomposeTeamCodes(context.Background(), db, rcTeam, step[0], step[1], rcActor)
		if err != nil {
			t.Fatal(err)
		}
	}

	rcArchive(t, db, id)

	list := func(teamID, productID uint64, page, limit uint32) (*productv1.ProductLogListResponse, error) {
		resp, err := svc.ProductLogList(context.Background(), connect.NewRequest(&productv1.ProductLogListRequest{
			TeamId:    teamID,
			ProductId: productID,
			Page:      &commonv1.CommonPagination{Page: page, Limit: limit},
		}))
		if err != nil {
			return nil, err
		}

		return resp.Msg, nil
	}

	first, err := list(rcTeam, id, 1, 2)
	if err != nil {
		t.Fatal(err)
	}

	var olds []string
	for _, l := range first.GetLogs() {
		olds = append(olds, l.GetOldCode()+"→"+l.GetNewCode())
	}

	if !slices.Equal(olds, []string{"PL-C-SHOE→PL-D-SHOE", "PL-B-SHOE→PL-C-SHOE"}) {
		t.Errorf("page 1 = %v, want the newest two", olds)
	}

	if first.GetPageInfo().GetTotalItems() != 3 || first.GetPageInfo().GetTotalPage() != 2 {
		t.Errorf("page info = %+v, want 3 items over 2 pages", first.GetPageInfo())
	}

	line := first.GetLogs()[0]
	if line.GetKind() != productv1.ProductLogKind_PRODUCT_LOG_KIND_CODE_CHANGED || line.GetActorId() != 41 || !line.GetIsOverride() ||
		line.GetCreatedAtUnix() == 0 || line.GetProductId() != id {
		t.Errorf("line = %+v, want code_changed by 41 (override), dated", line)
	}

	second, err := list(rcTeam, id, 2, 2)
	if err != nil {
		t.Fatal(err)
	}

	if len(second.GetLogs()) != 1 || second.GetLogs()[0].GetOldCode() != "PL-A-SHOE" {
		t.Errorf("page 2 = %+v, want the first change alone", second.GetLogs())
	}

	// Another team's product reads as one that does not exist — and so does a product of no team.
	for _, ask := range [][2]uint64{{rcTeam, theirs}, {rcTeam, 987654321}} {
		_, err = list(ask[0], ask[1], 1, 10)

		var connectErr *connect.Error
		if !errors.As(err, &connectErr) || connectErr.Code() != connect.CodeNotFound {
			t.Errorf("team %d asking product %d: err = %v, want NotFound", ask[0], ask[1], err)
		}
	}

	// A product with no history answers an empty page.
	empty, err := list(rcOther, theirs, 1, 10)
	if err != nil || len(empty.GetLogs()) != 0 || empty.GetPageInfo().GetTotalItems() != 0 {
		t.Errorf("a product with no history: %v, %+v", err, empty)
	}
}

// WHO READS A PRODUCT'S HISTORY: the owning team — its Owner, Admin and CS — and Root / the Administrator; never a
// warehouse (its product page draws none). Scoped and a read.
func TestProductLogList_Policy(t *testing.T) {
	roles, scoped, read := ptPolicy(t, "ProductLogListRequest", "ProductLogList")

	want := []role_basev1.Role{
		role_basev1.Role_ROLE_ROOT,
		role_basev1.Role_ROLE_ADMINISTRATOR,
		role_basev1.Role_ROLE_SELLING_OWNER,
		role_basev1.Role_ROLE_SELLING_ADMIN,
		role_basev1.Role_ROLE_SELLING_CS,
	}

	if !slices.Equal(roles, want) || !scoped || !read {
		t.Errorf("roles %v scoped %v read %v, want %v scoped read", roles, scoped, read, want)
	}
}
