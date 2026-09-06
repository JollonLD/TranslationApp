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

export function useSpeech(lang: LanguageCode, handlers: SpeechHandlers) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const shouldRun = useRef(false);
  const listeningRef = useRef(false);
  const restartTimer = useRef<number | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const clearRestart = () => {
    if (restartTimer.current !== null) {
      window.clearTimeout(restartTimer.current);
      restartTimer.current = null;
    }
  };

  const armRestart = useCallback((recognition: SpeechRecognition) => {
    clearRestart();
    restartTimer.current = window.setTimeout(() => {
      if (!shouldRun.current) return;
      try {
        recognition.start();
      } catch {
        try {
          recognition.stop();
        } catch {
          /* already stopped */
        }
        restartTimer.current = window.setTimeout(() => {
          if (!shouldRun.current) return;
          try {
            recognition.start();
          } catch {
            setListening(false);
          }
        }, 250);
      }
    }, 80);
  }, []);

  const stop = useCallback(() => {
    shouldRun.current = false;
    listeningRef.current = false;
    clearRestart();
    recognitionRef.current?.abort();
    setListening(false);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    if (!isSpeechSupported()) {
      setError("Open this space in Chrome or Edge. Speech recognition does not work in this browser.");
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
    } catch {
      setError("No microphone access. Connect the mixer to the computer and allow the microphone in Chrome.");
      return false;
    }

    recognitionRef.current?.abort();
    const recognition = getRecognition();
    if (!recognition) return false;

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = SPEECH_LOCALES[lang];
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      listeningRef.current = true;
      setListening(true);
    };
    recognition.onresult = (event) => {
      let interim = "";
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const piece = event.results[i][0]?.transcript ?? "";
        if (event.results[i].isFinal) finalText += `${piece} `;
        else interim += piece;
      }
      if (finalText.trim()) handlersRef.current.onTranscript(finalText.trim(), true);
      else if (interim.trim()) handlersRef.current.onTranscript(interim.trim(), false);
    };
    recognition.onerror = (event) => {
      if (event.error === "not-allowed") {
        setError("Microphone permission denied.");
        shouldRun.current = false;
        listeningRef.current = false;
        setListening(false);
        return;
      }
      if (RECOVERABLE.has(event.error)) return;
      setError("Listening failed. Tap Start again.");
    };
    recognition.onend = () => {
      listeningRef.current = false;
      if (shouldRun.current) {
        armRestart(recognition);
      } else {
        setListening(false);
      }
    };

    recognitionRef.current = recognition;
    shouldRun.current = true;
    recognition.start();
    return true;
  }, [armRestart, lang]);

  useEffect(() => {
    const watchdog = window.setInterval(() => {
      if (!shouldRun.current || listeningRef.current || !recognitionRef.current) return;
      armRestart(recognitionRef.current);
    }, 2500);

    return () => {
      window.clearInterval(watchdog);
      shouldRun.current = false;
      clearRestart();
      recognitionRef.current?.abort();
    };
  }, [armRestart]);

  return { listening, error, start, stop, supported: isSpeechSupported() };
}
