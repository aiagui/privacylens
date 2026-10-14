# Visual identity

PrivacyLens uses two overlapping optical planes as its mark: one focused
perspective formed from two lenses. The optical field is a decorative illustration
of signals coming into focus; its points are not measurements.

The palette pairs graphite (#14161b), chalk (#f5f4f0), electric blue (#4263eb) and
optical blue (#9badff). Graphite introduces the product; chalk supports evidence
reading. Evidence labels include text, so their meaning does not depend on color.

Manrope is hosted locally, with system fallbacks. The variable font and its SIL
Open Font License come from the [Google Fonts Manrope distribution](https://github.com/google/fonts/tree/main/ofl/manrope).
The license is retained in public/fonts/OFL.txt. No third-party font request is
needed at runtime.

## Accessibility

Navigation includes a skip link and visible keyboard focus. The skip link is
hidden in print, because a fixed element repeats on every printed page (this
was the repeated "Skip to content" in PDF exports). Reports open in a Simple
view and can switch to a Technical view with a tab control that supports the
arrow, Home and End keys; both views are built from the same summary, so their
counts cannot disagree. The optical field is deliberately low-contrast and
secondary to the findings. The optical field
has a pause control and remains still when reduced motion is preferred. Tables
have captions, scoped headers, named keyboard-focusable scroll regions and
mobile guidance. Reports use a single page heading followed by section headings.
The request window visualizes initiation times from the report data. Destination
buttons update a selected-signal summary with a polite announcement. The graphic
is decorative to assistive technology; the buttons expose the same timing and
destination data as text. Selection animation is brief and respects reduced motion.

## Public product assets

The favicon and social card are new product assets. Documentation screenshots
are captured from the production build using only bundled synthetic sample data.
They show the current product, not design mockups or real scan captures.

Approved assets are explicitly listed and fingerprinted in the publication
guard. Binary assets must match the reviewed bytes. New assets and changes to
existing ones need content and metadata inspection, an inventory update and an
updated fingerprint. Do not publish operational captures or personal material.

The metadata base is the local preview origin. A future hosted release must set
its verified public origin before using the social card in shared page previews.
