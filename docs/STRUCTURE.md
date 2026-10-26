# How the site is built

The commands, what is in each folder, and the rules the engine keeps.

## Commands

```sh
npm install        # once
npm run dev        # the site on http://localhost:5173
npm test           # unit tests: the engine, CutRoom's 49 scenarios, the project file, storage, import
npm run test:e2e   # the site in a real browser (Chromium; Firefox too with E2E_FIREFOX=1, WebKit with E2E_WEBKIT=1)
npm run typecheck
npm run build      # type check, then the site into dist/ (the privacy policy is at /privacy/)
```

WebCodecs and the origin private file system need a secure context, so always open the site on `localhost` or over
HTTPS, never from a `file:` address.

## What is here

- `src/engine/`: the editing engine, a port of the Android app's rules. Pure and immutable, with no browser APIs.
  Start with `index.ts`. Tests sit next to the code as `*.test.ts`.
- `test-data/edit-vectors.json`: what CutRoom's own code did in 49 scenarios. The Android app replays the same file.
- `content/privacy-policy.md`: the privacy policy, written for the Play Console as `docs/store/PRIVACY-POLICY.md`.
- `content/notice.md`: the notice that carries CutRoom's license, shared the same way from `NOTICE.md`.
- `src/policy/`: the static pages and what protects them: the privacy policy at `/privacy/`, the licenses and notices at
  `/licenses/` (built from the packages the site depends on), and the security policy of every page. The build that goes
  live (`PUBLIC_BUILD=1`) refuses to run while the effective date in the policy is still a placeholder, and has no source maps.
- `src/support.ts`: what the browser must have for the editor, and the notice when it lacks it.
- `src/project/`: the project and the codec for the Android app's project file (format 1).
- `src/storage/`: the project store (IndexedDB) and the media store (the private file system, written in a worker).
- `src/import/`: reading a video with Mediabunny, making a project from it, the project list's pictures.
- `src/player/`: the edit player (two video decks), the segment logic, and the sound stage with the players of music and voiceovers.
- `src/timeline/`: the viewport and zoom, the ruler, moving by cuts and frames, snapping, trimming and the range (ports of the app's).
- `src/editing/`: what each editing button does to the project, and the words for why an edit did nothing.
- `src/audio/`: the levels of every sound at a moment of the edit, music files, the voice recorder and the WAV it writes.
- `src/export/`: the export rules, the sound mix and the pipeline that writes the video file (WebCodecs through Mediabunny).
- `src/text/`: reading a subtitle file (encodings and code pages) into captions on a recording.
- `src/render/`: drawing captions on a canvas, with the same code for the preview and for export.
- `src/ui/`, `src/app.tsx`, `src/strings.ts`, `src/i18n.ts`: the screens, in English, Hebrew and Arabic.
- `e2e/`: the browser tests. `test-data/media/` holds their small videos (`npm run make-fixtures` rebuilds them).
- `public/`: the custom domain (`CNAME`), the icon, and the page for an address that does not exist (`404.html`), copied into every build.

## Rules for the engine

- A time is a whole number of milliseconds.
- Every edit is atomic: it gives a new timeline or a reason, and never leaves a half-changed one.
- A change that is refused or changes nothing costs no undo step.
- State is never mutated. Every function returns a new value.
