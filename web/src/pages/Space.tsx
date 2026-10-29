import { QRCodeSVG } from "qrcode.react";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Flame } from "../components/Flame";
import { TranscriptFeed } from "../components/TranscriptFeed";
import { useMixerPcm } from "../hooks/useMixerPcm";
import { useSpeech } from "../hooks/useSpeech";
import { appendCaption, mergeSpaceCaptions, updateCaption } from "../lib/captions";
import { viewerUrl } from "../lib/lanUrl";
import { getSocket } from "../socket";
import {
  LANGUAGE_LABELS,
  LANGUAGES,
  type Caption,
  type LanguageCode,
  type SpaceState,
} from "../types";

export function Space() {
  const [params] = useSearchParams();
  const skipIntro = params.get("pronto") === "1";
  const [space, setSpace] = useState<SpaceState | null>(null);
  const [publicUrl, setPublicUrl] = useState("");
  const [publicBase, setPublicBase] = useState("");
  const [lanIp, setLanIp] = useState("");
  const [copied, setCopied] = useState(false);
  const [sourceLang, setSourceLang] = useState<LanguageCode>("pt");
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [partial, setPartial] = useState<Caption | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [asrMode, setAsrMode] = useState<"whisperlivekit" | "webspeech">("webspeech");
  const created = useRef(false);
  const publicReady = useRef(false);
  const spaceRef = useRef<SpaceState | null>(null);

  const speech = useSpeech(sourceLang, {
    onTranscript: (text, isFinal) => {
      const live = spaceRef.current;
      if (!live) return;
      getSocket().emit("transcript", { code: live.code, text, isFinal });
    },
  });
  const pcm = useMixerPcm({
    onPcm: (buffer) => {
      const live = spaceRef.current;
      if (!live) return;
      getSocket().emit("asr:pcm", live.code, buffer);
    },
  });
  const useWhisper = asrMode === "whisperlivekit";
  const listening = useWhisper ? pcm.listening : speech.listening;
  const listenError = useWhisper ? pcm.error : speech.error;

  useEffect(() => {
    const socket = getSocket();

    if (created.current) return undefined;
    created.current = true;

    socket.emit(
      "space:create",
      { sourceLang },
      (result: {
        ok: boolean;
        space?: SpaceState;
        publicUrl?: string;
        publicBaseUrl?: string | null;
        addresses?: string[];
        error?: string;
      }) => {
        if (!result.ok || !result.space) {
          setSetupError(result.error ?? "Could not open the space.");
          return;
        }
        spaceRef.current = result.space;
        setSpace(result.space);
        setPublicUrl(result.publicUrl ?? "");
        if (result.publicBaseUrl) {
          publicReady.current = true;
          setPublicBase(result.publicBaseUrl);
        }
        setLanIp(result.addresses?.[0] ?? "");
      },
    );

    const applyNetwork = (network: {
      primary?: string;
      addresses?: string[];
      publicBaseUrl?: string | null;
    }) => {
      if (network.primary) setLanIp(network.primary);
      if (network.publicBaseUrl) {
        publicReady.current = true;
        setPublicBase(network.publicBaseUrl);
      }
    };

    void fetch("/api/network")
      .then((response) => response.json())
      .then(applyNetwork)
      .catch(() => undefined);

    void fetch("/api/asr")
      .then((response) => response.json())
      .then((asr: { mode?: string; ready?: boolean }) => {
        if (asr.mode === "whisperlivekit" && asr.ready) setAsrMode("whisperlivekit");
      })
      .catch(() => undefined);

    const poll = window.setInterval(() => {
      if (publicReady.current) {
        window.clearInterval(poll);
        return;
      }
      void fetch("/api/network")
        .then((response) => response.json())
        .then(applyNetwork)
        .catch(() => undefined);
    }, 2000);

    socket.on("network:public", (payload: { publicBaseUrl?: string }) => {
      if (payload.publicBaseUrl) {
        publicReady.current = true;
        setPublicBase(payload.publicBaseUrl);
      }
    });
    socket.on("space:state", (next: SpaceState) => {
      spaceRef.current = next;
      setSpace(next);
      setCaptions((current) => mergeSpaceCaptions(current, next.captions));
      setPartial(next.lastPartial);
    });
    socket.on("asr:fallback", () => {
      setAsrMode("webspeech");
    });
    socket.on("caption", (caption: Caption) => {
      if (!caption.isFinal) return;
      setPartial(null);
      setCaptions((current) => appendCaption(current, caption));
    });
    socket.on("caption:live", (caption: Caption) => {
      setPartial(caption);
    });
    socket.on("caption:update", (caption: Caption) => {
      setCaptions((current) => updateCaption(current, caption));
    });
    socket.on(
      "space:tail",
      (payload: { code?: string; tail?: string; partial?: Caption | null }) => {
        if (payload.partial) {
          setPartial(payload.partial);
          return;
        }
        setPartial(
          payload.tail
            ? {
                id: "host-tail",
                original: payload.tail,
                translated: payload.tail,
                isFinal: false,
                at: Date.now(),
              }
            : null,
        );
      },
    );

    return () => {
      window.clearInterval(poll);
      socket.off("network:public");
      socket.off("space:state");
      socket.off("caption");
      socket.off("caption:live");
      socket.off("caption:update");
      socket.off("space:tail");
      socket.off("asr:fallback");
    };
  }, []);

  useEffect(() => {
    if (!space) return;
    getSocket().emit("space:languages", {
      code: space.code,
      sourceLang,
    });
  }, [sourceLang, space?.code]);

  useEffect(() => {
    if (!space || !listening) return;
    const restart = useWhisper ? pcm : speech;
    restart.stop();
    void restart.start().then((started) => {
      if (started) {
        getSocket().emit("space:listening", {
          code: space.code,
          listening: true,
          asr: useWhisper ? "whisperlivekit" : "webspeech",
        });
      }
    });
    // Restart capture when the spoken language changes. Hooks are stable enough for this booth control.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceLang]);

  async function toggle() {
    if (!space) return;
    if (listening) {
      pcm.stop();
      speech.stop();
      getSocket().emit("space:listening", { code: space.code, listening: false });
      return;
    }
    const started = useWhisper ? await pcm.start() : await speech.start();
    if (started) {
      getSocket().emit("space:listening", {
        code: space.code,
        listening: true,
        asr: useWhisper ? "whisperlivekit" : "webspeech",
      });
    }
  }

  const qrValue = space
    ? viewerUrl(space.code, publicBase, lanIp) || publicUrl
    : "";

  async function copyUrl() {
    if (!qrValue) return;
    try {
      await navigator.clipboard.writeText(qrValue);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="atmosphere">
      <div className="shell">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center" }}>
          <span className="brand">
            <Flame className="brand-mark" />
            Chiesa Il Faro
          </span>
          {!skipIntro ? (
            <Link className="btn btn-ghost" to="/como-usar">
              How to connect the mixer
            </Link>
          ) : null}
        </div>

        <div className="space-layout" style={{ marginTop: 48 }}>
          <div>
            <p className="kicker">Booth space</p>
            <div className="status" style={{ marginTop: 12 }}>
              <span
                className={`dot ${listening ? "live" : ""}${space?.translateHealth === "down" ? " down" : space?.translateHealth === "degraded" ? " degraded" : ""}`}
              />
              {listening ? "Listening to the mixer" : "Ready to listen"}
              {useWhisper ? " · Whisper" : ""}
              {` · voice in ${LANGUAGE_LABELS[sourceLang]}`}
              {space ? ` · ${Math.max(space.listenerCount, 0)} listening` : ""}
              {space?.translateHealth === "down"
                ? " · translation paused"
                : space?.translateHealth === "degraded"
                  ? " · translation slow"
                  : ""}
            </div>

            <TranscriptFeed
              captions={captions}
              partial={partial}
              language={sourceLang}
              showOriginal
              showPartial
              emptyText="When the service starts, the spoken words will appear here and keep growing."
            />

            <div className="lang-row">
              <select
                className="select"
                value={sourceLang}
                onChange={(event) => setSourceLang(event.target.value as LanguageCode)}
              >
                {LANGUAGES.map((lang) => (
                  <option key={lang} value={lang}>
                    Voice in {LANGUAGE_LABELS[lang]}
                  </option>
                ))}
              </select>
              <p className="original" style={{ margin: 0, alignSelf: "center" }}>
                Each phone chooses its own language.
              </p>
            </div>

            <div className="cta-row">
              <button className="btn" type="button" onClick={toggle} disabled={!space}>
                {listening ? "Stop" : "Start"}
              </button>
              {space ? (
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => {
                    pcm.stop();
                    speech.stop();
                    getSocket().emit("space:end", { code: space.code });
                    spaceRef.current = null;
                    setSpace(null);
                    window.location.href = "/";
                  }}
                >
                  End space
                </button>
              ) : null}
            </div>
            {setupError ? <p className="error">{setupError}</p> : null}
            {listenError ? <p className="error">{listenError}</p> : null}
            {!speech.supported ? (
              <p className="error">Use Chrome or Edge on this computer to capture audio.</p>
            ) : null}
          </div>

          <aside className="qr-stage">
            {space && qrValue ? (
              <>
                <div className="qr-frame">
                  <QRCodeSVG
                    value={qrValue}
                    size={280}
                    level="M"
                    includeMargin
                    bgColor="#f6efe0"
                    fgColor="#14110d"
                  />
                </div>
                <div className="qr-code">{space.code}</div>
                <a className="qr-url" href={qrValue}>
                  {qrValue}
                </a>
                <button className="btn btn-ghost" type="button" onClick={() => void copyUrl()}>
                  {copied ? "Link copied" : "Copy link"}
                </button>
              </>
            ) : (
              <p className="original">Creating QR…</p>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
