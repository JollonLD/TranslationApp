import { useRef, useState } from "react";

const RAW_AUDIO = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  voiceIsolation: false,
} as MediaTrackConstraints;

const TARGET_RATE = 16_000;

function resampleToPcm(input: Float32Array, fromRate: number) {
  const ratio = fromRate / TARGET_RATE;
  const length = Math.max(1, Math.round(input.length / ratio));
  const pcm = new ArrayBuffer(length * 2);
  const view = new DataView(pcm);
  let offsetIn = 0;
  for (let i = 0; i < length; i += 1) {
    const next = Math.min(input.length, Math.round((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let j = offsetIn; j < next; j += 1) {
      sum += input[j] ?? 0;
      count += 1;
    }
    const sample = count ? sum / count : 0;
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offsetIn = next;
  }
  return pcm;
}

type PcmHandlers = {
  onPcm: (pcm: ArrayBuffer) => void;
};

/** Mixer line-in as 16 kHz s16le PCM for the local WhisperLiveKit sidecar. */
export function useMixerPcm(handlers: PcmHandlers) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);

  async function start() {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser cannot open the mixer input.");
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: RAW_AUDIO });
      const context = new AudioContext();
      await context.audioWorklet.addModule("/pcm-worklet.js");
      const source = context.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(context, "pcm-forwarder", {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
      });
      source.connect(worklet);
      const rate = context.sampleRate;
      worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
        const floats = event.data;
        if (!floats?.length) return;
        handlersRef.current.onPcm(resampleToPcm(floats, rate));
      };
      streamRef.current = stream;
      contextRef.current = context;
      workletRef.current = worklet;
      setListening(true);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open the mixer input.");
      setListening(false);
      return false;
    }
  }

  function stop() {
    workletRef.current?.disconnect();
    workletRef.current = null;
    void contextRef.current?.close();
    contextRef.current = null;
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    setListening(false);
  }

  return { listening, error, start, stop, supported: true };
}
