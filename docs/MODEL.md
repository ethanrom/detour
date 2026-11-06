# Detour model specification

Detour predicts how many **seconds** a task takes on a web page for three kinds of user: a mouse user, a
keyboard-only user and a blind screen-reader user. It then finds the smallest set of code fixes that saves the
most of those seconds. This document specifies the model precisely enough to be checked, reproduced and
criticised. Every number the product shows comes from the deterministic model below; the language model never
produces a number (section 10).

- Code: `lib/engine` (cost models, graphs, Monte Carlo), `lib/fixes` (optimiser), `lib/llm` (task grounding).
- Parameters: `lib/params/literature.ts`. The table in section 11 is generated from that file and checked by a
  test, so the document and the code cannot drift apart.

## 1. What a prediction means

For a task such as "Add the Trail Jacket in size M to the cart", a prediction is the expected time for a
**practised user who knows what to do and where to find it**, working on the page as rendered. It is a
*best-case* estimate: the model chooses the cheapest route available to each persona (section 4.3), so real
first-time users will usually be slower. The intended use is **comparison**: which persona is hit hardest, which
fix helps most, how much a page improves. It is not a forecast of any one person's stopwatch time.

Each persona result carries a point estimate (all parameters at their nominal values) and a **90% interval**
(5th to 95th percentile of a Monte Carlo over the literature ranges, section 7).

## 2. Pipeline

```
live page (iframe)  --extract-->  PageModel  --ground (LLM, validated)-->  Task (steps)
                                      |                                        |
                                      +----------------- evaluate -------------+
                                                   |
                          mouse / keyboard / screen-reader plans (shortest paths)
                                                   |
                       strategy mixture + Monte Carlo  -->  TaskResult (seconds, interval, trace)
                                                   |
                                  fix optimiser (applyFix on the PageModel, re-evaluate)
```

`PageModel` is what assistive technology "sees": the accessibility tree (roles, accessible names, states), the
browse-mode reading order, the sequential focus order, headings, landmarks, skip links and the layout rectangle
of every node. A `Task` is an ordered list of steps (`activate`, `select`, `type`, `read`), each pointing at a
node.

## 3. Personas

| Persona | Who it represents | How it operates the page |
|---|---|---|
| Mouse | Sighted user with mouse and keyboard | Looks, points, clicks; scrolls with the wheel |
| Keyboard-only | Sighted user who cannot or does not use a pointing device (motor impairment, RSI, power user) | Tab / Shift+Tab through the focus order, skip links, Enter / Space |
| Screen reader | Blind, experienced user of an NVDA-like screen reader in browse mode | Moves a virtual cursor with arrow keys, heading (H), landmark (D), Tab and Find commands, and listens |

The screen-reader population default is a **typical experienced user**, not a beginner and not a speed-listening
expert (section 5.3).

## 4. Operators and formulas

### 4.1 Keystroke-Level Model

Times are sums of operators (Card, Moran and Newell 1980, 1983; Kieras 2001):

| Operator | Meaning | Used for |
|---|---|---|
| `M` | Mental preparation | One per task step (decide what to do next) |
| `K` | Keystroke | Every navigation key (Tab, arrow, H, D, Enter, Find) |
| `B` | Mouse button press or release | A click is `2B` |
| `H` | Homing between keyboard and mouse | Mouse user typing into a field (`2H`) |
| `P` | Pointing | Fallback only, when the page has no layout rectangles |

Keyboard-only users pay `K × keyboardMotorFactor` per key (section 5.2). The factor is 1.0 at the point estimate
and is widened in the Monte Carlo to represent users with slower or less precise key presses.

### 4.2 Pointing: Fitts's law, Shannon formulation

```
MT = a + b · log2(D / W + 1)
```

`D` is the distance from the pointer to the centre of the target, in CSS pixels at the extraction viewport.
`W` is the smaller of the target's width and height (a conservative width along an unknown approach angle).
The pointer starts at the viewport centre and each step starts where the previous step left it. Targets
outside the viewport cost whole viewport scrolls first. The Shannon form (MacKenzie 1992) is the one adopted by
ISO 9241-9 and by the survey of mouse models in Soukoreff and MacKenzie (2004); the table in section 11 states
how `a` and `b` were chosen from that survey.

### 4.3 Reading and speech

Sighted reading of a target passage costs `words / readingWpm × 60` seconds. Screen-reader speech costs

```
t_speech = words / wpm × 60 × f        f = 1                 for the step's target
                                       f = listenFraction    for every other item the cursor passes
```

Experienced screen-reader users do not wait for each announcement to finish: pressing the next key cancels the
current speech (NVDA's default behaviour), so a non-target item is heard only partly. `listenFraction` is the
mean fraction heard; the target is always heard in full. `words` is the word count of the NVDA-style
announcement stored on the node (`lib/a11y/announce.ts`), including container-entry phrases such as
"navigation landmark, list with 12 items". The page title is announced once, before the first step.

### 4.4 Typing and scrolling

Typing costs `characters × charSeconds`. Scrolling costs `secondsPerViewport` per viewport-height moved,
`ceil(|distance| / viewport height)` viewports at a time. Focusing a control with Tab scrolls it into view for
free.

## 5. Navigation graphs

Each persona's route through a task is a **shortest path** in a graph whose edges are the commands available to
it. This is how a bad page structure turns into seconds: a 60-link menu in front of the content is 60 edges of
`K + partial speech` unless a cheaper edge (skip link, heading jump, landmark jump, Find) bypasses it.

### 5.1 Mouse

Per step: `M`, scroll if the target is off screen, `P` by Fitts's law, then `2B` for a click. A `type` step adds
`2H` plus the characters; a `read` step adds the silent reading time of the target's text. There is no graph:
with a pointer every visible target is one movement away.

### 5.2 Keyboard-only

States are positions in the sequential focus order. Edges: Tab (+1), Shift+Tab (-1) and, for every in-page skip
link, an Enter edge to the first focus stop at or after the link's target. Each edge costs `K × motorFactor`.
Operating a control that is not in the focus order is impossible (section 8). Reading content is done by
scrolling (Page Down) and is never blocked.

### 5.3 Screen reader

States are positions of the browse-mode virtual cursor in the reading order. Commands are edges:

| Command | Key (NVDA) | Edge | Cost |
|---|---|---|---|
| next / previous item | Down / Up arrow | cursor ±1 | `K + speech(arrived item)` |
| next heading | H | next heading stop | `K + speech` |
| next landmark | D | next landmark entry | `K + speech` |
| next / previous focusable | Tab / Shift+Tab | next focus stop | `K + speech` |
| find | Ctrl+F, query, Enter | first later stop whose announcement contains the query | `(2 + len(query)) · K + speech`, then `K` per find-next |
| activate | Enter | none (acts on the current item) | `K` |

A **strategy** is a restricted command set, modelling the way a user approaches a long page:

| Strategy | Commands allowed |
|---|---|
| headings | H, next, previous, Tab |
| linear | next only (read straight down) |
| find | Find, next |
| landmarks | D, next |
| tab | Tab, Shift+Tab only |

For each step the engine runs **Dijkstra** from the current cursor position to the step's target within the
strategy's command set. Edge weights are non-negative, so shortest paths are exact. When the target lies behind
the cursor, the backward analogue of each strategy's move is allowed so that a strategy is not declared blocked
merely because an earlier step moved past the next target.

## 6. Strategy mixture

A screen-reader user does not always use the same strategy. The five strategies are weighted by the WebAIM
Screen Reader User Survey #10 (December 2023 – January 2024, 1,539 valid responses; 1,511 answered this
question). The question is: *"When trying to find information on a lengthy web page, which of the following are
you most likely to do first?"*

| Survey answer | Respondents | Share | Detour strategy | Weight used |
|---|---|---|---|---|
| Navigate through the headings on the page | 1,082 | 71.6% | headings | 1082/1511 = 0.7161 |
| Use the Find feature | 205 | 13.6% | find | 205/1511 = 0.1357 |
| Read through the page | 96 | 6.4% | linear | 96/1511 = 0.0635 |
| Navigate through the links of the page | 72 | 4.8% | tab | 72/1511 = 0.0477 |
| Navigate through the landmarks/regions of the page | 56 | 3.7% | landmarks | 56/1511 = 0.0371 |

Weights are the raw response counts divided by 1,511, so they sum to exactly 1 (the published percentages sum to
100.1% because of rounding). Mapping choices: "read through the page" is `linear`; "navigate through the links"
is approximated by the `tab` strategy (Tab visits links and controls in order; a links-list dialog is not
modelled). The survey asks what a user does **first**, which we treat as the strategy for the whole task. The
survey also reports that advanced users choose headings more often (78%) than beginners (47%); we use the
all-respondent split.

The point estimate for the screen-reader persona is the weighted mean of the strategy times. A blocked strategy
(section 8) is removed and the remaining weights are renormalised. The mouse persona has one strategy, and so
does the keyboard-only persona (Tab).

## 7. Uncertainty: Monte Carlo

The point estimate uses each parameter's nominal value. The 90% interval comes from 400 seeded samples
(`mulberry32`, derived per task and persona, so results are reproducible):

1. Draw every parameter independently from its range: uniform, triangular (low, nominal as mode, high) or
   log-normal (nominal as median, `low` and `high` as about the 5th and 95th percentiles).
2. Draw a strategy from the mixture weights.
3. **Re-cost the nominal-optimal path**: each strategy's shortest path is computed once at nominal
   parameters and kept fixed; its operator counts (keystrokes, words of speech, Fitts bits, ...) are
   re-priced under the sampled parameters with one dot product.
4. Report the 5th and 95th percentiles of the samples, widened if necessary to contain the point estimate.

Keeping the path fixed is an approximation: a sampled parameter set could make a different path optimal (a very
fast speech rate makes listening past items cheaper than jumping), so unlucky draws are slightly
over-estimated. A test re-runs the shortest-path search per sample on the sample page and compares the medians.

## 8. Blocked conditions

Some pages do not merely slow a persona down; they stop it. A strategy is **blocked** at a step when:

- the keyboard cannot reach the target: it is not in the focus order (for example a `div` with a click handler
  and no `tabindex`), or its `tabindex` is negative, or it is disabled;
- a screen-reader user is asked to operate a control with no accessible name (they cannot tell what it does);
- the target is hidden from assistive technology, or is not a focus stop for the `tab` strategy;
- no path exists in the strategy's command graph.

Blocked strategies are dropped from the mixture. If every strategy of a persona is blocked, the persona
**cannot complete the task**; it is reported as blocked with a plain-English reason, and the fix optimiser charges
it `BLOCKED_PENALTY_SECONDS` = 300 s so that unblocking a persona is always worth more than shaving seconds
elsewhere.

## 9. Fix optimiser

Candidate fixes are generated deterministically from the page: add a skip link, promote a styled heading to a real
heading, wrap a region in a landmark, label an unlabeled control, replace a fake button with a real one, remove a
positive `tabindex`. Each fix is a pure function on the `PageModel` (with an HTML before/after patch for
display). The **objective** is the sum over tasks of the keyboard-only and screen-reader mixture seconds, with
blocked personas charged 300 s.

Choosing the best set of `k` fixes is a subset-selection problem. The optimiser uses **lazy greedy (CELF,
Leskovec et al. 2007)**: it keeps an upper bound on each candidate's marginal gain and only re-evaluates the
candidate currently at the top, which is exact whenever gains do not grow as fixes are added (submodularity).
Fix gains are *not* guaranteed to be submodular here (a skip link and a heading fix can overlap, or can
combine to unblock a task neither unblocks alone), so for `k ≤ 3` the plan is **certified by exhaustive
search**: all subsets of size up to `k` drawn from the best single-fix candidates and the greedy picks are
evaluated, and the plan reports `optimalityGap = greedy objective - best objective found` (0 means greedy was
optimal). The search pool is bounded for speed (see `EXHAUSTIVE_POOL_SIZE` in `lib/fixes/plan.ts`), so the
certificate covers that pool, not every conceivable subset. Optimisation evaluates point estimates only (no
Monte Carlo).

## 10. What the language model does

**Only task grounding.** A user types a task in plain English; the model maps it to page elements. It never
produces a time, a weight, a parameter, an explanation or a fix.

1. The server builds a compact listing of the page, one line per reading stop or focusable element in document
   order: `id | role | name (at most 80 characters) | context`, where context is the nearest preceding heading
   (including headings that are only styled as headings) and the enclosing landmark. Roles carry suffixes such
   as `+click` (clickable but not focusable) and `+unlabeled`.
2. The fast model tier is called through the Amazon Bedrock Converse API with **forced tool use** and a JSON
   schema: it must return an ordered list of `{ target, action, text?, note? }`.
3. The result is **validated against the `PageModel`**: every id exists; `activate` and `select` target
   actionable nodes; `type` targets a text field and carries text; `read` targets a reading stop; no empty
   list; no immediate repeats; at most 12 steps.
4. On validation failure the request is repeated **once** with the errors appended. A second failure is a
   grounding error (HTTP 422).
5. Without credentials the endpoint answers 503 and the product uses hand-pinned fixture tasks, so the demo never
   depends on the model.

The listing and the task text are treated as data, not instructions. Validation checks structure, not intent: a
valid but wrong element is possible, which is why the UI shows the grounded steps for confirmation.

## 11. Parameters

All parameters live in `lib/params/literature.ts` and nothing in the engine hard-codes a constant. "Range" is
the interval used by the Monte Carlo; "Dist." is the sampling distribution. Where a value is a modelling
assumption rather than a measurement, the source column says so.

<!-- BEGIN:parameter-table -->
| Parameter | Nominal | Range (low to high) | Dist. | Unit | Source |
|---|---|---|---|---|---|
| K  keystroke (navigation key) | 0.2 | 0.12 to 0.28 | triangular | s | Card, Moran & Newell 1980/1983, KLM typist classes as tabulated in Kieras 2001: 0.12 s expert (90 wpm), 0.20 s average skilled (55 wpm), 0.28 s average non-secretary (40 wpm) |
| B  mouse button press or release | 0.1 | 0.08 to 0.15 | triangular | s | Card, Moran & Newell 1983 via Kieras 2001: B = 0.1 s per press or release (a click is BB = 0.2 s) |
| M  mental preparation | 1.2 | 0.6 to 1.35 | triangular | s | Kieras 2001, after Olson & Olson 1990: M = 0.6 to 1.35 s, use 1.2 s (Card, Moran & Newell 1980 used 1.35 s) |
| H  homing keyboard / mouse | 0.4 | 0.3 to 0.5 | triangular | s | Card, Moran & Newell 1983 via Kieras 2001: H = 0.4 s |
| P  pointing (no layout) | 1.1 | 0.8 to 1.5 | triangular | s | Kieras 2001 / Card, Moran & Newell 1983: P ranges from 0.8 to 1.5 s with an average of 1.1 s (from Fitts's law) |
| Fitts intercept a | 0.33 | 0.12 to 0.51 | triangular | s | Soukoreff & MacKenzie 2004, Int. J. Human-Computer Studies 61(6):751-789, Table 3: median of eight Shannon-form mouse-pointing regressions |
| Fitts slope b | 0.17 | 0.12 to 0.23 | triangular | s/bit | Soukoreff & MacKenzie 2004, Table 3: slope = 1 / throughput; Shannon-form mouse models have 4.3 to 8.4 bits/s, median about 5.9 bits/s (b = 0.17) |
| Silent reading speed | 238 | 175 to 300 | triangular | words/min | Brysbaert 2019, J. Memory and Language 109:104047: silent reading of English non-fiction, mean 238 wpm (190 studies, 18,573 readers); most adults 175 to 300 wpm |
| Screen-reader speech rate | 320 | 200 to 450 | lognormal | words/min | Bragg et al. 2018, CHI: mean maximum intelligible rate 334 wpm for visually impaired and 297 wpm for sighted listeners; Stent et al. 2011; Asakawa et al. 2003 (judgement for a typical experienced user) |
| Listen fraction (non-targets) | 0.5 | 0.25 to 1 | triangular | fraction | Modelling assumption (no measurement exists). Mechanism: NVDA cancels speech on every key press by default (NVDA source, inputCore: speechEffectWhenExecuted = SPEECHEFFECT_CANCEL) |
| Typing, seconds per character | 0.24 | 0.12 to 0.48 | triangular | s/char | Dhakal et al. 2018, CHI, 136 M keystrokes from 168,960 typists: mean inter-key interval 238.7 ms (SD 111.6); fastest decile about 122 ms, slowest decile about 481 ms |
| Scroll, seconds per viewport | 0.8 | 0.4 to 1.6 | triangular | s | Modelling assumption anchored on Hinckley, Cutrell, Bathiche & Muss 2002, CHI: standard wheel fit MT = -0.42 + 1.25*log2(D/W+1) s gives 0.83 s for a one-screen scroll (30 lines) and 1.56 s for 60 lines |
| Keyboard motor factor (x K) | 1 | 1 to 3 | triangular | x | Trewin 1998 (Edinburgh PhD thesis; data of Trewin & Pain 1999, IJHCS 50(2)): copy-typing times of 20 people with motor disabilities were 2.8 to 2.9 times those of 6 non-disabled people |
| Screen-reader strategy weights | headings 0.7161, find 0.1357, linear 0.0635, landmarks 0.0371, tab 0.0477 | fixed | - | share | WebAIM Screen Reader User Survey #10 (Dec 2023 to Jan 2024), 'When trying to find information on a lengthy web page, which of the following are you most likely to do first?', n = 1,511: headings 71.6%, Find 13.6%, read through 6.4%, links 4.8%, landmarks 3.7%. Mapping: headings to headings, Find to find, read through to linear, links to tab, landmarks to landmarks. Weights are counts / 1511. |

Notes on individual parameters:

- **K  keystroke (navigation key).** Nominal is the average-skilled-typist class: Tab, arrow, H and D are single, practised keys, not words. Dhakal et al. 2018 (136 M keystrokes) measured a mean inter-key interval of 0.239 s (fastest decile about 0.12 s), which sits inside this range. Kieras recommends 0.28 s for a casual user. No published study measures single-key times of experienced screen-reader users, so the same range is applied to them (gap).
- **B  mouse button press or release.** The nominal value is published; the low/high range is a modelling assumption (no published interval).
- **M  mental preparation.** Charged once per task step. It covers routine decision time for a user who knows the task, not searching an unfamiliar page (see limitations).
- **H  homing keyboard / mouse.** The nominal value is published; the plus or minus 25% range is a modelling assumption.
- **P  pointing (no layout).** Fallback only. Used when the page has no layout rectangles; otherwise pointing is computed from Fitts's law.
- **Fitts intercept a.** Intercepts of those regressions run from 0.12 to 0.51 s (MacKenzie, Sellen & Buxton 1991 report a negative intercept, a regression artefact, excluded from the range). The studies' pointing tasks include a button press, which the engine also charges as 2B, so mouse times are slightly conservative.
- **Fitts slope b.** Cross-check at D/W = 10 (ID = 3.46 bits): a + b*ID = 0.91 s, against 0.71 to 0.94 s from the ISO 9241-9 mouse throughput range of 3.7 to 4.9 bits/s (Table 5) and 0.8 to 1.5 s for the KLM P operator.
- **Silent reading speed.** Fiction is faster (260 wpm); Detour tasks read short factual passages.
- **Screen-reader speech rate.** A judgement, not a measured distribution. Preferred rates are below maximum intelligible rates, so 320 sits at the verified means (297 to 334 wpm) and below the advanced users of Asakawa et al. (about 2.1 to 2.4 times a default TTS rate). Low (p05) 200 wpm is about the default rate of a synthesiser (eSpeak NORMAL = 175 wpm; Stent: 500 wpm is 2.5 times real time). High (p95) 450 wpm: Stent et al. tested 300 to 550 wpm, with frequent-user accuracy 0.83 at 350 and 0.66 at 500 wpm. No survey of preferred wpm exists (the WebAIM survey has no such question). Sensitivity runs at 250 and 400 wpm are advised.
- **Listen fraction (non-targets).** Heard fraction of a non-target announcement is roughly min(duration, decision time + key reaction) / duration. Very short labels are heard almost fully (fraction near 1); long announcements (role, name, state, description) are cut off early. 1.0 is a careful listener who hears everything; 0.25 is an expert skimming at speed. Borodin et al. 2010 report that experts expect key-to-speech latency under 50 to 100 ms, which is consistent with frequent interruption, but no study reports the fraction.
- **Typing, seconds per character.** Same scale as the KLM classes (0.20 s skilled, 0.28 s average). Includes pauses and corrections, so it describes free typing of short strings.
- **Scroll, seconds per viewport.** No study reports seconds per screenful including re-orientation. The fit covers motor time with target acquisition only. Low end 0.4 s is a Page Down press plus a brief glance.
- **Keyboard motor factor (x K).** Nominal 1.0 is an unimpaired keyboard-only user (the persona is defined by input modality, not by an impairment). Other measured ratios: 1.7 (cervical spinal cord injury, Pouplin et al. 2016), 1.15 (early Parkinson's, not significant, Liu et al. 2023). Individuals can be 6 times slower; that tail is not sampled. Applied to K for the keyboard-only persona only.
<!-- END:parameter-table -->

## 12. Limitations

State these when quoting a number.

1. **Omniscient-path lower bound.** The model picks the cheapest route within each strategy, as if the user
   already knew where the target is and which command reaches it fastest. Real users search, overshoot, backtrack
   and recover from errors. Predictions are best-case times for a practised user.
2. **NVDA-like phrasing.** Word counts follow NVDA 2024 defaults. JAWS, VoiceOver and Narrator differ in
   verbosity, quick keys and rotor-style navigation.
3. **No information scent yet.** The model does not predict which heading or link a user would *choose* when
   several look plausible; the headings strategy assumes the right heading is found. Modelling this (an
   absorbing Markov chain over scent scores) is planned and will turn the lower bound into a search estimate.
4. **Speech is word counts.** One constant rate, no prosody, number or URL expansion, punctuation pauses or
   synthesiser start-up latency. `listenFraction` is a modelling assumption (section 11) with a wide range.
5. **Independent parameter draws.** Monte Carlo samples each parameter independently, although some are
   correlated in real people (for example the Fitts intercept and slope trade off, and fast listeners are
   often fast typists). Intervals describe parameter uncertainty, not between-person variability in strategy.
6. **Survey weights.** WebAIM respondents are self-selected, skew towards experienced users, and the question
   asks for the *first* thing a user does; we treat it as the whole-task strategy.
7. **Static pages.** No dynamic content, modals, focus traps, live regions, form validation errors, page loads
   or network delays. The mouse persona has no hover menus, dragging or visual search beyond one `M` per step.
8. **Keyboard-only persona uses Tab only.** No access keys, caret browsing or find-in-page.
9. **Fix gains are model gains.** They are exactly the seconds the model saves, not measured improvements.
   The fix optimiser cannot be better than the model it optimises against.
10. **Not yet validated end to end.** Parameters are taken from the literature, but predicted task times have not
    yet been compared with measured screen-reader task times. Published studies of that kind exist and have been
    collected for later validation.
11. **Grounding can be wrong.** A grounded task is checked structurally, not semantically.

## 13. References

<!-- BEGIN:references -->
<!-- END:references -->
