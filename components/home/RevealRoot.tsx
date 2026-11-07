"use client";

import { useEffect } from "react";

/**
 * Scroll entrances, once. Everything is visible in the server HTML. After hydration, only the parts that are still
 * below the fold get the hidden state, and each is shown (with its --i stagger) when it scrolls into view.
 * Parts already in view are never hidden, so nothing flickers; under reduced motion nothing is hidden at all.
 */
export function RevealRoot() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timers: number[] = [];
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target;
          el.classList.add("rv-in");
          io.unobserve(el);
          // Once shown, drop the entrance classes so the part keeps its own transitions.
          timers.push(window.setTimeout(() => el.classList.remove("rv-hide", "rv-in"), 2000));
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    );
    for (const el of document.querySelectorAll<HTMLElement>("[data-reveal]")) {
      if (el.getBoundingClientRect().top < window.innerHeight * 0.92) continue;
      el.classList.add("rv-hide");
      io.observe(el);
    }
    // Parts at the very foot of the page can sit inside the observer margin: show whatever is left once the end is reached.
    const onScroll = () => {
      if (window.scrollY + window.innerHeight < document.documentElement.scrollHeight - 4) return;
      for (const el of document.querySelectorAll<HTMLElement>(".rv-hide:not(.rv-in)")) el.classList.add("rv-in");
      window.removeEventListener("scroll", onScroll);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      io.disconnect();
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, []);
  return null;
}
