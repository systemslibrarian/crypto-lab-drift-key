# Drift Key: What Would Make This a 10/10 Demo

## Verdict

This is already close to a 10/10 cryptography implementation. It is unusually honest, technically real, and deeply verified. The remaining gap is the demo experience: a first-time visitor has to read too much, choose among too many equally weighted paths, and scroll too far before seeing the proof.

Current overall impression: **8.5/10**.

The route to 10/10 is not more cryptography. It is a shorter, directed story that makes the strongest result impossible to miss:

> The device reproduced the key correctly, and the attacker recovered that same key from public data.

That is the memorable idea. Build the entire first-run experience around it.

## What Is Already Excellent

- The BCH encode/decode, code-offset sketch, HKDF call path, reliability trials, and attacker are real rather than staged.
- The page distinguishes secret, public, and derived values clearly.
- The entropy statement is precise: it discusses average min-entropy of the source given the helper, not "entropy of the key."
- Failure, mis-correction, and weak-source success are separate outcomes.
- The negative claim is exceptional: successful reproduction does not prove secrecy.
- The source simulation is labeled honestly and never presented as a physical PUF.
- The tests independently re-derive claims, cover accessibility, and include mutation evidence.
- The weak-source state is a genuinely strong climax, not a decorative toy result.

Do not dilute any of this. The job is to reveal it faster.

## Evidence From The Rendered Demo

The following observations came from the local app at desktop and 390 px mobile widths:

- On 390 px mobile, the first meaningful action, **Power the device up twice**, begins around `y = 1979`. A visitor must pass the hero, why-it-matters block, simulation notice, tabs, and several explanatory paragraphs before doing anything.
- The Enrol & Reproduce panel contains about **391 words**, six buttons, two disclosures, and several data blocks.
- The Helper Cost panel contains about **510 words** before its optional formula disclosure.
- Clicking **Weak-source fixture** near `y = 335` renders the decisive headline near `y = 1338`. There is no scroll or focus handoff, so the user can click the marquee action and see no apparent result.
- The six tabs have equal visual weight even though the material has a deliberate sequence.
- The term **fixture** exposes test-suite language in the primary experience.
- The weak-source action changes shared source settings. When the visitor changes tabs, that global state persists without a prominent scenario indicator or reset.

These are comprehension and feedback problems, not correctness problems.

## The Five Highest-Leverage Changes

### 1. Add a guided 90-second path

Make the first screen a directed experiment with one primary action:

**Run the experiment**

The guided path should advance through five scenes:

1. Read the same modeled device twice. A few cells change.
2. Hash both readings. The keys are completely different.
3. Enrol helper data, re-read, decode, and reproduce the same key.
4. Increase noise past the correction radius and show reliability fail.
5. Use a weak source. Reproduction stays green while the attacker gets the key.

Keep the existing tabs as an **Explore freely** mode for expert visitors. They should not be the only way to discover the story.

### 2. Put a real result in the first viewport

The hero should show the product, not only explain it. A compact live bit-grid comparison or before/after key strip should be visible immediately.

Suggested opening copy:

> **Drift Key**  
> Same device. Different bits. Same key.  
> See how public helper data repairs a noisy reading, then watch a weak source give the key away without any check failing.

Primary action: **Run the 90-second experiment**

Move the full simulation caveat into a short persistent label near the visualization, with its explanation available in a disclosure. Honesty remains visible without consuming the first two screens on mobile.

### 3. Couple every action to its result

After any primary action, its result must appear in the current viewport.

For the weak-source action:

- Rename **Weak-source fixture** to **Break secrecy without breaking reproduction**.
- Show a brief running state while the scenario is prepared.
- Scroll or move focus to the result summary.
- Announce the result through an appropriate live region.
- Put the decisive sentence directly beside the trigger before showing details.

Recommended result copy:

> **The device succeeded. The attacker did too.**  
> The key reproduced correctly, but the source had too little entropy to protect it.

The detailed bit grid, bound, attack derivation, and failure-code table can follow below.

### 4. Cut first-pass prose by roughly half

The writing is accurate, but the interface often explains a result before letting the visitor produce it.

For each scene, use this order:

1. One-sentence question.
2. One primary action.
3. Visual result.
4. One-sentence interpretation.
5. Optional **Why?** or **Show the math** disclosure.

Move theorem scope, formulas, failure-code tables, model detail, and paper context into disclosures. Keep all of it available; change only the default reading burden.

The **Why It Matters** hero card and final tab also overlap. Let the hero state the motivation in one sentence and reserve the final tab for applications, limitations, and references.

### 5. Make the transformation visual

The page should let a visitor watch data move through the construction:

```text
noisy reading -> XOR helper -> damaged codeword -> BCH correction -> recovered reading -> same key
```

Use a single stable stage rather than many peer cards. On each step:

- Highlight only the bits involved in that operation.
- Keep secret, public, and derived lanes spatially consistent.
- Animate values only after the real computation completes.
- Show corrected cells moving from error to repaired state.
- End with the two full key values snapping into an explicit equality comparison.

This is not decorative animation. It is the mechanism made legible.

## A Stronger Information Architecture

### Guided mode

A five-step progress rail tells the story in order:

```text
1 Noise -> 2 Hash fails -> 3 Repair -> 4 Reliability -> 5 Secrecy
```

Only the controls needed for the current lesson are visible. Advanced controls appear after the visitor completes the path or switches to Explore mode.

### Explore mode

Retain the current panels, but group them by question:

- **Can the key come back?** Noisy Source, Enrol & Reproduce, Reliability
- **Is the key still secret?** Helper Cost, Enrolling Twice
- **Where is this used?** Context and references

This preserves the lab depth without making six peer tabs the first decision.

### Persistent scenario bar

Show the shared state wherever it applies:

```text
Scenario: Healthy source | BCH(127,64) | BER 4% | Residual 64 bits | Reset
```

When the weak-source preset changes multiple panels, the bar should say **Weak source active**. This prevents hidden state from following the visitor between exhibits.

## Visual And Interaction Polish

- Give the central bit transformation more space and reduce the number of bordered boxes with equal emphasis.
- Reserve lime for active operations, equality, and success. Use a distinct warning color for low entropy so "decoder success" and "security failure" can coexist without semantic ambiguity.
- Make the entropy bar the visual anchor of the cost scene. Animate `m` shrinking while `n-k` stays fixed, then let the residual cross zero visibly.
- Mark the correction radius on reliability charts and label the visitor's current BER directly on the plot.
- Add three named presets instead of relying on sliders alone: **Healthy**, **Too noisy**, and **Weak source**.
- Keep raw hex available, but default to short values with a copy/reveal affordance. The lesson is the relationship between values, not reading the values themselves.
- On mobile, target the first action within the first `1.25` viewports. Collapse secondary hero text and disclosures before shrinking the visualization.
- After the final scene, show a compact conclusion that can be captured in one screenshot: key match, attacker result, source entropy, helper cost, and the one-sentence lesson.

## Suggested First-Run Script

### Scene 1: Same device, different reading

Question: **Can a key come from something that changes every time?**

Action: **Read the device twice**

Result: `7 / 127 cells changed`

Interpretation: **Close enough for error correction, but not close enough for a hash.**

### Scene 2: Hashing fails

Action: **Hash both readings**

Result: two visibly different keys

Interpretation: **A cryptographic hash amplifies even one changed bit.**

### Scene 3: The key comes back

Action: **Enrol and reproduce**

Show the real BCH correction one operation at a time, ending with:

> **Same key, byte for byte.**

### Scene 4: Reliability has a boundary

Action: **Push beyond the correction radius**

Result: decode failure or mis-correction, explicitly distinguished.

Interpretation: **Error correction solves drift only inside its operating envelope.**

### Scene 5: Correct is not secret

Action: **Break secrecy without breaking reproduction**

Result:

> **The device succeeded. The attacker did too.**

Then reveal the entropy arithmetic and public-data attack as evidence.

## Definition Of Done

The demo is 10/10 when these checks pass:

- A new visitor can reach the final weak-source insight in five primary actions and under 90 seconds.
- The first meaningful action is visible without scrolling on desktop and within `1.25` viewports at 390 px.
- Every primary action leaves its result visible, focused, or intentionally scrolled into view.
- The weak-source result is visible immediately after its button is activated.
- No scene requires more than two short paragraphs before its first action.
- A visitor can explain three facts after one run: why hashing fails, how helper data enables reproduction, and why reproduction does not prove secrecy.
- Guided mode never shows more than one primary button at a time.
- Shared presets are visibly identified and can be reset globally.
- Keyboard and screen-reader users receive the same guided sequence and result announcements.
- Existing unit, claims, mutation, mobile reflow, and accessibility gates remain green.

Add Playwright checks for the experience itself:

- At 390 px, assert the first CTA is within `1.25 * viewportHeight`.
- After each guided action, assert the result intersects the viewport.
- After the weak-source action, assert focus or scroll lands on the decisive headline.
- Assert the active scenario label changes with presets and Reset restores defaults.

## What Not To Add

- More algorithms, code families, or tabs
- Decorative animation disconnected from a real calculation
- A fake physical PUF claim
- Gamification, scores, badges, or completion confetti
- More theorem text in the default path
- A generic product tour that points at controls without telling the scientific story

## Recommended Build Order

1. Fix action-result visibility, especially the weak-source scenario.
2. Rename fixture/test language and add visible scenario state plus Reset.
3. Build the five-scene guided path from existing computations.
4. Move secondary explanation into disclosures and shorten first-pass copy.
5. Recompose the central transformation and entropy crossing as the two hero visuals.
6. Add viewport and focus assertions to Playwright.
7. Preserve the current panels as expert Explore mode.

The implementation already earns trust. A 10/10 version makes that trust legible in the first minute.