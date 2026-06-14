> ## Documentation Index
> Fetch the complete documentation index at: https://assemblyai.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Universal Streaming

> Stream audio and receive real-time transcription results. Fast, cost-effective streaming transcription available in two variants:
- **Universal-Streaming English** — the fastest real-time English transcription
- **Universal-Streaming Multilingual** — multilingual support (English, Spanish, German, French, Portuguese, and Italian) at the same speed and price

To use the EU server for Real-time STT, replace `streaming.assemblyai.com` with
`streaming.eu.assemblyai.com`.




## AsyncAPI

````yaml api-reference/specs/usm-streaming.yaml streaming
id: streaming
title: Streaming
description: >
  Stream audio and receive real-time transcription results. Fast, cost-effective
  streaming transcription available in two variants:

  - **Universal-Streaming English** — the fastest real-time English
  transcription

  - **Universal-Streaming Multilingual** — multilingual support (English,
  Spanish, German, French, Portuguese, and Italian) at the same speed and price


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
      description: The speech model used for your Streaming session.
      enum:
        - universal-streaming-english
        - universal-streaming-multilingual
    description: The speech model used for your Streaming session.
    type: string
    required: true
    deprecated: false
  - id: ApiKey
    jsonSchema:
      type: string
      description: >-
        Use your API key for authentication, or alternatively generate a
        [temporary token](/api-reference/streaming-api/generate-streaming-token)
        and pass it via the `token` query parameter.
      examples:
        - token YOUR_ASSEMBLYAI_API_KEY
    description: >-
      Use your API key for authentication, or alternatively generate a
      [temporary token](/api-reference/streaming-api/generate-streaming-token)
      and pass it via the `token` query parameter.
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
  - id: format_turns
    jsonSchema:
      type: string
      description: Whether to return formatted final transcripts.
      enum:
        - 'true'
        - 'false'
      default: 'false'
    description: Whether to return formatted final transcripts.
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
        Whether to detect the language and return language metadata on
        utterances and final turns. Only available for the multilingual model.
      enum:
        - 'true'
        - 'false'
      default: 'false'
    description: >-
      Whether to detect the language and return language metadata on utterances
      and final turns. Only available for the multilingual model.
    type: string
    required: true
    deprecated: false
  - id: max_turn_silence
    jsonSchema:
      type: string
      description: >-
        The maximum amount of silence in milliseconds allowed in a turn before
        end of turn is triggered. See [Turn
        Detection](https://www.assemblyai.com/docs/streaming/universal-streaming/turn-detection)
        for configuration details.
      default: '1280'
      examples:
        - '700'
        - '1000'
    description: >-
      The maximum amount of silence in milliseconds allowed in a turn before end
      of turn is triggered. See [Turn
      Detection](https://www.assemblyai.com/docs/streaming/universal-streaming/turn-detection)
      for configuration details.
    type: string
    required: true
    deprecated: false
  - id: min_turn_silence
    jsonSchema:
      type: string
      description: >-
        The minimum amount of silence in milliseconds required to detect end of
        turn when confident. See [Turn
        Detection](https://www.assemblyai.com/docs/streaming/universal-streaming/turn-detection)
        for configuration details.
      default: '400'
      examples:
        - '480'
        - '600'
    description: >-
      The minimum amount of silence in milliseconds required to detect end of
      turn when confident. See [Turn
      Detection](https://www.assemblyai.com/docs/streaming/universal-streaming/turn-detection)
      for configuration details.
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
      default: '0.4'
    description: >-
      The confidence threshold (0.0 to 1.0) for classifying audio frames as
      silence. Frames with VAD confidence below this value are considered
      silent. Increase for noisy environments to reduce false speech detection.
    type: string
    required: true
    deprecated: false
  - id: end_of_turn_confidence_threshold
    jsonSchema:
      type: string
      description: >
        The confidence threshold (0.0 to 1.0) to use when determining if the end
        of a turn has been reached. See [Turn
        Detection](https://www.assemblyai.com/docs/streaming/universal-streaming/turn-detection)
        for configuration details.


        Note: This parameter is only supported for the Universal-streaming
        model.
      default: '0.4'
      examples:
        - '0.4'
        - '0.7'
    description: >
      The confidence threshold (0.0 to 1.0) to use when determining if the end
      of a turn has been reached. See [Turn
      Detection](https://www.assemblyai.com/docs/streaming/universal-streaming/turn-detection)
      for configuration details.


      Note: This parameter is only supported for the Universal-streaming model.
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
  - id: language
    jsonSchema:
      type: string
      description: The language of your audio stream. Deprecated.
      enum:
        - en
        - multi
      default: en
    description: The language of your audio stream. Deprecated.
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
  - &ref_6
    id: sendAudio
    title: Send audio
    description: >-
      Send audio data chunks for transcription. The payload must be of type
      bytes and contain audio data between 50ms and 1000ms in length. When
      streaming from a pre-recorded file, pace the chunks at approximately
      real-time (for example, sleep for the chunk's duration between sends) —
      sending chunks in a tight loop can produce inconsistent Turn messages.
    type: send
    messages:
      - &ref_16
        id: audioChunk
        contentType: application/octet-stream
        payload:
          - type: string
            format: binary
            x-parser-schema-id: <anonymous-schema-25>
            name: Audio Data Chunk
            description: Client sends audio data as raw binary.
        headers: []
        jsonPayloadSchema:
          type: string
          format: binary
          x-parser-schema-id: <anonymous-schema-25>
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
        value: streaming
  - &ref_7
    id: sendUpdateConfiguration
    title: Send update configuration
    description: Update streaming configuration parameters during an active session.
    type: send
    messages:
      - &ref_17
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
              - name: end_of_turn_confidence_threshold
                type: number
                description: >-
                  Confidence threshold (0-1) for detecting end of turn. See
                  [Turn
                  Detection](https://www.assemblyai.com/docs/streaming/universal-streaming/turn-detection)
                  for configuration details.
                required: false
              - name: min_turn_silence
                type: integer
                description: >-
                  Minimum silence duration in ms when confident about end of
                  turn. See [Turn
                  Detection](https://www.assemblyai.com/docs/streaming/universal-streaming/turn-detection)
                  for configuration details.
                required: false
              - name: max_turn_silence
                type: integer
                description: >-
                  The maximum amount of silence allowed in a turn before end of
                  turn is triggered. See [Turn
                  Detection](https://www.assemblyai.com/docs/streaming/universal-streaming/turn-detection)
                  for configuration details.
                required: false
        headers: []
        jsonPayloadSchema:
          type: object
          properties:
            type:
              type: string
              const: UpdateConfiguration
              x-parser-schema-id: <anonymous-schema-19>
            end_of_turn_confidence_threshold:
              type: number
              format: float
              description: >-
                Confidence threshold (0-1) for detecting end of turn. See [Turn
                Detection](https://www.assemblyai.com/docs/streaming/universal-streaming/turn-detection)
                for configuration details.
              x-parser-schema-id: <anonymous-schema-20>
            min_turn_silence:
              type: integer
              description: >-
                Minimum silence duration in ms when confident about end of turn.
                See [Turn
                Detection](https://www.assemblyai.com/docs/streaming/universal-streaming/turn-detection)
                for configuration details.
              x-parser-schema-id: <anonymous-schema-21>
            max_turn_silence:
              type: integer
              description: >-
                The maximum amount of silence allowed in a turn before end of
                turn is triggered. See [Turn
                Detection](https://www.assemblyai.com/docs/streaming/universal-streaming/turn-detection)
                for configuration details.
              x-parser-schema-id: <anonymous-schema-22>
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
            "sample_rate": 16000,
            "encoding": "pcm_s16le",
            "format_turns": true,
            "keyterms_prompt": [
              "AssemblyAI",
              "Universal Streaming"
            ]
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: updateConfiguration
    bindings: []
    extensions: *ref_0
  - &ref_8
    id: sendForceEndpoint
    title: Send force endpoint
    description: Manually force an endpoint in the transcription.
    type: send
    messages:
      - &ref_18
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
              x-parser-schema-id: <anonymous-schema-23>
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
  - &ref_9
    id: sendSessionTermination
    title: Send session termination
    description: Gracefully terminate the streaming session.
    type: send
    messages:
      - &ref_19
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
              x-parser-schema-id: <anonymous-schema-24>
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
  - &ref_10
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
      - &ref_20
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
              x-parser-schema-id: <anonymous-schema-26>
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
      - &ref_11
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
              x-parser-schema-id: <anonymous-schema-27>
            id:
              type: string
              format: uuid
              description: Unique identifier for the streaming session.
              x-parser-schema-id: <anonymous-schema-28>
            expires_at:
              type: integer
              description: Unix timestamp indicating when the session will expire.
              x-parser-schema-id: <anonymous-schema-29>
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
    id: receiveTurn
    title: Receive turn
    description: Receive a formatted turn-based transcription result.
    type: receive
    messages:
      - &ref_12
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
                description: Whether this turn has been formatted.
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
                  Finalized text at the moment a pause in speech is detected.
                  Empty string on all other Turn messages. A turn can contain
                  multiple utterances.
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
                  0.0 (low confidence) and 1.0 (high confidence). See [Turn
                  Detection](https://www.assemblyai.com/docs/streaming/universal-streaming/turn-detection)
                  for more information.
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
              x-parser-schema-id: <anonymous-schema-30>
            turn_order:
              type: integer
              description: Order of this turn in the conversation.
              x-parser-schema-id: <anonymous-schema-31>
            turn_is_formatted:
              type: boolean
              description: Whether this turn has been formatted.
              x-parser-schema-id: <anonymous-schema-32>
            end_of_turn:
              type: boolean
              description: >-
                Whether this marks the end of a turn. See [Turn
                Detection](https://www.assemblyai.com/docs/streaming/universal-streaming/turn-detection)
                for more information.
              x-parser-schema-id: <anonymous-schema-33>
            transcript:
              type: string
              description: Transcript of all finalized words in the turn.
              x-parser-schema-id: <anonymous-schema-34>
            utterance:
              type: string
              description: >-
                Finalized text at the moment a pause in speech is detected.
                Empty string on all other Turn messages. A turn can contain
                multiple utterances.
              x-parser-schema-id: <anonymous-schema-35>
            language_code:
              type: string
              description: >-
                The language of the turn. Only populated when language detection
                is enabled and an utterance is complete or turn is final.
              x-parser-schema-id: <anonymous-schema-36>
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
              x-parser-schema-id: <anonymous-schema-37>
            speaker_label:
              type: string
              description: >-
                The speaker label for this turn (e.g. `A`, `B`). Only present
                when `speaker_labels` is enabled. Short turns with less than
                approximately 1 second of audio will have the label `UNKNOWN`.
                See [Streaming
                Diarization](https://www.assemblyai.com/docs/streaming/label-speakers-and-separate-channels)
                for more details.
              x-parser-schema-id: <anonymous-schema-38>
            end_of_turn_confidence:
              type: number
              format: float
              minimum: 0
              maximum: 1
              description: >-
                The confidence score that this is the end of a turn, between 0.0
                (low confidence) and 1.0 (high confidence). See [Turn
                Detection](https://www.assemblyai.com/docs/streaming/universal-streaming/turn-detection)
                for more information.
              x-parser-schema-id: <anonymous-schema-39>
            words:
              type: array
              items:
                type: object
                properties:
                  text:
                    type: string
                    description: The transcribed word.
                    x-parser-schema-id: <anonymous-schema-41>
                  start:
                    type: integer
                    description: >-
                      Start time in milliseconds relative to the beginning of
                      the audio stream.
                    format: ms
                    x-parser-schema-id: <anonymous-schema-42>
                  end:
                    type: integer
                    description: >-
                      End time in milliseconds relative to the beginning of the
                      audio stream.
                    format: ms
                    x-parser-schema-id: <anonymous-schema-43>
                  confidence:
                    type: number
                    format: float
                    minimum: 0
                    maximum: 1
                    description: Confidence score for the word (0.0 to 1.0).
                    x-parser-schema-id: <anonymous-schema-44>
                  word_is_final:
                    type: boolean
                    description: Whether the word is final.
                    x-parser-schema-id: <anonymous-schema-45>
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
                    x-parser-schema-id: <anonymous-schema-46>
                required:
                  - text
                  - start
                  - end
                  - confidence
                  - word_is_final
                x-parser-schema-id: Word
              description: Array of word-level details for this turn.
              x-parser-schema-id: <anonymous-schema-40>
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
            "end_of_turn_confidence": 0.98,
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
  - &ref_3
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
      - &ref_13
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
              x-parser-schema-id: <anonymous-schema-47>
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
                    x-parser-schema-id: <anonymous-schema-50>
                  speaker_label:
                    type: string
                    nullable: true
                    description: >-
                      The corrected turn-level speaker label (e.g. `A`, `B`,
                      `UNKNOWN`). Replaces the `speaker_label` originally
                      delivered on the matching Turn message.
                    x-parser-schema-id: <anonymous-schema-51>
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
                          x-parser-schema-id: <anonymous-schema-54>
                        speaker:
                          type: string
                          description: >-
                            The revised speaker label for this word (e.g. `A`,
                            `B`, `UNKNOWN`).
                          x-parser-schema-id: <anonymous-schema-55>
                        start:
                          type: integer
                          description: >-
                            Start time of the word in milliseconds from the
                            start of the session.
                          x-parser-schema-id: <anonymous-schema-56>
                        end:
                          type: integer
                          description: >-
                            End time of the word in milliseconds from the start
                            of the session.
                          x-parser-schema-id: <anonymous-schema-57>
                      required:
                        - text
                        - speaker
                        - start
                        - end
                      x-parser-schema-id: <anonymous-schema-53>
                    x-parser-schema-id: <anonymous-schema-52>
                required:
                  - turn_order
                  - speaker_label
                  - words
                x-parser-schema-id: <anonymous-schema-49>
              x-parser-schema-id: <anonymous-schema-48>
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
  - &ref_4
    id: receiveTermination
    title: Receive termination
    description: Receive confirmation that the session has been terminated by the server.
    type: receive
    messages:
      - &ref_14
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
              x-parser-schema-id: <anonymous-schema-58>
            audio_duration_seconds:
              type: integer
              description: Duration of the audio in seconds.
              x-parser-schema-id: <anonymous-schema-59>
            session_duration_seconds:
              type: integer
              description: Duration of the session in seconds.
              x-parser-schema-id: <anonymous-schema-60>
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
  - &ref_5
    id: receiveLLMGatewayResponse
    title: Receive l l m gateway response
    description: >-
      Receive an LLM Gateway response for a finalized turn. Emitted once per
      turn when `llm_gateway` is configured on the connection.
    type: receive
    messages:
      - &ref_15
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
              x-parser-schema-id: <anonymous-schema-61>
            turn_order:
              type: integer
              description: >-
                The order of the finalized turn that triggered the LLM Gateway
                call.
              x-parser-schema-id: <anonymous-schema-62>
            transcript:
              type: string
              description: >-
                The finalized turn transcript that triggered the LLM Gateway
                call.
              x-parser-schema-id: <anonymous-schema-63>
            data:
              type: object
              description: The chat completions response from the LLM Gateway.
              required: []
              properties:
                request_id:
                  type: string
                  format: uuid
                  description: Unique identifier for the LLM Gateway request.
                  x-parser-schema-id: <anonymous-schema-65>
                choices:
                  type: array
                  items:
                    type: object
                    required: []
                    properties:
                      index:
                        type: integer
                        description: The index of the choice in the response.
                        x-parser-schema-id: <anonymous-schema-68>
                      message:
                        type: object
                        required: []
                        properties:
                          role:
                            type: string
                            x-parser-schema-id: <anonymous-schema-70>
                          content:
                            type: string
                            description: >-
                              The text content of the model's response. Null
                              when only tool_calls are present.
                            x-parser-schema-id: <anonymous-schema-71>
                          tool_calls:
                            type: array
                            items:
                              type: object
                              properties:
                                id:
                                  type: string
                                  description: Unique identifier for the tool call.
                                  x-parser-schema-id: <anonymous-schema-74>
                                type:
                                  type: string
                                  enum:
                                    - function
                                  x-parser-schema-id: <anonymous-schema-75>
                                function:
                                  type: object
                                  properties:
                                    name:
                                      type: string
                                      description: The name of the function to call.
                                      x-parser-schema-id: <anonymous-schema-77>
                                    arguments:
                                      type: string
                                      description: >-
                                        The arguments to call the function with,
                                        as a JSON-formatted string.
                                      x-parser-schema-id: <anonymous-schema-78>
                                  required:
                                    - name
                                    - arguments
                                  x-parser-schema-id: <anonymous-schema-76>
                              required:
                                - id
                                - type
                                - function
                              x-parser-schema-id: <anonymous-schema-73>
                            description: >-
                              Tool calls requested by the model. Present when
                              the model invokes tools.
                            x-parser-schema-id: <anonymous-schema-72>
                        x-parser-schema-id: <anonymous-schema-69>
                      finish_reason:
                        type: string
                        description: The reason the model stopped generating tokens.
                        x-parser-schema-id: <anonymous-schema-79>
                    x-parser-schema-id: <anonymous-schema-67>
                  description: Array of completion choices returned by the model.
                  x-parser-schema-id: <anonymous-schema-66>
                usage:
                  type: object
                  description: Token usage statistics for the request.
                  required: []
                  properties:
                    input_tokens:
                      type: integer
                      description: Number of tokens in the prompt.
                      x-parser-schema-id: <anonymous-schema-81>
                    output_tokens:
                      type: integer
                      description: Number of tokens in the completion.
                      x-parser-schema-id: <anonymous-schema-82>
                    total_tokens:
                      type: integer
                      description: Total tokens used (prompt + completion).
                      x-parser-schema-id: <anonymous-schema-83>
                    prompt_tokens_details:
                      type: object
                      additionalProperties: true
                      required: []
                      properties: {}
                      description: Detailed breakdown of prompt token usage.
                      x-parser-schema-id: <anonymous-schema-84>
                    completion_tokens_details:
                      type: object
                      additionalProperties: true
                      required: []
                      properties: {}
                      description: Detailed breakdown of completion token usage.
                      x-parser-schema-id: <anonymous-schema-85>
                  x-parser-schema-id: <anonymous-schema-80>
                request:
                  type: object
                  additionalProperties: true
                  required: []
                  properties: {}
                  description: >-
                    A copy of the original request, excluding `prompt` and
                    `messages`.
                  x-parser-schema-id: <anonymous-schema-86>
                response_time:
                  type: integer
                  description: The response time in nanoseconds.
                  x-parser-schema-id: <anonymous-schema-87>
                llm_status_code:
                  type: integer
                  description: The status code from the LLM provider.
                  x-parser-schema-id: <anonymous-schema-88>
              x-parser-schema-id: <anonymous-schema-64>
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
receiveOperations:
  - *ref_6
  - *ref_7
  - *ref_8
  - *ref_9
  - *ref_10
sendMessages:
  - *ref_11
  - *ref_12
  - *ref_13
  - *ref_14
  - *ref_15
receiveMessages:
  - *ref_16
  - *ref_17
  - *ref_18
  - *ref_19
  - *ref_20
extensions:
  - id: x-parser-unique-object-id
    value: streaming
securitySchemes: []

````