// Human-performance parameters with plausible ranges and sources.
// Owned by agent F (research). The engine reads these; it never hard-codes constants.
// Every Range must cite a source. Values marked TODO are placeholders pending verification.

export type Distribution = "uniform" | "triangular" | "lognormal";

export interface Range {
  /** Nominal value used for point estimates. */
  value: number;
  /** Plausible range for Monte Carlo (for lognormal: ~p05 and ~p95). */
  low: number;
  high: number;
  dist: Distribution;
  unit: string;
  /** Short citation, e.g. "Card, Moran & Newell 1980, Table 2". */
  source: string;
  note?: string;
}

export interface Literature {
  klm: {
    /** Keystroke (navigation keys such as Tab, H, arrows). */
    K: Range;
    /** Mouse button press or release (a click is 2B). */
    B: Range;
    /** Mental preparation. */
    M: Range;
    /** Homing between keyboard and mouse. */
    H: Range;
    /** Pointing with a mouse when no layout is available (fallback for Fitts). */
    P: Range;
  };
  /** Silent reading speed for sighted users reading a target passage. */
  reading: { wpm: Range };
  /** Fitts's law, Shannon formulation: MT = a + b * log2(D / W + 1). */
  fitts: {
    mouse: { a: Range; b: Range };
  };
  speech: {
    /** Screen-reader speech rate in words per minute for the modelled population. */
    wpm: Range;
    /** Fraction of a non-target announcement heard before the user moves on. */
    listenFraction: Range;
  };
  typing: {
    /** Seconds per character when filling a field. */
    charSeconds: Range;
  };
  scroll: {
    /** Seconds per viewport-height scrolled with a wheel/trackpad, including re-orientation. */
    secondsPerViewport: Range;
  };
  /** Motor-impaired keyboard users press keys slower; multiplier applied to K for the keyboard persona. */
  keyboardMotorFactor: Range;
  /** Share of screen-reader users whose first strategy on a long page is each option. Sums to 1. */
  screenReaderStrategies: {
    headings: number;
    find: number;
    linear: number;
    landmarks: number;
    tab: number;
    source: string;
  };
}

export const LITERATURE: Literature = {
  klm: {
    K: { value: 0.28, low: 0.12, high: 0.5, dist: "triangular", unit: "s", source: "TODO verify: Card, Moran & Newell 1980 (average non-secretary typist)" },
    B: { value: 0.1, low: 0.08, high: 0.15, dist: "triangular", unit: "s", source: "TODO verify: Card, Moran & Newell 1980" },
    M: { value: 1.35, low: 0.6, high: 2.0, dist: "triangular", unit: "s", source: "TODO verify: Card, Moran & Newell 1980" },
    H: { value: 0.4, low: 0.3, high: 0.5, dist: "triangular", unit: "s", source: "TODO verify: Card, Moran & Newell 1980" },
    P: { value: 1.1, low: 0.8, high: 1.5, dist: "triangular", unit: "s", source: "TODO verify: Card, Moran & Newell 1980" },
  },
  reading: {
    wpm: { value: 238, low: 175, high: 320, dist: "triangular", unit: "words/min", source: "TODO verify: Brysbaert 2019 (silent reading, non-fiction)" },
  },
  fitts: {
    mouse: {
      a: { value: 0.1, low: 0.0, high: 0.25, dist: "uniform", unit: "s", source: "TODO verify: MacKenzie 1992" },
      b: { value: 0.15, low: 0.1, high: 0.25, dist: "uniform", unit: "s/bit", source: "TODO verify: MacKenzie 1992" },
    },
  },
  speech: {
    wpm: { value: 300, low: 180, high: 450, dist: "lognormal", unit: "words/min", source: "TODO verify: screen-reader speech rate studies" },
    listenFraction: { value: 0.5, low: 0.25, high: 1.0, dist: "triangular", unit: "fraction", source: "TODO verify / modelling assumption" },
  },
  typing: {
    charSeconds: { value: 0.28, low: 0.12, high: 0.5, dist: "triangular", unit: "s/char", source: "TODO verify: Card, Moran & Newell 1980" },
  },
  scroll: {
    secondsPerViewport: { value: 0.8, low: 0.4, high: 1.5, dist: "triangular", unit: "s", source: "TODO: modelling assumption" },
  },
  keyboardMotorFactor: { value: 1.0, low: 1.0, high: 3.0, dist: "triangular", unit: "×", source: "TODO verify: motor-impairment keystroke studies" },
  screenReaderStrategies: {
    headings: 0.7,
    find: 0.13,
    linear: 0.08,
    landmarks: 0.03,
    tab: 0.06,
    source: "TODO verify: WebAIM Screen Reader User Survey #10 (2024), 'finding information on a lengthy page'",
  },
};
