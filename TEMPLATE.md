# Template: Blank

A zero-dependency Node starter. It already boots, serves, and persists — it
is a foundation to build ON, not a placeholder to delete.

## What's already built and wired (do NOT rebuild it)

```
server.js          zero-dep HTTP server: static files + JSON API + /health
lib/store.js       durable JSON storage, atomic writes (temp file + rename)
public/index.html  placeholder page (self-titles from the subdomain): replace its content with the app
public/styles.css  design tokens — edit :root, don't re-invent a palette
public/shrink-photo.js  shrinkPhoto(file): a photo small enough to upload; use it on every photo
```

- **No dependencies, no `npm install`.** `npm start` runs it as-is. Keep it
  that way unless the app genuinely needs a package; every dependency you add
  costs the user an install on every build.
- **Add API routes to the `routes` table in `server.js`** (`'GET /api/items'`).
  There is a worked example in the comment right above it. Anything not
  matched there falls through to `public/`.
- **Persist with `lib/store.js`**, don't hand-roll `fs.writeFileSync` —
  a non-atomic write corrupts the user's data when a container restarts
  mid-write. `store.read(name)` / `store.write(name, data)`.
- **Style with `public/styles.css`.** The tokens in `:root` (`--bg`, `--fg`,
  `--accent`, `--card`, `--border`) already give a coherent dark theme.
- `/health` exists and the platform uses it. Don't remove it.

## Where things go

| Adding | Put it in |
|---|---|
| A page | `public/*.html` |
| An API endpoint | the `routes` table in `server.js` |
| Saved data | `lib/store.js` via `store.read` / `store.write` |
| Styling | `public/styles.css` (tokens first) |
| Shared logic | a new file in `lib/` |
