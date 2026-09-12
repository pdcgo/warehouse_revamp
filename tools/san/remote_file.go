package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/urfave/cli/v3"

	remotev1 "github.com/pdcgo/warehouse_revamp/backend/gen/san/remote/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/san/remote/v1/remotev1connect"
	"github.com/pdcgo/warehouse_revamp/tools/san/remote"
)

// remoteGetCommand and remotePutCommand are the file half of the client.
//
// They pipe RAW BYTES through stdout/stdin rather than printing anything of their own, so
// `san remote get x.go > x.go` is a faithful copy and not a re-encoded one. Any banner or
// "wrote N bytes" line goes to stderr for exactly that reason.

func remoteGetCommand() *cli.Command {
	return &cli.Command{
		Name:      "get",
		Usage:     "read a file from the server and write it to stdout",
		ArgsUsage: "<path>",
		Description: "The path is relative to the server's workspace root.\n\n" +
			"Bytes go to stdout untouched, so redirecting produces an identical copy — which is\n" +
			"the difference between this and `remote exec -- cat`, where the shell re-encodes\n" +
			"line endings on the way past.",
		Flags: []cli.Flag{
			&cli.StringFlag{
				Name:  "url",
				Value: defaultRemoteURL,
				Usage: "base URL of the server",
			},
			&cli.StringFlag{
				Name:  "out",
				Usage: "write to this local file instead of stdout",
			},
		},
		Action: runRemoteGet,
	}
}

func runRemoteGet(ctx context.Context, cmd *cli.Command) error {
	client, err := remoteClient(cmd)
	if err != nil {
		return err
	}

	path := strings.TrimSpace(cmd.Args().First())
	if path == "" {
		return errors.New("name the file to read")
	}

	resp, err := client.FileRead(ctx, connect.NewRequest(&remotev1.FileReadRequest{Path: path}))
	if err != nil {
		return err
	}

	out := cmd.String("out")
	if out == "" {
		_, err = os.Stdout.Write(resp.Msg.GetContent())

		return err
	}

	err = os.WriteFile(out, resp.Msg.GetContent(), 0o644)
	if err != nil {
		return err
	}

	fmt.Fprintf(os.Stderr, "%s → %s (%d bytes)\n", path, out, resp.Msg.GetSize())

	return nil
}

func remotePutCommand() *cli.Command {
	return &cli.Command{
		Name:      "put",
		Usage:     "write a file on the server from stdin or a local file",
		ArgsUsage: "<path>",
		Description: "The path is relative to the server's workspace root, and the write REPLACES —\n" +
			"there is no append, because a half-applied edit is the failure worth designing out.\n\n" +
			"Content comes from --from, or from stdin when it is omitted.",
		Flags: []cli.Flag{
			&cli.StringFlag{
				Name:  "url",
				Value: defaultRemoteURL,
				Usage: "base URL of the server",
			},
			&cli.StringFlag{
				Name:  "from",
				Usage: "local file to send (default: stdin)",
			},
			&cli.BoolFlag{
				Name:  "create-dirs",
				Usage: "create missing parent directories on the server",
			},
		},
		Action: runRemotePut,
	}
}

func runRemotePut(ctx context.Context, cmd *cli.Command) error {
	client, err := remoteClient(cmd)
	if err != nil {
		return err
	}

	path := strings.TrimSpace(cmd.Args().First())
	if path == "" {
		return errors.New("name the file to write")
	}

	content, err := readLocalContent(cmd.String("from"))
	if err != nil {
		return err
	}

	resp, err := client.FileWrite(ctx, connect.NewRequest(&remotev1.FileWriteRequest{
		Path:       path,
		Content:    content,
		CreateDirs: cmd.Bool("create-dirs"),
	}))
	if err != nil {
		return err
	}

	verb := "wrote"
	if resp.Msg.GetReplaced() {
		verb = "replaced"
	}

	// stderr, so it cannot end up inside a redirect the caller set up for something else.
	fmt.Fprintf(os.Stderr, "%s %s (%d bytes)\n", verb, path, resp.Msg.GetSize())

	return nil
}

func readLocalContent(from string) ([]byte, error) {
	if from == "" {
		return io.ReadAll(os.Stdin)
	}

	return os.ReadFile(from)
}

// remoteClient builds the authenticated client every remote subcommand uses. One place, so the
// "no token" message and the transport settings cannot differ between commands.
func remoteClient(cmd *cli.Command) (remotev1connect.RemoteServiceClient, error) {
	token := strings.TrimSpace(cmd.String("token"))

	// The token STORE is the second place to look, because the server wrote the credential this
	// client needs — persisting is the default. Pasting it back in by hand would be copying a
	// secret from one file on this machine to another on the same machine.
	if token == "" {
		token = clientStoredToken(cmd, time.Now())
	}

	if token == "" {
		return nil, errors.New(
			"no token: pass --token, set SAN_REMOTE_TOKEN, or point --root at the workspace whose " +
				"server is running (the token is printed at startup and kept in " +
				remote.DefaultTokenStorePath + ")")
	}

	return remotev1connect.NewRemoteServiceClient(
		remoteHTTPClient(),
		cmd.String("url"),
		connect.WithInterceptors(remote.NewClientAuthInterceptor(token)),
	), nil
}
