---
"data-cap": patch
---

`overrides` now aliases `puppeteer` -> `puppeteer-core` wherever `pa11y` resolves it -- zero bundled browser, zero Chromium-download postinstall script. A Socket.dev "Install scripts" finding directly hurts this package's own supply-chain score, so this had to go regardless of `pa11y`/`puppeteer` staying real, hard dependencies (no extra install step for anyone).

Also pins `tar` to `^7.5.22` (a critical hardlink/symlink-traversal CVE, non-breaking fix).
