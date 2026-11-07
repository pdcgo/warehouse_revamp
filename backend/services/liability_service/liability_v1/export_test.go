package liability_v1

// Test seams for the external test package: the record's owes-check, run inside a raceaudit interleaving's own
// transaction, and the refusal it returns.
var (
	PayerOwes       = payerOwes
	ErrNothingToPay = errNothingToPay
)
