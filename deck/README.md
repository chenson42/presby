# Training deck

`slides.md` is a [Marp](https://marp.app/) presentation. It compiles to PDF, PPTX, or HTML.

## Render it

Install the Marp CLI once:

```bash
npm install -g @marp-team/marp-cli
```

Then:

```bash
# PDF
marp deck/slides.md --pdf

# PowerPoint (.pptx)
marp deck/slides.md --pptx

# HTML (live reload)
marp deck/slides.md --html --watch
```

The output lands next to `slides.md` (e.g. `slides.pdf`, `slides.pptx`).

## Editing

It's plain markdown with slide breaks (`---`). Edit in any editor; the Marp VS Code extension gives you a live preview while you type.

## Audience

The deck is written for a mixed audience — engineers and non-engineers both. Lead each section with the *why*, then the *what*. Stack rationale and review cadence are designed to be understood without prior software experience.
