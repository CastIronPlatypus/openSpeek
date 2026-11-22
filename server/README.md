# openSpeek server

Optional. The openSpeek web app works without it, using Phonon running in your browser. The
server adds:

- **Edge TTS**: Microsoft Edge's online read-aloud voices, with word timings.
- **Server-side Phonon**: for devices too slow to run Phonon in the browser.
- **`/api/fetch`**: fetches web pages for URL import when a site blocks cross-origin requests.
- **Static hosting** of the built app (`dist/`), so one process is a complete deployment.

The API is described in [`docs/server-api.md`](../docs/server-api.md).

## Run

You need Node 22 or later.

```sh
npm ci && npm run build          # build the web app into dist/ (repo root)
cd server && npm ci && cd ..     # install the server's one dependency (ws)
node server/src/index.js         # http://localhost:8787
```

With Docker, from the repo root:

```sh
docker compose up --build        # openSpeek + a Phonon backend, http://localhost:8787
# or just openSpeek (Edge TTS, page fetching, browser Phonon):
docker build -t openspeek . && docker run -p 8787:8787 openspeek
```

The Phonon container downloads its model and voices from Hugging Face the first time it starts,
and keeps them in the `phonon-cache` volume.

### Server-side Phonon

The server uses one of these backends:

1. **Phonon's OpenAI-compatible server** ([`ptts-openai-server`](https://github.com/gradium-ai/xn-ptts/tree/main/ptts-openai-server)),
   when `PHONON_URL` is set. `docker-compose.yml` wires this up. To run the backend by hand:
   `docker run -p 8880:8880 -e PTTS_LANG=en -e PTTS_QUANT=q8 ghcr.io/gradium-ai/ptts-openai-server`,
   then start the server with `PHONON_URL=http://localhost:8880`. The backend has no
   authentication, so do not expose its port to other people.
2. **The `ptts` command line**, when `PHONON_URL` is not set and `ptts` is on `PATH` (or
   `PHONON_CMD` names it). Install it with `pip install ptts` (or `uv tool install ptts`, or a
   release binary). Each request starts `ptts`, which loads the model each time. That is fine for
   one person, but use option 1 for anything more.

`/api/health` reports `engines.phonon: true` only when a backend is set up and answering.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | Port to listen on. |
| `HOST` | `0.0.0.0` | Address to listen on. |
| `STATIC_DIR` | `../dist` | The built web app. |
| `CORS_ORIGIN` | `*` | `Access-Control-Allow-Origin` for `/api/*`: `*`, or a comma-separated list of origins. |
| `TRUST_PROXY` | off | Take the client IP from `X-Forwarded-For` for rate limiting. Turn this on only behind a reverse proxy you run. |
| `TTS_RATE_LIMIT` | `120` | `/api/tts` requests per minute per IP (`0` turns limiting off). |
| `FETCH_RATE_LIMIT` | `30` | `/api/fetch` requests per minute per IP. |
| `BODY_LIMIT` | `16384` | Maximum JSON body size, in bytes. |
| `EDGE_TTS` | on | Set to `0` to turn off Edge TTS. |
| `EDGE_DEFAULT_VOICE` | `en-US-AriaNeural` | The voice used when the client does not name one. |
| `EDGE_CONCURRENCY` | `4` | How many Edge requests run at once. |
| `EDGE_TIMEOUT_MS` | `30000` | Edge idle timeout. |
| `PHONON_URL` | unset | Base URL of a `ptts-openai-server`, e.g. `http://phonon:8880`. |
| `PHONON_CMD` | `ptts` | The local `ptts` command, used when `PHONON_URL` is unset. |
| `PHONON_LANG` | `en` | `--lang` for local `ptts`. It also filters the voice list. |
| `PHONON_CONCURRENCY` | `1` | How many Phonon requests run at once. |
| `PHONON_TIMEOUT_MS` | `120000` | Phonon request timeout. |
| `FETCH` | on | Set to `0` to turn off `/api/fetch`. |
| `HTTPS_PROXY` / `NO_PROXY` | unset | Outbound HTTP proxy for Edge TTS and page fetches. It is reached with `CONNECT`. Phonon traffic never goes through it. |
| `FETCH_USE_PROXY` | on | Set to `0` so page fetches go direct even when `HTTPS_PROXY` is set. |
| `FETCH_PROXY_PIN_IP` | off | When page fetches go through the proxy, `CONNECT` to the IP address the server checked instead of to the host name. See below. |

## Privacy and the Edge TTS caveat

**Edge TTS sends the text being read to Microsoft.** It uses the online service behind
Microsoft Edge's "Read aloud" feature. This is an **unofficial** use of that service: Microsoft
does not offer it as a public API. It may change, break or be restricted at any time, and using
it may be against Microsoft's terms. The protocol constants in `src/edge/constants.js` and the
token algorithm in `src/edge/drm.js` follow the open-source
[edge-tts](https://github.com/rany2/edge-tts) project (7.3.1). If Edge TTS starts failing, check
that project first. Set `EDGE_TTS=0` to turn it off. Phonon, in the browser or on the server, keeps
the text on machines you control.

## Page fetching and SSRF

`/api/fetch` fetches only `http`/`https` URLs on ports 80 and 443, with no credentials in the URL.
The server resolves the host name itself and refuses the request if any address is loopback,
private, link-local, CGNAT, multicast, reserved or unspecified. This covers IPv4 and IPv6,
including IPv4-mapped, NAT64 and 6to4 forms. The server then connects to the address it checked,
so nothing resolves the name again between the check and the connection. It checks every redirect
the same way (at most 5). Each fetch has a 10 s limit and a 5 MB limit after decompression. Only
HTML is accepted, and it is converted to UTF-8. The server sends no cookies.

With `HTTPS_PROXY` set, the server checks the addresses the same way. The tunnel is then opened
by host name by default, because many egress proxies accept only names. The proxy therefore
resolves the name again. A DNS-rebinding race is possible on that path unless the proxy blocks
private destinations itself. If your proxy accepts `CONNECT` to IP addresses, set
`FETCH_PROXY_PIN_IP=1` to keep the strict behaviour.

## Tests

```sh
cd server && npm test            # node --test
```
