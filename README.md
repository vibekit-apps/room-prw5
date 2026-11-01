# Blank Starter

A zero-dependency Node starter: static site, JSON API, and durable storage.
No framework, no build step, no `npm install`.

## What's inside

```
blank/
  server.js          # static files from public/ + JSON API + /health
  lib/store.js       # atomic JSON storage (temp file + rename)
  public/index.html  # landing page, self-titles from the subdomain
  public/styles.css  # design tokens (:root) + layout
```

## Start it locally

```bash
npm start
```

Open http://localhost:3000.

## Add an API route

Handlers live in the `routes` table in `server.js`, keyed by `"METHOD /path"`:

```js
const store = require('./lib/store');

const routes = {
  'GET /health': (req, res) => json(res, { status: 'ok', uptime: process.uptime() }),

  'GET /api/items': (req, res) => json(res, store.read('items')),

  'POST /api/items': async (req, res) => {
    const item = await readBody(req);
    const items = [...store.read('items'), item];
    json(res, store.write('items', items), 201);
  },
};
```

Anything not matched falls through to the static files in `public/`.

## Storage

`store.read(name, fallback)` and `store.write(name, data)` keep JSON under
`lib/data/`. Writes go to a temp file and get renamed into place, so an
interrupted write can't corrupt the file. A file that is unreadable gets
quarantined and the app keeps serving.

Good for up to a few thousand records. Past that, use a real database.
