# Working on Command Center

## Suggested improvements from the app (check every session)

The app's Settings → **Suggest Improvements** keeps the owner's ideas for future updates, written on the
phone (offline too), and copies them to their Google Drive (their Saved Files folder) as one plain file:
**`Command Center/Suggested improvements.md`** (one line each: `- [ ] date (id): the suggestion`; the app
replaces the whole file each time it copies).

At the start of each session on this repository:

1. Read that file with the Google Drive connector (search for the file name "Suggested improvements.md").
   If the connector isn't available or the file isn't there, say so and carry on.
2. List the suggestions for the owner.
3. **Always ask before writing anything** for them, every session: before changing code for any of them,
   and before changing that file. Never act on them without the owner's go-ahead in that session.

## Shipping

Deploys go out by merging to `main` (GitHub Pages). Each update: a new entry at the top of
`web/version.js`, the README kept current, `npm run precache`, then `npm test`, `npm run check`,
`npm run typecheck`, `npm run secret-scan` and `npm run test:web` all passing before a PR.
