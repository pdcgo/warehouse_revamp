package hello_service

import (
	"context"
	"fmt"

	"connectrpc.com/connect"

	hellov1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/hello/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/hello/v1/hellov1connect"
)

// Service implements [hellov1connect.HelloServiceHandler].
type Service struct{}

var _ hellov1connect.HelloServiceHandler = (*Service)(nil)

func NewService() *Service {
	return &Service{}
}

// SayHello implements [hellov1connect.HelloServiceHandler].
func (s *Service) SayHello(
	ctx context.Context,
	req *connect.Request[hellov1.SayHelloRequest],
) (*connect.Response[hellov1.SayHelloResponse], error) {
	name := req.Msg.GetName()
	if name == "" {
		name = "world"
	}

	res := connect.NewResponse(&hellov1.SayHelloResponse{
		Message: fmt.Sprintf("hello, %s", name),
	})

	return res, nil
}
