package selling_v1

// SetOrderCommitResult installs the test seam over the order transaction's result (backlog #10c): `f` is handed what the
// transaction returned and its answer is what placeOrder sees — a test returns an error after a commit that landed.
func SetOrderCommitResult(s *Service, f func(error) error) {
	s.orderCommitResult = f
}
