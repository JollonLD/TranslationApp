import { useEffect, useRef } from "react";
import { captionText, type Caption, type LanguageCode } from "../types";

type TranscriptFeedProps = {
  captions: Caption[];
  partial: Caption | null;
  language?: LanguageCode;
  showOriginal?: boolean;
  emptyText: string;
};

export function TranscriptFeed({
  captions,
  partial,
  language,
  showOriginal = false,
  emptyText,
}: TranscriptFeedProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const latest = language
    ? captions.at(-1)
      ? captionText(captions.at(-1)!, language)
      : partial
        ? captionText(partial, language)
        : ""
    : "";

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [captions.length, partial?.id, latest]);

  if (!captions.length && !partial) {
    return <p className="waiting">{emptyText}</p>;
  }

  return (
    <div className="transcript">
      {captions.map((caption, index) => (
        <p
          key={caption.id}
          className={`transcript-line${index === captions.length - 1 && !partial ? " latest" : ""}`}
        >
          {language ? captionText(caption, language) : caption.translated}
          {showOriginal ? <span className="transcript-original">{caption.original}</span> : null}
        </p>
      ))}
      {partial ? (
        <p className="transcript-line partial" key={partial.id}>
          {language ? captionText(partial, language) : partial.translated}
          {showOriginal ? <span className="transcript-original">{partial.original}</span> : null}
        </p>
      ) : null}
      <div ref={endRef} />
    </div>
  );
}
