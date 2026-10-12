package user_v1_test

import (
	"os"
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// dev-root-password-is-root1234 and the-migration-writes-the-dev-root-password: a freshly migrated database has a root
// that logs in as root / root1234, email root@pdc.com.
func TestDevRoot_AFreshDatabaseLogsInAsRoot1234(t *testing.T) {
	db := san_testdb.DB(t)

	var root user_service_models.User

	err := db.First(&root, 1).Error
	if err != nil {
		t.Fatalf("root: %v", err)
	}

	if root.Username != "root" || root.Email != "root@pdc.com" {
		t.Fatalf("root is %q / %q, want root / root@pdc.com", root.Username, root.Email)
	}

	err = bcrypt.CompareHashAndPassword([]byte(root.Password), []byte("root1234"))
	if err != nil {
		t.Fatalf("root1234 does not open the root account: %v", err)
	}
}

// ⚠ ONLY WHILE ROOT HAS NO PASSWORD: the migration's statements, run again over a root whose password was set, leave
// it — or a new deploy would reset a production root to a password that is public in this repository.
func TestDevRoot_ARootWithAPasswordKeepsIt(t *testing.T) {
	db := san_testdb.DB(t)

	raw, err := os.ReadFile("../db_migrations/00010_dev_root_password.sql")
	if err != nil {
		t.Fatalf("the migration: %v", err)
	}

	up := strings.SplitN(string(raw), "-- +goose Down", 2)[0]

	err = db.Exec(`UPDATE users SET password = 'operator-set-hash', email = 'ops@example.test' WHERE id = 1`).Error
	if err != nil {
		t.Fatalf("set root's password: %v", err)
	}

	err = db.Exec(up).Error
	if err != nil {
		t.Fatalf("run the migration's Up: %v", err)
	}

	var root user_service_models.User

	db.First(&root, 1)

	if root.Password != "operator-set-hash" || root.Email != "ops@example.test" {
		t.Fatalf("the migration overwrote a root that was set: password %q, email %q", root.Password, root.Email)
	}
}
