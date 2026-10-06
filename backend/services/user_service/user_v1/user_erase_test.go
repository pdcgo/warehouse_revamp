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
	user_v1 "github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_v1"
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

// erasedAccount makes a member of whTeam, suspends and erases them as Root, and returns their id.
func erasedAccount(t *testing.T, db *gorm.DB, svc *user_v1.Service, username string) uint64 {
	t.Helper()

	id := memberOf(t, db, username, whTeam, role_basev1.Role_ROLE_WAREHOUSE_STAFF)
	db.Model(&user_service_models.User{}).Where("id = ?", id).Update("is_suspended", true)

	_, err := svc.UserErase(asRoot(t, db), erase(id))
	if err != nil {
		t.Fatalf("UserErase: %v", err)
	}

	return id
}

// an-erased-account-is-final: the account is marked, and nothing brings it or its data back — not an unsuspend, not
// a password, not a team, not an edit. Only Root asks here, who may do all of those to a live account.
func TestUserErase_AnErasedAccountIsFinal(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	root := asRoot(t, db)

	gone := erasedAccount(t, db, svc, "finalgone")

	if readUser(t, db, gone).ErasedAt == nil {
		t.Fatal("erased_at not set — the account would be known as erased only by its name")
	}

	name := "Back Again"
	refused := map[string]error{}

	_, refused["unsuspend"] = svc.SuspendUser(root, connect.NewRequest(&userv1.SuspendUserRequest{UserId: gone, Suspended: false}))
	_, refused["a password"] = svc.AdminResetPassword(root, connect.NewRequest(&userv1.AdminResetPasswordRequest{UserId: gone, NewPassword: "newpassword1"}))
	_, refused["an edit"] = svc.UpdateUser(root, connect.NewRequest(&userv1.UpdateUserRequest{UserId: gone, Name: &name}))
	_, refused["a team"] = svc.TeamUserUpdate(root, add(sellTeam, gone, role_basev1.Role_ROLE_SELLING_CS))

	for what, err := range refused {
		if connect.CodeOf(err) != connect.CodeFailedPrecondition {
			t.Errorf("%s for an erased account: code = %v, want FailedPrecondition", what, connect.CodeOf(err))
		}
	}

	u := readUser(t, db, gone)
	if !u.IsSuspended || u.Password != "" || u.Name != "" {
		t.Errorf("an erased account came back: suspended %v, password set %v, name %q", u.IsSuspended, u.Password != "", u.Name)
	}

	// Still allowed: taking a former member out of a team, and erasing again (which retries the photos).
	_, err := svc.TeamUserUpdate(root, remove(whTeam, gone))
	if err != nil {
		t.Errorf("removing an erased member: %v", err)
	}

	_, err = svc.UserErase(root, erase(gone))
	if err != nil {
		t.Errorf("erasing again: %v", err)
	}
}

// erased-usernames-are-reserved: erased and digits is erase's name and nobody else's — refused at create and at
// rename; a name that only starts with "erased" is fine.
func TestUserErase_ErasedUsernamesAreReserved(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	root := asRoot(t, db)

	_, err := svc.CreateUser(root, connect.NewRequest(&userv1.CreateUserRequest{
		Username: "erased57", Password: "pw12345678", Name: "Squatter",
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("creating erased57: code = %v, want InvalidArgument", connect.CodeOf(err))
	}

	ani := insertUser(t, db, "reservedani", "pw12345678")
	rename := "erased12"

	_, err = svc.UpdateUser(root, connect.NewRequest(&userv1.UpdateUserRequest{UserId: ani, Username: &rename}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("renaming to erased12: code = %v, want InvalidArgument", connect.CodeOf(err))
	}

	fine := "erasedani"

	_, err = svc.UpdateUser(root, connect.NewRequest(&userv1.UpdateUserRequest{UserId: ani, Username: &fine}))
	if err != nil {
		t.Errorf("renaming to erasedani: %v", err)
	}
}
