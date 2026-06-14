> ## Documentation Index
> Fetch the complete documentation index at: https://assemblyai.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Universal-3 Pro Streaming

> Set up and configure Universal-3 Pro Streaming for real-time streaming transcription.

Universal-3 Pro Streaming is optimized for real-time audio utterances typically under 10 seconds, with special efficiencies built in for low-latency turn detection and voice agent workflows. It provides the highest accuracy with native multilingual code switching, entity accuracy, and prompting support.

This model is fantastic for **voice agents**, **agent assist**, and **all streaming use cases** that don't require partial transcriptions for every single subword — an early partial is emitted after 750ms of continuous speech, followed by silence-based partials as the speaker pauses (see [Partials behavior](#partials-behavior) for details). Universal-3 Pro Streaming delivers exceptional **entity and alphanumeric accuracy**, including credit card numbers, cell phone numbers, email addresses, physical addresses, and names — all with **sub-300ms time to complete transcript latency**.

<Tip>
  **Already using AssemblyAI streaming?**

  If you're an existing AssemblyAI streaming user, you can quickly test
  Universal-3 Pro Streaming by switching the `speech_model` parameter to
  `"u3-rt-pro"` in your connection parameters. No other code changes are
  required — just update the model and start streaming.
</Tip>

<Note>
  **Streaming is billed per session**

  Universal-3 Pro Streaming is billed on the total duration that your WebSocket connection stays open, not on the amount of audio you send. Always send a [Terminate](/streaming/universal-3-pro/u3-pro-message-sequence#session-termination) message when you're done with a stream — sessions that aren't closed auto-close after 3 hours and are billed for the full duration. See [Billing and pricing](/billing-and-pricing) for details.
</Note>

## Quickstart

Get started with Universal-3 Pro Streaming using the code below. This example streams audio from your microphone and prints transcription results in real time — no prompt is needed, since Universal-3 Pro is optimized for streaming and turn detection out of the box. To provide context about your audio, see the [Prompting guide](/streaming/universal-3-pro/prompting).

<Tabs>
  <Tab title="Python" language="python">
    <Steps>
      <Step>
        Install the required libraries

        ```bash theme={null}
        pip install websocket-client pyaudio
        ```
      </Step>

      <Step>
        Create a new file `main.py` and paste the code below. Replace `<YOUR_API_KEY>` with your API key.
      </Step>

      <Step>
        Run with `python main.py` and speak into your microphone.
      </Step>
    </Steps>

    ```python expandable theme={null}
    import pyaudio
    import websocket
    import json
    import threading
    import time
    from urllib.parse import urlencode

    YOUR_API_KEY = "<YOUR_API_KEY>"

    CONNECTION_PARAMS = {
        "sample_rate": 16000,
        "speech_model": "u3-rt-pro",
    }
    API_ENDPOINT_BASE_URL = "wss://streaming.assemblyai.com/v3/ws"
    API_ENDPOINT = f"{API_ENDPOINT_BASE_URL}?{urlencode(CONNECTION_PARAMS)}"

    FRAMES_PER_BUFFER = 800
    SAMPLE_RATE = CONNECTION_PARAMS["sample_rate"]
    CHANNELS = 1
    FORMAT = pyaudio.paInt16

    audio = None
    stream = None
    ws_app = None
    audio_thread = None
    stop_event = threading.Event()

    def on_open(ws):
        print("WebSocket connection opened.")
        def stream_audio():
            global stream
            while not stop_event.is_set():
                try:
                    audio_data = stream.read(FRAMES_PER_BUFFER, exception_on_overflow=False)
                    ws.send(audio_data, websocket.ABNF.OPCODE_BINARY)
                except Exception as e:
                    print(f"Error streaming audio: {e}")
                    break

        global audio_thread
        audio_thread = threading.Thread(target=stream_audio)
        audio_thread.daemon = True
        audio_thread.start()

    def on_message(ws, message):
        try:
            data = json.loads(message)
            msg_type = data.get("type")

            if msg_type == "Begin":
                print(f"Session began: ID={data.get('id')}")
            elif msg_type == "Turn":
                transcript = data.get("transcript", "")
                end_of_turn = data.get("end_of_turn", False)
                if end_of_turn:
                    print(f"\r{' ' * 80}\r{transcript}")
                else:
                    print(f"\r{transcript}", end="")
            elif msg_type == "Termination":
                print(f"\nSession terminated: {data.get('audio_duration_seconds', 0)}s of audio")
        except Exception as e:
            print(f"Error handling message: {e}")

    def on_error(ws, error):
        print(f"\nWebSocket Error: {error}")
        stop_event.set()

    def on_close(ws, close_status_code, close_msg):
        print(f"\nWebSocket Disconnected: Status={close_status_code}")
        global stream, audio
        stop_event.set()
        if stream:
            if stream.is_active():
                stream.stop_stream()
            stream.close()
        if audio:
            audio.terminate()

    def run():
        global audio, stream, ws_app

        audio = pyaudio.PyAudio()
        stream = audio.open(
            input=True,
            frames_per_buffer=FRAMES_PER_BUFFER,
            channels=CHANNELS,
            format=FORMAT,
            rate=SAMPLE_RATE,
        )
        print("Speak into your microphone. Press Ctrl+C to stop.")

        ws_app = websocket.WebSocketApp(
            API_ENDPOINT,
            header={"Authorization": YOUR_API_KEY},
            on_open=on_open,
            on_message=on_message,
            on_error=on_error,
            on_close=on_close,
        )

        ws_thread = threading.Thread(target=ws_app.run_forever)
        ws_thread.daemon = True
        ws_thread.start()

        try:
            while ws_thread.is_alive():
                time.sleep(0.1)
        except KeyboardInterrupt:
            print("\nStopping...")
            stop_event.set()
            if ws_app and ws_app.sock and ws_app.sock.connected:
                ws_app.send(json.dumps({"type": "Terminate"}))
                time.sleep(2)
            if ws_app:
                ws_app.close()
            ws_thread.join(timeout=2.0)

    if __name__ == "__main__":
        run()
    ```
  </Tab>

  <Tab title="Python SDK" language="python-sdk" default>
    <Steps>
      <Step>
        Install the required libraries

        ```bash theme={null}
        pip install "assemblyai>=0.54.0" pyaudio
        ```
      </Step>

      <Step>
        Create a new file `main.py` and paste the code below. Replace `<YOUR_API_KEY>` with your API key.
      </Step>

      <Step>
        Run with `python main.py` and speak into your microphone.
      </Step>
    </Steps>

    ```python expandable theme={null}
    import logging
    from typing import Type

    import assemblyai as aai
    from assemblyai.streaming.v3 import (
        BeginEvent,
        StreamingClient,
        StreamingClientOptions,
        StreamingError,
        StreamingEvents,
        StreamingParameters,
        TurnEvent,
        TerminationEvent,
    )

    api_key = "<YOUR_API_KEY>"

    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)

    def on_begin(self: Type[StreamingClient], event: BeginEvent):
        print(f"Session started: {event.id}")

    def on_turn(self: Type[StreamingClient], event: TurnEvent):
        print(f"{event.transcript} ({event.end_of_turn})")

    def on_terminated(self: Type[StreamingClient], event: TerminationEvent):
        print(
            f"Session terminated: {event.audio_duration_seconds} seconds of audio processed"
        )

    def on_error(self: Type[StreamingClient], error: StreamingError):
        print(f"Error occurred: {error}")

    def main():
        client = StreamingClient(
            StreamingClientOptions(
                api_key=api_key,
                api_host="streaming.assemblyai.com",
            )
        )

        client.on(StreamingEvents.Begin, on_begin)
        client.on(StreamingEvents.Turn, on_turn)
        client.on(StreamingEvents.Termination, on_terminated)
        client.on(StreamingEvents.Error, on_error)

        client.connect(
            StreamingParameters(
                sample_rate=16000,
                speech_model="u3-rt-pro",
            )
        )

        try:
            client.stream(
                aai.extras.MicrophoneStream(sample_rate=16000)
            )
        finally:
            client.disconnect(terminate=True)

    if __name__ == "__main__":
        main()
    ```
  </Tab>

  <Tab title="JavaScript" language="javascript">
    <Steps>
      <Step>
        Install the required libraries

        ```bash theme={null}
        npm install ws mic
        ```
      </Step>

      <Step>
        Create a new file `main.js` and paste the code below. Replace `<YOUR_API_KEY>` with your API key.
      </Step>

      <Step>
        Run with `node main.js` and speak into your microphone.
      </Step>
    </Steps>

    ```javascript expandable theme={null}
    const WebSocket = require("ws");
    const mic = require("mic");
    const querystring = require("querystring");

    const YOUR_API_KEY = "<YOUR_API_KEY>";
    const CONNECTION_PARAMS = {
      sample_rate: 16000,
      speech_model: "u3-rt-pro",
    };
    const API_ENDPOINT_BASE_URL = "wss://streaming.assemblyai.com/v3/ws";
    const API_ENDPOINT = `${API_ENDPOINT_BASE_URL}?${querystring.stringify(CONNECTION_PARAMS)}`;

    const SAMPLE_RATE = CONNECTION_PARAMS.sample_rate;

    let micInstance = null;
    let ws = null;

    function run() {
      console.log("Starting AssemblyAI streaming transcription...");

      ws = new WebSocket(API_ENDPOINT, {
        headers: { Authorization: YOUR_API_KEY },
      });

      ws.on("open", () => {
        console.log("WebSocket connection opened.");

        micInstance = mic({
          rate: String(SAMPLE_RATE),
          channels: "1",
          bitwidth: "16",
          encoding: "signed-integer",
          endian: "little",
        });

        const micInputStream = micInstance.getAudioStream();
        micInputStream.on("data", (data) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(data);
          }
        });

        micInstance.start();
        console.log("Speak into your microphone. Press Ctrl+C to stop.");
      });

      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data);
          if (msg.type === "Begin") {
            console.log(`Session began: ID=${msg.id}`);
          } else if (msg.type === "Turn") {
            const transcript = msg.transcript || "";
            if (msg.end_of_turn) {
              process.stdout.write("\r" + " ".repeat(80) + "\r");
              console.log(transcript);
            } else {
              process.stdout.write(`\r${transcript}`);
            }
          } else if (msg.type === "Termination") {
            console.log(
              `\nSession terminated: ${msg.audio_duration_seconds}s of audio`
            );
          }
        } catch (e) {
          console.error("Error parsing message:", e);
        }
      });

      ws.on("error", (error) => {
        console.error("WebSocket error:", error);
      });

      ws.on("close", (code, reason) => {
        console.log(`WebSocket closed: ${code}`);
        if (micInstance) micInstance.stop();
      });

      process.on("SIGINT", () => {
        console.log("\nStopping...");
        if (micInstance) micInstance.stop();
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "Terminate" }));
          setTimeout(() => ws.close(), 2000);
        }
      });
    }

    run();
    ```
  </Tab>

  <Tab title="JavaScript SDK" language="javascript-sdk">
    <Steps>
      <Step>
        Install the required libraries

        ```bash theme={null}
        npm install assemblyai node-record-lpcm16
        ```

        <Note>
          The module `node-record-lpcm16` requires [SoX](http://sox.sourceforge.net/) and it must be available in your `$PATH`.

          For Mac OS:

          ```bash theme={null}
          brew install sox
          ```

          For most linux distros:

          ```bash theme={null}
          sudo apt-get install sox libsox-fmt-all
          ```

          For Windows:

          [download the binaries](http://sourceforge.net/projects/sox/files/latest/download)
        </Note>
      </Step>

      <Step>
        Create a new file `main.js` and paste the code below. Replace `<YOUR_API_KEY>` with your API key.
      </Step>

      <Step>
        Run with `node main.js` and speak into your microphone.
      </Step>
    </Steps>

    ```javascript expandable theme={null}
    import { Readable } from "stream";
    import { AssemblyAI } from "assemblyai";
    import recorder from "node-record-lpcm16";

    const run = async () => {
      const client = new AssemblyAI({
        apiKey: "<YOUR_API_KEY>",
      });

      const transcriber = client.streaming.transcriber({
        sampleRate: 16_000,
        speechModel: "u3-rt-pro",
      });

      transcriber.on("open", ({ id }) => {
        console.log(`Session opened with ID: ${id}`);
      });

      transcriber.on("error", (error) => {
        console.error("Error:", error);
      });

      transcriber.on("close", (code, reason) =>
        console.log("Session closed:", code, reason)
      );

      transcriber.on("turn", (turn) => {
        if (!turn.transcript) {
          return;
        }

        console.log("Turn:", turn.transcript);
      });

      try {
        console.log("Connecting to streaming transcript service");
        await transcriber.connect();

        console.log("Starting recording");
        const recording = recorder.record({
          channels: 1,
          sampleRate: 16_000,
          audioType: "wav",
        });

        Readable.toWeb(recording.stream()).pipeTo(transcriber.stream());

        process.on("SIGINT", async function () {
          console.log();
          console.log("Stopping recording");
          recording.stop();

          console.log("Closing streaming transcript connection");
          await transcriber.close();

          process.exit();
        });
      } catch (error) {
        console.error(error);
      }
    };

    run();
    ```
  </Tab>
</Tabs>

## Prompting

Universal-3 Pro supports contextual prompting and keyterms prompting to improve transcription accuracy for your use case. Use the `prompt` parameter to describe what the audio is about — its domain, scenario, or full details — and `keyterms_prompt` to list specific terms. For detailed guidance, see the [Prompting Guide (Streaming)](/streaming/universal-3-pro/prompting).

You can also boost recognition of specific terms using the `keyterms_prompt` parameter. See [Keyterms prompting](/streaming/keyterms-prompting) for details.

## Configuring turn detection

Universal-3 Pro uses a punctuation-based turn detection system controlled by two parameters:

| Parameter          | Default   | Description                                                          |
| ------------------ | --------- | -------------------------------------------------------------------- |
| `min_turn_silence` | `100` ms  | Silence duration before a speculative end-of-turn (EOT) check fires. |
| `max_turn_silence` | `1000` ms | Maximum silence before a turn is forced to end.                      |

When silence reaches `min_turn_silence`, the model transcribes the audio and checks for terminal punctuation (`.` `?` `!`):

* **Terminal punctuation found** — the turn ends and is emitted as a final transcript (`end_of_turn: true`).
* **No terminal punctuation** — a partial transcript is emitted (`end_of_turn: false`) and the turn continues waiting.
  * If silence continues to `max_turn_silence`, the turn is forced to end as a final transcript (`end_of_turn: true`) regardless of punctuation.

<Note>
  This differs from Universal-Streaming English and Multilingual, which use a confidence-based end-of-turn system controlled by `end_of_turn_confidence_threshold`.

  Instead, Universal-3 Pro makes turn decisions based on ending punctuation after `min_turn_silence` has elapsed. Because of this, `end_of_turn_confidence_threshold` has no impact.
</Note>

<Note>
  **end\_of\_turn and turn\_is\_formatted**

  Because formatting is built into the end-of-turn system in Universal-3 Pro
  streaming, there is only ever one end-of-turn transcript per turn and it is
  always formatted. This means `end_of_turn` and `turn_is_formatted` always have
  the same value for Universal-3 Pro streaming. You can reliably use
  `end_of_turn: true` to detect a formatted, final end-of-turn transcript.
</Note>

For example, to configure both parameters:

```json theme={null}
{
  "speech_model": "u3-rt-pro",
  "min_turn_silence": 100,
  "max_turn_silence": 1000
}
```

### Partials behavior

Partials are `Turn` events where `end_of_turn` is `false`. They are produced in three ways:

* **Early partial** — emitted after 750ms of continuous speech by default, providing a fast transcript signal for barge-in and speculative inference without waiting for the speaker to pause. You can tune this timing with the `interruption_delay` parameter (see [Tuning early partial timing](#tuning-early-partial-timing) below). If the first attempt returns empty, it retries at 1500ms, 2250ms, and so on. Only one **early** partial is emitted per turn, but additional partials can be produced when the speaker pauses.
* **Silence-based partials** — produced whenever `min_turn_silence` is met, but the ending punctuation doesn't signal the end of a turn. Each period of silence can produce at most one partial.
* **Continuous partials** — emitted approximately every 3 seconds while speech continues, regardless of silence. Each continuous partial covers the full transcript for the current turn so far. Enabled by default; disable with `continuous_partials: false` if you only want the early partial and silence-based partials.

There can be multiple partial transcripts per turn. If silence exceeds `min_turn_silence`, but speech resumes before `max_turn_silence`, the partial is emitted and the EOT check resets until the next period of silence.

If you're running eager LLM inference on partial transcripts, we recommend setting `min_turn_silence` to `100`.

<Warning>
  **Entity splitting (accuracy) vs Model Latency trade-off**

  Setting `min_turn_silence` too low can split entities like phone numbers and
  emails. We have found LLM steps fix this for voice agents, but we recommend
  testing carefully with your use case.
</Warning>

### Continuous partials

For long, uninterrupted turns — such as a caller reading out a credit card number or giving a detailed explanation — silence-based partials may not fire often enough for your downstream consumers (LLMs, UI, eager inference) to keep up. `continuous_partials` is **enabled by default**, so you'll automatically receive a steady stream of non-final transcripts every \~3 seconds while speech continues. Set `continuous_partials: false` to opt out if you only want the early partial and silence-based partials.

<Tabs>
  <Tab title="Python" language="python">
    ```python {4} theme={null}
    CONNECTION_PARAMS = {
        "sample_rate": 16000,
        "speech_model": "u3-rt-pro",
        "continuous_partials": True,
    }
    ```
  </Tab>

  <Tab title="Python SDK" language="python">
    ```python {5} theme={null}
    client.connect(
        StreamingParameters(
            sample_rate=16000,
            speech_model="u3-rt-pro",
            continuous_partials=True,
        )
    )
    ```
  </Tab>

  <Tab title="JavaScript" language="javascript">
    ```javascript {4} theme={null}
    const CONNECTION_PARAMS = {
      sample_rate: 16000,
      speech_model: "u3-rt-pro",
      continuous_partials: true,
    };
    ```
  </Tab>
</Tabs>

The first partial is still emitted at 750ms (or your configured `interruption_delay`). Continuous partials are non-final (`end_of_turn: false`) and each one covers the full transcript for the current turn so far. The final transcript is emitted as normal when the turn ends.

### Tuning early partial timing

The `interruption_delay` parameter controls how soon the first partial transcript is emitted during a turn, directly affecting your time to first token (TTFT). This is the primary lever for tuning barge-in responsiveness and speculative LLM inference timing.

| Parameter            | Default  | Range         | Description                                                                                                |
| -------------------- | -------- | ------------- | ---------------------------------------------------------------------------------------------------------- |
| `interruption_delay` | `500` ms | `0`–`1000` ms | How soon the first partial is emitted. Lower values produce faster TTFT; higher values are more confident. |

The server adds a minimum turn duration of 300ms on top of your configured value, so the effective timing is:

* `interruption_delay: 0` → \~300ms effective (fastest possible first partial)
* `interruption_delay: 500` → \~800ms effective (default)
* `interruption_delay: 1000` → \~1300ms effective (most confident, slowest TTFT)

<Tabs>
  <Tab title="Python" language="python">
    ```python {4} theme={null}
    CONNECTION_PARAMS = {
        "sample_rate": 16000,
        "speech_model": "u3-rt-pro",
        "interruption_delay": 0,
    }
    API_ENDPOINT = (
        f"wss://streaming.assemblyai.com/v3/ws"
        f"?{urlencode(CONNECTION_PARAMS)}"
    )

    ws = websocket.WebSocketApp(
        API_ENDPOINT,
        header={"Authorization": YOUR_API_KEY},
    )
    ```
  </Tab>

  <Tab title="Python SDK" language="python-sdk">
    ```python {4} theme={null}
    client.connect(
        StreamingParameters(
            sample_rate=16000,
            speech_model="u3-rt-pro",
            interruption_delay=0,
        )
    )
    ```
  </Tab>

  <Tab title="JavaScript" language="javascript">
    ```javascript {4} theme={null}
    const CONNECTION_PARAMS = {
      sample_rate: 16000,
      speech_model: "u3-rt-pro",
      interruption_delay: 0,
    };

    const qs = new URLSearchParams(
      CONNECTION_PARAMS
    ).toString();
    const ws = new WebSocket(
      `wss://streaming.assemblyai.com/v3/ws?${qs}`,
      { headers: { Authorization: YOUR_API_KEY } }
    );
    ```
  </Tab>

  <Tab title="JavaScript SDK" language="javascript-sdk">
    ```javascript {4} theme={null}
    const transcriber = client.streaming.transcriber({
      sampleRate: 16_000,
      speechModel: "u3-rt-pro",
      interruptionDelay: 0,
    });

    await transcriber.connect();
    ```
  </Tab>
</Tabs>

You can also update `interruption_delay` mid-session via `UpdateConfiguration` — for example, lower it when the agent is speaking (for faster barge-in) and raise it when waiting for a user response:

<Tabs>
  <Tab title="Python" language="python">
    ```python theme={null}
    ws.send(json.dumps({
        "type": "UpdateConfiguration",
        "interruption_delay": 200,
    }))
    ```
  </Tab>

  <Tab title="Python SDK" language="python-sdk">
    ```python theme={null}
    client.update_configuration(
        interruption_delay=200,
    )
    ```
  </Tab>

  <Tab title="JavaScript" language="javascript">
    ```javascript theme={null}
    ws.send(JSON.stringify({
      type: "UpdateConfiguration",
      interruption_delay: 200,
    }));
    ```
  </Tab>

  <Tab title="JavaScript SDK" language="javascript-sdk">
    ```javascript theme={null}
    transcriber.updateConfiguration({
      interruption_delay: 200,
    });
    ```
  </Tab>
</Tabs>

**When to adjust `interruption_delay`:**

* **Lower values (0–200ms)** — Use when TTFT is critical and you want the earliest possible signal for speculative LLM inference or barge-in detection. The first partial may be less complete since less audio has been buffered.
* **Default (500ms)** — Balanced for most voice agent use cases. The first partial arrives with enough audio context to be useful without excessive delay.
* **Higher values (500–1000ms)** — Use when you prefer fewer, more confident partials and don't need aggressive barge-in responsiveness. Reduces unnecessary early partials in scenarios where users tend to speak in longer turns.

<Note>
  See the `UpdateConfiguration` examples above for dynamic mid-session adjustment.
</Note>

### Formatting and turn detection

Because the model applies punctuation and formatting intelligently, this works well with formatting-based turn detection. For example, based purely on vocal tone:

* `"Pizza."` — Statement
* `"Pizza?"` — Questioning tone
* `"Pizza---"` — Trailing off

The punctuation quality has been excellent when paired with custom turn detection models.

From testing, mid-turn emission looks like this — where each line is an additional partial leading up to the final end-of-turn transcript:

```
"Yeah my credit card number is--"
"One moment---"
"Its 8888-8888-8888-8888"  ← end_of_turn: true
```

Each partial is emitted during a silence period within the turn. The final line with terminal punctuation triggers the end of turn.

### Forcing a turn endpoint

You can force the current turn to end immediately by sending a `ForceEndpoint` message:

```json theme={null}
{
  "type": "ForceEndpoint"
}
```

This is useful when your application knows the user has finished speaking based on external signals (e.g., a button press).

## Specifying the transcription language

Universal-3 Pro Streaming runs in multilingual mode by default. To bias the model toward a single language, pass the `language_code` connection parameter — see [Language selection](/streaming/getting-started/optimizing-accuracy-and-latency#language-selection) for supported codes and details.

## Supported languages and regional dialects

Universal-3 Pro Streaming supports 6 languages with out-of-the-box recognition of regional dialects and local speech variants. See the [Supported languages](/streaming/universal-3-pro/supported-languages) page for the full language list and dialect reference.

## Updating configuration mid-stream

You can update configuration during an active streaming session using `UpdateConfiguration`. This applies changes without needing to reconnect. **The recommended approach is to dynamically update `keyterms_prompt`** based on the current stage of your voice agent flow — if you expect certain answers or terminology at a specific stage, proactively add those as keyterms so the model recognizes them accurately.

```python theme={null}
# Replace or establish new set of keyterms
websocket.send('{"type": "UpdateConfiguration", "keyterms_prompt": ["Universal-3"]}')

# Remove keyterms and reset context biasing
websocket.send('{"type": "UpdateConfiguration", "keyterms_prompt": []}')
```

For example, if your voice agent is currently asking for the caller's name and date of birth, send the expected terms for that stage:

```python theme={null}
# Caller identification stage
websocket.send('{"type": "UpdateConfiguration", "keyterms_prompt": ["Kelly Byrne-Donoghue", "date of birth", "January", "February"]}')
```

Then, when the conversation moves to a different stage (e.g., medical intake), update with the relevant terms:

```python theme={null}
# Medical intake stage
websocket.send('{"type": "UpdateConfiguration", "keyterms_prompt": ["cardiology", "echocardiogram", "Dr. Patel", "metoprolol"]}')
```

You can also update `prompt`, `max_turn_silence`, `min_turn_silence`, `interruption_delay`, or any combination at the same time:

```json theme={null}
{
  "type": "UpdateConfiguration",
  "keyterms_prompt": ["account number", "routing number"],
  "max_turn_silence": 5000,
  "min_turn_silence": 200
}
```

Common reasons to update configuration mid-stream:

* **`keyterms_prompt`** — Dynamically add terms relevant to the current stage of your voice agent flow. This is the most effective way to improve recognition accuracy mid-stream. See [Keyterms prompting](/streaming/keyterms-prompting) for details.
* **`prompt`** — Update the contextual prompt as your application learns more about the conversation.
* **`max_turn_silence`** — Increase for moments where you'd expect a longer pause, such as when a caller is reading out a credit card number, ID number, or address. Decrease it again afterward to resume snappier turn detection.
* **`min_turn_silence`** — Tune how quickly speculative EOT checks fire. Lower values produce faster partials for eager LLM inference, while higher values reduce entity splitting for utterances with numbers or proper nouns.
* **`interruption_delay`** — Tune how quickly the first partial is emitted. Lower values (e.g. `0`) produce faster TTFT for aggressive barge-in detection; higher values (e.g. `500`–`1000`) produce more confident first partials. See [Tuning early partial timing](#tuning-early-partial-timing) for details.
* **`continuous_partials`** — Toggle steady-cadence partial emission on or off mid-session. Useful when switching between interaction modes where you need more frequent feedback for some turns but not others.
* **`agent_context`** — Pass your voice agent's most recent spoken reply (TTS text) so the model has it as context for the next user turn. See [Context carryover](/streaming/universal-3-pro/context-carryover#passing-your-agents-reply-as-context).

<Tabs>
  <Tab title="Python" language="python">
    ```python theme={null}
    websocket.send('{"type": "UpdateConfiguration", "continuous_partials": true}')
    ```
  </Tab>

  <Tab title="JavaScript" language="javascript">
    ```javascript theme={null}
    ws.send(JSON.stringify({ type: "UpdateConfiguration", continuous_partials: true }));
    ```
  </Tab>
</Tabs>

## Keep alive

**`KeepAlive` messages are not required.** By default, sessions remain open until [explicitly terminated](/streaming/universal-3-pro/u3-pro-message-sequence#session-termination) or until the 3-hour maximum session duration is reached.

`KeepAlive` is only relevant if you have configured the `inactivity_timeout` connection parameter, which closes the session after a period of no audio or messages being sent. If you are using `inactivity_timeout` and want to keep the session open during periods where no audio is being sent, send a `KeepAlive` message to reset the inactivity timer:

```json theme={null}
{ "type": "KeepAlive" }
```
