// shrinkPhoto(file): a phone photo made small enough to upload, in the browser.
//
// A camera original is 3-12 MB (48 MP on newer phones, HEIC on iPhone). Sent
// as-is it takes long enough on a phone connection for the upload to drop, or
// it passes the server's body limit, and the runtime AI reads only PNG, JPEG,
// WebP and GIF. So shrink every photo before it leaves the page: redrawn to at
// most 1568 px on the long edge (what vision models read anyway) as a JPEG at
// 0.8, usually 200-500 KB. A file already that small is sent unchanged. A PNG
// or WebP is redrawn as a PNG, so a logo keeps its transparency. A GIF may be
// animated and a canvas keeps one frame, so a GIF is never redrawn: one up to
// 1 MB is sent unchanged, a bigger one is refused.
//
//   <script src="/shrink-photo.js"></script>
//
//   input.addEventListener('change', async () => {
//     try {
//       const photo = await shrinkPhoto(input.files[0]);
//       // photo.dataUrl for JSON bodies and the runtime AI, photo.blob for FormData
//       await fetch('/api/photos', { method: 'POST', headers: { 'Content-Type': 'application/json' },
//         body: JSON.stringify({ image: photo.dataUrl }) });
//     } catch (e) {
//       showError(e.message); // e.g. a HEIC this browser cannot open
//     }
//   });
//
// Resolves { dataUrl, blob, width, height, type }. Rejects with a message fit
// to show the person when this browser cannot open the file.
(function () {
  const MAX_EDGE = 1568;
  const QUALITY = 0.8;
  const KEEP_BYTES = 1024 * 1024;
  const KEEP_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const CLEAR_TYPES = ['image/png', 'image/webp'];

  function readAsDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('The photo could not be read.'));
      reader.readAsDataURL(blob);
    });
  }

  function load(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => (img.naturalWidth > 0 && img.naturalHeight > 0 ? resolve(img) : reject(new Error('empty image')));
      img.onerror = () => reject(new Error('not decoded'));
      img.src = src;
    });
  }

  // Decoded by the browser, or a clear refusal. A blob: URL keeps a 12 MB
  // photo out of a base64 string; a page whose Content-Security-Policy allows
  // only `img-src data:` (helmet's default) refuses blob:, so the data URL is
  // the fallback.
  async function decode(file, label) {
    const url = URL.createObjectURL(file);
    try {
      return await load(url);
    } catch {
      try {
        return await load(await readAsDataUrl(file));
      } catch {
        throw new Error(`This browser can't open this photo (${label}). Choose a JPEG or PNG instead.`);
      }
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function formatLabel(file) {
    const fromType = (file.type || '').split('/')[1];
    const fromName = /\.([a-z0-9]+)$/i.exec(file.name || '');
    return (fromType || (fromName && fromName[1]) || 'unknown format').toUpperCase();
  }

  async function shrinkPhoto(file) {
    if (!(file instanceof Blob)) throw new TypeError('shrinkPhoto needs a File, e.g. input.files[0]');
    const img = await decode(file, formatLabel(file));
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
    const unchanged = async () => ({ dataUrl: await readAsDataUrl(file), blob: file, width: w, height: h, type: file.type });
    if (file.type === 'image/gif') {
      if (file.size <= KEEP_BYTES) return unchanged();
      throw new Error('This GIF is too large to send (over 1 MB). Choose a smaller one.');
    }
    if (scale === 1 && file.size <= KEEP_BYTES && KEEP_TYPES.includes(file.type)) return unchanged();
    const clear = CLEAR_TYPES.includes(file.type);
    const type = clear ? 'image/png' : 'image/jpeg';
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    if (!clear) {
      ctx.fillStyle = '#fff'; // a JPEG has no transparency: clear areas turn white, not black
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY));
    if (!blob) throw new Error('This photo could not be resized here. Try a smaller photo.');
    return { dataUrl: await readAsDataUrl(blob), blob, width: canvas.width, height: canvas.height, type };
  }

  window.shrinkPhoto = shrinkPhoto;
})();
