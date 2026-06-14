> ## Documentation Index
> Fetch the complete documentation index at: https://assemblyai.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Common session errors and closures

### Common session errors and closures

In WebSocket based connections, closures and errors represent different ways a connection can terminate.
A closure is a normal, expected termination initiated by either the client or the server, whereas errors are terminations resulting from an unexpected problem like network issues, protocol mismatches, timeouts, or server-side issues.
In the event of an error, the `on_error` callback is triggered just prior to `on_close`. **If an error is not encountered, then only `on_close` is called.**

When a session closes, the `on_close` callback receives a status code and reason detailing why the connection ended.
This information is useful when attempting to debug issues or handle certain closure scenarios programmatically.
The below table lists some of the common reasons for a session closure along with their corresponding codes and descriptions.

| Code   | Reason                                                                         | Description                                                                                                                                                                                                                                                                                                   |
| ------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `3008` | Session Expired: Maximum session duration exceeded                             | Session exceeded 3 hour limit (or max session duration set by [temporary token](/streaming/authenticate-with-a-temporary-token)). You are billed for the full session duration. Always [terminate sessions](/streaming/universal-streaming/message-sequence#session-termination) explicitly to control costs. |
| `3007` | Input duration violation: `<time>` ms. Expected between 50 and 1000 ms         | Audio chunk size less than 50ms or greater than 1000ms.                                                                                                                                                                                                                                                       |
| `3006` | Invalid Message Type: `<message>`                                              | Unsupported [message type](/streaming/common-session-errors-and-closures).                                                                                                                                                                                                                                    |
| `3006` | Invalid JSON: `<json>`                                                         | Message contains invalid JSON.                                                                                                                                                                                                                                                                                |
| `3006` | Invalid Message: `<message>`                                                   | Message is not valid (i.e. `'[]'`).                                                                                                                                                                                                                                                                           |
| `3007` | Audio Transmission Rate Exceeded: Received `<time>` sec. audio in `<time>` sec | Audio sent faster than real-time.                                                                                                                                                                                                                                                                             |
| `3005` | Session Cancelled: An error occurred                                           | Unknown server error.                                                                                                                                                                                                                                                                                         |
| `3009` | Unauthorized Connection: Too many concurrent sessions                          | Streaming rate limit exceeded. For more on rate limits, see your [Account's Rate Limits](https://www.assemblyai.com/dashboard/rate-limits) and [how streaming rate limits work](/streaming/rate-limits).                                                                                                      |
| `1008` | Unauthorized Connection: Missing Authorization header                          | Missing or invalid API token. Your API tokens can be found on the [API Keys page](https://www.assemblyai.com/dashboard/api-keys) of your account dashboard.                                                                                                                                                   |
| `1008` | Unauthorized Connection: `<reason>`                                            | Account related issue (insufficient account balance, account temporarily disabled, etc.).                                                                                                                                                                                                                     |
| `410`  | Deprecated endpoint                                                            | The V2 streaming API has been retired. Use this endpoint instead: [`wss://streaming.assemblyai.com/v3/ws`](/streaming/getting-started/transcribe-streaming-audio).                                                                                                                                            |

<Note>
  Code `3005` is still used as a catch-all for server-side errors not covered by
  the more specific codes above.
</Note>

<Note>
  **Handling closed sessions**

  A common way to handle a closure such as `3008 - Session Expired: Maximum session duration exceeded` is to parse the status code and reason in the `on_close` callback. If a specific code and reason are detected, you can then take appropriate action, such as opening a new session or logging useful debugging information.

  Note that the `on_error` callback is not triggered in this case, as the session closes for a known reason and not due to encountering an error.
</Note>

If you believe your session received an error or closed due to a reason not listed above, please reach out to [support@assemblyai.com](mailto:support@assemblyai.com) with the [session id](/api-reference/streaming-api/universal-3-pro-streaming#receive.receiveSessionBegins.id) and any further details.
