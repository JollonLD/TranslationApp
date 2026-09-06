import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Flame } from "../components/Flame";
import { TranscriptFeed } from "../components/TranscriptFeed";
import { appendCaption, mergeSpaceCaptions } from "../lib/captions";
import { getSocket } from "../socket";
import { LANGUAGE_LABELS, type Caption, type SpaceState } from "../types";

const SIZES = ["1.7rem", "2.1rem", "2.7rem", "3.4rem"];

export function Listen() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const [space, setSpace] = useState<SpaceState | null>(null);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [partial, setPartial] = useState<Caption | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [connected, setConnected] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [size, setSize] = useState(1);

  useEffect(() => {
    document.documentElement.style.setProperty("--caption-size", SIZES[size]);
  }, [size]);

  useEffect(() => {
    if (!code) return;
    const socket = getSocket();
    setError(null);
    setEnded(false);
    setCaptions([]);
    setPartial(null);

    const applyState = (next: SpaceState) => {
      setSpace(next);
      setCaptions((current) => mergeSpaceCaptions(current, next.captions));
      setPartial(next.lastPartial);
    };

    const join = () => {
      socket.emit(
        "space:join",
        { code, role: "listener" },
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
      if (caption.isFinal) {
        setCaptions((current) => appendCaption(current, caption));
        setPartial(null);
        return;
      }
      setPartial(caption);
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

  function goToCode(event: FormEvent) {
    event.preventDefault();
    const clean = manualCode.trim().toUpperCase();
    if (clean) navigate(`/ouvir/${clean}`);
  }

  return (
    <div className="atmosphere listen-page">
      <div className="listen">
        <header className="listen-top">
          <span className="brand">
            <Flame className="brand-mark" />
            Palavra
          </span>
          <div className="status">
            <span className={`dot ${connected && space && !ended ? "live" : ""}`} />
            {ended
              ? "Space ended"
              : !code
                ? "Enter the code"
                : !connected
                  ? "No connection"
                  : space
                    ? `Live · ${LANGUAGE_LABELS[space.sourceLang]} → ${LANGUAGE_LABELS[space.targetLang]}`
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
              partial={partial}
              emptyText="Waiting for the word…"
            />
          )}
        </main>
      </div>
    </div>
  );
}
