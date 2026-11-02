# Likningsspill Web

A browser-native rewrite of Likningsspill, built with Vanilla TypeScript and
Vite. The equation model and game logic are implemented in TypeScript, and the
equation tiles are rendered as DOM elements styled with CSS.

Randomly generated equations omit zero constant terms: `3x+0` starts as `3x`,
including in the initial history entry.

Dragging a denominator uses one continuous drop area enclosing the numerator,
its chips, gaps, fraction bar (within 10 pixels) and before/after insertion
positions. Numerator drags use the mirrored area around the denominator. The
same rules apply on the opposite side of equals; a new denominator has only one
slot. The midpoint of the entire combined area determines before/after placement,
not the halves of individual chips. Only the chosen slot is visible, with the
matching ghost on the opposite side defaulting to the left.

Legal cancellation within the same fraction takes priority over insertion.
The cancellation area covers the target numeric chip and the corridor to the
fraction bar, including 10 pixels past the bar within the chip's width. It
requires a common factor greater than one and factors belonging to products
outside sums. A factor in `3(x+2)/3` can cancel; a term in `(x+3)/3` cannot. Hover
shows diagonal strokes only, without reduced numbers or model/history changes.
Dropping shows cancellation annotations and reduced values. Multiple pairs can
be marked on either side without completing earlier pairs. Click an annotation
to complete all marked pairs on that side, or equals to complete all marked
pairs on both sides. Completion only removes identities created by those
cancellations; it never cancels additional factors or simplifies unmarked
expressions. For example, completing the left cancellation in `3(x+2)/3 = 3(1)`
leaves `x+2 = 3(1)`. Other explicit operations first complete the marked pairs;
their own usual mathematical behavior is unchanged. Undo restores both the
equation and pending annotations.

When removing a denominator or completing a cancellation exposes a sum such as
`x+2`, its terms become ordinary movable terms immediately. No redundant
parentheses remain, and the opposite product (for example `1(3)`) does not need
to be evaluated first.

Slots stay hidden until the pointer reaches a legal area. Expressions shift
horizontally as needed to keep slots inside their side's frame. The expanded
area includes shifted slots and retains its layout through insertion/cancellation
mode changes. Leaving the combined area restores the layout; move away and back
to re-enter so restoration cannot cause flicker. Preview and release use the
same hit rules. Dropping preserves existing numerator/term height and centers
equals between the resulting expressions. Cancelling a drag applies no operation.
Other product-factor drags retain their existing merge and division behavior.
Terms in nested sums (including fraction numerators and denominators) can be
selected individually. Click the intervening plus/minus, select two compatible
terms, or drag one onto another to merge them without moving the whole fraction.
For example, merging the numerator of `(7-3)/2` produces `4/2`; the denominator
is left unchanged for a separate cancellation step.

## Development

```sh
npm install
npm run dev
```

## Tests and production build

```sh
npm test
npm run build
npm run preview
```

## GitHub Pages

The GitHub Actions workflow builds the app and deploys `dist/` to GitHub Pages
when changes are pushed to `main`. Vite uses the repository name from
`GITHUB_REPOSITORY` as the Pages base path during CI builds.
