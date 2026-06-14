> ## Documentation Index
> Fetch the complete documentation index at: https://assemblyai.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Message Sequence

This page walks through the WebSocket message sequence of a streaming session — what the client sends and what the server emits, from session start to termination.

For this example, we walk through a user saying:
`My name is Sonny.`

## Session initialization

When the session begins, you receive a `Begin` message with the session ID and expiration time.

```json theme={null}
{
  "type": "Begin",
  "id": "3207b601-2054-48df-ba77-8784dfcf9fb8",
  "expires_at": 1772570132
}
```

## Speech started

<Note>
  `SpeechStarted` is emitted **only on Universal-3 Pro Streaming**. Universal Streaming skips this message and goes straight to the first `Turn`.
</Note>

Before any Turn messages are sent, the server sends a `SpeechStarted` message indicating that speech has been detected. The `timestamp` field indicates when the speech was detected, in milliseconds relative to the beginning of the audio stream. The `confidence` field is the confidence score that speech has started.

```json theme={null}
{
  "type": "SpeechStarted",
  "timestamp": 1216,
  "confidence": 0.987654
}
```

## Partial transcript

As the speaker is talking, the server emits one or more `Turn` messages with `end_of_turn: false`. These are partial transcripts.

```json expandable theme={null}
{
  "turn_order": 0,
  "turn_is_formatted": false,
  "end_of_turn": false,
  "transcript": "My name is—",
  "end_of_turn_confidence": 0,
  "words": [
    {
      "start": 1216,
      "end": 1627,
      "text": "My",
      "confidence": 0.956314,
      "word_is_final": false
    },
    {
      "start": 1668,
      "end": 2490,
      "text": "name",
      "confidence": 0.999393,
      "word_is_final": false
    },
    {
      "start": 2531,
      "end": 3067,
      "text": "is—",
      "confidence": 0.753325,
      "word_is_final": false
    }
  ],
  "utterance": "",
  "type": "Turn"
}
```

The cadence and shape of partials depends on the model. See [Universal-3 Pro Streaming](/streaming/universal-3-pro) and [Universal Streaming](/streaming/universal-streaming) for the details of how each model produces partials.

## End of turn

When the turn ends, the server emits a `Turn` message with `end_of_turn: true` and the final transcript.

```json expandable theme={null}
{
  "turn_order": 0,
  "turn_is_formatted": true,
  "end_of_turn": true,
  "transcript": "My name is Sonny.",
  "end_of_turn_confidence": 1,
  "words": [
    {
      "start": 1216,
      "end": 1635,
      "text": "My",
      "confidence": 0.956583,
      "word_is_final": true
    },
    {
      "start": 1676,
      "end": 2515,
      "text": "name",
      "confidence": 0.999199,
      "word_is_final": true
    },
    {
      "start": 2556,
      "end": 2975,
      "text": "is",
      "confidence": 0.999535,
      "word_is_final": true
    },
    {
      "start": 3016,
      "end": 4155,
      "text": "Sonny.",
      "confidence": 0.316031,
      "word_is_final": true
    }
  ],
  "utterance": "My name is Sonny.",
  "type": "Turn"
}
```

## Keep alive

**`KeepAlive` messages are not required.** By default, sessions remain open until [explicitly terminated](#session-termination) or until the 3-hour maximum session duration is reached.

`KeepAlive` is only relevant if you have configured the `inactivity_timeout` connection parameter, which closes the session after a period of no audio or messages being sent. If you are using `inactivity_timeout` and want to keep the session open during periods where no audio is being sent, send a `KeepAlive` message to reset the inactivity timer:

```json theme={null}
{ "type": "KeepAlive" }
```

## Session termination

To end a session, the client must send a `Terminate` message. The server then responds with a `Termination` message containing the total audio and session durations, and closes the connection.

**Client sends:**

```json theme={null}
{ "type": "Terminate" }
```

**Server responds:**

```json theme={null}
{
  "type": "Termination",
  "audio_duration_seconds": 13,
  "session_duration_seconds": 13
}
```

After receiving the `Termination` message, no further messages will be sent and the WebSocket connection will be closed.

<Note>
  If [Streaming Diarization](/streaming/label-speakers-and-separate-channels) is enabled (`speaker_labels: true`), the server may emit a `SpeakerRevision` message immediately before `Termination`. The end-of-session refinement adds approximately 400ms of latency at session close. See [Revised speaker labels](/streaming/label-speakers-and-separate-channels#revised-speaker-labels) for the message schema and consumption guidance.
</Note>

<Warning>
  Always terminate sessions explicitly. Streaming is [billed per session](/billing-and-pricing#streaming-speech-to-text-billing) — sessions that are not terminated remain open and continue to accrue charges until the server auto-closes them after 3 hours (error code `3008`). See [Common errors](/streaming/common-session-errors-and-closures) for more details.
</Warning>
