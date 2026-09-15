# Norae

A desktop karaoke room: queue YouTube links, play temporary audio, and cross-check database lyrics against an independent on-device transcript. Built with **Electron + React + TypeScript**, with a Node processing engine that can later serve a Swift queueing client. The UI intentionally uses native browser controls and layout-only CSS; visual theming is deferred.

## Run

Requires Node.js **22.12+**. Automatic audio setup supports macOS with [Homebrew](https://brew.sh).

```sh
npm install
npm run setup:audio
npm run dev
```

`setup:audio` installs **yt-dlp**, **FFmpeg**, and **whisper.cpp**, then downloads the multilingual **base** model (~142 MiB) into `.models/`. Norae detects that model at startup. Settings accepts custom executable and model paths. Setup usually takes 5–10 minutes, depending on the connection.

**Settings → Load demo** works without any audio tools or network. It uses an original synthesized instrumental and explicitly labelled illustrative lyrics. It does not simulate a successful transcription or measure accuracy.

For quality evaluation, download a larger multilingual model and select it in **Settings → Whisper model**:

```sh
npm run setup:audio -- large-v3
```

This model is approximately 3 GiB. Base is a quick setup model, not a recommendation for accurate singing transcription. No model here guarantees exact lyrics.

For Windows/Linux, install [yt-dlp](https://github.com/yt-dlp/yt-dlp#installation), [FFmpeg](https://ffmpeg.org/download.html), and [whisper.cpp](https://github.com/ggml-org/whisper.cpp#quick-start), download a [ggml model](https://huggingface.co/ggerganov/whisper.cpp/tree/main), and enter the executable/model paths in Settings. Those platforms have not been validated in this prototype.

## Use the room

1. Paste a YouTube video URL into the field at the top and click **Add to queue**. Optional singer, title, and artist fields are under **Song details**.
2. Follow the status in the queue. Use a song’s **…** button to reorder or remove it.
3. Open **Cross-check**. Confirm the correct LRCLIB recording when metadata is not an exact match, review disagreements, or retry after changing audio settings.
4. Play, seek, adjust volume, or use the fullscreen button for **Stage view**. Escape returns to the room. Playback advances to the next playable track when a song ends.

The prototype plays the **original recording, including vocals**. It does not yet separate backing tracks, record the microphone, or score singing. The queue lasts for the current desktop session. MP3s remain available for playback until removal or app exit; temporary WAV and raw transcript files are removed after processing. Lyrics and transcript results are kept in memory. Crash leftovers are cleared on next startup.

## Processing contract

```text
YouTube URL → validate → metadata → temporary MP3
                                        │
                       ┌────────────────┴────────────────┐
                       │                                 │
                  LRCLIB lookup                  FFmpeg → local Whisper
               title / artist / duration          audio only, no lyrics prompt
                       │                                 │
                       └────────────────┬────────────────┘
                                        │
                              cross-check / review
                                        │
                           primary lyrics + playback
```

Both branches start after extraction and run concurrently using independent failure handling. One track is prepared at a time to bound device resource use. A failed lyrics lookup leaves an explicitly unverified transcript; a failed transcription leaves database lyrics intact. Missing tools and provider errors are shown, never replaced with fabricated output.

**Lyrics provider:** [LRCLIB](https://lrclib.net/docs), which supplies plain and synchronized lyrics through an API. Exact normalized title + artist + duration within three seconds permits automatic selection. Other results require the user to choose the recording. The initial adapter avoids scraping Genius/Musixmatch pages; those providers can be added through their supported APIs and access arrangements.

**Primary wording:** database text is preserved even when Whisper disagrees. Synced LRC timestamps (including offsets and instrumental gaps) stay intact. Plain lyrics use monotonic word matching against Whisper segments for approximate line timestamps; insufficiently matched lines remain untimed. Repeated lines are aligned in sequence. The algorithm caps its comparison matrix to bound memory and marks oversized comparisons for review.

**Agreement is not accuracy.** The displayed percentage is the fraction of database words found in sequence in the transcript. Low overlap, absent transcript evidence, estimated timing, and timing drift are flagged. Independent ASR can still hallucinate, and a database match can be the wrong live/remix version. This is a reviewable prototype, not a benchmark demonstrating “extremely accurate” transcription. The next accuracy work is a labelled song test set, vocal separation, and a separate forced-alignment pass after the independent transcript has finished. None should silently rewrite the primary lyrics.

## Commands and checks

```sh
npm test              # Core and pipeline behavior tests, no external tools
npm run build         # TypeScript validation + production renderer build
npm run test:desktop  # Actual Electron UI/audio smoke test; build first
npm start             # Launch the production build
npm run package       # Create an unsigned unpacked desktop app in release/
```

Desktop smoke uses an isolated settings directory, generates screenshots in `.runtime/`, and removes its audio/settings data afterward. Network/audio-provider checks require the local tools and an accessible URL; the default test suite injects provider doubles to test deterministic failure, cancellation, and concurrency behavior.

`npm run dev:web` offers a layout preview only. YouTube processing is available through Electron’s isolated preload bridge. In development Vite permits its local React refresh preamble; the production renderer uses a restrictive CSP, no Node integration, a sandboxed renderer, denied navigation/popups/permissions, and narrow IPC methods. Audio URLs resolve only queue IDs, never arbitrary filesystem paths. External tools use argument arrays without a shell; subprocesses have time/output limits and cancellation. Inputs are restricted to individual YouTube videos up to 15 minutes, with a 30-track queue limit.

## Project map

| Path | Responsibility |
| --- | --- |
| `electron/engine.mjs` | Queue lifecycle, independent parallel branches, cancellation, cleanup |
| `electron/providers.mjs` | yt-dlp, FFmpeg, whisper.cpp, LRCLIB adapters |
| `electron/core.mjs` | URL/metadata validation, LRC parsing, candidate ranking, cross-checking |
| `electron/main.mjs` / `preload.cjs` | Native shell, settings, secure IPC, private audio protocol |
| `src/App.tsx` / `style.css` | Queue, processing state, review, player, stage, setup |

## Scope and future integration

SoundCloud intake and the Swift phone client are not implemented in this YouTube-first desktop prototype. A future authenticated local-room API can wrap `QueueEngine.add`, `move`, `remove`, and snapshots without moving transcription off-device. Queue persistence, a dedicated TV window, bundled tools/models, signed installers, source separation, word-level forced alignment, lyric correction, and a multilingual accuracy benchmark remain future work.

Use recordings you are permitted to download. Publicly accessible lyrics do not establish redistribution rights. The app uses temporary local media rather than hosting a song library.

## Validation on this machine

Validated on Apple Silicon macOS: 22 deterministic tests, TypeScript/production build, Electron smoke tests against both production and Vite renderers, demo audio playback and seeking, stage view, settings persistence, and queue removal. Live checks passed for LRCLIB lookup, FFmpeg + local Whisper transcription on upstream's public-domain JFK speech sample, and extraction of Blender's Big Buck Bunny YouTube video to a temporary MP3. The original yt-dlp test video was unavailable, so the extraction check uses Big Buck Bunny instead.

Run `npm run test:audio` to repeat the live checks after audio setup. Media is deleted when the checks finish. These checks validate integration; they are not a singing-transcription accuracy benchmark.
