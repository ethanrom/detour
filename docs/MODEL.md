# Detour model specification

Detour predicts how many **seconds** a task takes on a web page for three kinds of user: a mouse user, a
keyboard-only user and a blind screen-reader user. It then finds the smallest set of code fixes that saves the
most of those seconds. This document specifies the model precisely enough to be checked, reproduced and
criticised. Every number the product shows comes from the deterministic model below; the language model never
produces a number (section 10).

- Code: `lib/engine` (cost models, graphs, Monte Carlo), `lib/scent` (information-scent search), `lib/fixes`
  (optimiser), `lib/llm` (task grounding).
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

## 7a. Realistic heading search (information scent)

The shortest-path engine charges a heading navigator as if the first guess were right: press H until the heading
above the target, then arrow down. People who navigate by headings (71.6% of survey respondents, section 6) do not
know which heading holds the answer; they hear a heading and judge by its words. `lib/scent` models that as an
**absorbing Markov chain** (information foraging: Pirolli and Card 1999; SNIF-ACT: Fu and Pirolli 2007;
CogTool-Explorer: Teo, John and Blackmon 2012). It is reported next to the shortest-path number, as a
`SearchEstimate` on the screen-reader result, and is not part of the optimiser's objective.

For one task step the chain has a state `S(pass, q)` for "just arrived, by H, at the q-th heading of the circular
heading order that starts at the first heading after the cursor". Pass 1 visits every heading once (NVDA wraps
past the end); pass 2 visits them all again.

1. **Scent.** A scorer maps the goal text (task label plus step note) and each heading's accessible name to a scent
   `s` in [0, 1]. The shipped scorer is deterministic and lexical: stemmed, stop-word-free token sets, an overlap
   coefficient, and a small synonym map (exact stem 1, synonym cluster 0.8, related cluster 0.3). An LLM scorer
   interface exists (validated, blended with the lexical score, lexical fallback); the shipped pipeline uses the
   lexical one.
2. **Decide.** The user enters the section with probability `p = 1 / (1 + exp(-alpha (s - theta)))`, `alpha` = 10,
   `theta` = 0.35. In pass 2 the probability is at least `pMin2` = 0.5 (a user who has heard every heading once
   and found nothing becomes willing to try anything).
3. **Enter.** If the section holds the target, the user presses Down through it and hears the target in full
   (absorbing state "found"). If it is wrong, the user hears `min(len, ceil(beta len) + 1)` stops (`beta` = 0.4),
   pays one mental preparation `M`, and presses H again. Skipping costs the H press. After the last heading of
   pass 2 the user reads linearly from the top.
4. **Cost.** Every arrival is `K` plus the heading's speech at `listenFraction`; a full hearing of the target is
   `K` plus its speech; speech uses the same word counts and rates as section 4.3. Let `Q` be the
   transient-to-transient transition matrix and `c` the expected cost incurred in each state. The expected time is
   `t = N c` with `N = (I - Q)^-1` (the fundamental matrix; row 0 gives the expected visits to each heading).

`alpha`, `theta`, `beta` and `pMin2` are **modelling assumptions**, not measured constants. The model also reports the
probability of finding the target on the first pass, the expected number of wrong sections entered, the linear
reading time from the top, and where the expected seconds go. A vague heading shows up as the cost of the wrong
sections and of the linear fallback. The claim that a vague heading can be worse than no heading at all (reading
straight down beats searching) is checked in `lib/scent/vague.test.ts`.

**Verification.** `lib/scent/search.test.ts` compares the analytic solution with an independent reference
implementation (to 1e-9) and with a seeded simulation of 20,000 users that shares no cost or matrix code with the
model. Over 100 random pages the worst disagreement in mean seconds was 0.531% (the test bound is 2%).

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
positive `tabindex`. Fixes that share a component (same `styleKey`: for example the five size options of one
picker) are grouped into one candidate, so the candidate count stays small. Each fix is a pure function on the
`PageModel` (with an HTML before/after patch for display). The **objective** is the sum over tasks of the
keyboard-only and screen-reader mixture seconds, with blocked personas charged 300 s. It is evaluated on point
estimates only (no Monte Carlo), and every distinct set of fixes is evaluated once (memoised by its sorted
candidate indices), so the result does not depend on pick order.

Choosing the best set of `k` fixes is a subset-selection problem. The optimiser uses **plain greedy**: in every
round it re-evaluates the marginal gain of **every** remaining candidate on top of the fixes already chosen, adds
the best one, and stops after `k` fixes or when the best marginal gain is at most `MIN_GAIN_SECONDS` = 0.01 s.
Ties go to the lower candidate index.

Greedy is deliberately not lazy. Lazy greedy (Minoux 1978; CELF, Leskovec et al. 2007) keeps an upper bound on each
candidate's marginal gain and only re-evaluates the top one, which is exact only when gains never grow as fixes are
added (submodularity; the same property gives greedy its `1 - 1/e` guarantee, Nemhauser et al. 1978). Fix gains
here are **complementary**, not submodular. The clearest case is the Northwind demo page: a skip link helps a
keyboard user only after the size picker has become focusable. With the skip link alone the keyboard persona is
still blocked (300 s charged); with the real-button fix alone it needs 18.4 s; with both it needs 4.4 s. So the
skip link's marginal gain is slightly negative in round one (it adds one more stop for a screen-reader user to
pass) and 13 s in round three, so a lazy bound computed in round one would never re-examine it. The optimiser originally used CELF and was changed for this reason. Evaluations are
cheap (a plan takes a few hundred, memoised), so re-evaluating every candidate each round is affordable.

Because greedy has no guarantee for non-submodular gains, for `k ≤ 3` (`exhaustiveMaxK`) the plan is **certified by
exhaustive search**: every subset of size 1 to `k` drawn from a **pool** of candidates is evaluated, and the plan
reports `optimalityGap = greedy objective - best objective found` (0 means greedy was optimal; it is never
negative, because the empty set and the greedy picks are always searched). The pool is:

- **all candidates** when there are at most 14 (`EXHAUSTIVE_ALL_MAX`); the certificate is then a proof of
  optimality over every subset of size at most `k`;
- otherwise the **union** of the top 8 candidates (`EXHAUSTIVE_TOP_PER_ROUND`) by marginal gain in each of the
  first three greedy rounds (single-fix gains, then gains after the first pick, then after the second), plus the
  greedy picks themselves. The certificate then covers that pool, not every conceivable subset; the pool size is
  reported (`exhaustivePoolSize` in `lib/fixes/plan.ts`) so the UI can say so.

For scale: with 14 candidates and `k = 3` the search evaluates 14 + 91 + 364 = 469 subsets. On the demo pages
greedy was optimal (gap 0) on both inaccessible sites: Northwind (18 candidates, pool of 11) and Riverside (10
candidates, pool of all 10).

## 9a. Fixing the page and re-checking it

A plan is a prediction made on the model of the page: `applyFix` edits the `PageModel`, not the page. **Fix this
page** turns each planned fix into a real edit on the page in the preview and checks it there.

1. **Stable ids.** Before the first edit, every element that has a node in the `PageModel` gets
   `data-detour-id` set to its node id. On a page read through the proxy the ids are otherwise generated from
   document order, and an inserted skip link would renumber every one of them.
2. **One agent per fix, in parallel** (`lib/livefix/agent.ts`, POST `/api/fix`). The fast model tier gets the
   fix (kind, title, parameters, WCAG criteria) and each target's real markup: its outer HTML, its parent with the
   target marked, the announcements just before and after it, and a few computed styles. With forced tool use it
   returns edit operations: `setAttributes`, `removeAttributes`, `wrapChildren`, `insert`, `setText` and, as a
   last resort, `replace`. It is told to keep the original element whenever it can (`wrapChildren` puts a real
   `<button>` inside a clickable `<div>`, so the page's own click handler still fires) and to add scoped CSS so
   the page looks the same. The answers stream back as each call settles.
3. **Validation** (`lib/livefix/validate.ts` on the server, `sanitize.ts` again in the browser). Every selector
   must be one of the fix's targets (plus `body` for a skip link); at most 8 edits, 4 KB of HTML and 2 KB of CSS per
   fix; no script, frame, object, embed, link, meta, style or base elements, no `on*` attributes, no
   `javascript:` or other dangerous URLs; attributes set directly come from an allow-list (`aria-*`, `role`,
   `tabindex` of 0 or less, `type`, `id`, `class`, `lang`, `href` starting with `#`); CSS may not load anything
   and every rule must be scoped to a class. A failed validation is retried once with the errors; a second failure,
   no credentials, or a refused rate limit falls back to deterministic edits for the same fix kind, labelled as
   such. Demo pages are served from one recorded agent run when their markup still matches.
4. **Apply in plan order, then re-check.** Edits are applied in the order the planner chose them, even when they
   arrive out of order. After each fix the page is read again with `extractPage` and every task is timed again
   with the same engine. The result is compared with the plan's prediction for that point
   (`FixPlan.gains[i].after`): a fix is **proven** when every persona the plan unblocked is unblocked and every
   re-checked time is within 0.5 s of the prediction or better. Otherwise it is **partial**, its edits are undone
   and the agent is asked once more, with Detour's own reason sentence as feedback (for example why the target is
   still not in the Tab order). Verified wording from section 10 is applied in the same run as plain text edits.
5. **Layout check.** Every element's box is recorded before the first edit and compared after the last one,
   outside the edited elements. An element that moved by more than 1 px is listed, so a fix that changes what
   sighted users see is visible.
6. **Patch.** The owner gets the before and after markup of every edited element, the CSS, and one sentence on
   where the change likely belongs in their source.

The seconds after a fix are still this model's seconds, computed on the patched page. They are reported as
**re-checked on the fixed page**, never as measured. What the re-check adds is that the page they are computed
on is the page after the edit really happened, not a simulation of it.

## 10. What the language model does

**Three jobs: task grounding, proposed wording, and writing the markup edit for a planned fix.** A user types a task
in plain English; the model maps it to page elements. Separately, it proposes clearer text for vague headings and
for unlabeled controls (see "Proposed wording" below), and it writes the concrete edit for each fix the planner
chose (section 9a). It never produces a time, a weight, a parameter, an explanation or a fix
*selection*: every number comes from the models in sections 4 to 9.

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

**Proposed wording (`lib/repair`, POST `/api/repair`).** A heading such as "More information" gives the
information-scent model nothing to match (section 7a). The language model proposes a replacement from the text of
the section it heads; the proposal is validated (non-empty, different from the current heading, at most 6 words and
60 characters) and then **verified by the scent model**: the search is re-run on the renamed page, and the rename is
accepted only if it saves more than 0.5 s of expected search time across the page's tasks. Unlabeled controls with no visible hint get proposed accessible
names (validated for length and generic words, not time-verified). Without credentials, or when the model fails
twice, a deterministic fallback proposes the wording and the same verification applies. The seconds in the UI are
the scent model's, never the language model's.

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
| Fitts intercept a | 0.33 | 0.12 to 0.51 | triangular | s | Soukoreff & MacKenzie 2004, Int. J. Human-Computer Studies 61(6):751-789, Table 3: median (our computation) of eight published Shannon-form mouse-pointing regressions |
| Fitts slope b | 0.17 | 0.12 to 0.23 | triangular | s/bit | Soukoreff & MacKenzie 2004, Table 3: slope = 1 / throughput; Shannon-form mouse models have 4.3 to 8.4 bits/s, median about 5.9 bits/s (b = 0.17) |
| Silent reading speed | 238 | 175 to 300 | triangular | words/min | Brysbaert 2019, J. Memory and Language 109:104047: silent reading of English non-fiction, mean 238 wpm (190 studies, 18,573 readers); most adults 175 to 300 wpm |
| Screen-reader speech rate | 320 | 200 to 450 | lognormal | words/min | Bragg et al. 2018, CHI: mean maximum intelligible rate 334 wpm for visually impaired and 297 wpm for sighted listeners; Stent et al. 2011; Asakawa et al. 2003 (judgement for a typical experienced user) |
| Listen fraction (non-targets) | 0.5 | 0.25 to 1 | triangular | fraction | Modelling assumption (no measurement exists). Mechanism: NVDA cancels speech on every key press by default (NVDA source, inputCore: speechEffectWhenExecuted = SPEECHEFFECT_CANCEL) |
| Typing, seconds per character | 0.24 | 0.12 to 0.48 | triangular | s/char | Dhakal et al. 2018, CHI, 136 M keystrokes from 168,960 typists: mean inter-key interval 238.7 ms (SD 111.6); fastest decile about 122 ms, slowest decile about 481 ms |
| Scroll, seconds per viewport | 0.8 | 0.4 to 1.6 | triangular | s | Modelling assumption anchored on Hinckley, Cutrell, Bathiche & Muss 2002, CHI: standard wheel fit MT = -0.42 + 1.25*log2(D/W+1) s gives 0.83 s for a one-screen scroll (30 lines) and 1.56 s for 60 lines |
| Keyboard motor factor (x K) | 1 | 1 to 3 | triangular | x | Trewin 1998 (Edinburgh PhD thesis; data of Trewin & Pain 1999, IJHCS 50(2)): mean copy-typing times of people with motor disabilities (n = 20 recruited) were 2.8 to 2.9 times those of non-disabled controls (n = 6 recruited), our ratio of the reported group means |
| Screen-reader strategy weights | headings 0.7161, find 0.1357, linear 0.0635, landmarks 0.0371, tab 0.0477 | fixed | - | share | WebAIM Screen Reader User Survey #10 (Dec 2023 to Jan 2024), 'When trying to find information on a lengthy web page, which of the following are you most likely to do first?', n = 1,511: headings 71.6%, Find 13.6%, read through 6.4%, links 4.8%, landmarks 3.7%. Mapping: headings to headings, Find to find, read through to linear, links to tab, landmarks to landmarks. Weights are counts / 1511. |

Notes on individual parameters:

- **K  keystroke (navigation key).** Nominal is the average-skilled-typist class: Tab, arrow, H and D are single, practised keys, not words. Dhakal et al. 2018 (136 M keystrokes) measured a mean inter-key interval of 0.239 s (fastest decile about 0.12 s), which sits inside this range. Kieras recommends 0.28 s for a casual user. No published study measures single-key times of experienced screen-reader users, so the same range is applied to them (gap).
- **B  mouse button press or release.** The nominal value is published; the low/high range is a modelling assumption (no published interval).
- **M  mental preparation.** Charged once per task step. It covers routine decision time for a user who knows the task, not searching an unfamiliar page (see limitations).
- **H  homing keyboard / mouse.** The nominal value is published; the plus or minus 25% range is a modelling assumption.
- **P  pointing (no layout).** Fallback only. Used when the page has no layout rectangles; otherwise pointing is computed from Fitts's law.
- **Fitts intercept a.** The eight intercepts run from 0.12 to 0.51 s, apart from one negative intercept (MacKenzie, Sellen & Buxton 1991, a regression artefact) that is kept in the median but excluded from the range. The studies' pointing tasks include a button press, which the engine also charges as 2B, so mouse times are slightly conservative.
- **Fitts slope b.** Cross-check at D/W = 10 (ID = 3.46 bits): a + b*ID = 0.91 s, against 0.71 to 0.94 s from the ISO 9241-9 mouse throughput range of 3.7 to 4.9 bits/s (Table 5) and 0.8 to 1.5 s for the KLM P operator.
- **Silent reading speed.** Fiction is faster (260 wpm); Detour tasks read short factual passages.
- **Screen-reader speech rate.** A judgement, not a measured distribution. Preferred rates are below maximum intelligible rates, so 320 sits at the verified means (297 to 334 wpm) and below the advanced users of Asakawa et al. (about 2.1 to 2.4 times a default TTS rate). Low (p05) 200 wpm is about the default rate of a synthesiser (eSpeak NORMAL = 175 wpm; Stent: 500 wpm is 2.5 times real time). High (p95) 450 wpm: Stent et al. tested 300 to 550 wpm, with frequent-user accuracy 0.83 at 350 and 0.66 at 500 wpm. No survey of preferred wpm exists (the WebAIM survey has no such question). Sensitivity runs at 250 and 400 wpm are advised.
- **Listen fraction (non-targets).** Heard fraction of a non-target announcement is roughly min(duration, decision time + key reaction) / duration. Very short labels are heard almost fully (fraction near 1); long announcements (role, name, state, description) are cut off early. 1.0 is a careful listener who hears everything; 0.25 is an expert skimming at speed. Borodin et al. 2010 report that experts expect key-to-speech latency under 50 to 100 ms, which is consistent with frequent interruption, but no study reports the fraction.
- **Typing, seconds per character.** Same scale as the KLM classes (0.20 s skilled, 0.28 s average). Includes pauses and corrections, so it describes free typing of short strings.
- **Scroll, seconds per viewport.** No study reports seconds per screenful including re-orientation. The fit covers motor time with target acquisition only. Low end 0.4 s is a Page Down press plus a brief glance.
- **Keyboard motor factor (x K).** Nominal 1.0 is an unimpaired keyboard-only user (the persona is defined by input modality, not by an impairment). Other measured ratios: 1.7 (cervical spinal cord injury, Pouplin et al. 2016), 1.15 (early Parkinson's, not significant, Liu et al. 2023). Individuals can be 6 times slower; that tail is not sampled. Applied to K for the keyboard-only persona only.
<!-- END:parameter-table -->

## 12. Validation targets

The parameters come from the literature, but Detour's end-to-end predictions have **not yet been compared with
measured screen-reader task times** (limitation 10 below). Published field studies give targets: blind to sighted
time ratios that the screen-reader to mouse ratio of comparable Detour tasks should roughly reproduce.

| Study | Participants and setting | Task | Blind (s) | Sighted (s) | Ratio |
|---|---|---|---|---|---|
| Bigham et al. 2007 (WebinSitu) | 10 blind (8 JAWS, 2 Window-Eyes), 10 sighted; one week of unscripted browsing | Issue a query on the Google home page | 74.7 | 34.5 | 2.2 |
| | | Click a result after the results page loads | 155.1 | 34.8 | 4.5 (sighted SD 222 s, soft) |
| | | Query the user's own web history | 30.4 | 18.4 | 1.65 |
| | | Leave a comment on a page | 104.6 | 68.7 | 1.5 |
| Nielsen 2001 (NN/g, Coyne & Nielsen study) | Screen-reader users vs 20 controls; four tasks on 19 live sites | Mean time on task over four goal-level tasks | 1006 | 434 | 2.3 (success 12.5% vs 78.2%) |

Ratios are our arithmetic on the published means. These are the only studies we found with matched blind and
sighted times; in the same data blind users clicked only 46 of 822 skip links offered (5.6%), which is worth
keeping in mind when a fix is "add a skip link". Caveats: different tasks and pages from ours; unscripted field
behaviour includes exploration and errors that Detour's lower bound excludes, so Detour is expected to come in
*below* these ratios for first-visit tasks and nearer to them for practised ones.

## 13. Limitations

State these when quoting a number.

1. **Omniscient-path lower bound.** The model picks the cheapest route within each strategy, as if the user
   already knew where the target is and which command reaches it fastest. Real users search, overshoot, backtrack
   and recover from errors. Predictions are best-case times for a practised user.
2. **NVDA-like phrasing.** Word counts follow NVDA 2024 defaults. JAWS, VoiceOver and Narrator differ in
   verbosity, quick keys and rotor-style navigation.
3. **Scent is lexical and its behaviour parameters are assumptions.** The shortest-path numbers assume the right
   heading is found. The information-scent search (section 7a) relaxes that for the headings strategy only, with a
   deterministic word-overlap scorer (no semantics beyond a small synonym map) and four behavioural constants
   (`alpha`, `theta`, `beta`, `pMin2`) that are modelling assumptions. It does not cover Find, landmarks, links
   or sighted visual search.
4. **Speech is word counts.** One constant rate, no prosody, number or URL expansion, punctuation pauses or
   synthesiser start-up latency. The speech rate is a judgement from listening-rate studies (no survey of
   preferred rates exists), and `listenFraction` is a modelling assumption (section 11), both with wide ranges.
   They are the two parameters that move screen-reader times most; sensitivity runs are advised.
5. **Independent parameter draws.** Monte Carlo samples each parameter independently, although some are
   correlated in real people (for example the Fitts intercept and slope trade off, and fast listeners are
   often fast typists). Intervals describe parameter uncertainty, not between-person variability in strategy.
6. **Survey weights.** WebAIM respondents are self-selected, skew towards experienced users, and the question
   asks for the *first* thing a user does; we treat it as the whole-task strategy.
7. **Static pages.** No dynamic content, modals, focus traps, live regions, form validation errors, page loads
   or network delays. The mouse persona has no hover menus, dragging or visual search beyond one `M` per step.
8. **Keyboard-only persona uses Tab only.** No access keys, caret browsing or find-in-page.
9. **Fix gains are model gains.** A plan's gains are the seconds the model saves on a simulated edit. After **Fix this
   page** they are re-checked on the really patched page, but they are still the model's seconds, not measured
   improvements. The fixed copy is the rendered page: the owner still makes the change in their own source, and the
   patch shows the element-level change, not where it lives in their framework.
   The fix optimiser cannot be better than the model it optimises against.
10. **Not yet validated end to end.** See section 12.
11. **Grounding can be wrong.** A grounded task is checked structurally, not semantically.
12. **Population.** Defaults describe adult, English-language, experienced users on a desktop. Beginners, braille
    users, mobile screen readers and non-English speech are outside the model.

## 14. References

Card, S. K., English, W. K., & Burr, B. J. (1978). Evaluation of mouse, rate-controlled isometric joystick, step
keys, and text keys for text selection on a CRT. *Ergonomics, 21*(8), 601-613.

Card, S. K., Moran, T. P., & Newell, A. (1980). The keystroke-level model for user performance time with
interactive systems. *Communications of the ACM, 23*(7), 396-410. doi:10.1145/358886.358895

Card, S. K., Moran, T. P., & Newell, A. (1983). *The Psychology of Human-Computer Interaction.* Lawrence Erlbaum.

Asakawa, C., Takagi, H., Ino, S., & Ifukube, T. (2003). Maximum listening speeds for the blind. *Proceedings of
the 9th International Conference on Auditory Display (ICAD 2003)*, 276-279.

Bigham, J. P., Cavender, A. C., Brudvik, J. T., Wobbrock, J. O., & Ladner, R. E. (2007). WebinSitu: A comparative
analysis of blind and sighted browsing behavior. *Proceedings of ASSETS 2007.* doi:10.1145/1296843.1296854

Borodin, Y., Bigham, J. P., Dausch, G., & Ramakrishnan, I. V. (2010). More than meets the eye: A survey of
screen-reader browsing strategies. *Proceedings of W4A 2010.*

Bragg, D., Bennett, C., Reinecke, K., & Ladner, R. (2018). A large inclusive study of human listening rates.
*Proceedings of CHI 2018*, Paper 444. doi:10.1145/3173574.3174018

Brysbaert, M. (2019). How many words do we read per minute? A review and meta-analysis of reading rate.
*Journal of Memory and Language, 109*, 104047. doi:10.1016/j.jml.2019.104047

Dhakal, V., Feit, A. M., Kristensson, P. O., & Oulasvirta, A. (2018). Observations on typing from 136 million
keystrokes. *Proceedings of CHI 2018.* doi:10.1145/3173574.3174220

Dijkstra, E. W. (1959). A note on two problems in connexion with graphs. *Numerische Mathematik, 1*, 269-271.

Fitts, P. M. (1954). The information capacity of the human motor system in controlling the amplitude of movement.
*Journal of Experimental Psychology, 47*(6), 381-391.

Fu, W.-T., & Pirolli, P. (2007). SNIF-ACT: A cognitive model of user navigation on the World Wide Web.
*Human-Computer Interaction, 22*(4), 355-412.

Hinckley, K., Cutrell, E., Bathiche, S., & Muss, T. (2002). Quantitative analysis of scrolling techniques.
*Proceedings of CHI 2002.* doi:10.1145/503376.503389

ISO 9241-9:2000. Ergonomic requirements for office work with visual display terminals (VDTs), Part 9:
Requirements for non-keyboard input devices. (Superseded by ISO 9241-411:2012.)

Kieras, D. (2001). *Using the Keystroke-Level Model to Estimate Execution Times.* University of Michigan.
http://web.eecs.umich.edu/~kieras/docs/GOMS/KLM.pdf

Leskovec, J., Krause, A., Guestrin, C., Faloutsos, C., VanBriesen, J., & Glance, N. (2007). Cost-effective outbreak
detection in networks. *Proceedings of KDD 2007*, 420-429. doi:10.1145/1281192.1281239

Liu, W.-M., Yeh, C.-L., Chen, P.-W., Lin, C.-W., & Liu, A.-B. (2023). Keystroke biometrics as a tool for the early
diagnosis and clinical assessment of Parkinson's disease. *Diagnostics, 13*(19), 3061. doi:10.3390/diagnostics13193061

MacKenzie, I. S. (1992). Fitts' law as a research and design tool in human-computer interaction.
*Human-Computer Interaction, 7*(1), 91-139. doi:10.1207/s15327051hci0701_3

MacKenzie, I. S., Sellen, A., & Buxton, W. (1991). A comparison of input devices in elemental pointing and
dragging tasks. *Proceedings of CHI '91*, 161-166. doi:10.1145/108844.108868

Minoux, M. (1978). Accelerated greedy algorithms for maximizing submodular set functions. In *Optimization
Techniques*, Lecture Notes in Control and Information Sciences 7, 234-243. Springer.

Moos, A., & Trouvain, J. (2007). Comprehension of ultra-fast speech: blind vs. "normally hearing" persons.
*Proceedings of the 16th International Congress of Phonetic Sciences (ICPhS 2007)*, 677-680.

Nemhauser, G. L., Wolsey, L. A., & Fisher, M. L. (1978). An analysis of approximations for maximizing submodular
set functions I. *Mathematical Programming, 14*, 265-294.

Nielsen, J. (2001). Beyond accessibility: Treating users with disabilities as people. *Alertbox*, 10 November 2001,
Nielsen Norman Group (summarising Coyne, K. P., & Nielsen, J., *Beyond ALT Text: Making the Web Easy to Use for
Users with Disabilities*, 2001).

NV Access. NVDA source code (`inputCore.py`, speech cancellation on key press) and User Guide.
https://github.com/nvaccess/nvda

Olson, J. R., & Olson, G. M. (1990). The growth of cognitive modeling in human-computer interaction since GOMS.
*Human-Computer Interaction, 5*(2-3), 221-265. doi:10.1207/s15327051hci0502&3_4

Pirolli, P., & Card, S. (1999). Information foraging. *Psychological Review, 106*(4), 643-675.

Pouplin, S., Roche, N., Vaugier, I., Cabanilles, S., Hugeron, C., & Bensmail, D. (2016). Text input speed in persons
with cervical spinal cord injury. *Spinal Cord, 54*(2), 158-162. doi:10.1038/sc.2015.147

Soukoreff, R. W., & MacKenzie, I. S. (2004). Towards a standard for pointing device evaluation, perspectives on 27
years of Fitts' law research in HCI. *International Journal of Human-Computer Studies, 61*(6), 751-789.
doi:10.1016/j.ijhcs.2004.09.001

Stent, A., Syrdal, A., & Mishra, T. (2011). On the intelligibility of fast synthesized speech for individuals with
early-onset blindness. *Proceedings of ASSETS 2011*, 211-218. doi:10.1145/2049536.2049574

Teo, L., John, B., & Blackmon, M. (2012). CogTool-Explorer: A model of goal-directed user exploration that
considers information layout. *Proceedings of CHI 2012*, 2479-2488.

Trewin, S. M. (1998). *Towards intelligent, adaptive input devices for users with physical disabilities.* PhD
thesis, University of Edinburgh. http://hdl.handle.net/1842/34255

Trewin, S., & Pain, H. (1999). Keyboard and mouse errors due to motor disabilities. *International Journal of
Human-Computer Studies, 50*(2), 109-144. doi:10.1006/ijhc.1998.0238

WebAIM (2024). *Screen Reader User Survey #10* (December 2023 to January 2024, 1,539 valid responses).
https://webaim.org/projects/screenreadersurvey10/
