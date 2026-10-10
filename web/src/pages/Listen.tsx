import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Flame } from "../components/Flame";
import { TranscriptFeed } from "../components/TranscriptFeed";
import { appendCaption, mergeSpaceCaptions } from "../lib/captions";
import { getSocket } from "../socket";
import {
  LANGUAGE_LABELS,
  LANGUAGES,
  RTL_LANGUAGES,
  isLanguage,
  preferredReadLang,
  type Caption,
  type LanguageCode,
  type SpaceState,
} from "../types";

const SIZES = ["1.7rem", "2.1rem", "2.7rem", "3.4rem"];

export function Listen() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const [space, setSpace] = useState<SpaceState | null>(null);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [connected, setConnected] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [size, setSize] = useState(1);
  const [readLang, setReadLang] = useState<LanguageCode>(preferredReadLang);
  const translateHealth = space?.translateHealth ?? "ok";
  const showHealthBanner = Boolean(space && !ended && translateHealth === "down");

  useEffect(() => {
    document.documentElement.style.setProperty("--caption-size", SIZES[size]);
  }, [size]);

  useEffect(() => {
    window.localStorage.setItem("palavra-read-lang", readLang);
  }, [readLang]);

  useEffect(() => {
    if (!code) return;
    const socket = getSocket();
    setError(null);
    setEnded(false);
    setCaptions([]);

    const applyState = (next: SpaceState) => {
      setSpace(next);
      setCaptions((current) => mergeSpaceCaptions(current, next.captions));
    };

    const join = () => {
      socket.emit(
        "space:join",
        { code, role: "listener", targetLang: readLang },
        (result: { ok: boolean; space?: SpaceState; error?: string }) => {
          if (!result.ok || !result.space) {
            setError(result.error ?? "Could not join this space.");
            setSpace(null);
            return;
          }
          applyState(result.space);
        },
      );
    };

    socket.on("connect", () => {
      setConnected(true);
      join();
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("space:state", applyState);
    socket.on("caption", (caption: Caption) => {
      if (!caption.isFinal) return;
      setCaptions((current) => appendCaption(current, caption));
    });
    socket.on("space:ended", () => {
      setEnded(true);
      setSpace(null);
    });

    if (socket.connected) {
      setConnected(true);
      join();
    }

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("space:state");
      socket.off("caption");
      socket.off("space:ended");
    };
  }, [code]);

  useEffect(() => {
    if (!code || !connected) return;
    getSocket().emit(
      "space:viewLanguage",
      { code, lang: readLang },
      (result?: { ok?: boolean; space?: SpaceState }) => {
        if (result?.space) {
          setSpace(result.space);
          setCaptions((current) => mergeSpaceCaptions(current, result.space!.captions));
        }
      },
    );
  }, [code, connected, readLang]);

  function goToCode(event: FormEvent) {
    event.preventDefault();
    const clean = manualCode.trim().toUpperCase();
    if (clean) navigate(`/ouvir/${clean}`);
  }

  const rtl = RTL_LANGUAGES.has(readLang);

  return (
    <div className={`atmosphere listen-page${rtl ? " rtl" : ""}`} data-lang={readLang}>
      <div className="listen">
        <header className="listen-top">
          <span className="brand">
            <Flame className="brand-mark" />
            Chiesa Il Faro
          </span>
          <label className="listen-lang-wrap">
            <span className="sr-only">Language</span>
            <select
              className="select listen-lang"
              value={readLang}
              onChange={(event) => {
                const next = event.target.value;
                if (isLanguage(next)) setReadLang(next);
              }}
              aria-label="Read in"
            >
              {LANGUAGES.map((lang) => (
                <option key={lang} value={lang}>
                  {LANGUAGE_LABELS[lang]}
                </option>
              ))}
            </select>
          </label>
          <div className="status">
            <span className={`dot ${connected && space && !ended ? "live" : ""}`} />
            {ended
              ? "Space ended"
              : !code
                ? "Enter the code"
                : !connected
                  ? "No connection"
                  : space
                    ? `Live · ${LANGUAGE_LABELS[readLang]}`
                    : "Looking…"}
          </div>
          <div className="sizes" aria-label="Text size">
            <button type="button" onClick={() => setSize((value) => Math.max(0, value - 1))}>
              A-
            </button>
            <button type="button" onClick={() => setSize((value) => Math.min(SIZES.length - 1, value + 1))}>
              A+
            </button>
          </div>
        </header>

        <main className="listen-body">
          {showHealthBanner ? (
            <p className="health-banner" role="status">
              Translation paused — still listening
            </p>
          ) : null}
          {error || ended || !code ? (
            <div>
              <p className={`waiting ${error || ended ? "error" : ""}`}>
                {ended
                  ? "This space has ended."
                  : error || "Scan the booth QR or enter the code."}
              </p>
              <form className="field" style={{ marginTop: 24 }} onSubmit={goToCode}>
                <input
                  value={manualCode}
                  onChange={(event) => setManualCode(event.target.value)}
                  placeholder="IGREJA-A3F2"
                  autoCapitalize="characters"
                />
                <button className="btn" type="submit">
                  Join
                </button>
              </form>
              <p style={{ marginTop: 18 }}>
                <Link to="/">Back</Link>
              </p>
            </div>
          ) : (
            <TranscriptFeed
              captions={captions}
              partial={null}
              language={readLang}
              showPartial={false}
              emptyText="Waiting for the word…"
            />
          )}
        </main>
      </div>
    </div>
  );
}
