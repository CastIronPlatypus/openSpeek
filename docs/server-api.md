# openSpeek server API

The server is optional. The web app works without it using Phonon in the browser. With it,
the app gains two more engines (Edge TTS and server-side Phonon) and can import web pages
that block cross-origin fetches. The server also serves the built app (`dist/`), so one
process is a complete deployment.

All endpoints are under `/api`, send `Access-Control-Allow-Origin` (configurable, default
`*`) and answer `OPTIONS` preflights, so a statically hosted app can use a server on another
origin. Errors are JSON `{ "error": "human readable message" }` with a 4xx/5xx status.

## `GET /api/health`

```json
{ "ok": true, "engines": { "edge": true, "phonon": false }, "fetch": true, "feedback": true }
```

`engines.phonon` is true only when a Phonon backend is configured and answering.

## `GET /api/voices?engine=edge|phonon`

```json
{ "voices": [ { "name": "en-US-AriaNeural", "gender": "Female", "locale": "en-US", "description": "Aria (United States)" } ] }
```

`name` is the identifier to pass back as `voice`. English voices first, then by locale and name.

## `POST /api/tts`

Request (JSON): `{ "engine": "edge" | "phonon", "text": "One sentence.", "voice": "en-US-AriaNeural" }`
— `voice` optional (engine default). `text` is at most 4000 characters.

Response (JSON):

```json
{
  "format": "mp3",
  "audio": "<base64>",
  "words": [ { "start": 0.1, "end": 0.42, "charStart": 0, "charEnd": 3 } ]
}
```

`format` is `mp3` or `wav`. `words` is present only when the engine reports word timings
(Edge): times in seconds from the start of the audio, offsets into the request `text`.

## `GET /api/fetch?url=<encoded http(s) URL>`

Returns the page's HTML (`text/html; charset=utf-8`) for the importer. Only `http`/`https`,
refuses loopback, private and link-local addresses (including after redirects), caps the
body size and time.

## `POST /api/feedback`

Saves one piece of user feedback as a Markdown file on the server. `feedback` in
`/api/health` says whether this is enabled.

Request (JSON):

```json
{
  "message": "The voice picker is hard to reach on my phone.",
  "category": "bug",
  "contact": "optional@example.com",
  "context": {
    "route": "reader",
    "engine": "phonon",
    "voice": "Zoey",
    "theme": "dark",
    "viewport": "390x844",
    "language": "en-GB",
    "appVersion": "0.1.0",
    "standalone": false,
    "sourceKind": "pdf"
  }
}
```

- `message` is required, 1–5000 characters after trimming.
- `category` is `bug`, `idea` or `other` (default `other`).
- `contact` is optional free text, at most 200 characters.
- `context` is optional; unknown keys are dropped, values are short strings, numbers or booleans.
  It never contains document text or titles.

Response: `201` with `{ "ok": true, "id": "20261122-153012-a1b2c3" }`.

Each submission becomes one file, `<FEEDBACK_DIR>/<YYYY-MM-DD>-<HHMMSS>-<id suffix>.md` (UTC),
with YAML front matter followed by the message as written:

```markdown
---
id: "20261122-153012-a1b2c3"
date: "2026-11-22T15:30:12.000Z"
category: "bug"
contact: "optional@example.com"
route: "reader"
engine: "phonon"
voice: "Zoey"
theme: "dark"
viewport: "390x844"
language: "en-GB"
app_version: "0.1.0"
standalone: false
source_kind: "pdf"
user_agent: "Mozilla/5.0 …"
---

The voice picker is hard to reach on my phone.
```

The client's IP address is not stored.
