package san_caches

import (
	"encoding/json"
	"fmt"

	"google.golang.org/protobuf/proto"
)

// encode serialises a cached value. Proto messages go over the wire as protobuf; everything
// else as JSON. Keeping ONE codec here means the Redis and in-memory managers cannot
// disagree about what a cached value looks like — a bug that would only ever show up when
// swapping implementations between dev and production.
func encode(value any) ([]byte, error) {
	message, ok := value.(proto.Message)
	if ok {
		return proto.Marshal(message)
	}

	return json.Marshal(value)
}

// decode is encode's inverse. dst must be a pointer.
func decode(data []byte, dst any) error {
	message, ok := dst.(proto.Message)
	if ok {
		return proto.Unmarshal(data, message)
	}

	err := json.Unmarshal(data, dst)
	if err != nil {
		return fmt.Errorf("san_caches: decoding cached value into %T: %w", dst, err)
	}

	return nil
}
