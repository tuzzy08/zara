> ## Documentation Index
> Fetch the complete documentation index at: https://docs.cartesia.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Output Format

> How to find the right parameters for output audio

This page explains how to configure `output_format` for TTS responses (`container`, `encoding`, and `sample_rate`).

In general, use a consistent encoding and sample rate across your audio pipeline (telephony, playback, and storage) to avoid unnecessary transcoding and quality loss.

If you're saving audio samples, we recommend using the [Text-to-Speech (Bytes)](/api-reference/tts/bytes) API
with `output_format.container: "wav"` or `output_format.container: "mp3"` so audio players can automatically detect the encoding and sample rate.

## Reference

<ParamField path="output_format.container" type="string">
  The container format for the audio output.

  Available options: `raw`, `wav`, `mp3`. Only the Bytes endpoint supports all container formats;
  our other endpoints (SSE, Websockets) only support `raw`.
</ParamField>

<ParamField path="output_format.encoding" type="string">
  The encoding of the output audio. Available options: `pcm_f32le`, `pcm_s16le`,
  `pcm_mulaw`, `pcm_alaw`.
</ParamField>

<ParamField path="output_format.sample_rate" type="number">
  The sample rate of the output audio. Remember that to represent a given signal, the sample rate
  must be at least twice the highest frequency component of the signal (Nyquist theorem).

  Available options: `8000`, `16000`, `22050`, `24000`, `44100`, `48000`.
</ParamField>

## `output_format` for RAW (PCM) Audio

When using raw audio, it is important to match the encoding and sample rate with your output device with the `output_format` parameter.

| Encoding    | Bit depth        | Commonly used for                                    | Pair with sample rate |
| ----------- | ---------------- | ---------------------------------------------------- | --------------------- |
| `pcm_mulaw` | 8-bit compressed | North American / Japanese telephony (G.711μ), Twilio | 8000                  |
| `pcm_alaw`  | 8-bit compressed | European / international telephony (G.711A)          | 8000                  |
| `pcm_s16le` | 16-bit int       | Most voice agent platforms, e.g. LiveKit and Pipecat | 16000                 |
| `pcm_f32le` | 32-bit float     | Most browsers                                        | 44100 or 48000        |

### Telephony

#### North America and Japan

Many customers send their audio output over Twilio. All audio sent over Twilio is
transcoded to µ-law encoding with an 8 kHz sample rate.

```json theme={null}
{
  "container": "raw",
  "encoding": "pcm_mulaw",
  "sample_rate": 8000
}
```

#### Europe, India, and others

The standard for European and international telephone networks (G.711A) is 8-bit A-law compressed PCM with an 8 kHz sample rate.

```json theme={null}
{
  "container": "raw",
  "encoding": "pcm_alaw",
  "sample_rate": 8000
}
```

### Voice agent platforms

Many voice agent platforms use `pcm_s16le` at a 16 kHz sample rate in their pipeline. If speech plays alright, then that probably means you're using the right output format.

### Web browsers

When playing audio through the [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API), use `pcm_f32le` to match `AudioContext`.

The sample rate is not fixed: it defaults to whatever the user's output hardware reports, commonly 48 kHz but sometimes 44.1 kHz. Read it from `AudioContext.sampleRate`:

```ts theme={null}
const audioContext = new AudioContext();
console.log(audioContext.sampleRate); // e.g. 48000
```

Match your `output_format.sample_rate` to this value. If it differs, the browser resamples on playback, which adds latency and can degrade quality. You can request a specific rate with `new AudioContext({ sampleRate: 24000 })`, but browsers may error depending on the platform.

### Audio CD quality

Standard audio CDs are encoded as `pcm_s16le` at a 44.1 kHz sample rate.

```json theme={null}
{
  "container": "raw",
  "encoding": "pcm_s16le",
  "sample_rate": 44100
}
```

This performs well for consumer digital audio setups.
