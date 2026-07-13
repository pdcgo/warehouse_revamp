package san_auth

import (
	"fmt"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
)

// PolicyOf reads the (request_policy) option off a request message's descriptor.
//
// A nil result means NO POLICY, which the interceptor treats as DENY. That is deliberate:
// forgetting the option must fail closed, never open.
func PolicyOf(descriptor protoreflect.MessageDescriptor) *role_basev1.RequestPolicy {
	opts, ok := descriptor.Options().(*descriptorpb.MessageOptions)
	if !ok || opts == nil {
		return nil
	}

	if !proto.HasExtension(opts, role_basev1.E_RequestPolicy) {
		return nil
	}

	policy, _ := proto.GetExtension(opts, role_basev1.E_RequestPolicy).(*role_basev1.RequestPolicy)

	return policy
}

// scopeField finds the field tagged (use_scope), or nil.
//
// TOP-LEVEL FIELDS ONLY — it does not descend into nested messages. That is a real limitation,
// and it is why ValidateDescriptors exists: in the source, a use_scope tag on a nested field
// was silently ignored, leaving that RPC permanently unscoped. Silent over-permission.
func scopeField(descriptor protoreflect.MessageDescriptor) protoreflect.FieldDescriptor {
	fields := descriptor.Fields()

	for i := range fields.Len() {
		field := fields.Get(i)

		opts, ok := field.Options().(*descriptorpb.FieldOptions)
		if !ok || opts == nil {
			continue
		}

		scoped, _ := proto.GetExtension(opts, role_basev1.E_UseScope).(bool)
		if scoped {
			return field
		}
	}

	return nil
}

// ScopeOf returns (teamID, isScoped).
//
// isScoped reports whether the message DECLARES a scope field at all — which is different from
// the scope being zero. The interceptor needs both: a scoped message whose team_id is 0 must
// resolve to the root scope, not be waved through. In the source that case was a free pass.
func ScopeOf(message proto.Message) (uint64, bool) {
	reflected := message.ProtoReflect()

	field := scopeField(reflected.Descriptor())
	if field == nil {
		return 0, false
	}

	// GUARD. protoreflect's .Uint() PANICS on a non-uint field, so a use_scope tag on a string
	// would take down every request to that RPC — the source called it unconditionally.
	//
	// ValidateDescriptors already rejects this at startup, but an interceptor must not depend
	// on someone having remembered to call it. Refuse to read the field instead: scope 0 is
	// still reported as SCOPED, so it resolves to the root team and the RPC becomes
	// root/admin-only. It fails CLOSED, and it fails without panicking.
	switch field.Kind() {
	case protoreflect.Uint64Kind, protoreflect.Uint32Kind:
		return reflected.Get(field).Uint(), true

	default:
		return 0, true
	}
}

// ValidateDescriptors asserts, at STARTUP, that every use_scope tag in the binary is
// well-formed. Each of these is silent at runtime otherwise:
//
//   - a non-uint scope field => the interceptor panics on that RPC (it calls .Uint()).
//   - two scope fields in one message => first-in-field-order silently wins.
//   - a scope tag on a nested field => never seen; the RPC is silently unscoped.
//
// Call this from main. A misconfigured policy should stop the process, not serve traffic.
func ValidateDescriptors() error {
	var err error

	protoregistry.GlobalFiles.RangeFiles(func(file protoreflect.FileDescriptor) bool {
		messages := file.Messages()

		for i := range messages.Len() {
			err = validateMessage(messages.Get(i))
			if err != nil {
				return false
			}
		}

		return true
	})

	return err
}

func validateMessage(descriptor protoreflect.MessageDescriptor) error {
	fields := descriptor.Fields()

	found := 0

	for i := range fields.Len() {
		field := fields.Get(i)

		opts, ok := field.Options().(*descriptorpb.FieldOptions)
		if !ok || opts == nil {
			continue
		}

		scoped, _ := proto.GetExtension(opts, role_basev1.E_UseScope).(bool)
		if !scoped {
			continue
		}

		found++

		kind := field.Kind()
		if kind != protoreflect.Uint64Kind && kind != protoreflect.Uint32Kind {
			return fmt.Errorf(
				"san_auth: %s.%s is tagged use_scope but is %s — it must be a uint (the interceptor reads it as one)",
				descriptor.FullName(), field.Name(), kind,
			)
		}
	}

	if found > 1 {
		return fmt.Errorf(
			"san_auth: %s has %d use_scope fields — exactly one is allowed, or the scope silently depends on field order",
			descriptor.FullName(), found,
		)
	}

	// Nested messages carry their own scope tags, which the interceptor will never read.
	// Catch it here rather than shipping a silently-unscoped RPC.
	nested := descriptor.Messages()
	for i := range nested.Len() {
		child := nested.Get(i)

		if child.IsMapEntry() {
			continue
		}

		childFields := child.Fields()

		for j := range childFields.Len() {
			field := childFields.Get(j)

			opts, ok := field.Options().(*descriptorpb.FieldOptions)
			if !ok || opts == nil {
				continue
			}

			scoped, _ := proto.GetExtension(opts, role_basev1.E_UseScope).(bool)
			if scoped {
				return fmt.Errorf(
					"san_auth: %s.%s is tagged use_scope but is NESTED — the interceptor only reads top-level fields, so this RPC would be silently UNSCOPED. Flatten it",
					child.FullName(), field.Name(),
				)
			}
		}
	}

	return nil
}
