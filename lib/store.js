// Durable JSON storage. Writes are atomic (temp file + rename), so a crash
// or a container restart mid-write can never leave a half-written file —
// the same pattern every other VibeKit starter uses. Good for up to a few
// thousand records; reach for a real database past that.
//
//   const store = require('./lib/store');
//   const items = store.read('items');            // [] if it doesn't exist yet
//   store.write('items', [...items, newItem]);    // returns what it wrote
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const fileFor = (name) => path.join(DATA_DIR, `${name}.json`);

function read(name, fallback = []) {
  try {
    return JSON.parse(fs.readFileSync(fileFor(name), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    // Corrupt or unreadable: quarantine it and carry on rather than
    // crash-looping the whole app over one bad file.
    try { fs.renameSync(fileFor(name), `${fileFor(name)}.corrupt-${Date.now()}`); } catch { /* best effort */ }
    console.error(`store: ${name}.json was unreadable, quarantined it:`, err.message);
    return fallback;
  }
}

function write(name, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${fileFor(name)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, fileFor(name));
  return data;
}

module.exports = { read, write };
