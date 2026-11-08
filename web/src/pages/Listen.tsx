import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Flame } from "../components/Flame";
import { TranscriptFeed } from "../components/TranscriptFeed";
import { appendCaption, mergePartial, mergeSpaceCaptions, updateCaption } from "../lib/captions";
import { LISTEN_COPY } from "../lib/listenCopy";
import { getSocket } from "../socket";
import {
  LANGUAGES,
  RTL_LANGUAGES,
  captionText,
  isLanguage,
  preferredReadLang,
  type Caption,
  type LanguageCode,
  type SpaceState,
} from "../types";

/** Extra small steps at the start so a phone can shrink captions further. */
const SIZES = [
  "0.7rem",
  "0.82rem",
  "0.94rem",
  "1.05rem",
  "1.25rem",
  "1.5rem",
  "1.85rem",
  "2.3rem",
  "2.9rem",
  "3.5rem",
];
const SIZE_KEY = "palavra-caption-size";
const SIZE_VERSION_KEY = "palavra-caption-size-v";
const SIZE_VERSION = "2";
const SMALLER_STEPS_ADDED = 3;

function loadSize() {
  try {
    const raw = Number(window.localStorage.getItem(SIZE_KEY));
    const version = window.localStorage.getItem(SIZE_VERSION_KEY);
    let index = Number.isFinite(raw) ? raw : SMALLER_STEPS_ADDED + 2;
    if (version !== SIZE_VERSION) {
      index = Number.isFinite(raw) ? raw + SMALLER_STEPS_ADDED : SMALLER_STEPS_ADDED + 2;
      window.localStorage.setItem(SIZE_VERSION_KEY, SIZE_VERSION);
    }
    if (index >= 0 && index < SIZES.length) return index;
  } catch {
    /* ignore */
  }
  return SMALLER_STEPS_ADDED + 2;
}

type NotesPayload = {
  ok: boolean;
  error?: string;
  fullText?: string;
  lines?: string[];
  summary?: string;
};

export function Listen() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const [space, setSpace] = useState<SpaceState | null>(null);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [connected, setConnected] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [size, setSize] = useState(loadSize);
  const [readLang, setReadLang] = useState<LanguageCode>(preferredReadLang);
  const [partial, setPartial] = useState<Caption | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesBusy, setNotesBusy] = useState(false);
  const [fullText, setFullText] = useState("");
  const [summary, setSummary] = useState("");
  const [notesError, setNotesError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"full" | "summary" | null>(null);
  const notesGen = useRef(0);
  const notesOpenRef = useRef(false);
  const readLangRef = useRef(readLang);
  readLangRef.current = readLang;
  notesOpenRef.current = notesOpen;
  const translateHealth = space?.translateHealth ?? "ok";
  const showHealthBanner = Boolean(space && !ended && translateHealth === "down");

  useEffect(() => {
    document.documentElement.style.setProperty("--caption-size", SIZES[size]);
    window.localStorage.setItem(SIZE_KEY, String(size));
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
    setPartial(null);
    setFullText("");
    setSummary("");
    setNotesError(null);

    const applyState = (next: SpaceState) => {
      setSpace(next);
      setCaptions((current) => mergeSpaceCaptions(current, next.captions));
      setPartial((current) => mergePartial(current, next.lastPartial));
    };

    const join = () => {
      socket.emit(
        "space:join",
        { code, role: "listener", targetLang: readLang },
        (result: { ok: boolean; space?: SpaceState; error?: string }) => {
          if (!result.ok || !result.space) {
            setError(result.error ?? LISTEN_COPY[readLangRef.current].couldNotJoin);
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
      setPartial(null);
      setCaptions((current) => appendCaption(current, caption));
    });
    socket.on("caption:live", (caption: Caption) => {
      setPartial((current) => mergePartial(current, caption));
    });
    socket.on("caption:update", (caption: Caption) => {
      setCaptions((current) => updateCaption(current, caption));
    });
    socket.on("space:ended", () => {
      setEnded(true);
      setSpace(null);
      setPartial(null);
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
      socket.off("caption:live");
      socket.off("caption:update");
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
          setPartial((current) => mergePartial(current, result.space!.lastPartial));
        }
      },
    );
  }, [code, connected, readLang]);

  function goToCode(event: FormEvent) {
    event.preventDefault();
    const clean = manualCode.trim().toUpperCase();
    if (clean) navigate(`/ouvir/${clean}`);
  }

  function loadNotes(lang: LanguageCode, summarize: boolean) {
    if (!code || !connected) return;
    const gen = ++notesGen.current;
    const copy = LISTEN_COPY[lang];
    setNotesBusy(true);
    setNotesError(null);
    getSocket().emit(
      "space:notes",
      { code, lang, summarize },
      (result?: NotesPayload) => {
        if (gen !== notesGen.current) return;
        setNotesBusy(false);
        if (!result?.ok) {
          setNotesError(result?.error ?? copy.couldNotLoad);
          return;
        }
        setFullText(result.fullText ?? "");
        if (summarize) setSummary(result.summary ?? "");
        setNotesOpen(true);
      },
    );
  }

  useEffect(() => {
    setSummary("");
    setFullText("");
    setCopied(null);
    setNotesError(null);
    if (!notesOpenRef.current || !code || !connected || ended) return;
    loadNotes(readLang, false);
    // Reload the open sheet in the newly selected language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readLang]);

  function captionsToText(list: Caption[]) {
    return list
      .filter((item) => item.isFinal)
      .map((item) => captionText(item, readLang).trim())
      .filter(Boolean)
      .join("\n\n");
  }

  function translationDocument(text: string, kind: "translation" | "summary") {
    const copy = LISTEN_COPY[readLang];
    const label = kind === "summary" ? copy.docSummary : copy.docTranslation;
    return `Chiesa Il Faro\n${label}\n${copy.langName}\n${code}\n\n${text.trim()}\n`;
  }

  function translationFileName(kind: "translation" | "summary") {
    const copy = LISTEN_COPY[readLang];
    const slug = kind === "summary" ? copy.fileSummary : copy.fileTranslation;
    const day = new Date().toISOString().slice(0, 10);
    return `chiesa-il-faro-${code || "culto"}-${readLang}-${slug}-${day}.txt`;
  }

  function saveTextFile(filename: string, text: string) {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function downloadTranslation() {
    const lang = readLang;
    const copy = LISTEN_COPY[lang];
    const local = captionsToText(captions);
    if (!code || !connected || ended || !space) {
      if (!local.trim()) {
        setNotesError(copy.noDownload);
        setNotesOpen(true);
        return;
      }
      saveTextFile(translationFileName("translation"), translationDocument(local, "translation"));
      return;
    }

    const gen = ++notesGen.current;
    setNotesBusy(true);
    setNotesError(null);
    getSocket().emit(
      "space:notes",
      { code, lang, summarize: false },
      (result?: NotesPayload) => {
        if (gen !== notesGen.current) return;
        setNotesBusy(false);
        const text = result?.fullText?.trim() || local;
        if (!text) {
          setNotesError(result?.error ?? copy.noDownload);
          setNotesOpen(true);
          return;
        }
        setFullText(text);
        saveTextFile(translationFileName("translation"), translationDocument(text, "translation"));
      },
    );
  }

  async function copyText(kind: "full" | "summary", text: string) {
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      setNotesError(LISTEN_COPY[readLang].couldNotCopy);
    }
  }

  const t = LISTEN_COPY[readLang];
  const rtl = RTL_LANGUAGES.has(readLang);
  const canOpenNotes = Boolean(code && connected && space && !ended);
  const canDownload = Boolean(captions.some((item) => item.isFinal) || canOpenNotes);

  return (
    <div className={`atmosphere listen-page${rtl ? " rtl" : ""}`} data-lang={readLang}>
      <div className="listen">
        <header className="listen-top">
          <span className="brand">
            <Flame className="brand-mark" />
            Chiesa Il Faro
          </span>
          <label className="listen-lang-wrap">
            <span className="sr-only">{t.readIn}</span>
            <select
              className="select listen-lang"
              value={readLang}
              onChange={(event) => {
                const next = event.target.value;
                if (isLanguage(next)) setReadLang(next);
              }}
              aria-label={t.readIn}
            >
              {LANGUAGES.map((lang) => (
                <option key={lang} value={lang}>
                  {LISTEN_COPY[lang].langName}
                </option>
              ))}
            </select>
          </label>
          <div className="status">
            <span className={`dot ${connected && space && !ended ? "live" : ""}`} />
            {ended
              ? t.spaceEnded
              : !code
                ? t.enterCode
                : !connected
                  ? t.noConnection
                  : space
                    ? `${t.live} · ${t.langName}`
                    : t.looking}
          </div>
          <div className="listen-actions">
            <button
              type="button"
              className="notes-open"
              disabled={!canOpenNotes || notesBusy}
              onClick={() => loadNotes(readLang, false)}
            >
              {notesBusy ? "…" : t.text}
            </button>
            <button
              type="button"
              className="notes-open"
              disabled={!canDownload || notesBusy}
              onClick={downloadTranslation}
            >
              {t.download}
            </button>
            <div className="sizes" aria-label={t.textSize}>
              <button type="button" onClick={() => setSize((value) => Math.max(0, value - 1))}>
                A-
              </button>
              <button type="button" onClick={() => setSize((value) => Math.min(SIZES.length - 1, value + 1))}>
                A+
              </button>
            </div>
          </div>
        </header>

        <main className="listen-body">
          {showHealthBanner ? (
            <p className="health-banner" role="status">
              {t.translationPaused}
            </p>
          ) : null}
          {error || ended || !code ? (
            <div>
              <p className={`waiting ${error || ended ? "error" : ""}`}>
                {ended ? t.spaceEndedLong : error || t.scanQr}
              </p>
              <form className="field" style={{ marginTop: 24 }} onSubmit={goToCode}>
                <input
                  value={manualCode}
                  onChange={(event) => setManualCode(event.target.value)}
                  placeholder="IGREJA-A3F2"
                  autoCapitalize="characters"
                />
                <button className="btn" type="submit">
                  {t.join}
                </button>
              </form>
              <p style={{ marginTop: 18 }}>
                <Link to="/">{t.back}</Link>
              </p>
            </div>
          ) : (
            <TranscriptFeed
              captions={captions}
              partial={partial}
              language={readLang}
              showPartial
              emptyText={t.waiting}
            />
          )}
        </main>
      </div>

      {notesOpen ? (
        <div className="notes-sheet" role="dialog" aria-modal="true" aria-label={t.sheet}>
          <div className="notes-backdrop" onClick={() => setNotesOpen(false)} />
          <div className={`notes-panel${rtl ? " rtl" : ""}`}>
            <header className="notes-head">
              <h2>{t.ministry}</h2>
              <button type="button" className="notes-close" onClick={() => setNotesOpen(false)} aria-label={t.close}>
                ×
              </button>
            </header>

            {notesError ? <p className="notes-error">{notesError}</p> : null}

            <section className="notes-section">
              <div className="notes-section-head">
                <h3>{t.summary}</h3>
                <div className="notes-tools">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={notesBusy}
                    onClick={() => loadNotes(readLang, true)}
                  >
                    {notesBusy ? t.generating : summary ? t.refreshSummary : t.generateSummary}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={!summary.trim()}
                    onClick={() => void copyText("summary", summary)}
                  >
                    {copied === "summary" ? t.copied : t.copy}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={!summary.trim()}
                    onClick={() => saveTextFile(translationFileName("summary"), translationDocument(summary, "summary"))}
                  >
                    {t.download}
                  </button>
                </div>
              </div>
              <div className="notes-body">
                {summary.trim() ? summary : t.summaryHint}
              </div>
            </section>

            <section className="notes-section">
              <div className="notes-section-head">
                <h3>{t.full}</h3>
                <div className="notes-tools">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={notesBusy}
                    onClick={() => loadNotes(readLang, false)}
                  >
                    {t.refresh}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={!fullText.trim()}
                    onClick={() => void copyText("full", fullText)}
                  >
                    {copied === "full" ? t.copied : t.copy}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={!fullText.trim() && !captions.some((item) => item.isFinal)}
                    onClick={() => {
                      const text = fullText.trim() || captionsToText(captions);
                      if (!text) return;
                      saveTextFile(translationFileName("translation"), translationDocument(text, "translation"));
                    }}
                  >
                    {t.download}
                  </button>
                </div>
              </div>
              <div className="notes-body notes-full">
                {fullText.trim() || t.noCaptions}
              </div>
            </section>
          </div>
        </div>
      ) : null}
    </div>
  );
}
