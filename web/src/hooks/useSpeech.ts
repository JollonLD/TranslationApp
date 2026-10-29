import { useCallback, useEffect, useRef, useState } from "react";
import { SPEECH_LOCALES, type LanguageCode } from "../types";

type SpeechHandlers = {
  onTranscript: (text: string, isFinal: boolean) => void;
};

function getRecognition(): SpeechRecognition | null {
  const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export function isSpeechSupported() {
  return Boolean(window.SpeechRecognition ?? window.webkitSpeechRecognition);
}

const RECOVERABLE = new Set(["no-speech", "aborted", "network", "audio-capture"]);
/** Recycle less often so Chrome keeps a longer continuous utterance. */
const SOFT_RECYCLE_MS = 90_000;
const WATCHDOG_MS = 2_000;
const MAX_FAILS_BEFORE_ERROR = 3;
/** Slightly slower interim updates → more stable server buffer. */
const INTERIM_THROTTLE_MS = 180;

/** Raw line-in from the mixer — no browser processing / noise filters. */
const RAW_AUDIO = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  voiceIsolation: false,
} as MediaTrackConstraints;

/** Only true disfluencies — keep sermon discourse words (então, assim, aí). */
const FILLER = new Set([
  "uh",
  "um",
  "ah",
  "eh",
  "hm",
  "hmm",
  "hum",
  "hã",
  "hãã",
  "er",
  "tipo",
  "né",
  "ne",
  "well",
  "like",
  "youknow",
]);

function normalizeSpeech(text: string) {
  return text.trim().replace(/\s+/g, " ");
}

function stripFillers(text: string) {
  const words = normalizeSpeech(text).split(" ");
  const kept = words.filter((word) => {
    const bare = word.toLowerCase().replace(/[.,;:!?…]+$/g, "");
    if (!bare) return false;
    if (FILLER.has(bare)) return false;
    if (FILLER.has(bare.replace(/^(tipo|então|entao)$/, ""))) return false;
    return true;
  });
  // Drop stutter repeats: "a a paz" → "a paz"
  const deduped: string[] = [];
  for (const word of kept) {
    const prev = deduped.at(-1);
    if (prev && prev.toLowerCase() === word.toLowerCase() && word.length <= 4) continue;
    deduped.push(word);
  }
  return deduped.join(" ").trim();
}

function isNoiseOnly(text: string) {
  const cleaned = stripFillers(text);
  if (!cleaned) return true;
  // Single filler-like token or very short hum
  if (cleaned.split(" ").length === 1 && cleaned.length <= 3) return true;
  return false;
}

export function useSpeech(lang: LanguageCode, handlers: SpeechHandlers) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const shouldRun = useRef(false);
  const listeningRef = useRef(false);
  const restartTimer = useRef<number | null>(null);
  const recycleTimer = useRef<number | null>(null);
  const lastResultAt = useRef(0);
  const pendingInterim = useRef("");
  const lastSentInterim = useRef("");
  const lastSentFinal = useRef("");
  const lastInterimSentAt = useRef(0);
  const interimThrottleTimer = useRef<number | null>(null);
  const failCount = useRef(0);
  const recycling = useRef(false);
  const langRef = useRef(lang);
  langRef.current = lang;
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const beginSessionRef = useRef<() => boolean>(() => false);

  const clearRestart = () => {
    if (restartTimer.current !== null) {
      window.clearTimeout(restartTimer.current);
      restartTimer.current = null;
    }
  };

  const clearRecycle = () => {
    if (recycleTimer.current !== null) {
      window.clearTimeout(recycleTimer.current);
      recycleTimer.current = null;
    }
  };

  const clearInterimThrottle = () => {
    if (interimThrottleTimer.current !== null) {
      window.clearTimeout(interimThrottleTimer.current);
      interimThrottleTimer.current = null;
    }
  };

  const sendInterimNow = (text: string) => {
    lastSentInterim.current = text;
    lastInterimSentAt.current = Date.now();
    handlersRef.current.onTranscript(text, false);
  };

  const scheduleInterimSend = (text: string) => {
    const elapsed = Date.now() - lastInterimSentAt.current;
    if (!lastSentInterim.current || elapsed >= INTERIM_THROTTLE_MS) {
      clearInterimThrottle();
      sendInterimNow(text);
      return;
    }
    clearInterimThrottle();
    interimThrottleTimer.current = window.setTimeout(() => {
      interimThrottleTimer.current = null;
      const latest = stripFillers(pendingInterim.current);
      if (latest && !isNoiseOnly(latest) && latest !== lastSentInterim.current) {
        sendInterimNow(latest);
      }
    }, INTERIM_THROTTLE_MS - elapsed);
  };

  const flushPendingInterim = () => {
    clearInterimThrottle();
    const leftover = stripFillers(pendingInterim.current);
    pendingInterim.current = "";
    lastSentInterim.current = "";
    // Soft recycle often re-finalizes the same line — skip exact duplicates
    if (
      leftover &&
      !isNoiseOnly(leftover) &&
      leftover.toLowerCase() !== lastSentFinal.current.toLowerCase()
    ) {
      lastSentFinal.current = leftover;
      handlersRef.current.onTranscript(leftover, true);
    }
  };

  const detachRecognition = (hard: boolean) => {
    clearRestart();
    clearRecycle();
    const current = recognitionRef.current;
    recognitionRef.current = null;
    if (!current) return;
    current.onstart = null;
    current.onresult = null;
    current.onerror = null;
    current.onend = null;
    try {
      if (hard) current.abort();
      else current.stop();
    } catch {
      /* already stopped */
    }
  };

  const scheduleRecycle = useCallback(() => {
    clearRecycle();
    const tryRecycle = () => {
      if (!shouldRun.current || !recognitionRef.current) return;
      // Don't recycle while the pastor is still speaking
      if (Date.now() - lastResultAt.current < 3_500) {
        recycleTimer.current = window.setTimeout(tryRecycle, 800);
        return;
      }
      recycling.current = true;
      try {
        recognitionRef.current.stop();
      } catch {
        recycling.current = false;
        flushPendingInterim();
        beginSessionRef.current();
      }
    };
    recycleTimer.current = window.setTimeout(tryRecycle, SOFT_RECYCLE_MS);
  }, []);

  const beginSession = useCallback(() => {
    if (!shouldRun.current) return false;

    if (recognitionRef.current) detachRecognition(true);

    const recognition = getRecognition();
    if (!recognition) {
      setError("Open this space in Chrome or Edge. Speech recognition does not work in this browser.");
      setListening(false);
      return false;
    }

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = SPEECH_LOCALES[langRef.current];
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      listeningRef.current = true;
      recycling.current = false;
      failCount.current = 0;
      lastResultAt.current = Date.now();
      setListening(true);
      setError(null);
      scheduleRecycle();
    };

    recognition.onresult = (event) => {
      failCount.current = 0;
      lastResultAt.current = Date.now();

      let finalText = "";
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const piece = event.results[i][0]?.transcript ?? "";
        if (event.results[i].isFinal) finalText += `${piece} `;
        else interim += piece;
      }

      const cleanFinal = stripFillers(finalText);
      if (cleanFinal && !isNoiseOnly(cleanFinal)) {
        clearInterimThrottle();
        pendingInterim.current = "";
        lastSentInterim.current = "";
        if (cleanFinal.toLowerCase() !== lastSentFinal.current.toLowerCase()) {
          lastSentFinal.current = cleanFinal;
          handlersRef.current.onTranscript(cleanFinal, true);
        }
      }

      const cleanInterim = stripFillers(interim);
      if (cleanInterim && !isNoiseOnly(cleanInterim)) {
        pendingInterim.current = cleanInterim;
        // Send when wording changes (revisions), throttled to avoid flood
        if (cleanInterim !== lastSentInterim.current) {
          scheduleInterimSend(cleanInterim);
        }
      } else if (!cleanFinal) {
        pendingInterim.current = "";
      }
    };

    recognition.onerror = (event) => {
      if (event.error === "not-allowed") {
        setError("Microphone permission denied.");
        shouldRun.current = false;
        listeningRef.current = false;
        setListening(false);
        clearRecycle();
        return;
      }
      if (RECOVERABLE.has(event.error)) return;
      failCount.current += 1;
      if (failCount.current >= MAX_FAILS_BEFORE_ERROR) {
        setError("Listening interrupted. Retrying…");
      }
    };

    recognition.onend = () => {
      listeningRef.current = false;
      clearRecycle();
      flushPendingInterim();
      if (!shouldRun.current) {
        setListening(false);
        return;
      }
      clearRestart();
      const delay = recycling.current ? 30 : 50;
      recycling.current = false;
      restartTimer.current = window.setTimeout(() => {
        if (!shouldRun.current) return;
        const started = beginSessionRef.current();
        if (!started) {
          failCount.current += 1;
          if (failCount.current >= MAX_FAILS_BEFORE_ERROR) {
            setError("Listening interrupted. Retrying…");
          }
        }
      }, delay);
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
      return true;
    } catch {
      failCount.current += 1;
      if (failCount.current >= MAX_FAILS_BEFORE_ERROR) {
        setError("Listening interrupted. Retrying…");
      }
      clearRestart();
      restartTimer.current = window.setTimeout(() => {
        if (shouldRun.current) beginSessionRef.current();
      }, 200);
      return false;
    }
  }, [scheduleRecycle]);

  beginSessionRef.current = beginSession;

  const stop = useCallback(() => {
    shouldRun.current = false;
    listeningRef.current = false;
    recycling.current = false;
    failCount.current = 0;
    flushPendingInterim();
    detachRecognition(true);
    setListening(false);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    if (!isSpeechSupported()) {
      setError("Open this space in Chrome or Edge. Speech recognition does not work in this browser.");
      return false;
    }

    try {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: RAW_AUDIO });
      probe.getTracks().forEach((track) => track.stop());
    } catch {
      setError("No microphone access. Connect the mixer to the computer and allow the microphone in Chrome.");
      return false;
    }

    shouldRun.current = true;
    failCount.current = 0;
    pendingInterim.current = "";
    lastSentInterim.current = "";
    lastResultAt.current = Date.now();
    return beginSession();
  }, [beginSession]);

  useEffect(() => {
    const watchdog = window.setInterval(() => {
      if (!shouldRun.current || listeningRef.current) return;
      beginSessionRef.current();
    }, WATCHDOG_MS);

    return () => {
      window.clearInterval(watchdog);
      shouldRun.current = false;
      detachRecognition(true);
    };
  }, []);

  return { listening, error, start, stop, supported: isSpeechSupported() };
}
