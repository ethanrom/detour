// Human-performance parameters with plausible ranges and sources.
// Owned by agent F (research). The engine reads these; it never hard-codes constants.
// Every Range cites a source. Where a value is a modelling assumption rather than a measurement, the
// source or note says so. docs/MODEL.md section 11 is generated from this file (see literature.test.ts).

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
    K: {
      value: 0.2,
      low: 0.12,
      high: 0.28,
      dist: "triangular",
      unit: "s",
      source:
        "Card, Moran & Newell 1980/1983, KLM typist classes as tabulated in Kieras 2001: 0.12 s expert (90 wpm), 0.20 s average skilled (55 wpm), 0.28 s average non-secretary (40 wpm)",
      note: "Nominal is the average-skilled-typist class: Tab, arrow, H and D are single, practised keys, not words. Dhakal et al. 2018 (136 M keystrokes) measured a mean inter-key interval of 0.239 s (fastest decile about 0.12 s), which sits inside this range. Kieras recommends 0.28 s for a casual user. No published study measures single-key times of experienced screen-reader users, so the same range is applied to them (gap).",
    },
    B: {
      value: 0.1,
      low: 0.08,
      high: 0.15,
      dist: "triangular",
      unit: "s",
      source: "Card, Moran & Newell 1983 via Kieras 2001: B = 0.1 s per press or release (a click is BB = 0.2 s)",
      note: "The nominal value is published; the low/high range is a modelling assumption (no published interval).",
    },
    M: {
      value: 1.2,
      low: 0.6,
      high: 1.35,
      dist: "triangular",
      unit: "s",
      source: "Kieras 2001, after Olson & Olson 1990: M = 0.6 to 1.35 s, use 1.2 s (Card, Moran & Newell 1980 used 1.35 s)",
      note: "Charged once per task step. It covers routine decision time for a user who knows the task, not searching an unfamiliar page (see limitations).",
    },
    H: {
      value: 0.4,
      low: 0.3,
      high: 0.5,
      dist: "triangular",
      unit: "s",
      source: "Card, Moran & Newell 1983 via Kieras 2001: H = 0.4 s",
      note: "The nominal value is published; the plus or minus 25% range is a modelling assumption.",
    },
    P: {
      value: 1.1,
      low: 0.8,
      high: 1.5,
      dist: "triangular",
      unit: "s",
      source: "Kieras 2001 / Card, Moran & Newell 1983: P ranges from 0.8 to 1.5 s with an average of 1.1 s (from Fitts's law)",
      note: "Fallback only. Used when the page has no layout rectangles; otherwise pointing is computed from Fitts's law.",
    },
  },
  reading: {
    wpm: {
      value: 238,
      low: 175,
      high: 300,
      dist: "triangular",
      unit: "words/min",
      source: "Brysbaert 2019, J. Memory and Language 109:104047: silent reading of English non-fiction, mean 238 wpm (190 studies, 18,573 readers); most adults 175 to 300 wpm",
      note: "Fiction is faster (260 wpm); Detour tasks read short factual passages.",
    },
  },
  fitts: {
    mouse: {
      a: {
        value: 0.33,
        low: 0.12,
        high: 0.51,
        dist: "triangular",
        unit: "s",
        source: "Soukoreff & MacKenzie 2004, Int. J. Human-Computer Studies 61(6):751-789, Table 3: median (our computation) of eight published Shannon-form mouse-pointing regressions",
        note: "The eight intercepts run from 0.12 to 0.51 s, apart from one negative intercept (MacKenzie, Sellen & Buxton 1991, a regression artefact) that is kept in the median but excluded from the range. The studies' pointing tasks include a button press, which the engine also charges as 2B, so mouse times are slightly conservative.",
      },
      b: {
        value: 0.17,
        low: 0.12,
        high: 0.23,
        dist: "triangular",
        unit: "s/bit",
        source: "Soukoreff & MacKenzie 2004, Table 3: slope = 1 / throughput; Shannon-form mouse models have 4.3 to 8.4 bits/s, median about 5.9 bits/s (b = 0.17)",
        note: "Cross-check at D/W = 10 (ID = 3.46 bits): a + b*ID = 0.91 s, against 0.71 to 0.94 s from the ISO 9241-9 mouse throughput range of 3.7 to 4.9 bits/s (Table 5) and 0.8 to 1.5 s for the KLM P operator.",
      },
    },
  },
  speech: {
    wpm: {
      value: 320,
      low: 200,
      high: 450,
      dist: "lognormal",
      unit: "words/min",
      source:
        "Bragg et al. 2018, CHI: mean maximum intelligible rate 334 wpm for visually impaired and 297 wpm for sighted listeners; Stent et al. 2011; Asakawa et al. 2003 (judgement for a typical experienced user)",
      note: "A judgement, not a measured distribution. Preferred rates are below maximum intelligible rates, so 320 sits at the verified means (297 to 334 wpm) and below the advanced users of Asakawa et al. (about 2.1 to 2.4 times a default TTS rate). Low (p05) 200 wpm is about the default rate of a synthesiser (eSpeak NORMAL = 175 wpm; Stent: 500 wpm is 2.5 times real time). High (p95) 450 wpm: Stent et al. tested 300 to 550 wpm, with frequent-user accuracy 0.83 at 350 and 0.66 at 500 wpm. No survey of preferred wpm exists (the WebAIM survey has no such question). Sensitivity runs at 250 and 400 wpm are advised.",
    },
    listenFraction: {
      value: 0.5,
      low: 0.25,
      high: 1.0,
      dist: "triangular",
      unit: "fraction",
      source: "Modelling assumption (no measurement exists). Mechanism: NVDA cancels speech on every key press by default (NVDA source, inputCore: speechEffectWhenExecuted = SPEECHEFFECT_CANCEL)",
      note: "Heard fraction of a non-target announcement is roughly min(duration, decision time + key reaction) / duration. Very short labels are heard almost fully (fraction near 1); long announcements (role, name, state, description) are cut off early. 1.0 is a careful listener who hears everything; 0.25 is an expert skimming at speed. Borodin et al. 2010 report that experts expect key-to-speech latency under 50 to 100 ms, which is consistent with frequent interruption, but no study reports the fraction.",
    },
  },
  typing: {
    charSeconds: {
      value: 0.24,
      low: 0.12,
      high: 0.48,
      dist: "triangular",
      unit: "s/char",
      source: "Dhakal et al. 2018, CHI, 136 M keystrokes from 168,960 typists: mean inter-key interval 238.7 ms (SD 111.6); fastest decile about 122 ms, slowest decile about 481 ms",
      note: "Same scale as the KLM classes (0.20 s skilled, 0.28 s average). Includes pauses and corrections, so it describes free typing of short strings.",
    },
  },
  scroll: {
    secondsPerViewport: {
      value: 0.8,
      low: 0.4,
      high: 1.6,
      dist: "triangular",
      unit: "s",
      source: "Modelling assumption anchored on Hinckley, Cutrell, Bathiche & Muss 2002, CHI: standard wheel fit MT = -0.42 + 1.25*log2(D/W+1) s gives 0.83 s for a one-screen scroll (30 lines) and 1.56 s for 60 lines",
      note: "No study reports seconds per screenful including re-orientation. The fit covers motor time with target acquisition only. Low end 0.4 s is a Page Down press plus a brief glance.",
    },
  },
  keyboardMotorFactor: {
    value: 1.0,
    low: 1.0,
    high: 3.0,
    dist: "triangular",
    unit: "x",
    source: "Trewin 1998 (Edinburgh PhD thesis; data of Trewin & Pain 1999, IJHCS 50(2)): mean copy-typing times of people with motor disabilities (n = 20 recruited) were 2.8 to 2.9 times those of non-disabled controls (n = 6 recruited), our ratio of the reported group means",
    note: "Nominal 1.0 is an unimpaired keyboard-only user (the persona is defined by input modality, not by an impairment). Other measured ratios: 1.7 (cervical spinal cord injury, Pouplin et al. 2016), 1.15 (early Parkinson's, not significant, Liu et al. 2023). Individuals can be 6 times slower; that tail is not sampled. Applied to K for the keyboard-only persona only.",
  },
  screenReaderStrategies: {
    // WebAIM Screen Reader User Survey #10, 1,511 answers: headings 1082, find 205, read through 96, links 72, landmarks 56.
    headings: 1082 / 1511,
    find: 205 / 1511,
    linear: 96 / 1511,
    landmarks: 56 / 1511,
    tab: 72 / 1511,
    source:
      "WebAIM Screen Reader User Survey #10 (Dec 2023 to Jan 2024), 'When trying to find information on a lengthy web page, which of the following are you most likely to do first?', n = 1,511: headings 71.6%, Find 13.6%, read through 6.4%, links 4.8%, landmarks 3.7%. Mapping: headings to headings, Find to find, read through to linear, links to tab, landmarks to landmarks. Weights are counts / 1511.",
  },
};
