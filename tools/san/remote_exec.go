package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/urfave/cli/v3"

	remotev1 "github.com/pdcgo/warehouse_revamp/backend/gen/san/remote/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/san/remote/v1/remotev1connect"
)

const defaultRemoteURL = "http://" + defaultRemoteAddr

// remoteExecCommand is the client — one command, streamed, exiting with the remote command's own
// status.
//
// It exists so a server can be checked by a human without writing a client, and so the streaming
// contract has a reference consumer: an agent implementing its own client can read this file and
// see exactly which frames matter.
func remoteExecCommand() *cli.Command {
	return &cli.Command{
		Name:      "exec",
		Usage:     "run one command on a `san remote` server and stream the output",
		ArgsUsage: `"<command>"`,
		Description: "Runs the command on the server named by --url and prints its output as it\n" +
			"arrives — stdout to stdout, stderr to stderr, and the server's own narration to\n" +
			"stderr with a `san:` prefix so it cannot be mistaken for the command's output.\n\n" +
			"IT EXITS WITH THE REMOTE COMMAND'S STATUS, so it composes in a shell the way the\n" +
			"command would have locally.",
		Flags: []cli.Flag{
			&cli.StringFlag{
				Name:  "url",
				Value: defaultRemoteURL,
				Usage: "base URL of the server",
			},
			&cli.StringFlag{
				Name:  "dir",
				Usage: "directory to run in, relative to the server's workspace root",
			},
			&cli.DurationFlag{
				Name:  "timeout",
				Usage: "kill the command after this long (default: the server's own)",
			},
			&cli.BoolFlag{
				Name:  "info",
				Usage: "print the server's Info instead of running anything",
			},
		},
		Action: runRemoteExec,
	}
}

func runRemoteExec(ctx context.Context, cmd *cli.Command) error {
	client, err := remoteClient(cmd)
	if err != nil {
		return err
	}

	if cmd.Bool("info") {
		return printRemoteInfo(ctx, client)
	}

	command := strings.Join(cmd.Args().Slice(), " ")
	if strings.TrimSpace(command) == "" {
		return errors.New("nothing to run: give the command as the argument")
	}

	return streamRemoteExec(ctx, client, &remotev1.ExecRequest{
		Command:        command,
		WorkingDir:     cmd.String("dir"),
		TimeoutSeconds: uint32(cmd.Duration("timeout").Seconds()),
	})
}

func streamRemoteExec(
	ctx context.Context,
	client remotev1connect.RemoteServiceClient,
	req *remotev1.ExecRequest,
) error {
	stream, err := client.Exec(ctx, connect.NewRequest(req))
	if err != nil {
		return err
	}

	defer func() { _ = stream.Close() }()

	var result *remotev1.ExecResult

	for stream.Receive() {
		msg := stream.Msg()

		switch msg.GetStream() {
		case remotev1.ExecStream_EXEC_STREAM_STDOUT:
			fmt.Fprint(os.Stdout, msg.GetMessage())

		case remotev1.ExecStream_EXEC_STREAM_STDERR:
			fmt.Fprint(os.Stderr, msg.GetMessage())

		default:
			// The server narrating the run. Prefixed so it can never be confused with the
			// command's own stderr by a script reading this output.
			fmt.Fprint(os.Stderr, "san: "+msg.GetMessage())
		}

		// The result rides on the final frame; keeping the last one seen is what makes the exit
		// status available after the loop.
		if msg.GetResult() != nil {
			result = msg.GetResult()
		}
	}

	err = stream.Err()
	if err != nil {
		return err
	}

	if result == nil {
		return errors.New("the stream ended without a result frame")
	}

	if result.GetTimedOut() {
		took := time.Duration(result.GetDurationMs()) * time.Millisecond

		// 124 is what `timeout(1)` uses, so a script wrapping this can tell a timeout apart from
		// the command's own failure without parsing text.
		return cli.Exit("timed out after "+took.String(), 124)
	}

	if result.GetExitCode() != 0 {
		// An empty message, because the command has already printed whatever it wanted to say.
		// Adding a line of ours would corrupt the output of anything parsing it.
		return cli.Exit("", int(result.GetExitCode()))
	}

	return nil
}

func printRemoteInfo(ctx context.Context, client remotev1connect.RemoteServiceClient) error {
	resp, err := client.Info(ctx, connect.NewRequest(&remotev1.InfoRequest{}))
	if err != nil {
		return err
	}

	info := resp.Msg

	fmt.Printf("workspace   %s\n", info.GetWorkspaceRoot())
	fmt.Printf("shell       %s\n", strings.Join(info.GetShell(), " "))
	fmt.Printf("platform    %s/%s\n", info.GetOs(), info.GetArch())
	fmt.Printf("timeout     %ds (max %ds)\n", info.GetDefaultTimeoutSeconds(), info.GetMaxTimeoutSeconds())

	expiry := "when the server stops"
	if info.GetTokenExpiresAt() != nil {
		expiry = info.GetTokenExpiresAt().AsTime().Format(time.RFC3339)
	}

	fmt.Printf("token dies  %s\n", expiry)

	return nil
}

// remoteHTTPClient speaks unencrypted HTTP/2 the modern way (HARD RULE 5 — h2c is deprecated),
// and has NO overall timeout: a Timeout on the client would cut the stream off mid-build, which
// is the one thing this tool must not do. The command's own deadline is the server's job.
func remoteHTTPClient() *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()

	protocols := new(http.Protocols)
	protocols.SetHTTP1(true)
	protocols.SetUnencryptedHTTP2(true)
	transport.Protocols = protocols

	return &http.Client{Transport: transport}
}
