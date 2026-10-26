# JustInVideo for the web

The browser version of JustInVideo, published at https://video.medicom.vip. The source is public so that anyone can read what
the site does; it stays proprietary, all rights reserved (see LICENSE). The parts derived from CutRoom keep its MIT license,
and the bundled components keep theirs (see `content/notice.md` and the site's /licenses/ page).

**This repository is a published copy.** It is made from the web folder of the app's own repository by a script, one commit
for each release, so a change made here would be overwritten by the next copy. Made from commit 9eb614957aac of that repository.

## Commands

```sh
npm ci
npm run dev        # the site on http://localhost:5173
npm test           # unit tests
npm run test:e2e   # the browser tests (Chromium; Firefox too with E2E_FIREFOX=1, WebKit with E2E_WEBKIT=1)
npm run build      # type check, then the site into dist/
```

## Publishing

Settings, Pages, Source: GitHub Actions, with the custom domain video.medicom.vip. Every push runs the CI workflow; when it
has passed, run Deploy to GitHub Pages from the Actions tab. The build that goes live has no source maps and stops if the
effective date in `content/privacy-policy.md` is ever a placeholder. How the site is built and what is in each folder is in
[docs/STRUCTURE.md](docs/STRUCTURE.md).
