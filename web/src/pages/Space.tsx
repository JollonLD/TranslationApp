import { QRCodeSVG } from "qrcode.react";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Flame } from "../components/Flame";
import { TranscriptFeed } from "../components/TranscriptFeed";
import { useSpeech } from "../hooks/useSpeech";
import { appendCaption, mergeSpaceCaptions } from "../lib/captions";
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
  const created = useRef(false);
  const publicReady = useRef(false);

  const speech = useSpeech(sourceLang, {
    onTranscript: (text, isFinal) => {
      if (!space) return;
      getSocket().emit("transcript", { code: space.code, text, isFinal });
    },
  });

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
      setSpace(next);
      setCaptions((current) => mergeSpaceCaptions(current, next.captions));
      setPartial(next.lastPartial);
    });
    socket.on("caption", (caption: Caption) => {
      if (!caption.isFinal) return;
      setCaptions((current) => appendCaption(current, caption));
    });
    socket.on(
      "space:tail",
      (payload: { code?: string; tail?: string; partial?: Caption | null }) => {
        setPartial(payload.partial ?? (payload.tail ? {
          id: "host-tail",
          original: payload.tail,
          translated: payload.tail,
          isFinal: false,
          at: Date.now(),
        } : null));
      },
    );

    return () => {
      window.clearInterval(poll);
      socket.off("network:public");
      socket.off("space:state");
      socket.off("caption");
      socket.off("space:tail");
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
    if (!space || !speech.listening) return;
    speech.stop();
    void speech.start().then((started) => {
      if (started) {
        getSocket().emit("space:listening", { code: space.code, listening: true });
      }
    });
  }, [sourceLang]);

  async function toggle() {
    if (!space) return;
    if (speech.listening) {
      speech.stop();
      getSocket().emit("space:listening", { code: space.code, listening: false });
      return;
    }
    const started = await speech.start();
    if (started) {
      getSocket().emit("space:listening", { code: space.code, listening: true });
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
                className={`dot ${speech.listening ? "live" : ""}${space?.translateHealth === "down" ? " down" : space?.translateHealth === "degraded" ? " degraded" : ""}`}
              />
              {speech.listening ? "Listening to the mixer" : "Ready to listen"}
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
                {speech.listening ? "Stop" : "Start"}
              </button>
              {space ? (
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => {
                    speech.stop();
                    getSocket().emit("space:end", { code: space.code });
                    setSpace(null);
                    window.location.href = "/";
                  }}
                >
                  End space
                </button>
              ) : null}
            </div>
            {setupError ? <p className="error">{setupError}</p> : null}
            {speech.error ? <p className="error">{speech.error}</p> : null}
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
