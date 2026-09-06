import { useEffect, useRef } from "react";
import type { Caption } from "../types";

type TranscriptFeedProps = {
  captions: Caption[];
  partial: Caption | null;
  showOriginal?: boolean;
  emptyText: string;
};

export function TranscriptFeed({
  captions,
  partial,
  showOriginal = false,
  emptyText,
}: TranscriptFeedProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [captions.length, partial?.id, partial?.translated]);

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
          {caption.translated}
          {showOriginal ? <span className="transcript-original">{caption.original}</span> : null}
        </p>
      ))}
      {partial ? (
        <p className="transcript-line partial" key={partial.id}>
          {partial.translated}
          {showOriginal ? <span className="transcript-original">{partial.original}</span> : null}
        </p>
      ) : null}
      <div ref={endRef} />
    </div>
  );
}
