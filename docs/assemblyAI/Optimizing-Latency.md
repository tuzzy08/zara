> ## Documentation Index
> Fetch the complete documentation index at: https://assemblyai.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Optimizing Accuracy and Latency

> Tune streaming models to balance transcription accuracy and latency.

## Mode

Universal-3 Pro Streaming workloads sit on a spectrum between two competing goals: returning transcripts as fast as possible, and returning the most accurate transcripts possible. To make this tradeoff explicit, Universal-3 Pro supports a **mode** connection parameter you can set when opening a streaming session.

| Mode         | Value          | When to use                                                                                                                    |
| ------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Min latency  | `min_latency`  | Lowest possible time-to-text. Best when responsiveness matters more than catching every word.                                  |
| Balanced     | `balanced`     | A middle ground between latency and accuracy. Best for voice agents and other interactive applications.                        |
| Max accuracy | `max_accuracy` | Highest transcription accuracy. Best for note-taking, scribes, and post-call analysis where a small added delay is acceptable. |

Set the `mode` connection parameter when you open the WebSocket. {/* TODO: confirm parameter name and that it's a connection param (vs. a message). */}

<Tabs>
  <Tab language="python" title="Python" default>
    ```python theme={null}
    CONNECTION_PARAMS = {
        "sample_rate": 16000,
        "speech_model": "u3-rt-pro",
        "mode": "balanced",  # min_latency | max_accuracy
    }
    ```
  </Tab>

  <Tab language="python-sdk" title="Python SDK">
    ```python theme={null}
    client.connect(
        StreamingParameters(
            sample_rate=16000,
            speech_model="u3-rt-pro",
            mode="balanced",  # min_latency | max_accuracy
        )
    )
    ```
  </Tab>

  <Tab language="javascript" title="Javascript">
    ```javascript theme={null}
    const CONNECTION_PARAMS = {
      sample_rate: 16000,
      speech_model: "u3-rt-pro",
      mode: "balanced", // min_latency | max_accuracy
    };
    ```
  </Tab>

  <Tab language="javascript-sdk" title="JavaScript SDK">
    ```javascript theme={null}
    const transcriber = client.streaming.transcriber({
      sampleRate: 16_000,
      speechModel: "u3-rt-pro",
      mode: "balanced", // min_latency | max_accuracy
    });
    ```
  </Tab>
</Tabs>

## Language Selection

By default, Universal-3 Pro Streaming runs in multilingual mode. Pass a `language_code` connection parameter to bias the model toward a single language. This is useful when you know the session is monolingual and want to improve language accuracy.

| Status      | Languages                                                                    |
| ----------- | ---------------------------------------------------------------------------- |
| Available   | `en`, `es`, `fr`, `de`, `it`, `pt`                                           |
| Coming soon | `tr`, `nl`, `sv`, `no`, `da`, `fi`, `hi`, `vi`, `ar`, `he`, `ja`, `ur`, `zh` |

Set the `language_code` connection parameter when you open the WebSocket. Omit `language_code` to keep multilingual code-switching behavior.

<Tabs>
  <Tab language="python" title="Python" default>
    ```python theme={null}
    CONNECTION_PARAMS = {
        "sample_rate": 16000,
        "speech_model": "u3-rt-pro",
        "language_code": "es",
    }
    ```
  </Tab>

  <Tab language="python-sdk" title="Python SDK">
    ```python theme={null}
    client.connect(
        StreamingParameters(
            sample_rate=16000,
            speech_model="u3-rt-pro",
            language_code="es",
        )
    )
    ```
  </Tab>

  <Tab language="javascript" title="Javascript">
    ```javascript theme={null}
    const CONNECTION_PARAMS = {
      sample_rate: 16000,
      speech_model: "u3-rt-pro",
      language_code: "es",
    };
    ```
  </Tab>

  <Tab language="javascript-sdk" title="JavaScript SDK">
    ```javascript theme={null}
    const transcriber = client.streaming.transcriber({
      sampleRate: 16_000,
      speechModel: "u3-rt-pro",
      languageCode: "es",
    });
    ```
  </Tab>
</Tabs>

## Advanced: Tuning turn detection parameters

Beyond the `mode` parameter, you can tune individual turn detection parameters to fine-tune partial cadence and turn endpointing for your use case. The parameters differ by model.

<AccordionGroup>
  <Accordion title="Universal-3 Pro Streaming">
    Universal-3 Pro Streaming uses **punctuation-based turn detection**. Turns end when terminal punctuation (`.` `?` `!`) is detected; if no punctuation is detected within `max_turn_silence`, the turn ends anyway.

    Each `mode` ships with its own set of defaults for these parameters. Override any of them on the connection to fine-tune further.

    | Parameter             | Default                                                             | Description                                                                                                                                                    |
    | --------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
    | `min_turn_silence`    | `min_latency: 96`<br />`balanced: 224`<br />`max_accuracy: 800`     | Silence (ms) before a speculative end-of-turn check fires. Lower = faster turn endings; higher = fewer entity splits on numbers and proper nouns.              |
    | `max_turn_silence`    | `min_latency: 416`<br />`balanced: 1536`<br />`max_accuracy: 1536`  | Maximum silence (ms) before forcing a turn to end, regardless of punctuation. Raise it when you expect a longer pause (caller reading a credit card, address). |
    | `interruption_delay`  | `min_latency: 0`<br />`balanced: 500`<br />`max_accuracy: 500`      | Time to first partial (ms). Lower = faster TTFT for barge-in detection; higher = more confident first partials. The server adds \~300ms minimum on top.        |
    | `continuous_partials` | `min_latency: true`<br />`balanced: true`<br />`max_accuracy: true` | When `true`, emit a partial every \~3s during continuous speech. Useful for long utterances where silence-based partials don't fire often enough.              |
    | `vad_threshold`       | `min_latency: 0.3`<br />`balanced: 0.2`<br />`max_accuracy: 0.2`    | Confidence threshold (0–1) for classifying audio frames as speech. Increase for noisy environments to reduce false speech detection.                           |

    **Tuning recipe — long utterance prep**

    When your voice agent prompts the user for a long utterance (credit card, phone number, address), raise `min_turn_silence` mid-stream so brief pauses don't fragment the turn:

    ```json theme={null}
    { "type": "UpdateConfiguration", "min_turn_silence": 1000 }
    ```

    After the response, restore the default:

    ```json theme={null}
    { "type": "UpdateConfiguration", "min_turn_silence": 100 }
    ```

    See [Updating configuration mid-stream](/streaming/updating-configuration-mid-stream) for the full list of mid-stream parameters.
  </Accordion>

  <Accordion title="Universal Streaming">
    Universal Streaming uses **confidence-based turn detection**. The model predicts when speech naturally ends; if confidence exceeds `end_of_turn_confidence_threshold` and `min_turn_silence` has passed, the turn ends. Acoustic (silence-based) detection kicks in as a fallback after `max_turn_silence`.

    | Parameter                          | Default   | Description                                                                                                                                                        |
    | ---------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
    | `end_of_turn_confidence_threshold` | `0.4`     | Confidence threshold for semantic end-of-turn. Higher = more confident before ending; lower = ends faster.                                                         |
    | `min_turn_silence`                 | `400` ms  | Silence required before a semantic end-of-turn fires.                                                                                                              |
    | `max_turn_silence`                 | `1280` ms | Maximum silence before forcing a turn to end via acoustic detection.                                                                                               |
    | `vad_threshold`                    | —         | Confidence threshold (0–1) for classifying audio frames as speech. Increase for noisy environments to reduce false speech detection. {/* TODO: confirm default */} |

    **Quick-start configurations**

    Aggressive — short, rapid back-and-forth (e.g., IVR replacements, order confirmations):

    ```javascript theme={null}
    const streamingConfig = {
      end_of_turn_confidence_threshold: 0.4,
      min_turn_silence: 160,
      max_turn_silence: 400,
    };
    ```

    Balanced — most conversational voice agents (e.g., customer support):

    ```javascript theme={null}
    const streamingConfig = {
      end_of_turn_confidence_threshold: 0.4,
      min_turn_silence: 400,
      max_turn_silence: 1280,
    };
    ```

    Conservative — reflective or complex speech (e.g., healthcare, sales, legal):

    ```javascript theme={null}
    const streamingConfig = {
      end_of_turn_confidence_threshold: 0.7,
      min_turn_silence: 800,
      max_turn_silence: 3600,
    };
    ```

    **Disabling turn detection**

    If you're using your own VAD or turn detection model, send a `ForceEndpoint` event to force a turn boundary:

    ```python theme={null}
    ws.send(json.dumps({"type": "ForceEndpoint"}))
    ```

    Or set `end_of_turn_confidence_threshold` to `1` (acoustic-only fallback) or `0` (silence-only). Setting it to `0` is **not recommended** unless you have a custom turn detection model running on top — it forces a turn at every `min_turn_silence`-length pause and fragments mid-sentence thinking pauses.
  </Accordion>
</AccordionGroup>
