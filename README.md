# Norae

An Electron desktop karaoke room and video editor for English songs. Paste a YouTube or SoundCloud track link, fetch LRCLIB lyrics independently of ElevenLabs Scribe v2 transcription, align the chosen lyrics, review the timing, and export a black-background karaoke MP4.

## Run

Norae targets macOS. Development requires Node.js 22.12+, Xcode Command Line Tools (`xcode-select --install`), yt-dlp and FFmpeg. Build the native helper with a macOS 26 SDK. Apple Intelligence title enrichment requires macOS 26 and an eligible Mac with Apple Intelligence enabled in System Settings. The packaged app includes the helper and does not require developer tools.

```sh
npm install
npm run setup:audio
npm run dev
```

`npm run dev` fully relaunches Electron after changes in `src/`, `electron/`, `shared/`, `native/`, or app configuration. Changes within 350 ms are batched, and the old desktop process closes before the new one starts. The queue, downloaded audio, selected lyrics, transcription and saved timing survive relaunches. Completed songs reopen without media or lyrics provider requests. Interrupted processing stays paused until explicitly retried.

Title enrichment uses Apple's on-device Foundation Models framework with structured output; no metadata service or API key is involved. The model extracts a song name from supplied source metadata without inventing names or dropping recording-version labels. Artist attribution remains separate for lyric matching. Original names and successful enrichment are saved. Existing songs are cleaned locally on launch without downloading, transcribing, aligning or changing reviewer timing. If Apple Intelligence is disabled, unavailable or times out, basic cleanup removes known artist prefixes and common upload suffixes; enable Apple Intelligence and relaunch to enrich these titles locally.

The setup script also installs optional local Whisper tools. The default cloud pipeline does not need a Whisper model. Settings → Load demo uses an original synthesized instrumental and illustrative timing; it works without API keys and supports manual editing and video export.

## Credentials

LRCLIB is the default lyrics provider and requires no API key. Supply an ElevenLabs API key for transcription and forced alignment through a dotenv file. From the project folder, request it securely:

```sh
bb secret request ELEVENLABS_API_KEY --purpose "Configure Norae transcription and timing" --describe ELEVENLABS_API_KEY "Scribe v2 and forced alignment" --write-env .env.local
```

Alternatively, create a credentials file using the variable names in `.env.example`, and choose that file in Settings. The development app reads `.env.local` from its working directory by default. Packaged apps can choose an absolute credentials file path. Environment variables also work. Keys are read only in the desktop process and are never returned through settings or track snapshots. `.env` files are ignored by Git. Key presence is a configuration check; account entitlements are checked when the APIs are called.

Settings use LRCLIB, ElevenLabs, English, and Arial. Lyrics lookup needs no key; only ElevenLabs requires credentials. Existing lyrics-provider preferences are migrated to LRCLIB on launch. Local Whisper remains explicitly selectable.

## Prepare a song

1. Paste a single YouTube or SoundCloud track URL and click **Add to queue**. The app reads source metadata and cleans the song title with Apple Intelligence on this Mac. Artist attribution stays available for LRCLIB matching and recording review; the queue and song heading show only the title.
2. Open **Cross-check** if the lyrics recording needs confirmation or a provider fails. Exact title, artist, and duration within three seconds permits automatic selection only when there is one exact candidate.
3. Open **Edit timing** to correct word boundaries, split held words into syllables, and choose stanza boundaries.
4. Click **Export MP4** and choose the destination. The button becomes available when every word or syllable has valid timing; any blocker names the affected line and unit. Export progress and cancellation appear beside the preview. Export uses cached audio and saved timing without downloading, transcribing, or aligning again.

SoundCloud input accepts direct track links, `on.soundcloud.com` / `snd.sc` share links, and supplied private track links with their access token. Profiles, sets, and playlists are rejected; shortened links are checked again after the downloader resolves them. Preview-only recordings are rejected before transcription. Public tracks use the existing yt-dlp integration without a separate SoundCloud API key.

The downloader chooses `bestaudio/best`, then converts to MP3 using yt-dlp quality `0`. This is the highest MP3 conversion setting; transcoding cannot improve the compressed source. The app retains the original recording's vocals. Vocal separation, instrumental generation, and singing scoring are not implemented.

## Independent evidence and timing

```text
YouTube / SoundCloud → best available audio → highest-quality MP3 conversion
                                      │
                      ┌───────────────┴────────────────┐
                      │                                │
             LRCLIB plain/synced lyrics     ElevenLabs Scribe v2
                recording selection         English, no lyric prompt
                      │                                │
                      └───────────────┬────────────────┘
                                      │
                           independent word comparison
                                      │
                     ElevenLabs forced alignment of chosen lyrics
                                      │
                         reviewer edits → preview → MP4
```

Scribe v2 receives audio without database lyrics or transcript editing instructions. Forced alignment is a separate request that receives audio plus the selected lyric text. Agreement measures matching words, not accuracy or timing confidence. Singing, mumble rap, held vowels, repeated choruses, omissions, and ad-libs remain unbenchmarked. Incorrect text or recording variants can produce plausible but wrong alignment; reviewers must listen and correct them.

LRCLIB supplies plain lyrics and synchronized LRC lines where available. Recording selection and independent transcription still precede the separate ElevenLabs word-alignment pass. No lyrics API key is needed for this workflow.

Each lyrics lookup automatically retries twice after temporary network failures, timeouts, HTTP 408/429 or HTTP 500/502/503/504. Requests have a fresh 25-second timeout; retry delays default to one and two seconds and respect `Retry-After` seconds or HTTP dates. A server-requested wait longer than one minute leaves the manual retry available instead of retrying early. Cancellation interrupts the request or retry delay. Empty results, malformed responses and other HTTP errors are not retried. These retries affect only LRCLIB, including when using **Retry lyrics**; they do not redownload audio or repeat ElevenLabs requests.


If lyrics are unavailable, the independent transcript remains explicitly unverified. **Retry lyrics** in the song panel or Cross-check refreshes only LRCLIB recording choices; audio, transcription, and reviewer timing stay intact until a recording is selected. Reviewers can paste complete English lyrics, preserving blank lines between verses and choruses, and align them or time them manually. API failures remain visible, and audio playback/manual editing stay available after download succeeds. Exact word-for-word transcript matches retain their actual word timestamps as an unreviewed fallback if alignment fails. Forced alignment uses character timestamps to handle punctuation, contractions, and differences in returned word boundaries. A mismatched word keeps valid timing on other words and becomes a local review item; missing boundaries are not interpolated. Line-only timestamps cannot produce a word reading bar; the app lists affected line numbers and shows **Align words** when any line has missing word timing.

Word-level transcript results are grouped into readable lines using punctuation, phrase length, and pauses; inferred line and verse breaks remain unverified. LRCLIB's plain-text lines and section headings take priority over word-synced LRC row granularity when the words match. A phrase timestamp that spans multiple reference lines cannot invent precise timings for those lines; they remain untimed until alignment or review.

For repeated phrases, aligned words must stay within the selected recording's lyric line windows (with a small boundary tolerance). Conflicting assignments are removed locally, and matching saved transcript words can recover timing within that occurrence. Partial alignment preserves reference line windows so repeats cannot retire out of order. Relaunch applies this repair to unreviewed saved database results without new provider calls; manual and reviewed timing stays intact. Missing syllable boundaries still need reviewer timing.

## Manual review

**Edit timing** provides playback and a scrubber, a line selector, numeric word/syllable start/end times, and **Now** buttons to stamp the current audio position. Click the tap button or press **T** outside text inputs to stamp the first word start, subsequent word boundaries, and the final end. Refine gaps and overlaps with the numeric controls.

**Split syllables** accepts spelling-preserving parts such as `a|way`. Initial split durations are equally divided estimates; adjust them while listening. English syllable boundaries are not automatically inferred from character timestamps. The highlight progresses through each timing unit over its full duration and pauses in gaps.

**Begin a new stanza here** starts a new display block. Blank lines and section labels in plain lyrics also establish boundaries; longer stanzas are split into groups of four. Reviewers can override boundaries for a natural chorus layout. Changing wording clears that line's timing. Replacing the complete lyrics clears existing manual timing. Unsaved timing changes trigger a discard confirmation when closing the editor.

**Edit line and verse layout** accepts new line breaks, blank lines, and headings such as `[Verse 1]` or `[Chorus]` while preserving the same words and existing word/syllable timing. Use **Apply verse layout**, then **Save timing**. Changing words through this layout control is rejected; the separate wording/replace controls handle that explicitly.

**Save timing** applies validated changes to playback and export. **Save project file** preserves the recording URL, lyric text, stanza boundaries, timing units, font, and attribution in a `.norae.json` file. To resume later, queue the same recording and use **Load project file**. Loading checks recording identity and duration. The desktop also saves its queue and applied timing locally. Project files remain useful for portable backups; unsaved editor drafts still need Save timing before closing. Export rejects missing, reversed, overlapping, or out-of-song timing units; manual save can retain wholly untimed units for later work.

## Video format

Exports are 1920×1080, 30 fps, High-profile H.264 (`CRF 18`, progressive 4:2:0, closed GOP) with 48 kHz stereo AAC-LC audio at 384 kbps, BT.709 color metadata, and fast-start MP4 metadata without edit lists. These settings follow [YouTube’s upload recommendations](https://support.google.com/youtube/answer/1722171?hl=en). The background is black. Complete lyric lines remain visible; unsung words are pale gray. A rounded white vertical reading bar crosses the text at the timing of each word or reviewer-defined syllable, leaving consumed text blue. Its current style is 3px wide at 60% opacity in the desktop preview and native 1080p export. Held syllables slow the cursor; gaps between words move it across the space without coloring the next word early. At verse starts, the upcoming lyrics are visible during instrumental lead-ins and the bar moves linearly at constant speed from the left to reach the first word exactly at its start. Between lines within a verse, the outgoing bar fades at EOL while the incoming bar fades in at the next line’s first glyph over 240 ms. Periods are hidden in playback and export without altering the reference lyrics or word timings. Known verse/chorus names appear above the block.

Four lyric slots form two alternating pairs. When lines 3–4 begin, the consumed lines 1–2 fade out, then lines 5–6 fade into those freed slots. As 5–6 begin, 3–4 fade and 7–8 replace them. The untouched pair never shifts. Fades shorten for rapid phrases so brief lines such as “Yes” remain visible at their real onset. Verse boundaries keep their labels and do not split a pair across stanzas. During pauses between lines, the reading bar approaches the next word linearly from the left; tight transitions retain the simultaneous cue crossfade. The outro fades to black. The preview and export share the same sequencing and renderer. The desktop frame fits the space left after headings and errors, preserving 16:9 without overlapping playback controls. Export draws native canvas frames, so FFmpeg does not need libass/subtitle filters. Font rendering uses the installed font; fonts are not redistributed.

Arial is the default. The editor also offers Verdana (wide letters and generous spacing) and Trebuchet MS (rounded letters with distinct shapes). Export reports a missing installed font rather than silently substituting one.

The export is rendered into local song storage first, then copied to a staging file beside the destination and committed atomically. Cancellation or a failed save leaves an existing destination file intact. Removing a track aborts its work and deletes that recording from the library. Quitting aborts unfinished processing/export, saves completed work, and retains downloaded audio. Queue metadata is atomically saved under the app’s user-data library; no credentials are stored in it. Project files and completed exports remain where the reviewer saved them. Use authorized source recordings.

## Development checks

```sh
npm test              # Cross-checking, queue lifecycle, cloud API contracts, timing rules
npm run build         # TypeScript + production renderer
npm run test:desktop  # Electron playback, syllable editor, stage, and real 1080p MP4 export
npm run test:export   # Real 1080p export, timing preflight, A/V sync and encoded reading bars
npm run test:playback # Slider click/drag, keyboard/reviewer seek, and song switching
npm run test:persistence # Quit/reopen without repeated downloads or provider calls
npm run test:reprocessing # Reading bars and viewport containment after reprocessing
npm run test:audio    # Optional live YouTube/LRCLIB/local Whisper integration checks
npm run package       # Unsigned unpacked desktop app
```

Desktop smoke uses isolated settings and removes its temporary audio/settings data. It leaves `.runtime/demo-export.mp4`, exported frame and UI screenshots for visual review. Fixtures use original demo audio and lyrics; these are not evidence of singing transcription accuracy. Cloud contract tests mock API responses. Live ElevenLabs account checks require its API key.

`node scripts/persistence-smoke.mjs --soundcloud` checks SoundCloud URL entry, credited-artist metadata, the full pipeline, and playable queue restoration using local audio and mocked provider responses.

Export, playback, persistence, and reprocessing checks use isolated libraries and local audio fixtures without provider charges or preview artifacts. The local audio protocol streams byte ranges with explicit partial-response headers so clicking or dragging the playback slider can seek without restarting the recording.

`node scripts/legacy-upgrade-smoke.mjs` checks a one-time upgrade from the old in-memory queue: the development renderer saves its public snapshot, cached recordings are copied into the library, the old cache is deleted on quit, and the new desktop restores both songs and seeks to 0:04 without provider requests. `scripts/apply-live-upgrade.mjs` is a recovery tool for an already-running old development launcher; it verifies exact process ownership, disables its restart watcher, and refuses to close the desktop until the queue migration is verified. Normal launches and source-change restarts use the persistent library automatically.

## Implementation

| Path | Responsibility |
| --- | --- |
| `electron/engine.mjs` | Queue, independent branches, alignment, manual edits, exports, cancellation |
| `electron/audio.mjs` | Local audio streaming and byte-range responses for seeking |
| `electron/cloud.mjs` | ElevenLabs adapter and private credential loading |
| `electron/providers.mjs` | yt-dlp, optional local Whisper/LRCLIB, dependency checks |
| `electron/core.mjs` | Source metadata, recording ranking, LRC parsing, independent comparison |
| `shared/source-url.mjs` | YouTube/SoundCloud link validation and canonical recording identity |
| `electron/timing.mjs` | Alignment mapping and reviewer timing preparation |
| `shared/timing-validation.mjs` | Shared reviewer validation and export readiness |
| `shared/karaoke.mjs` | Stanza grouping, pair fades, word/syllable sweep, shared frame drawing |
| `shared/lyrics.mjs` | Reference lyric structure, transcript grouping, timing-preserving verse reflow |
| `shared/reading-cursor.mjs` | Deterministic cue motion during lead-ins, words, held syllables, and gaps |
| `electron/video.mjs` | Native canvas → FFmpeg MP4; timing project serialization |
| `electron/main.mjs` / `preload.cjs` | Sandboxed renderer bridge, native save/load dialogs |
| `src/App.tsx` | Queue, preview, cross-check, manual timing editor, settings |

The renderer has no Node integration, runs sandboxed, and uses narrow validated IPC calls. Credentials and arbitrary media paths are not exposed through track snapshots. URLs are limited to individual YouTube videos or SoundCloud tracks up to 15 minutes, with a 30-track queue limit. Mobile queue clients, automatic singing-specific syllable alignment, signed installers, and vocal separation remain future work.
