# Code Implementation Guideline

## Implementation For Long Running Task RPC
This is implementation guideline for long running rpc that require complex execution.
1. rpc shape usualy use stream response like `rpc LongTask(...) returns (stream LongTaskResponse)`.
2. return response must have :
    ```
    message LongTaskResponse {
        ... any defined field
        string message          <--- must have this.
    }
    ```
3. in golang code implementation every important step is logged using slog and binding to stream. Here example how to Binding:
    ```
    var logwritter io.Writer = &LongTaskLogger{
		stream: stream,
	}

	logger := slog.New(slog.NewTextHandler(logwritter, nil))
    ```
    and here the `LongTaskLogger` implementation example:
    ```
    type LongTaskLogger struct {
        stream *connect.ServerStream[service.LongTaskResponse]
    }

    // Write implements [io.Writer].
    func (r *ReconcileLogger) Write(p []byte) (n int, err error) {
        c := len(p)

        err = r.stream.Send(&service.LongTaskResponse{
            Message: string(p),
        })

        return c, err
    }
    ``` 
    so we can use `logger.Info(..)`, `logger.Info(..)` and other log print.

