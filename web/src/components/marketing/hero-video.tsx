"use client";

import { useEffect, useRef } from "react";

/**
 * Hero explainer: a silent, looping one-take animation (source in `video/`) of a document
 * travelling through DocuMind: upload, indexing, a question, a cited answer, the PDF page.
 * Autoplays muted (the only kind browsers allow); reduced motion keeps it on the poster frame.
 */
export function HeroVideo() {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      if (query.matches) video.pause();
      else void video.play().catch(() => {});
    };
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return (
    <figure className="w-full">
      <video
        ref={ref}
        className="aspect-video w-full rounded-xl bg-muted ring-1 ring-border"
        poster="/documind-explainer-poster.jpg"
        width={1280}
        height={720}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        aria-label="A document is uploaded and indexed. A question is typed, and DocuMind answers with a citation that opens the exact PDF page."
      >
        <source src="/documind-explainer.mp4" type="video/mp4" />
      </video>
    </figure>
  );
}
