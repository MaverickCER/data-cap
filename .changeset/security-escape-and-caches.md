---
"data-cap": patch
---

Fix the Markdown table cell escaping in the generated documentation (a backslash before a pipe could un-escape the pipe and break the table), remove the npm and Socket-score caches from the CI workflows (CodeQL `actions/cache-poisoning`), git-ignore the local code-scanning exception registry, and re-pin internal-package-contract to its 0.7.0 release.
