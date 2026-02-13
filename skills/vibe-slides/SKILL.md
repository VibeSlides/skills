---
name: vibe-slides
description: Create presentation decks and export to PDF/PPTX/PNG using the Vibe Slides API. Use for any slide deck, presentation, or PowerPoint generation request. Triggers on "make a deck", "create a presentation", "build slides", "make a PowerPoint", "generate a pptx", or any presentation creation task. Also supports branded decks using company themes, headshot/image attachments, and one-page profile summaries. Triggers on "create a profile deck", "make a one-pager for", "LinkedIn summary deck", or similar.
---

# Vibe Slides — Presentation Generation

Generate slide decks via the Vibe Slides API, then export as PDF, PPTX, or PNG.

## Key Behavior

**Just create it.** Always include "Don't ask questions, just create it immediately" in your prompts to the API. The deck AI will ask clarifying questions otherwise, wasting a generation cycle.

**One-shot by default.** Don't ask the user what style, how many slides, or what format unless they've left critical info out. Pick sensible defaults and generate. You can always iterate after.

## Environment

Requires `VIBE_API_KEY` env var. Get one at https://vibeslides.app/api-keys

## Quick Start

```bash
# Simple deck
node skills/vibe-slides/scripts/vibe-slides.mjs "A 5-slide overview of climate tech trends in 2026" --name "Climate Tech"

# PowerPoint format
node skills/vibe-slides/scripts/vibe-slides.mjs "Product roadmap for Q3" --format pptx

# Long prompt via stdin
echo "Create a detailed 10-slide investor pitch for..." | node skills/vibe-slides/scripts/vibe-slides.mjs --stdin --name "Pitch Deck"
```

Output: `FILE: /path/to/deck.pdf` on stdout, progress on stderr.

---

## Script 1: General Deck Creation

```
node skills/vibe-slides/scripts/vibe-slides.mjs "your prompt" [options]
```

### Options

| Flag | Effect |
|------|--------|
| `--name <name>` | Deck name (optional) |
| `--format <fmt>` | `pdf` (default), `pptx`, or `png` |
| `--upscale` | Upscale slide renders before export |
| `--out <dir>` | Output directory (default: cwd) |
| `--filename <name>` | Output filename without extension |
| `--no-export` | Create deck only, skip export |
| `--stdin` | Read prompt from stdin |
| `--timeout <s>` | Max wait time (default: 600s) |

### Timing

- Deck generation: 30–120s typical (more slides = longer)
- Export: 5–30s
- Total timeout default: 600s — increase for complex decks

---

## Script 2: LinkedIn Profile One-Pager

Creates a branded one-page profile deck from structured profile data piped via stdin.

```
cat profile.json | node skills/vibe-slides/scripts/linkedin-deck.mjs "Person Name" [options]
```

### Options

| Flag | Effect |
|------|--------|
| `--url <url>` | LinkedIn profile URL (informational) |
| `--company <url>` | Override company URL for theme |
| `--no-theme` | Skip theme creation |
| `--no-photo` | Skip headshot attachment |
| `--style <desc>` | Style description (default: "professional, modern, and visually striking") |
| `--format <fmt>` | `pdf` (default), `pptx`, or `png` |
| `--out <dir>` | Output directory (default: cwd) |
| `--filename <name>` | Output filename without extension |

### Stdin JSON Schema

```json
{
  "name": "Jane Smith",
  "headline": "VP Engineering at Acme",
  "location": "Melbourne, Australia",
  "followers": "5,200",
  "about": "Building great teams...",
  "experience": "1. Acme — VP Eng (2023-Present)\n2. BigCo — Director (2019-2023)",
  "education": "MIT — Computer Science",
  "skills": "Leadership, Distributed Systems, ML",
  "recommendations": "Jane is an exceptional leader...",
  "companyName": "Acme",
  "companyUrl": "https://acme.com",
  "photoPath": "/absolute/path/to/headshot.jpg"
}
```

The script auto-creates a branded theme from `companyUrl`, uploads the headshot as an attachment, and generates a visually rich one-page profile card.

**Without companyUrl:** deck generates unbranded (no theme colors). Always try to find the company website.

**Without photoPath:** layout adjusts to use full slide space (no placeholder silhouette).

---

## API Reference

The scripts wrap these endpoints. Use directly only if the scripts don't cover your use case.

**Base URL:** `https://api.vibeslides.app`
**Auth:** `Authorization: Bearer <VIBE_API_KEY>`

### Themes

Brand a deck using a company's visual identity (colors, fonts, style extracted from their website).

```
GET  /v1/themes                                    # List all themes
POST /v1/themes  { name, brand_url }               # Create from URL
GET  /v1/themes/:id                                # Check status
```

Poll `status` until `ready`. Theme creation takes ~2–5s. **Check existing themes before creating** to avoid duplicates.

### Attachments

Upload images (headshots, logos, diagrams) to include in decks.

```
POST /v1/attachments  (multipart/form-data, field: "file")
GET  /v1/attachments/:id
```

Returns `{ id, filename, content_type, file_size }`.

### Decks

```
POST /v1/decks  { prompt, name?, theme_id?, attachment_ids? }
GET  /v1/decks/:id
```

Poll until `status: "complete"` and `slides_complete >= slides_count`.

### Export

```
POST /v1/decks/:id/export  { format: "pdf"|"pptx"|"png", upscale?: bool }
GET  /v1/decks/:id/export?export_id=<id>
```

Poll until `download_url` appears. PNG format returns a zip of one PNG per slide.

---

## Prompting Tips

### Must-haves
- **Always** include: "Don't ask questions, just create it immediately"
- Be specific about slide count (e.g., "a 5-slide deck" vs. just "a deck")
- Specify the audience if relevant ("for a technical audience", "for C-suite executives")

### Style keywords that work well
- "bold and modern" / "minimalist and clean" / "premium magazine feel"
- "extra fabulous" / "visually striking" / "dark theme with neon accents"
- "corporate and professional" / "startup-friendly and colorful"

### Structure guidance
- "Each slide should cover one main point with a clear heading"
- "Include a title slide, 3 content slides, and a closing slide"
- "Use icons and visual elements, not just bullet points"

### With attachments
- "Include the attached headshot prominently on the first slide"
- "Use the attached logo in the header of every slide"
- Reference attached images explicitly so the deck AI knows to use them

### Example: complete prompt

```
Don't ask questions, just create it immediately.

Create a 6-slide pitch deck for "Acme AI" — an AI-powered document processing startup.

Slides:
1. Title — company name, tagline "Documents, Understood", logo
2. Problem — manual document processing costs enterprises $5M/year
3. Solution — our AI reads any document in seconds
4. Market — $12B TAM, growing 25% annually
5. Traction — 50 enterprise customers, 3M documents/month
6. Ask — raising $10M Series A

Style: bold, modern, dark background with bright accent colors.
Audience: investors at a demo day.
```

---

## Notes

- Decks stay accessible at `https://vibeslides.app/d/<id>` after export
- The `linkedin-deck.mjs` script requires `adm-zip` and `sharp` (installed in `skills/vibe-slides/node_modules/`)
- PNG export returns a zip; the script auto-extracts the first slide
- For multi-slide PNG export, use the API directly and extract all entries from the zip
