# politiko-research — working rules

Research repo for browser-runtime tooling (userscripts) for **Politiko**
(<https://politiko.io>), a live browser/PWA political-crime MMO run by someone else.

Read [`docs/01-rules-envelope.md`](docs/01-rules-envelope.md) before proposing anything.
It is not boilerplate — Politiko has an explicit scripting clause that draws a sharp,
enforceable line, and it is the main design constraint on this whole project.

## Hard rules

1. **Consume, don't request.** Tools read data that already arrived — the DOM of the page
   being viewed, responses the app itself fetched, the client's query cache, the socket
   the client already opened. A tool that adds zero requests to politiko.io cannot
   violate the scripting clause. Treat any design that needs a new request as requiring
   an explicit decision, not a default.
2. **Never automate gameplay.** No clicking, no action initiation, no auto-anything.
   Politiko's account-sharing rule treats "having someone initiate processes on your
   behalf" as bannable — which includes an agent driving the session. Claude inspects;
   the human plays.
3. **One account, no alts.** Multi-accounting is aggressively enforced and there is no
   test account. Every authenticated experiment risks the only account. Prefer observing
   normal play over probing.
4. **Never probe an endpoint to see what it does.** If it wasn't called by the app during
   normal use, we don't call it.
5. **Exploits → report, don't test.** If something exploitable surfaces, stop, write it
   up privately, and route it to the bug bounty. Nothing public first.
6. **Disclose everything** in any script shipped — reads, writes, storage, network.
   Undisclosed functionality is explicitly bannable.

## Recon conduct

- Read-only browsing of public pages is fine.
- `tools/fetch-bundles.ps1` is a manually-initiated, one-shot static-asset pull. Never
  automate it, schedule it, or point it at game routes.
- Analyze downloaded bundles locally rather than poking the live site.
- Anything from an authenticated session (tokens, cookies, HARs, personal data) stays out
  of git — see `.gitignore`.

## Layout

```
docs/     numbered findings + plan; 00 recon, 01 rules, 02 plan, 03 ideas
tools/    recon helpers (PowerShell)
userscripts/  _template.user.js — passive-tap skeleton; real tools land beside it
artifacts/    gitignored: downloaded bundles, HARs, captures
```

## Conventions

- Findings go in `docs/`, dated, with the evidence that produced them. Distinguish
  **measured** from **inferred** — the recon baseline already flags which is which.
- The landing page's stat blocks are hardcoded marketing content. Only `/api/public/*`
  reflects the real world state. Don't cite the landing page as data.
- Chunk hashes change every deploy — never hardcode a hashed filename or a generated CSS
  class in anything meant to last.
- Windows box: `git commit -F <file>` rather than `-m` (PowerShell mangles quoted `-m`).
  `.gitattributes` handles the CRLF situation.
</content>
