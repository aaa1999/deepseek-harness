# EPUB Reader

Adds a Reading panel to the left sidebar:

- Import EPUB books by click or drag; the shelf remembers reading progress.
- Two-column reading: serif reading column with adjustable size, notes column on the right.
- Select text and right-click to translate or explain. Results stream into note cards and persist as highlights; the text stays highlighted and hovering a card jumps back to it.
- Treatments use the currently configured model; no separate API key.

Data lives under `~/.dsh/epub-reader/`. Imported content is sanitized through a strict allowlist before it reaches the browser.
