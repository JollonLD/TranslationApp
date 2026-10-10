import { useCallback, useEffect, useRef, useState } from "react";
import { captionText, type Caption, type LanguageCode } from "../types";

type TranscriptFeedProps = {
  captions: Caption[];
  partial: Caption | null;
  language?: LanguageCode;
  showOriginal?: boolean;
  showPartial?: boolean;
  emptyText: string;
};

const NEAR_BOTTOM_PX = 48;

export function TranscriptFeed({
  captions,
  partial,
  language,
  showOriginal = false,
  showPartial = false,
  emptyText,
}: TranscriptFeedProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const prevCount = useRef(0);
  const [showJump, setShowJump] = useState(false);
  const [freshId, setFreshId] = useState<string | null>(null);
  const latestId = captions.at(-1)?.id ?? "";
  const visiblePartial = showPartial ? partial : null;

  const isNearBottom = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
  }, []);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: smooth ? "smooth" : "auto",
    });
  }, []);

  const onScroll = () => {
    const near = isNearBottom();
    stickToBottom.current = near;
    setShowJump(!near);
  };

  useEffect(() => {
    const grew = captions.length > prevCount.current;
    const previous = prevCount.current;
    prevCount.current = captions.length;

    if (!grew) return;

    if (previous > 0) {
      setFreshId(latestId);
    }

    if (!stickToBottom.current) {
      setShowJump(true);
      return;
    }
    scrollToBottom(false);
  }, [captions.length, latestId, scrollToBottom]);

  if (!captions.length && !visiblePartial) {
    return <p className="waiting">{emptyText}</p>;
  }

  return (
    <div className="transcript-shell">
      <div className="transcript" ref={scrollerRef} onScroll={onScroll}>
        {captions.map((caption, index) => (
          <p
            key={caption.id}
            className={`transcript-line${index === captions.length - 1 && !visiblePartial ? " latest" : ""}${caption.id === freshId ? " enter" : ""}`}
          >
            {language ? captionText(caption, language) : caption.translated}
            {showOriginal ? <span className="transcript-original">{caption.original}</span> : null}
          </p>
        ))}
        {visiblePartial ? (
          <p className="transcript-line partial" key={visiblePartial.id}>
            {language ? captionText(visiblePartial, language) : visiblePartial.translated}
            {showOriginal ? (
              <span className="transcript-original">{visiblePartial.original}</span>
            ) : null}
          </p>
        ) : null}
      </div>
      {showJump ? (
        <button
          type="button"
          className="back-to-live"
          onClick={() => {
            stickToBottom.current = true;
            setShowJump(false);
            scrollToBottom(true);
          }}
        >
          Back to live
        </button>
      ) : null}
    </div>
  );
}
