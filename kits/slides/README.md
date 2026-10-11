# Slides

Build fixed-canvas slide decks with the shared slide kit. The kit ships the entire viewer: scaling to any screen, keyboard and touch navigation, thumbnail rail, play mode with a presentation pointer and image zoom, presenter view with speaker notes, PDF and PPTX downloads. You author slide content only; never rebuild any of that chrome.

In a live artifact, decks are multiplayer out of the box: the rail shows who is on which slide, and each slide shows the cursors of the people on it, their cursor chat (`/`) and the text they select. Leave all of it on unless the user asks otherwise; `<Deck cursors={{ chat: false }}>` (or `selection: false`, `enabled: false`) turns one part off.

When the user wants every future deck to share one look (master slides), don't re-describe the design each time: load the ART-KITS subskill and turn an approved deck into an Art Kit.

## What you are building

The decks people admire are not documents cut into pages; they are talks, staged. Jobs introduced the iPod with a slide that said "1,000 songs in your pocket": five words on screen, every other word spoken. You are the speechwriter and the stage designer, not the typesetter: write the talk first, then stage it, and the classic failures of generated decks (walls of text, no build, no arc) never get a chance to happen.

Two different artifacts get called a deck. Decide which one you are building before anything else:

- **Presented deck**, the default. A presenter speaks over it, and each canvas anchors its moment with the one thing that must be seen to be believed. Sparse slides, real speaker `Notes`, reveals that follow the speech.
- **Reading deck**, only when the deck will be read rather than watched ("pre-read", "send-around", "leave-behind"). With no presenter to carry the words, each canvas has to make its point alone, like a consulting pre-read: the headline states a conclusion and one exhibit backs it up. The extra room goes to evidence (charts, tables, comparisons), never to prose; a slide of paragraphs is a memo wearing a deck's clothes. Don't use `Step` reveals here, since a reader only ever sees the settled slide.

If the request leaves the genre genuinely unclear, ask ("Will you present this, or should it read on its own?"): one question is cheaper than the wrong deck. Everything below assumes a presented deck; the reading deck differs only where called out.

## The beat sheet

Every deck starts as a beat sheet: the talk written out in order, opening on the thesis, building it with evidence, closing on the one takeaway. Each beat answers two questions:

- **What do you say?** The sentence or three you would actually speak. These words ship as the slide's `Notes`, nearly verbatim, so the canvas never has to absorb them.
- **What do they see?** The one thing the audience must see while hearing it. A number at statement scale (the takeaway, not the table it came from), an image or diagram that shows what words can't, a phrase (only the words that must be remembered verbatim), a chart whose shape is the point, or nothing new: the previous canvas holds while the speech moves on (Jobs often spoke over a plain black slide).

A slide shows only what its beat puts on screen: no headers, footers, sheet numbers, or corner labels. What you say can run long; what they see cannot. A beat that seems to need two things on screen is two beats. Every slide must pass the billboard test: one dominant element, huge type, readable in three seconds from across the room. A headline asserts the beat ("Churn dropped 40% after the rework"), never labels a topic ("Churn update"). Finish every slide with Chanel's rule: look once more and take one thing off.

Test the sheet before building anything: read the spoken lines top to bottom; they should reconstruct the whole argument. For a reading deck, each beat's words become the slide's headline instead of `Notes`, and the same test runs on the headlines.

Then stage it. A beat usually gets its own slide; consecutive beats can share one canvas, with the later beats becoming `Step` reveals. The audience must never read ahead of the narration: a list spoken item by item reveals item by item, an annotation lands when the speech reaches it.

## Build

Set up the project like any artifact; the kit is in every project as `kits/slides`:

```bash
artifact init "Q3 Review"        # or: artifact clone <artifact-url> [-v N] to rework an existing deck (or one of its versions)
```

The deck is the whole app; `Notes` carry the talk, `Step`s carry the clicks. Every prop is in `kits/slides/docs/slides.d.ts`:

```jsx
import { motion } from "motion/react";
import "https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400..900&display=swap";
import { Deck, Notes, Slide, Step, useSlideSteps, useStep } from "@kits/slides";

// The deck's one bold beat: snaps into focus when its step is revealed and
// unwinds going back; static surfaces (exports, thumbnails) render it settled.
function BoldBeat() {
  const { visible } = useStep();
  const { interactive } = useSlideSteps();
  const beat = (delay) => ({
    initial: false,
    animate: visible
      ? { opacity: 1, filter: "blur(0px)", scale: 1 }
      : { opacity: 0, filter: "blur(24px)", scale: 1.14 },
    transition: { duration: interactive ? 0.9 : 0, ease: [0.16, 1, 0.3, 1], delay: interactive && visible ? delay : 0 },
  });
  return (
    <>
      <motion.h2 {...beat(0)} style={{ fontFamily: "Schibsted Grotesk" }} className="origin-left text-[240px] font-extrabold leading-none tracking-[-0.05em]">
        Then move.
      </motion.h2>
      <motion.p {...beat(0.3)} className="mt-[52px] max-w-[880px] origin-left text-[40px] leading-[1.4] text-[#a89d92]">
        Motion spends the attention that stillness saves.
      </motion.p>
    </>
  );
}

export default function App() {
  return (
    <Deck>
      <Slide className="flex flex-col justify-between bg-[#a4492e] p-[120px] text-[#f6f1e7]">
        <p className="text-[24px] font-semibold uppercase tracking-[0.2em] text-[#efc4b2]">Slide craft</p>
        {/* The hero: the same viewTransitionName and text on both slides makes
            it travel between them. Keep it w-fit and never animate it. */}
        <h1 style={{ fontFamily: "Schibsted Grotesk", viewTransitionName: "thesis" }} className="w-fit text-[300px] font-extrabold leading-none tracking-[-0.04em]">
          Subtract.
        </h1>
        <div className="max-w-[880px] self-end">
          <p className="text-[40px] leading-[1.4] text-[#f2d5c8]">
            “Perfection is achieved, not when there is nothing more to add, but when there is nothing left to take away.”
          </p>
          <p className="mt-[28px] text-[26px] text-[#efc4b2]">— Antoine de Saint-Exupéry</p>
        </div>
        {/* Notes are the talk, nearly verbatim; "advance" cues mark the clicks. */}
        <Notes>
          Saint-Exupéry said perfection is reached when there is nothing left
          to take away. That is this whole talk in one word; let it hold the
          room for a moment. Advance: the counter-beat.
        </Notes>
      </Slide>
      <Slide className="flex flex-col justify-center bg-[#211d19] p-[120px] text-[#f6f1e7]">
        <p style={{ fontFamily: "Schibsted Grotesk", viewTransitionName: "thesis" }} className="w-fit text-[56px] font-extrabold text-[#e17a55]">
          Subtract.
        </p>
        <Step className="mt-[72px]">
          <BoldBeat />
        </Step>
        <Notes>
          But stillness is only half the craft. Advance, then move: motion
          spends the attention that stillness saves, so spend it where the
          story turns.
        </Notes>
      </Slide>
    </Deck>
  );
}
```

Slides crossfade into each other by default; `<Slide transition="slide">` pushes sideways, `"none"` cuts.

Hooks, for content that reacts to the deck:

```tsx
useSlideNumber(): number; useSlideCount(): number;   // 1-based slide this renders on / total slides
useSlideSteps(): { revealed, total, interactive };   // reveal cursor; interactive=false on static surfaces
useStep(): { visible, index };                       // the surrounding Step
useSlideNavigation(): { next, previous, goToSlide }; // in-slide nav, e.g. agenda links; goToSlide is 1-based
```

Slides render on several surfaces at once (stage, thumbnails, presenter, export), so keep them pure: no `window` reads or randomness in render. Design the resting pose first; exports skip animation and freeze infinite loops at their first frame. `<Slide staticAssets={[url]}>` declares URLs that only CSS references, so exports wait for them. Images are click-to-zoom in play mode; `data-slide-image-zoom="false"` opts a logo out.

## Craft

Word budgets: headline ≤ 8 words, a bullet ≤ 6 words and never wrapping, ~30 words visible per slide in total (a reading deck may run denser).

Density ceilings per slide type; hitting one means split, never shrink:

| Slide type        | Maximum                                                 |
| ----------------- | ------------------------------------------------------- |
| Title / statement | 1 heading + 1 support line                              |
| Content           | 1 heading + 4 one-line bullets **or** 1 short paragraph |
| Grid              | 1 heading + 6 cards                                     |
| Quote             | 1 quote (≤3 lines) + attribution                        |
| Data              | 1 chart **or** 2–3 big stats, + 1 takeaway line         |

Type scale (px):

| Role                                 | Size                        |
| ------------------------------------ | --------------------------- |
| Statement h1 (the text is the slide) | 120–200                     |
| Section heading h2                   | 64                          |
| Subheading h3                        | 44                          |
| Body                                 | 36                          |
| Eyebrow, labels, captions            | 24 (the floor for any text) |

Canvas padding ≥ 80px, gaps between tiers ≥ 48px; both grow as slides get sparser. Text blocks ≤ 900px wide. Left-align body text; center only statements.

The shared design principles, applied to a fixed canvas:

- **Hierarchy has depth.** Build it on two or three dimensions at once (size, weight, color, position, surrounding space), never size alone. Scale with sparseness: the fewer the elements, the bigger the type. Dead space around enormous type reads as intent; around timid type, as an accident.
- **Place the whitespace.** Push it between content tiers (`justify-between`, generous gaps) instead of letting it pool at the bottom. Horizontal asymmetry is composition; vertical imbalance is a bug. A slide that feels empty needs bigger type, not more decoration.
- **One visual system.** Two typefaces (one display face that stays composed at statement scale, one workhorse for body and labels), a committed palette, the same grammar on every slide. Vary the composition within it: no two adjacent slides should look alike.
- **Commit to color.** Decks carry far more color than UI: full-bleed color slides make great section breaks and closers. Never pure #000/#fff.
- **Motion hands attention to the content, never holds it.** Design the resting composition first, then decide how the slide arrives. Ambient motion is this medium's superpower: no other slide tool can make a canvas breathe (a drifting gradient, a texture stirring at the edges). Spectacle is welcome too when the motion acts out the idea (a number counting up, three options collapsing into one). Choreograph the deck like music: quiet slides frame expressive ones, elements move together rather than each on its own. Motion fails only when it is beside the point.
- **Never:** topic-label titles; accent bars or underlines beneath headings; the same card grid twice; bullets as the default body; every slide centered; hairline frames, divider lines, or corner marks where spacing would do; sheet numbers, rev tags, or other fake print metadata; gradient text; default chart styling; icons or emoji as filler; boxes added because a corner felt empty.

## Review

The URL hash switches review surfaces without reloading.

```bash
# Every slide as a numbered contact sheet in one screenshot (square viewport packs it largest).
artifact cdp -v 1500x1500 -e 'location.hash = "slide-preview-grid"' -s

# Slide N at full 1920×1080 resolution, steps revealed, animations settled.
artifact cdp --continue -v 1920x1080 -e 'location.hash = "slide-preview-3"' -s

# The live viewer (empty hash), for checking real choreography like hero carries
# and multi-step builds; each ArrowRight is one beat: next step, then next slide.
artifact cdp --continue -e 'location.hash = ""' \
  -e 'window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }))' -s
```

The grid is usually all you need: review it the way you would review a junior designer's work. Does it deliver the plan, does every slide land its one beat, does anything read as a wall of text (a thumbnail that does is a document, not a slide). Then get obsessive about the finish, because that is where generated decks betray themselves.

These screenshots are your working material, not deliverables: the user sees the saved deck itself. Never embed your captures in a reply, as markdown images or attachment URLs, unless the user explicitly asks to see a screenshot.
