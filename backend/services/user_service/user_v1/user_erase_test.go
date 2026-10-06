package user_v1_test

import (
	"fmt"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

func erase(userID uint64) *connect.Request[userv1.UserEraseRequest] {
	return connect.NewRequest(&userv1.UserEraseRequest{UserId: userID})
}

func readUser(t *testing.T, db *gorm.DB, id uint64) user_service_models.User {
	t.Helper()

	var u user_service_models.User

	err := db.Where("id = ?", id).Take(&u).Error
	if err != nil {
		t.Fatalf("read user %d: %v", id, err)
	}

	return u
}

// erase-keeps-the-row: the personal data is blanked, the row and its memberships stay, and the account can never
// sign in again — an empty password hash never matches.
func TestUserErase_BlanksTheDataAndKeepsTheRow(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	ani := memberOf(t, db, "eraseani", whTeam, role_basev1.Role_ROLE_WAREHOUSE_STAFF)
	db.Model(&user_service_models.User{}).Where("id = ?", ani).Updates(map[string]any{
		"name": "Ani Wijaya", "phone_number": "081234567890", "avatar_url": "https://x/ani.png", "is_suspended": true,
	})

	_, err := svc.UserErase(asRoot(t, db), erase(ani))
	if err != nil {
		t.Fatalf("UserErase: %v", err)
	}

	u := readUser(t, db, ani)

	if u.Username != fmt.Sprintf("erased%d", ani) {
		t.Errorf("username = %q, want erased%d", u.Username, ani)
	}

	if u.Name != "" || u.Email != "" || u.PhoneNumber != "" || u.AvatarURL != "" || u.Password != "" {
		t.Errorf("personal data left: name %q email %q phone %q avatar %q password set %v",
			u.Name, u.Email, u.PhoneNumber, u.AvatarURL, u.Password != "")
	}

	if u.LastPasswordReset == nil {
		t.Error("last_password_reset not stamped — the account's tokens would stay valid")
	}

	if !u.IsSuspended {
		t.Error("an erased account must stay suspended")
	}

	if role := roleOf(t, db, whTeam, ani); role != role_basev1.Role_ROLE_WAREHOUSE_STAFF {
		t.Errorf("the membership is gone (%v) — a former member is still the person behind the team's history", role)
	}
}

// Only a FORMER user: an active account is refused, and nothing is blanked.
func TestUserErase_OnlyASuspendedAccount(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	budi := insertUser(t, db, "erasebudi", "pw12345678")

	_, err := svc.UserErase(asRoot(t, db), erase(budi))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("code = %v, want FailedPrecondition", connect.CodeOf(err))
	}

	if u := readUser(t, db, budi); u.Username != "erasebudi" || u.Password == "" {
		t.Error("a refused erase blanked the account")
	}
}

// The people who may suspend an account may erase it: the Administrator never erases another Administrator,
// Root does.
func TestUserErase_OnlyRootErasesAnAdministrator(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	other := memberOf(t, db, "eraseadmin", san_auth.RootTeamID, role_basev1.Role_ROLE_ADMINISTRATOR)
	db.Model(&user_service_models.User{}).Where("id = ?", other).Update("is_suspended", true)

	_, err := svc.UserErase(asAdministrator(t, db), erase(other))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("the Administrator erasing an Administrator: code = %v, want PermissionDenied", connect.CodeOf(err))
	}

	_, err = svc.UserErase(asRoot(t, db), erase(other))
	if err != nil {
		t.Fatalf("Root erasing an Administrator: %v", err)
	}
}

func TestUserErase_UnknownIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	_, err := svc.UserErase(asRoot(t, db), erase(9_999_999))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("code = %v, want NotFound", connect.CodeOf(err))
	}
}
