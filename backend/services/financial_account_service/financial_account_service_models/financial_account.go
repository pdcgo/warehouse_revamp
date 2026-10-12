package financial_account_service_models

import "time"

// The text values of `financial_accounts.type`, `.provider` and `.status` — the database's vocabulary,
// mapped to the proto enums in financial_account_v1/mapper.go.
const (
	TypeWallet      = "wallet"
	TypeBankAccount = "bank_account"
	TypeCash        = "cash"
	TypeUnknown     = "unknown"

	ProviderCash      = "cash"
	ProviderBCA       = "bca"
	ProviderBNI       = "bni"
	ProviderJago      = "jago"
	ProviderShopeePay = "shopeepay"
	ProviderUnknown   = "unknown"

	StatusActive   = "active"
	StatusArchived = "archived"
)

// FinancialAccount is a row of `financial_accounts` — one place a team holds money, and its balance.
// The schema is owned by goose (db_migrations); GORM only reads and writes rows.
//
// ⚠ Balance moves ONLY with a FinancialAccountLog row, in the same transaction (the-accounts-are-one-ledger)
// — never write it from anywhere but the ledger's post.
type FinancialAccount struct {
	ID            uint64 `gorm:"primaryKey"`
	TeamID        uint64
	Type          string
	Provider      string
	Status        string
	AccountNumber string
	Name          string
	HolderName    string
	Description   string
	Balance       float64 `gorm:"type:numeric(20,2)"`
	ReconciledAt  *time.Time
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

func (FinancialAccount) TableName() string {
	return "financial_accounts"
}
