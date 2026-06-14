> ## Documentation Index
> Fetch the complete documentation index at: https://assemblyai.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Universal-3 Pro Streaming

> Stream audio and receive real-time transcription results using the Universal-3 Pro Streaming model. The most accurate streaming model for voice agents that demand the highest quality, with best-in-class accuracy and advanced prompting capabilities.

Supports: English, Spanish, German, French, Portuguese, and Italian.

To use the EU server for Real-time STT, replace `streaming.assemblyai.com` with
`streaming.eu.assemblyai.com`.




## AsyncAPI

````yaml api-reference/specs/usm-streaming-u3-pro.yaml streamingU3Pro
id: streamingU3Pro
title: Streaming u3 pro
description: >
  Stream audio and receive real-time transcription results using the Universal-3
  Pro Streaming model. The most accurate streaming model for voice agents that
  demand the highest quality, with best-in-class accuracy and advanced prompting
  capabilities.


  Supports: English, Spanish, German, French, Portuguese, and Italian.


  To use the EU server for Real-time STT, replace `streaming.assemblyai.com`
  with

  `streaming.eu.assemblyai.com`.
servers:
  - id: production
    protocol: wss
    host: streaming.assemblyai.com
    bindings: []
    variables: []
address: /v3/ws
parameters:
  - id: speech_model
    jsonSchema:
      type: string
      description: The speech model to use.
      enum:
        - u3-rt-pro
    description: The speech model to use.
    type: string
    required: true
    deprecated: false
  - id: ApiKey
    jsonSchema:
      type: string
      description: >-
        Use your API key for authentication, or alternatively generate a
        [temporary
        token](/api-reference/universal-3-pro/generate-streaming-token) and pass
        it via the `token` query parameter.
      examples:
        - token YOUR_ASSEMBLYAI_API_KEY
    description: >-
      Use your API key for authentication, or alternatively generate a
      [temporary token](/api-reference/universal-3-pro/generate-streaming-token)
      and pass it via the `token` query parameter.
    type: string
    required: true
    deprecated: false
  - id: agent_context
    jsonSchema:
      type: string
      description: >-
        Your voice agent's spoken text (TTS reply). The model uses this as
        context for the next user turn, which improves accuracy on short or
        ambiguous replies and on spelled-out entities like emails or IDs. Set at
        connection time to seed the model with your agent's opening greeting,
        and/or update mid-stream via `UpdateConfiguration` after each agent
        reply. Each `UpdateConfiguration` replaces the previously set value.
        Maximum ~1500 characters per value. Universal-3 Pro Streaming only. See
        [Context
        Carryover](https://www.assemblyai.com/docs/streaming/universal-3-pro/context-carryover).
      examples:
        - >-
          Welcome to the Krusty Krab, home of the Krabby Patty, may I take your
          order?
    description: >-
      Your voice agent's spoken text (TTS reply). The model uses this as context
      for the next user turn, which improves accuracy on short or ambiguous
      replies and on spelled-out entities like emails or IDs. Set at connection
      time to seed the model with your agent's opening greeting, and/or update
      mid-stream via `UpdateConfiguration` after each agent reply. Each
      `UpdateConfiguration` replaces the previously set value. Maximum ~1500
      characters per value. Universal-3 Pro Streaming only. See [Context
      Carryover](https://www.assemblyai.com/docs/streaming/universal-3-pro/context-carryover).
    type: string
    required: true
    deprecated: false
  - id: encoding
    jsonSchema:
      type: string
      description: Encoding of the audio stream.
      enum:
        - pcm_s16le
        - pcm_mulaw
      default: pcm_s16le
    description: Encoding of the audio stream.
    type: string
    required: true
    deprecated: false
  - id: inactivity_timeout
    jsonSchema:
      type: string
      description: >-
        Optional time in seconds of inactivity before session is terminated
        (integer, minimum 5, maximum 3600). If not set, no inactivity timeout is
        applied.
      examples:
        - '5'
        - '3600'
    description: >-
      Optional time in seconds of inactivity before session is terminated
      (integer, minimum 5, maximum 3600). If not set, no inactivity timeout is
      applied.
    type: string
    required: true
    deprecated: false
  - id: keyterms_prompt
    jsonSchema:
      type: string
      description: >-
        A list of words and phrases to improve recognition accuracy for. See
        [Keyterms
        Prompting](https://www.assemblyai.com/docs/streaming/keyterms-prompting)
        for more details.
    description: >-
      A list of words and phrases to improve recognition accuracy for. See
      [Keyterms
      Prompting](https://www.assemblyai.com/docs/streaming/keyterms-prompting)
      for more details.
    type: string
    required: true
    deprecated: false
  - id: language_detection
    jsonSchema:
      type: string
      description: >-
        Whether to return `language_code` and `language_confidence` in turn
        messages. Universal-3 Pro Streaming natively code-switches between
        English, Spanish, German, French, Portuguese, and Italian by default
        without any necessary configuration.
      enum:
        - 'true'
        - 'false'
      default: 'false'
    description: >-
      Whether to return `language_code` and `language_confidence` in turn
      messages. Universal-3 Pro Streaming natively code-switches between
      English, Spanish, German, French, Portuguese, and Italian by default
      without any necessary configuration.
    type: string
    required: true
    deprecated: false
  - id: max_turn_silence
    jsonSchema:
      type: string
      description: >-
        Maximum silence in milliseconds before the turn is forced to end,
        regardless of punctuation. See [Configuring Turn
        Detection](https://www.assemblyai.com/docs/streaming/universal-3-pro#configuring-turn-detection)
        for configuration details.
      default: '1000'
      examples:
        - '700'
        - '1000'
    description: >-
      Maximum silence in milliseconds before the turn is forced to end,
      regardless of punctuation. See [Configuring Turn
      Detection](https://www.assemblyai.com/docs/streaming/universal-3-pro#configuring-turn-detection)
      for configuration details.
    type: string
    required: true
    deprecated: false
  - id: min_turn_silence
    jsonSchema:
      type: string
      description: >-
        Silence duration in milliseconds before a speculative end-of-turn check.
        If terminal punctuation is found, the turn ends. Otherwise, a partial is
        emitted and the turn continues. See [Configuring Turn
        Detection](https://www.assemblyai.com/docs/streaming/universal-3-pro#configuring-turn-detection)
        for configuration details.
      default: '100'
      examples:
        - '100'
        - '200'
    description: >-
      Silence duration in milliseconds before a speculative end-of-turn check.
      If terminal punctuation is found, the turn ends. Otherwise, a partial is
      emitted and the turn continues. See [Configuring Turn
      Detection](https://www.assemblyai.com/docs/streaming/universal-3-pro#configuring-turn-detection)
      for configuration details.
    type: string
    required: true
    deprecated: false
  - id: prompt
    jsonSchema:
      type: string
      description: >-
        Prompting is a beta feature. Custom transcription instructions for the
        model. When not provided, a default prompt optimized for native turn
        detection is used automatically. See the [Prompting
        Guide](https://www.assemblyai.com/docs/streaming/universal-3-pro/prompting)
        for details.
    description: >-
      Prompting is a beta feature. Custom transcription instructions for the
      model. When not provided, a default prompt optimized for native turn
      detection is used automatically. See the [Prompting
      Guide](https://www.assemblyai.com/docs/streaming/universal-3-pro/prompting)
      for details.
    type: string
    required: true
    deprecated: false
  - id: previous_context_n_turns
    jsonSchema:
      type: string
      description: >-
        Advanced. Maximum number of prior conversation entries (user transcripts
        and any `agent_context` values) carried forward as context for each
        transcription. Set to `0` to disable automatic context carryover
        entirely. Most integrations should leave this at the default.
      default: '3'
    description: >-
      Advanced. Maximum number of prior conversation entries (user transcripts
      and any `agent_context` values) carried forward as context for each
      transcription. Set to `0` to disable automatic context carryover entirely.
      Most integrations should leave this at the default.
    type: string
    required: true
    deprecated: false
  - id: sample_rate
    jsonSchema:
      type: string
      description: Sample rate of the audio stream.
      default: '16000'
      examples:
        - '16000'
        - '48000'
    description: Sample rate of the audio stream.
    type: string
    required: true
    deprecated: false
  - id: speaker_labels
    jsonSchema:
      type: string
      description: >-
        Whether to enable [Streaming Speaker
        Diarization](https://www.assemblyai.com/docs/streaming/label-speakers-and-separate-channels).
        When enabled, each Turn event will include a `speaker_label` field and
        each final word in the `words` array will include a `speaker` field for
        word-level speaker attribution.
      enum:
        - 'true'
        - 'false'
      default: 'false'
    description: >-
      Whether to enable [Streaming Speaker
      Diarization](https://www.assemblyai.com/docs/streaming/label-speakers-and-separate-channels).
      When enabled, each Turn event will include a `speaker_label` field and
      each final word in the `words` array will include a `speaker` field for
      word-level speaker attribution.
    type: string
    required: true
    deprecated: false
  - id: max_speakers
    jsonSchema:
      type: string
      description: >-
        The maximum number of speakers expected in the audio stream (integer,
        1-10). Setting this can improve speaker label accuracy when you know the
        number of speakers in advance. Only used when `speaker_labels` is
        enabled. See [Streaming
        Diarization](https://www.assemblyai.com/docs/streaming/label-speakers-and-separate-channels)
        for more details.
      examples:
        - '2'
        - '4'
    description: >-
      The maximum number of speakers expected in the audio stream (integer,
      1-10). Setting this can improve speaker label accuracy when you know the
      number of speakers in advance. Only used when `speaker_labels` is enabled.
      See [Streaming
      Diarization](https://www.assemblyai.com/docs/streaming/label-speakers-and-separate-channels)
      for more details.
    type: string
    required: true
    deprecated: false
  - id: token
    jsonSchema:
      type: string
      description: >-
        API token for authentication (if using a [temporary
        token](/api-reference/streaming-api/generate-streaming-token)).
    description: >-
      API token for authentication (if using a [temporary
      token](/api-reference/streaming-api/generate-streaming-token)).
    type: string
    required: true
    deprecated: false
  - id: vad_threshold
    jsonSchema:
      type: string
      description: >-
        The confidence threshold (0.0 to 1.0) for classifying audio frames as
        silence. Frames with VAD confidence below this value are considered
        silent. Increase for noisy environments to reduce false speech
        detection.
      default: '0.3'
    description: >-
      The confidence threshold (0.0 to 1.0) for classifying audio frames as
      silence. Frames with VAD confidence below this value are considered
      silent. Increase for noisy environments to reduce false speech detection.
    type: string
    required: true
    deprecated: false
  - id: continuous_partials
    jsonSchema:
      type: string
      description: >-
        Whether to emit additional partial transcripts during long turns at a
        steady ~3 second cadence. When enabled (default), additional partials
        covering the full turn transcript are emitted approximately every 3
        seconds while speech continues. When disabled, only one early partial is
        emitted near turn start. The first partial (at 750ms) is unaffected.
      default: 'true'
    description: >-
      Whether to emit additional partial transcripts during long turns at a
      steady ~3 second cadence. When enabled (default), additional partials
      covering the full turn transcript are emitted approximately every 3
      seconds while speech continues. When disabled, only one early partial is
      emitted near turn start. The first partial (at 750ms) is unaffected.
    type: string
    required: true
    deprecated: false
  - id: include_partial_turns
    jsonSchema:
      type: string
      description: >-
        Whether to emit partial transcripts during the turn. When enabled
        (default), partial transcripts are forwarded as speech is still in
        progress alongside final turns. When disabled, only final turns (with
        end_of_turn true) are sent. Defaults to false when redact_pii is
        enabled, to prevent unredacted partial transcripts from reaching the
        client; set explicitly to true to override.
      default: 'true'
    description: >-
      Whether to emit partial transcripts during the turn. When enabled
      (default), partial transcripts are forwarded as speech is still in
      progress alongside final turns. When disabled, only final turns (with
      end_of_turn true) are sent. Defaults to false when redact_pii is enabled,
      to prevent unredacted partial transcripts from reaching the client; set
      explicitly to true to override.
    type: string
    required: true
    deprecated: false
  - id: interruption_delay
    jsonSchema:
      type: string
      description: >-
        How soon the first partial is emitted in milliseconds. Useful for tuning
        voice agent barge-in responsiveness or allowing earlier partials for
        early LLM inference. Larger values are more confident on interruptions,
        smaller values result in faster time to first partial.
      default: '500'
      examples:
        - '0'
        - '500'
    description: >-
      How soon the first partial is emitted in milliseconds. Useful for tuning
      voice agent barge-in responsiveness or allowing earlier partials for early
      LLM inference. Larger values are more confident on interruptions, smaller
      values result in faster time to first partial.
    type: string
    required: true
    deprecated: false
  - id: domain
    jsonSchema:
      type: string
      description: >-
        Enable domain-specific transcription models to improve accuracy for
        specialized terminology. Set to `"medical-v1"` to enable [Medical
        Mode](https://www.assemblyai.com/docs/streaming/medical-mode) for
        improved accuracy of medical terms such as medications, procedures,
        conditions, and dosages. Supported languages: English (`en`), Spanish
        (`es`), German (`de`), French (`fr`). If used with an unsupported
        language, the parameter is ignored and a warning is returned.
      enum:
        - medical-v1
    description: >-
      Enable domain-specific transcription models to improve accuracy for
      specialized terminology. Set to `"medical-v1"` to enable [Medical
      Mode](https://www.assemblyai.com/docs/streaming/medical-mode) for improved
      accuracy of medical terms such as medications, procedures, conditions, and
      dosages. Supported languages: English (`en`), Spanish (`es`), German
      (`de`), French (`fr`). If used with an unsupported language, the parameter
      is ignored and a warning is returned.
    type: string
    required: true
    deprecated: false
  - id: filter_profanity
    jsonSchema:
      type: string
      description: >-
        Filter profanity from the transcribed text, can be true or false. See
        [Profanity
        Filtering](https://www.assemblyai.com/docs/streaming/filter-profanity-from-transcripts)
        for more details.
      enum:
        - 'true'
        - 'false'
      default: 'false'
    description: >-
      Filter profanity from the transcribed text, can be true or false. See
      [Profanity
      Filtering](https://www.assemblyai.com/docs/streaming/filter-profanity-from-transcripts)
      for more details.
    type: string
    required: true
    deprecated: false
  - id: redact_pii
    jsonSchema:
      type: string
      description: >-
        Redact PII from the transcribed text using the Redact PII model, can be
        true or false. Only applies to final turns. See [PII
        Redaction](https://www.assemblyai.com/docs/streaming/pii-redaction) for
        more details.
      enum:
        - 'true'
        - 'false'
      default: 'false'
    description: >-
      Redact PII from the transcribed text using the Redact PII model, can be
      true or false. Only applies to final turns. See [PII
      Redaction](https://www.assemblyai.com/docs/streaming/pii-redaction) for
      more details.
    type: string
    required: true
    deprecated: false
  - id: redact_pii_policies
    jsonSchema:
      type: string
      description: >-
        The list of PII Redaction policies to enable. Requires `redact_pii` to
        be `true`. See [PII
        redaction](https://www.assemblyai.com/docs/streaming/pii-redaction) for
        more details.
    description: >-
      The list of PII Redaction policies to enable. Requires `redact_pii` to be
      `true`. See [PII
      redaction](https://www.assemblyai.com/docs/streaming/pii-redaction) for
      more details.
    type: string
    required: true
    deprecated: false
  - id: redact_pii_sub
    jsonSchema:
      type: string
      description: >-
        The replacement logic for detected PII, can be `entity_name` or `hash`.
        Requires `redact_pii` to be `true`. See [PII
        redaction](https://www.assemblyai.com/docs/streaming/pii-redaction) for
        more details.
      enum:
        - entity_name
        - hash
      default: hash
    description: >-
      The replacement logic for detected PII, can be `entity_name` or `hash`.
      Requires `redact_pii` to be `true`. See [PII
      redaction](https://www.assemblyai.com/docs/streaming/pii-redaction) for
      more details.
    type: string
    required: true
    deprecated: false
  - id: llm_gateway
    jsonSchema:
      type: string
      description: >-
        JSON-stringified LLM Gateway configuration that processes each finalized
        turn. Follows the same interface as the [Chat
        Completions](/llm-gateway/chat-completions) endpoint and accepts
        `model`, `messages`, `tools`, `tool_choice`, `post_processing_steps`,
        and `max_tokens`. See [Apply LLM Gateway to
        Streaming](https://www.assemblyai.com/docs/llm-gateway/apply-llm-gateway-to-streaming)
        for the full schema and examples.
    description: >-
      JSON-stringified LLM Gateway configuration that processes each finalized
      turn. Follows the same interface as the [Chat
      Completions](/llm-gateway/chat-completions) endpoint and accepts `model`,
      `messages`, `tools`, `tool_choice`, `post_processing_steps`, and
      `max_tokens`. See [Apply LLM Gateway to
      Streaming](https://www.assemblyai.com/docs/llm-gateway/apply-llm-gateway-to-streaming)
      for the full schema and examples.
    type: string
    required: true
    deprecated: false
bindings: []
operations:
  - &ref_7
    id: sendAudio
    title: Send audio
    description: >-
      Send audio data chunks for transcription. The payload must be of type
      bytes and contain audio data between 50ms and 1000ms in length. When
      streaming from a pre-recorded file, pace the chunks at approximately
      real-time (for example, sleep for the chunk's duration between sends) —
      sending chunks in a tight loop can produce inconsistent Turn messages. See
      the [Universal-3 Pro Streaming
      quickstart](https://www.assemblyai.com/docs/streaming/universal-3-pro) to
      get started.
    type: send
    messages:
      - &ref_18
        id: audioChunk
        contentType: application/octet-stream
        payload:
          - type: string
            format: binary
            x-parser-schema-id: <anonymous-schema-38>
            name: Audio Data Chunk
            description: Client sends audio data as raw binary.
        headers: []
        jsonPayloadSchema:
          type: string
          format: binary
          x-parser-schema-id: <anonymous-schema-38>
        title: Audio Data Chunk
        description: Client sends audio data as raw binary.
        example: >-
          "\\x10\\x00\\x20\\x00\\x30\\x00\\x40\\x00\\x30\\x00\\x20\\x00\\x10\\x00\\x00\\x00\\xf0\\xff\\xe0\\xff\\xd0\\xff\\xc0\\xff"
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: audioChunk
    bindings: []
    extensions: &ref_0
      - id: x-parser-unique-object-id
        value: streamingU3Pro
  - &ref_8
    id: sendUpdateConfiguration
    title: Send update configuration
    description: >-
      Update streaming configuration parameters during an active session. You
      can update `prompt`, `keyterms_prompt`, `min_turn_silence`,
      `max_turn_silence`, `continuous_partials`, `vad_threshold`,
      `interruption_delay`, and `agent_context`.
    type: send
    messages:
      - &ref_19
        id: updateConfiguration
        contentType: application/json
        payload:
          - name: Update Streaming Configuration
            description: >-
              Client message to update streaming configuration parameters during
              an active session.
            type: object
            properties:
              - name: type
                type: string
                description: UpdateConfiguration
                required: true
              - name: prompt
                type: string
                description: >-
                  Prompting is a beta feature. Custom transcription instructions
                  for the model. See the [Prompting
                  Guide](https://www.assemblyai.com/docs/streaming/universal-3-pro/prompting)
                  for details.
                required: false
              - name: keyterms_prompt
                type: array
                description: >-
                  A list of words and phrases to boost recognition for. See
                  [Keyterms
                  Prompting](https://www.assemblyai.com/docs/streaming/keyterms-prompting)
                  for more details.
                required: false
                properties:
                  - name: item
                    type: string
                    required: false
              - name: min_turn_silence
                type: integer
                description: >-
                  Silence duration in milliseconds before a speculative
                  end-of-turn check. See [Configuring Turn
                  Detection](https://www.assemblyai.com/docs/streaming/universal-3-pro#configuring-turn-detection)
                  for configuration details.
                required: false
              - name: max_turn_silence
                type: integer
                description: >-
                  Maximum silence in milliseconds before the turn is forced to
                  end, regardless of punctuation. See [Configuring Turn
                  Detection](https://www.assemblyai.com/docs/streaming/universal-3-pro#configuring-turn-detection)
                  for configuration details.
                required: false
              - name: continuous_partials
                type: boolean
                description: >-
                  Whether to emit additional partial transcripts during long
                  turns at a steady ~3 second cadence. When enabled (default),
                  additional partials covering the full turn transcript are
                  emitted approximately every 3 seconds while speech continues.
                  When disabled, only one early partial is emitted near turn
                  start. The first partial (at 750ms) is unaffected.
                required: false
              - name: vad_threshold
                type: number
                description: >-
                  The confidence threshold (0.0 to 1.0) for classifying audio
                  frames as silence. Frames with VAD confidence below this value
                  are considered silent. Increase for noisy environments to
                  reduce false speech detection.
                required: false
              - name: interruption_delay
                type: integer
                description: >-
                  How soon the first partial is emitted in milliseconds. Useful
                  for tuning voice agent barge-in responsiveness or allowing
                  earlier partials for early LLM inference. Larger values are
                  more confident on interruptions, smaller values result in
                  faster time to first partial.
                required: false
              - name: agent_context
                type: string
                description: >-
                  Your voice agent's most recent spoken reply (TTS text). The
                  model uses this as context for the next user turn, which
                  improves accuracy on short or ambiguous replies and on
                  spelled-out entities like emails or IDs. Each
                  `UpdateConfiguration` replaces the previously set value.
                  Maximum ~1500 characters. See [Context
                  Carryover](https://www.assemblyai.com/docs/streaming/universal-3-pro/context-carryover#passing-your-agents-reply-as-context).
                required: false
        headers: []
        jsonPayloadSchema:
          type: object
          properties:
            type:
              type: string
              const: UpdateConfiguration
              x-parser-schema-id: <anonymous-schema-26>
            prompt:
              type: string
              description: >-
                Prompting is a beta feature. Custom transcription instructions
                for the model. See the [Prompting
                Guide](https://www.assemblyai.com/docs/streaming/universal-3-pro/prompting)
                for details.
              x-parser-schema-id: <anonymous-schema-27>
            keyterms_prompt:
              type: array
              items:
                type: string
                x-parser-schema-id: <anonymous-schema-29>
              description: >-
                A list of words and phrases to boost recognition for. See
                [Keyterms
                Prompting](https://www.assemblyai.com/docs/streaming/keyterms-prompting)
                for more details.
              x-parser-schema-id: <anonymous-schema-28>
            min_turn_silence:
              type: integer
              description: >-
                Silence duration in milliseconds before a speculative
                end-of-turn check. See [Configuring Turn
                Detection](https://www.assemblyai.com/docs/streaming/universal-3-pro#configuring-turn-detection)
                for configuration details.
              x-parser-schema-id: <anonymous-schema-30>
            max_turn_silence:
              type: integer
              description: >-
                Maximum silence in milliseconds before the turn is forced to
                end, regardless of punctuation. See [Configuring Turn
                Detection](https://www.assemblyai.com/docs/streaming/universal-3-pro#configuring-turn-detection)
                for configuration details.
              x-parser-schema-id: <anonymous-schema-31>
            continuous_partials:
              type: boolean
              description: >-
                Whether to emit additional partial transcripts during long turns
                at a steady ~3 second cadence. When enabled (default),
                additional partials covering the full turn transcript are
                emitted approximately every 3 seconds while speech continues.
                When disabled, only one early partial is emitted near turn
                start. The first partial (at 750ms) is unaffected.
              x-parser-schema-id: <anonymous-schema-32>
            vad_threshold:
              type: number
              description: >-
                The confidence threshold (0.0 to 1.0) for classifying audio
                frames as silence. Frames with VAD confidence below this value
                are considered silent. Increase for noisy environments to reduce
                false speech detection.
              x-parser-schema-id: <anonymous-schema-33>
            interruption_delay:
              type: integer
              minimum: 0
              maximum: 1000
              description: >-
                How soon the first partial is emitted in milliseconds. Useful
                for tuning voice agent barge-in responsiveness or allowing
                earlier partials for early LLM inference. Larger values are more
                confident on interruptions, smaller values result in faster time
                to first partial.
              x-parser-schema-id: <anonymous-schema-34>
            agent_context:
              type: string
              description: >-
                Your voice agent's most recent spoken reply (TTS text). The
                model uses this as context for the next user turn, which
                improves accuracy on short or ambiguous replies and on
                spelled-out entities like emails or IDs. Each
                `UpdateConfiguration` replaces the previously set value. Maximum
                ~1500 characters. See [Context
                Carryover](https://www.assemblyai.com/docs/streaming/universal-3-pro/context-carryover#passing-your-agents-reply-as-context).
              x-parser-schema-id: <anonymous-schema-35>
          required:
            - type
          x-parser-schema-id: UpdateConfigurationPayload
        title: Update Streaming Configuration
        description: >-
          Client message to update streaming configuration parameters during an
          active session.
        example: |-
          {
            "type": "UpdateConfiguration",
            "prompt": "Transcribe product names accurately.",
            "keyterms_prompt": [
              "AssemblyAI",
              "Universal-3"
            ],
            "min_turn_silence": 700,
            "max_turn_silence": 1600,
            "agent_context": "Sure — what date would you like to book?"
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: updateConfiguration
    bindings: []
    extensions: *ref_0
  - &ref_9
    id: sendForceEndpoint
    title: Send force endpoint
    description: Manually force an endpoint in the transcription.
    type: send
    messages:
      - &ref_20
        id: forceEndpoint
        contentType: application/json
        payload:
          - name: Force Endpoint
            description: Client message to manually force an endpoint in the transcription.
            type: object
            properties:
              - name: type
                type: string
                description: ForceEndpoint
                required: true
        headers: []
        jsonPayloadSchema:
          type: object
          properties:
            type:
              type: string
              const: ForceEndpoint
              x-parser-schema-id: <anonymous-schema-36>
          required:
            - type
          x-parser-schema-id: ForceEndpointPayload
        title: Force Endpoint
        description: Client message to manually force an endpoint in the transcription.
        example: |-
          {
            "type": "ForceEndpoint"
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: forceEndpoint
    bindings: []
    extensions: *ref_0
  - &ref_10
    id: sendSessionTermination
    title: Send session termination
    description: Gracefully terminate the streaming session.
    type: send
    messages:
      - &ref_21
        id: sessionTermination
        contentType: application/json
        payload:
          - name: Terminate Session (Client Initiated)
            description: Client message to gracefully terminate the streaming session.
            type: object
            properties:
              - name: type
                type: string
                description: Terminate
                required: true
        headers: []
        jsonPayloadSchema:
          type: object
          properties:
            type:
              type: string
              const: Terminate
              x-parser-schema-id: <anonymous-schema-37>
          required:
            - type
          x-parser-schema-id: SessionTerminationPayload
        title: Terminate Session (Client Initiated)
        description: Client message to gracefully terminate the streaming session.
        example: |-
          {
            "type": "<string>"
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: sessionTermination
    bindings: []
    extensions: *ref_0
  - &ref_11
    id: sendKeepAlive
    title: Send keep alive
    description: >-
      Send a keep-alive message to reset the `inactivity_timeout` timer. This is
      not necessary by default — sessions remain open until explicitly
      terminated or until the 3-hour maximum session duration is reached. This
      message is only needed if you have set `inactivity_timeout` and want to
      keep the session open during periods where no audio is being sent.
    type: send
    messages:
      - &ref_22
        id: keepAlive
        contentType: application/json
        payload:
          - name: Keep Alive
            description: >-
              Client message to reset the inactivity timeout timer. This is not
              necessary by default — sessions remain open until explicitly
              terminated or until the 3-hour maximum session duration is
              reached. This message is only needed if you have set
              `inactivity_timeout` and want to keep the session open during
              periods where no audio is being sent.
            type: object
            properties:
              - name: type
                type: string
                description: KeepAlive
                required: true
        headers: []
        jsonPayloadSchema:
          type: object
          properties:
            type:
              type: string
              const: KeepAlive
              x-parser-schema-id: <anonymous-schema-39>
          required:
            - type
          x-parser-schema-id: KeepAlivePayload
        title: Keep Alive
        description: >-
          Client message to reset the inactivity timeout timer. This is not
          necessary by default — sessions remain open until explicitly
          terminated or until the 3-hour maximum session duration is reached.
          This message is only needed if you have set `inactivity_timeout` and
          want to keep the session open during periods where no audio is being
          sent.
        example: |-
          {
            "type": "KeepAlive"
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: keepAlive
    bindings: []
    extensions: *ref_0
  - &ref_1
    id: receiveSessionBegins
    title: Receive session begins
    description: Receive confirmation that the streaming session has successfully started.
    type: receive
    messages:
      - &ref_12
        id: sessionBegins
        contentType: application/json
        payload:
          - name: Session Begins Confirmation
            description: >-
              Server message indicating the streaming session has successfully
              started.
            type: object
            properties:
              - name: type
                type: string
                description: Identifies the type of the message.
                required: true
              - name: id
                type: string
                description: Unique identifier for the streaming session.
                required: true
              - name: expires_at
                type: integer
                description: Unix timestamp indicating when the session will expire.
                required: true
        headers: []
        jsonPayloadSchema:
          type: object
          properties:
            type:
              type: string
              const: Begin
              description: Identifies the type of the message.
              x-parser-schema-id: <anonymous-schema-40>
            id:
              type: string
              format: uuid
              description: Unique identifier for the streaming session.
              x-parser-schema-id: <anonymous-schema-41>
            expires_at:
              type: integer
              description: Unix timestamp indicating when the session will expire.
              x-parser-schema-id: <anonymous-schema-42>
          required:
            - type
            - id
            - expires_at
          x-parser-schema-id: SessionBeginsPayload
        title: Session Begins Confirmation
        description: >-
          Server message indicating the streaming session has successfully
          started.
        example: |-
          {
            "type": "<string>",
            "id": "<string>",
            "expires_at": 123
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: sessionBegins
    bindings: []
    extensions: *ref_0
  - &ref_2
    id: receiveSpeechStarted
    title: Receive speech started
    description: >-
      Receive a notification that speech has been detected. This event is only
      emitted when the model produces a transcript. Every `SpeechStarted` is
      guaranteed to be followed by one or more Turn messages.
    type: receive
    messages:
      - &ref_13
        id: speechStarted
        contentType: application/json
        payload:
          - name: Speech Started
            description: Server message indicating that speech has been detected.
            type: object
            properties:
              - name: type
                type: string
                description: Identifies the type of the message.
                required: true
              - name: timestamp
                type: integer
                description: >-
                  The timestamp in milliseconds when speech was detected,
                  relative to the beginning of the audio stream.
                required: true
              - name: confidence
                type: number
                description: The confidence score that speech has started.
                required: true
        headers: []
        jsonPayloadSchema:
          type: object
          properties:
            type:
              type: string
              const: SpeechStarted
              description: Identifies the type of the message.
              x-parser-schema-id: <anonymous-schema-43>
            timestamp:
              type: integer
              description: >-
                The timestamp in milliseconds when speech was detected, relative
                to the beginning of the audio stream.
              format: ms
              x-parser-schema-id: <anonymous-schema-44>
            confidence:
              type: number
              format: float
              description: The confidence score that speech has started.
              x-parser-schema-id: <anonymous-schema-45>
          required:
            - type
            - timestamp
            - confidence
          x-parser-schema-id: SpeechStartedPayload
        title: Speech Started
        description: Server message indicating that speech has been detected.
        example: |-
          {
            "type": "<string>",
            "timestamp": 123,
            "confidence": 123
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: speechStarted
    bindings: []
    extensions: *ref_0
  - &ref_3
    id: receiveTurn
    title: Receive turn
    description: Receive a formatted turn-based transcription result.
    type: receive
    messages:
      - &ref_14
        id: turn
        contentType: application/json
        payload:
          - name: Formatted Turn Result
            description: >-
              Server message containing a formatted turn-based transcription
              result.
            type: object
            properties:
              - name: type
                type: string
                description: Turn
                required: true
              - name: turn_order
                type: integer
                description: Order of this turn in the conversation.
                required: true
              - name: turn_is_formatted
                type: boolean
                description: >-
                  Whether this turn has been formatted. For Universal-3 Pro
                  Streaming, this always matches `end_of_turn`.
                required: true
              - name: end_of_turn
                type: boolean
                description: >-
                  Whether this marks the end of a turn. See [Turn
                  Detection](https://www.assemblyai.com/docs/streaming/universal-streaming/turn-detection)
                  for more information.
                required: true
              - name: transcript
                type: string
                description: Transcript of all finalized words in the turn.
                required: true
              - name: utterance
                type: string
                description: >-
                  Finalized transcript of the turn, populated only on
                  end_of_turn messages. Empty string on all other Turn messages.
                  Equivalent to transcript when populated.
                required: false
              - name: language_code
                type: string
                description: >-
                  The language of the turn. Only populated when language
                  detection is enabled and an utterance is complete or turn is
                  final.
                required: false
              - name: language_confidence
                type: number
                description: >-
                  The confidence score for the detected language, between 0 (low
                  confidence) and 1 (high confidence). Only populated when
                  language detection is enabled and an utterance is complete or
                  turn is final.
                required: false
              - name: speaker_label
                type: string
                description: >-
                  The speaker label for this turn (e.g. `A`, `B`). Only present
                  when `speaker_labels` is enabled. Short turns with less than
                  approximately 1 second of audio will have the label `UNKNOWN`.
                  See [Streaming
                  Diarization](https://www.assemblyai.com/docs/streaming/label-speakers-and-separate-channels)
                  for more details.
                required: false
              - name: end_of_turn_confidence
                type: number
                description: >-
                  The confidence score that this is the end of a turn, between
                  0.0 (low confidence) and 1.0 (high confidence). For
                  Universal-3 Pro Streaming, this is 1.0 when `end_of_turn` is
                  true and 0.0 otherwise.
                required: true
              - name: words
                type: array
                description: Array of word-level details for this turn.
                required: true
                properties:
                  - name: text
                    type: string
                    description: The transcribed word.
                    required: true
                  - name: start
                    type: integer
                    description: >-
                      Start time in milliseconds relative to the beginning of
                      the audio stream.
                    required: true
                  - name: end
                    type: integer
                    description: >-
                      End time in milliseconds relative to the beginning of the
                      audio stream.
                    required: true
                  - name: confidence
                    type: number
                    description: Confidence score for the word (0.0 to 1.0).
                    required: true
                  - name: word_is_final
                    type: boolean
                    description: Whether the word is final.
                    required: true
                  - name: speaker
                    type: string
                    description: >-
                      The speaker label for this word (e.g. `A`, `B`,
                      `UNKNOWN`). Only present on final words (`word_is_final`
                      is `true`) when `speaker_labels` is enabled. May be absent
                      on individual words even when diarization is enabled —
                      treat absent as unattributed and fall back to the
                      turn-level `speaker_label` if needed. See [Streaming
                      Diarization](https://www.assemblyai.com/docs/streaming/label-speakers-and-separate-channels)
                      for more details.
                    required: false
        headers: []
        jsonPayloadSchema:
          type: object
          properties:
            type:
              type: string
              const: Turn
              x-parser-schema-id: <anonymous-schema-46>
            turn_order:
              type: integer
              description: Order of this turn in the conversation.
              x-parser-schema-id: <anonymous-schema-47>
            turn_is_formatted:
              type: boolean
              description: >-
                Whether this turn has been formatted. For Universal-3 Pro
                Streaming, this always matches `end_of_turn`.
              x-parser-schema-id: <anonymous-schema-48>
            end_of_turn:
              type: boolean
              description: >-
                Whether this marks the end of a turn. See [Turn
                Detection](https://www.assemblyai.com/docs/streaming/universal-streaming/turn-detection)
                for more information.
              x-parser-schema-id: <anonymous-schema-49>
            transcript:
              type: string
              description: Transcript of all finalized words in the turn.
              x-parser-schema-id: <anonymous-schema-50>
            utterance:
              type: string
              description: >-
                Finalized transcript of the turn, populated only on end_of_turn
                messages. Empty string on all other Turn messages. Equivalent to
                transcript when populated.
              x-parser-schema-id: <anonymous-schema-51>
            language_code:
              type: string
              description: >-
                The language of the turn. Only populated when language detection
                is enabled and an utterance is complete or turn is final.
              x-parser-schema-id: <anonymous-schema-52>
            language_confidence:
              type: number
              format: float
              minimum: 0
              maximum: 1
              description: >-
                The confidence score for the detected language, between 0 (low
                confidence) and 1 (high confidence). Only populated when
                language detection is enabled and an utterance is complete or
                turn is final.
              x-parser-schema-id: <anonymous-schema-53>
            speaker_label:
              type: string
              description: >-
                The speaker label for this turn (e.g. `A`, `B`). Only present
                when `speaker_labels` is enabled. Short turns with less than
                approximately 1 second of audio will have the label `UNKNOWN`.
                See [Streaming
                Diarization](https://www.assemblyai.com/docs/streaming/label-speakers-and-separate-channels)
                for more details.
              x-parser-schema-id: <anonymous-schema-54>
            end_of_turn_confidence:
              type: number
              format: float
              minimum: 0
              maximum: 1
              description: >-
                The confidence score that this is the end of a turn, between 0.0
                (low confidence) and 1.0 (high confidence). For Universal-3 Pro
                Streaming, this is 1.0 when `end_of_turn` is true and 0.0
                otherwise.
              x-parser-schema-id: <anonymous-schema-55>
            words:
              type: array
              items:
                type: object
                properties:
                  text:
                    type: string
                    description: The transcribed word.
                    x-parser-schema-id: <anonymous-schema-57>
                  start:
                    type: integer
                    description: >-
                      Start time in milliseconds relative to the beginning of
                      the audio stream.
                    format: ms
                    x-parser-schema-id: <anonymous-schema-58>
                  end:
                    type: integer
                    description: >-
                      End time in milliseconds relative to the beginning of the
                      audio stream.
                    format: ms
                    x-parser-schema-id: <anonymous-schema-59>
                  confidence:
                    type: number
                    format: float
                    minimum: 0
                    maximum: 1
                    description: Confidence score for the word (0.0 to 1.0).
                    x-parser-schema-id: <anonymous-schema-60>
                  word_is_final:
                    type: boolean
                    description: Whether the word is final.
                    x-parser-schema-id: <anonymous-schema-61>
                  speaker:
                    type: string
                    description: >-
                      The speaker label for this word (e.g. `A`, `B`,
                      `UNKNOWN`). Only present on final words (`word_is_final`
                      is `true`) when `speaker_labels` is enabled. May be absent
                      on individual words even when diarization is enabled —
                      treat absent as unattributed and fall back to the
                      turn-level `speaker_label` if needed. See [Streaming
                      Diarization](https://www.assemblyai.com/docs/streaming/label-speakers-and-separate-channels)
                      for more details.
                    x-parser-schema-id: <anonymous-schema-62>
                required:
                  - text
                  - start
                  - end
                  - confidence
                  - word_is_final
                x-parser-schema-id: Word
              description: Array of word-level details for this turn.
              x-parser-schema-id: <anonymous-schema-56>
          required:
            - type
            - turn_order
            - turn_is_formatted
            - end_of_turn
            - transcript
            - end_of_turn_confidence
            - words
          x-parser-schema-id: TurnPayload
        title: Formatted Turn Result
        description: Server message containing a formatted turn-based transcription result.
        example: |-
          {
            "type": "Turn",
            "turn_order": 0,
            "turn_is_formatted": true,
            "end_of_turn": true,
            "transcript": "Hello world.",
            "end_of_turn_confidence": 1,
            "words": [
              {
                "text": "Hello",
                "start": 0,
                "end": 500,
                "confidence": 0.99
              },
              {
                "text": "world.",
                "start": 500,
                "end": 1000,
                "confidence": 0.98
              }
            ]
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: turn
    bindings: []
    extensions: *ref_0
  - &ref_4
    id: receiveSpeakerRevision
    title: Receive speaker revision
    description: >-
      Receive revised speaker labels at the end of a session. Emitted as a
      single message immediately before `Termination` when `speaker_labels` is
      enabled. Contains a `revisions` array with only the turns whose labels
      changed — unchanged turns are omitted. Text and word timestamps are never
      changed — only speaker assignments. Adds approximately 400ms of latency at
      session close. See [Revised speaker
      labels](https://www.assemblyai.com/docs/streaming/label-speakers-and-separate-channels#revised-speaker-labels)
      for details.
    type: receive
    messages:
      - &ref_15
        id: speakerRevision
        contentType: application/json
        payload:
          - name: Revised Speaker Labels
            description: >-
              Server message containing corrected speaker labels for any turns
              that changed. Emitted as a single message after the client sends
              `Terminate`, when `speaker_labels` is enabled. A session may
              produce zero or one `SpeakerRevision` message; if sent, only
              changed turns are included in the `revisions` array. See [Revised
              speaker
              labels](https://www.assemblyai.com/docs/streaming/label-speakers-and-separate-channels#revised-speaker-labels)
              for details.
            type: object
            properties:
              - name: type
                type: string
                description: Identifies the type of the message.
                required: true
              - name: revisions
                type: array
                description: >-
                  Array of turn corrections. Only turns whose speaker labels
                  changed are included.
                required: true
                properties:
                  - name: turn_order
                    type: integer
                    description: >-
                      Matches the `turn_order` of the original Turn message
                      being corrected.
                    required: true
                  - name: speaker_label
                    type: string
                    description: >-
                      The corrected turn-level speaker label (e.g. `A`, `B`,
                      `UNKNOWN`). Replaces the `speaker_label` originally
                      delivered on the matching Turn message.
                    required: true
                  - name: words
                    type: array
                    description: >-
                      Words with corrected per-word `speaker` assignments. Text
                      and timestamps match the original Turn — only the
                      `speaker` field may change.
                    required: true
                    properties:
                      - name: text
                        type: string
                        description: The word text (unchanged from the original Turn).
                        required: true
                      - name: speaker
                        type: string
                        description: >-
                          The revised speaker label for this word (e.g. `A`,
                          `B`, `UNKNOWN`).
                        required: true
                      - name: start
                        type: integer
                        description: >-
                          Start time of the word in milliseconds from the start
                          of the session.
                        required: true
                      - name: end
                        type: integer
                        description: >-
                          End time of the word in milliseconds from the start of
                          the session.
                        required: true
        headers: []
        jsonPayloadSchema:
          type: object
          description: >-
            Sent at the end of a streaming session when `speaker_labels` is
            enabled. Contains corrections for any turns whose speaker labels
            changed. Text content and word timestamps are never changed — only
            speaker assignments.
          properties:
            type:
              type: string
              const: SpeakerRevision
              description: Identifies the type of the message.
              x-parser-schema-id: <anonymous-schema-63>
            revisions:
              type: array
              description: >-
                Array of turn corrections. Only turns whose speaker labels
                changed are included.
              items:
                type: object
                properties:
                  turn_order:
                    type: integer
                    description: >-
                      Matches the `turn_order` of the original Turn message
                      being corrected.
                    x-parser-schema-id: <anonymous-schema-66>
                  speaker_label:
                    type: string
                    nullable: true
                    description: >-
                      The corrected turn-level speaker label (e.g. `A`, `B`,
                      `UNKNOWN`). Replaces the `speaker_label` originally
                      delivered on the matching Turn message.
                    x-parser-schema-id: <anonymous-schema-67>
                  words:
                    type: array
                    description: >-
                      Words with corrected per-word `speaker` assignments. Text
                      and timestamps match the original Turn — only the
                      `speaker` field may change.
                    items:
                      type: object
                      properties:
                        text:
                          type: string
                          description: The word text (unchanged from the original Turn).
                          x-parser-schema-id: <anonymous-schema-70>
                        speaker:
                          type: string
                          description: >-
                            The revised speaker label for this word (e.g. `A`,
                            `B`, `UNKNOWN`).
                          x-parser-schema-id: <anonymous-schema-71>
                        start:
                          type: integer
                          description: >-
                            Start time of the word in milliseconds from the
                            start of the session.
                          x-parser-schema-id: <anonymous-schema-72>
                        end:
                          type: integer
                          description: >-
                            End time of the word in milliseconds from the start
                            of the session.
                          x-parser-schema-id: <anonymous-schema-73>
                      required:
                        - text
                        - speaker
                        - start
                        - end
                      x-parser-schema-id: <anonymous-schema-69>
                    x-parser-schema-id: <anonymous-schema-68>
                required:
                  - turn_order
                  - speaker_label
                  - words
                x-parser-schema-id: <anonymous-schema-65>
              x-parser-schema-id: <anonymous-schema-64>
          required:
            - type
            - revisions
          x-parser-schema-id: SpeakerRevisionPayload
        title: Revised Speaker Labels
        description: >-
          Server message containing corrected speaker labels for any turns that
          changed. Emitted as a single message after the client sends
          `Terminate`, when `speaker_labels` is enabled. A session may produce
          zero or one `SpeakerRevision` message; if sent, only changed turns are
          included in the `revisions` array. See [Revised speaker
          labels](https://www.assemblyai.com/docs/streaming/label-speakers-and-separate-channels#revised-speaker-labels)
          for details.
        example: |-
          {
            "type": "SpeakerRevision",
            "revisions": [
              {
                "turn_order": 3,
                "speaker_label": "B",
                "words": [
                  {
                    "text": "Hello",
                    "speaker": "B",
                    "start": 1200,
                    "end": 1450
                  },
                  {
                    "text": "there.",
                    "speaker": "B",
                    "start": 1450,
                    "end": 1780
                  }
                ]
              },
              {
                "turn_order": 7,
                "speaker_label": "A",
                "words": [
                  {
                    "text": "Got it.",
                    "speaker": "A",
                    "start": 4100,
                    "end": 4520
                  }
                ]
              }
            ]
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: speakerRevision
    bindings: []
    extensions: *ref_0
  - &ref_5
    id: receiveTermination
    title: Receive termination
    description: Receive confirmation that the session has been terminated by the server.
    type: receive
    messages:
      - &ref_16
        id: termination
        contentType: application/json
        payload:
          - name: Session Terminated (Server Confirmation)
            description: >-
              Server message confirming session termination with session
              statistics.
            type: object
            properties:
              - name: type
                type: string
                description: Indicates the session has been terminated.
                required: true
              - name: audio_duration_seconds
                type: integer
                description: Duration of the audio in seconds.
                required: true
              - name: session_duration_seconds
                type: integer
                description: Duration of the session in seconds.
                required: true
        headers: []
        jsonPayloadSchema:
          type: object
          properties:
            type:
              type: string
              const: Termination
              description: Indicates the session has been terminated.
              x-parser-schema-id: <anonymous-schema-74>
            audio_duration_seconds:
              type: integer
              description: Duration of the audio in seconds.
              x-parser-schema-id: <anonymous-schema-75>
            session_duration_seconds:
              type: integer
              description: Duration of the session in seconds.
              x-parser-schema-id: <anonymous-schema-76>
          required:
            - type
            - audio_duration_seconds
            - session_duration_seconds
          x-parser-schema-id: TerminationPayload
        title: Session Terminated (Server Confirmation)
        description: Server message confirming session termination with session statistics.
        example: |-
          {
            "type": "<string>",
            "audio_duration_seconds": 123,
            "session_duration_seconds": 123
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: termination
    bindings: []
    extensions: *ref_0
  - &ref_6
    id: receiveLLMGatewayResponse
    title: Receive l l m gateway response
    description: >-
      Receive an LLM Gateway response for a finalized turn. Emitted once per
      turn when `llm_gateway` is configured on the connection.
    type: receive
    messages:
      - &ref_17
        id: llmGatewayResponse
        contentType: application/json
        payload:
          - name: LLM Gateway Response
            description: >-
              Server message containing an LLM Gateway response for a finalized
              turn.
            type: object
            properties:
              - name: type
                type: string
                description: Identifies the type of the message.
                required: true
              - name: turn_order
                type: integer
                description: >-
                  The order of the finalized turn that triggered the LLM Gateway
                  call.
                required: true
              - name: transcript
                type: string
                description: >-
                  The finalized turn transcript that triggered the LLM Gateway
                  call.
                required: true
              - name: data
                type: object
                description: The chat completions response from the LLM Gateway.
                required: true
                properties:
                  - name: request_id
                    type: string
                    description: Unique identifier for the LLM Gateway request.
                    required: false
                  - name: choices
                    type: array
                    description: Array of completion choices returned by the model.
                    required: false
                    properties:
                      - name: index
                        type: integer
                        description: The index of the choice in the response.
                        required: false
                      - name: message
                        type: object
                        required: false
                        properties:
                          - name: role
                            type: string
                            required: false
                          - name: content
                            type: string
                            description: >-
                              The text content of the model's response. Null
                              when only tool_calls are present.
                            required: false
                          - name: tool_calls
                            type: array
                            description: >-
                              Tool calls requested by the model. Present when
                              the model invokes tools.
                            required: false
                            properties:
                              - name: id
                                type: string
                                description: Unique identifier for the tool call.
                                required: true
                              - name: type
                                type: string
                                enumValues:
                                  - function
                                required: true
                              - name: function
                                type: object
                                required: true
                                properties:
                                  - name: name
                                    type: string
                                    description: The name of the function to call.
                                    required: true
                                  - name: arguments
                                    type: string
                                    description: >-
                                      The arguments to call the function with,
                                      as a JSON-formatted string.
                                    required: true
                      - name: finish_reason
                        type: string
                        description: The reason the model stopped generating tokens.
                        required: false
                  - name: usage
                    type: object
                    description: Token usage statistics for the request.
                    required: false
                    properties:
                      - name: input_tokens
                        type: integer
                        description: Number of tokens in the prompt.
                        required: false
                      - name: output_tokens
                        type: integer
                        description: Number of tokens in the completion.
                        required: false
                      - name: total_tokens
                        type: integer
                        description: Total tokens used (prompt + completion).
                        required: false
                      - name: prompt_tokens_details
                        type: object
                        description: Detailed breakdown of prompt token usage.
                        required: false
                        properties: []
                      - name: completion_tokens_details
                        type: object
                        description: Detailed breakdown of completion token usage.
                        required: false
                        properties: []
                  - name: request
                    type: object
                    description: >-
                      A copy of the original request, excluding `prompt` and
                      `messages`.
                    required: false
                    properties: []
                  - name: response_time
                    type: integer
                    description: The response time in nanoseconds.
                    required: false
                  - name: llm_status_code
                    type: integer
                    description: The status code from the LLM provider.
                    required: false
        headers: []
        jsonPayloadSchema:
          type: object
          properties:
            type:
              type: string
              const: LLMGatewayResponse
              description: Identifies the type of the message.
              x-parser-schema-id: <anonymous-schema-77>
            turn_order:
              type: integer
              description: >-
                The order of the finalized turn that triggered the LLM Gateway
                call.
              x-parser-schema-id: <anonymous-schema-78>
            transcript:
              type: string
              description: >-
                The finalized turn transcript that triggered the LLM Gateway
                call.
              x-parser-schema-id: <anonymous-schema-79>
            data:
              type: object
              description: The chat completions response from the LLM Gateway.
              required: []
              properties:
                request_id:
                  type: string
                  format: uuid
                  description: Unique identifier for the LLM Gateway request.
                  x-parser-schema-id: <anonymous-schema-81>
                choices:
                  type: array
                  items:
                    type: object
                    required: []
                    properties:
                      index:
                        type: integer
                        description: The index of the choice in the response.
                        x-parser-schema-id: <anonymous-schema-84>
                      message:
                        type: object
                        required: []
                        properties:
                          role:
                            type: string
                            x-parser-schema-id: <anonymous-schema-86>
                          content:
                            type: string
                            description: >-
                              The text content of the model's response. Null
                              when only tool_calls are present.
                            x-parser-schema-id: <anonymous-schema-87>
                          tool_calls:
                            type: array
                            items:
                              type: object
                              properties:
                                id:
                                  type: string
                                  description: Unique identifier for the tool call.
                                  x-parser-schema-id: <anonymous-schema-90>
                                type:
                                  type: string
                                  enum:
                                    - function
                                  x-parser-schema-id: <anonymous-schema-91>
                                function:
                                  type: object
                                  properties:
                                    name:
                                      type: string
                                      description: The name of the function to call.
                                      x-parser-schema-id: <anonymous-schema-93>
                                    arguments:
                                      type: string
                                      description: >-
                                        The arguments to call the function with,
                                        as a JSON-formatted string.
                                      x-parser-schema-id: <anonymous-schema-94>
                                  required:
                                    - name
                                    - arguments
                                  x-parser-schema-id: <anonymous-schema-92>
                              required:
                                - id
                                - type
                                - function
                              x-parser-schema-id: <anonymous-schema-89>
                            description: >-
                              Tool calls requested by the model. Present when
                              the model invokes tools.
                            x-parser-schema-id: <anonymous-schema-88>
                        x-parser-schema-id: <anonymous-schema-85>
                      finish_reason:
                        type: string
                        description: The reason the model stopped generating tokens.
                        x-parser-schema-id: <anonymous-schema-95>
                    x-parser-schema-id: <anonymous-schema-83>
                  description: Array of completion choices returned by the model.
                  x-parser-schema-id: <anonymous-schema-82>
                usage:
                  type: object
                  description: Token usage statistics for the request.
                  required: []
                  properties:
                    input_tokens:
                      type: integer
                      description: Number of tokens in the prompt.
                      x-parser-schema-id: <anonymous-schema-97>
                    output_tokens:
                      type: integer
                      description: Number of tokens in the completion.
                      x-parser-schema-id: <anonymous-schema-98>
                    total_tokens:
                      type: integer
                      description: Total tokens used (prompt + completion).
                      x-parser-schema-id: <anonymous-schema-99>
                    prompt_tokens_details:
                      type: object
                      additionalProperties: true
                      required: []
                      properties: {}
                      description: Detailed breakdown of prompt token usage.
                      x-parser-schema-id: <anonymous-schema-100>
                    completion_tokens_details:
                      type: object
                      additionalProperties: true
                      required: []
                      properties: {}
                      description: Detailed breakdown of completion token usage.
                      x-parser-schema-id: <anonymous-schema-101>
                  x-parser-schema-id: <anonymous-schema-96>
                request:
                  type: object
                  additionalProperties: true
                  required: []
                  properties: {}
                  description: >-
                    A copy of the original request, excluding `prompt` and
                    `messages`.
                  x-parser-schema-id: <anonymous-schema-102>
                response_time:
                  type: integer
                  description: The response time in nanoseconds.
                  x-parser-schema-id: <anonymous-schema-103>
                llm_status_code:
                  type: integer
                  description: The status code from the LLM provider.
                  x-parser-schema-id: <anonymous-schema-104>
              x-parser-schema-id: <anonymous-schema-80>
          required:
            - type
            - turn_order
            - transcript
            - data
          x-parser-schema-id: LLMGatewayResponsePayload
        title: LLM Gateway Response
        description: >-
          Server message containing an LLM Gateway response for a finalized
          turn.
        example: |-
          {
            "type": "LLMGatewayResponse",
            "turn_order": 0,
            "transcript": "Hello world.",
            "data": {
              "request_id": "3c90c3cc-0d44-4b50-8888-8dd25736052a",
              "choices": [
                {
                  "index": 0,
                  "message": {
                    "role": "assistant",
                    "content": "Hello! How can I help?"
                  },
                  "finish_reason": "stop"
                }
              ],
              "usage": {
                "input_tokens": 12,
                "output_tokens": 8,
                "total_tokens": 20,
                "prompt_tokens_details": {},
                "completion_tokens_details": {}
              },
              "request": {},
              "response_time": 123456789
            }
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: llmGatewayResponse
    bindings: []
    extensions: *ref_0
sendOperations:
  - *ref_1
  - *ref_2
  - *ref_3
  - *ref_4
  - *ref_5
  - *ref_6
receiveOperations:
  - *ref_7
  - *ref_8
  - *ref_9
  - *ref_10
  - *ref_11
sendMessages:
  - *ref_12
  - *ref_13
  - *ref_14
  - *ref_15
  - *ref_16
  - *ref_17
receiveMessages:
  - *ref_18
  - *ref_19
  - *ref_20
  - *ref_21
  - *ref_22
extensions:
  - id: x-parser-unique-object-id
    value: streamingU3Pro
securitySchemes: []

````