package user_v1_test

import (
	"strings"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
	user_v1 "github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_v1"
)

func createWithPhone(t *testing.T, svc *user_v1.Service, db *gorm.DB, username, phone string) (*userv1.User, error) {
	t.Helper()

	res, err := svc.CreateUser(asRoot(t, db), connect.NewRequest(&userv1.CreateUserRequest{
		Username: username, Password: "password123", Name: username, Email: username + "@x.local", PhoneNumber: phone,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetUser(), nil
}

func storedPhone(t *testing.T, db *gorm.DB, userID uint64) string {
	t.Helper()

	var user user_service_models.User

	err := db.Where("id = ?", userID).First(&user).Error
	if err != nil {
		t.Fatalf("read user %d: %v", userID, err)
	}

	return user.PhoneNumber
}

// a-phone-is-saved-in-international-form: what is stored is the one form, whatever was typed.
func TestCreateUser_SavesThePhoneInInternationalForm(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	user, err := createWithPhone(t, svc, db, "anilestari", "0812-3456-7890")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	if got := storedPhone(t, db, user.GetId()); got != "+6281234567890" {
		t.Fatalf("stored %q, want +6281234567890", got)
	}

	if user.GetPhoneNumber() != "+6281234567890" {
		t.Fatalf("answered %q, want the stored form", user.GetPhoneNumber())
	}
}

// a-phone-has-8-to-15-digits and a-phone-starts-with-0-or-a-country-code: refused when typed, nothing written.
func TestCreateUser_RefusesWhatIsNotAPhone(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	for _, phone := range []string{"0811", "abc", "812-3456-7890"} {
		_, err := createWithPhone(t, svc, db, "x"+strings.NewReplacer("-", "", " ", "").Replace(phone), phone)
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("phone %q: %v, want InvalidArgument", phone, err)
		}
	}
}

// a-phone-or-email-belongs-to-one-account: the same number written another way is the same number, and the refusal
// says which field so the popup can offer to add that person instead.
func TestCreateUser_OneAccountPerPhoneAndEmail(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	_, err := createWithPhone(t, svc, db, "anilestari", "0812-3456-7890")
	if err != nil {
		t.Fatalf("first: %v", err)
	}

	_, err = createWithPhone(t, svc, db, "anirahma", "+62 812 3456 7890")
	if connect.CodeOf(err) != connect.CodeAlreadyExists || !strings.Contains(err.Error(), "phone number") {
		t.Fatalf("the same phone again: %v, want AlreadyExists naming the phone", err)
	}

	_, err = svc.CreateUser(asRoot(t, db), connect.NewRequest(&userv1.CreateUserRequest{
		Username: "anirahma", Password: "password123", Name: "Ani", Email: "AniLestari@X.local",
	}))
	if connect.CodeOf(err) != connect.CodeAlreadyExists || !strings.Contains(err.Error(), "email") {
		t.Fatalf("the same email in other case: %v, want AlreadyExists naming the email", err)
	}

	// One account holds the number, written either way.
	var count int64

	db.Model(&user_service_models.User{}).Where("phone_number = ?", "+6281234567890").Count(&count)

	if count != 1 {
		t.Fatalf("%d accounts hold the number, want 1", count)
	}
}

// The same rule on an edit, by an admin and on your own profile — and keeping your OWN number is no conflict.
func TestUpdate_OneAccountPerPhone(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	ani, err := createWithPhone(t, svc, db, "anilestari", "0812-3456-7890")
	if err != nil {
		t.Fatalf("ani: %v", err)
	}

	budi, err := createWithPhone(t, svc, db, "budisantoso", "0813-1111-2222")
	if err != nil {
		t.Fatalf("budi: %v", err)
	}

	taken := "62 812 3456 7890"

	_, err = svc.UpdateUser(asRoot(t, db), connect.NewRequest(&userv1.UpdateUserRequest{UserId: budi.GetId(), PhoneNumber: &taken}))
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("UpdateUser to Ani's number: %v, want AlreadyExists", err)
	}

	_, err = svc.UpdateProfile(ctxWithIdentity(budi.GetId(), "budisantoso"), connect.NewRequest(&userv1.UpdateProfileRequest{PhoneNumber: &taken}))
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("UpdateProfile to Ani's number: %v, want AlreadyExists", err)
	}

	// Ani re-saving her own number, written another way, is fine — and stored in the one form.
	own := "+62 (812) 3456-7890"

	_, err = svc.UpdateProfile(ctxWithIdentity(ani.GetId(), "anilestari"), connect.NewRequest(&userv1.UpdateProfileRequest{PhoneNumber: &own}))
	if err != nil {
		t.Fatalf("Ani keeping her number: %v", err)
	}

	bad := "0811"

	_, err = svc.UpdateUser(asRoot(t, db), connect.NewRequest(&userv1.UpdateUserRequest{UserId: ani.GetId(), PhoneNumber: &bad}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("UpdateUser to 0811: %v, want InvalidArgument", err)
	}

	if got := storedPhone(t, db, ani.GetId()); got != "+6281234567890" {
		t.Fatalf("Ani's stored phone %q, want +6281234567890", got)
	}
}
