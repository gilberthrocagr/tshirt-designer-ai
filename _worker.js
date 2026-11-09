// gilberthroca.com — the static site plus one small server function.
//
// Everything is served from the uploaded files (env.ASSETS) except POST /api/tryon:
// it receives a visitor's photo and the garment they designed on /work, and asks an
// image model to dress the person (the browser reads the image out of the model's answer). The API key lives only here, as a Cloudflare secret
// (GEMINI_API_KEY); it never reaches the browser. Photos are not stored.

const MODEL = 'gemini-nano-banana-2.1';      // Nano Banana 2.1: Google's current image model (~0.034 $ a photo)
const FALLBACK = 'gemini-3.1-flash-image';   // if the first one is not available to this key
const MAX_BODY = 8 * 1024 * 1024;           // two images, base64
const PER_IP_PER_HOUR = 15;                  // best effort, per server instance
const LOGOS_PER_IP_PER_HOUR = 5;             // "Create a logo with AI": its own, smaller limit
const ALLOWED = ['https://gilberthroca.com', 'https://www.gilberthroca.com'];
const seen = new Map(), seenLogos = new Map();
// "See it on a model": what the page may ask for (anything else is refused)
const SKINS = { 'very-light': 'very fair, white', light: 'light', medium: 'medium', olive: 'olive', brown: 'brown', deep: 'deep brown', black: 'very dark, black' };
const BUILDS = { slim: 'slim', average: 'average', broad: 'broad, sturdy', curvy: 'curvy', plus: 'plus-size' };
const SIZES = ['2T', '3T', '4T', 'Youth XS', 'Youth S', 'Youth M', 'Youth L', 'Youth XL', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'];
// The colours offered on the page, by name, so the model is told the colour in words as well as in the image
const COLOR_NAMES = { '#F5F5F2': 'white', '#111111': 'black', '#1E3A8A': 'navy blue', '#B91C1C': 'red', '#166534': 'forest green',
  '#6B7280': 'heather grey', '#F2963F': 'orange', '#C4B5FD': 'lavender' };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/tryon') return tryon(request, env);
    return env.ASSETS.fetch(request);
  },
};

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

function tooMany(ip, map = seen, max = PER_IP_PER_HOUR) {
  const now = Date.now(), hour = 3600e3;
  const list = (map.get(ip) || []).filter((t) => now - t < hour);
  if (list.length >= max) return true;
  list.push(now); map.set(ip, list);
  return false;
}

async function tryon(request, env) {
  if (request.method !== 'POST') return json(405, { error: 'method' });
  const origin = request.headers.get('Origin') || '';
  if (!ALLOWED.includes(origin)) return json(403, { error: 'origin' });  // browsers always send it on a POST; tools without it are refused
  if (!env.GEMINI_API_KEY) return json(503, { error: 'not-configured' });
  if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY) return json(413, { error: 'too-large' });
  if (tooMany(request.headers.get('CF-Connecting-IP') || 'unknown')) return json(429, { error: 'rate-limited' });

  // The size is checked on what actually arrives, also when the request does not announce its length.
  let raw = '';
  try {
    const reader = request.body.getReader(), dec = new TextDecoder();
    for (let got = 0; ;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      if (got > MAX_BODY) { reader.cancel(); return json(413, { error: 'too-large' }); }
      raw += dec.decode(value, { stream: true });
    }
  } catch { return json(400, { error: 'bad-body' }); }
  let input;
  try { input = JSON.parse(raw); } catch { return json(400, { error: 'bad-json' }); }
  if (!input || typeof input !== 'object') return json(400, { error: 'bad-json' });
  if (input.mode === 'logo') return logo(input, env, request);
  const garment = /^data:image\/png;base64,/.exec(input.garment || '');
  if (!garment && input.mode !== 'product') return json(400, { error: 'bad-images' });
  const kind = ['t-shirt', 'crewneck sweatshirt', 'hoodie'].includes(input.garmentType) ? input.garmentType : 't-shirt';

  const hex = typeof input.color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(input.color) ? input.color.toUpperCase() : null;
  const colour = hex ? (COLOR_NAMES[hex] ? `${COLOR_NAMES[hex]} (${hex})` : hex) : 'the colour shown in the reference image';
  // Where the visitor put the logo (0-1 across and down the chest; 0.5 / 0.34 is the centre), told in words as well,
  // because image models follow a sentence more reliably than a position in a reference drawing.
  const num = (v, lo, hi, d) => (typeof v === 'number' && v >= lo && v <= hi ? v : d);
  const lx = num(input.logoX, 0, 1, 0.5), ly = num(input.logoY, 0, 1, 0.34), ls = num(input.logoSize, 0.1, 0.7, 0.36);
  // said as a side of the PHOTO first: image models mix up the wearer's left and right, never the photo's
  const side = lx > 0.6 ? "on the RIGHT half of the photo as the viewer sees it (the wearer's left chest), not centred" : lx < 0.4 ? "on the LEFT half of the photo as the viewer sees it (the wearer's right chest), not centred" : 'centred horizontally on the chest';
  const height = ly < 0.25 ? 'high, just below the collar' : ly < 0.31 ? 'high on the chest, where a pocket logo goes' : ly > 0.5 ? 'low, around the stomach' : ly > 0.41 ? 'slightly below the middle of the chest' : 'at the middle of the chest';
  const scale = ls < 0.25 ? 'small, like a pocket logo (about 8-10 cm wide)' : ls > 0.5 ? 'large (about 30 cm wide)' : 'medium (about 20-25 cm wide)';
  const where = `Place the logo ${side}, ${height}, ${scale}, exactly where it sits in the reference.` +
    (input.mirrored === true ? ' The logo in the reference is intentionally mirrored: copy it exactly as drawn, with its letters and shapes mirrored too; do not turn it the right way round.' : '');
  const garmentPart = garment ? { inline_data: { mime_type: 'image/png', data: input.garment.slice(garment[0].length) } } : null;

  let parts;
  if (input.mode === 'product') {
    // The 360° view's base photos: a plain white garment on an invisible mannequin, from one angle, on a flat grey
    // background (so the page can cut it out and recolour it). Made once by the site owner, not by visitors.
    const angle = { front: 'straight-on front view', threequarter: 'three-quarter view, turned 45 degrees to its left', side: 'exact side profile view, turned 90 degrees', back: 'straight-on back view' }[input.angle];
    if (!angle) return json(400, { error: 'bad-angle' });
    const prompt =
      `Photorealistic e-commerce product photo of a plain white ${kind} on an invisible ghost mannequin (no person, no mannequin visible), ${angle}. ` +
      'The garment is empty inside but holds the natural 3D shape of a body, with realistic cotton texture, soft natural folds, visible seams and ribbed collar' + (kind === 't-shirt' ? '' : ', cuffs and hem') + '. ' +
      'No logo, no print, no text, no tag visible. Centred, the whole garment in frame with a little margin, camera at chest height. ' +
      'Background: a perfectly flat, even medium grey (#7f7f7f) with no gradient and no shadow on it. Soft, even studio lighting. Return only the photo.';
    parts = [{ text: prompt }];
  } else if (input.mode === 'model') {
    // "See it on a model": no photo of the visitor; a catalogue model with the body they described
    const who = { woman: 'woman', man: 'man', girl: 'girl', boy: 'boy' }[input.who];
    const age = Math.round(Number(input.age)), cm = Math.round(Number(input.heightCm)), kg = Math.round(Number(input.weightKg));
    const skin = input.skin === 'natural' ? 'natural' : SKINS[input.skin], build = BUILDS[input.build], size = SIZES.includes(input.size) ? input.size : null;
    const child = who === 'girl' || who === 'boy';
    if (!who || !skin || !build || !size || !(age >= 2 && age <= 90) || (child ? age > 17 : age < 18) || !(cm >= 80 && cm <= 220) || !(kg >= 10 && kg <= 220)) return json(400, { error: 'bad-model' });
    const print = input.withLogo
      ? `with the logo from the reference printed on it. ${where} Reproduce it exactly (same shapes, letters, colours, proportions), looking like real ink printed into the cotton: the fabric texture shows through it, it follows the folds and takes the same light and shadows, never a flat sticker`
      : 'completely plain, with no logo, print or text of any kind';
    const prompt =
      `Create a photorealistic e-commerce catalogue photo of a ${age}-year-old ${who}, about ${cm} cm tall and ${kg} kg; body build: ${build}` + (skin === 'natural' ? '. ' : `; skin tone: ${skin}. `) +
      `They wear a ${colour} ${kind}, ${print}. The garment colour must be ${colour}, exactly. ` +
      `It fits like a size ${size} on this body: a natural, true-to-size fit, neither tight nor baggy. Simple neutral jeans or trousers. ` +
      'Front-facing, standing in a relaxed natural pose, framed from the head to mid-thigh, plain light grey studio background, soft even studio lighting, sharp focus. ' +
      'A wholesome, fully clothed photo suitable for a family clothing store. ' +
      'The image is only a flat reference for the garment cut, the colour and the logo: ignore its grey background and its flat drawing style. Return only the photo.';
    parts = [{ text: prompt }, garmentPart];
  } else {
    const person = /^data:image\/(jpeg|png|webp);base64,/.exec(input.person || '');
    if (!person) return json(400, { error: 'bad-images' });
    const prompt =
      `Edit the first image. Dress the person in a ${colour} ${kind}. ` +
      `The garment colour must be ${colour}, exactly; do not change it to any other colour. ` +
      'The second image is only a flat reference of the design on a grey background: use it for the garment cut, the logo and where the logo goes, and ignore the grey background and the flat drawing style. ' +
      `Reproduce the logo exactly (same shapes, letters, colours and proportions). ${where} ` +
      'The logo must look like real ink printed into the cotton, as in a product photo of a printed shirt: ' +
      'the knit texture of the fabric shows through the print; the print follows the curve of the chest with slight perspective; ' +
      'every fold, wrinkle and shadow of the shirt passes over the print and darkens it exactly as it darkens the fabric; ' +
      'its edges are soft at fabric scale, its colours slightly less saturated than in the flat reference, and it is never sharp, glossy or flat like a sticker or a digital overlay. ' +
      "Keep the person's face, body, pose, hair, hands, background and lighting unchanged. " +
      'Photorealistic result with natural fabric folds and shadows. Return only the edited photo.';
    parts = [{ text: prompt }, { inline_data: { mime_type: 'image/' + person[1], data: input.person.slice(person[0].length) } }, garmentPart];
  }

  return generate(parts, env);
}

// "Create a logo with AI": a short description becomes a flat logo on plain white. The page then makes the white
// that touches the edges transparent, so the logo is asked to read on both a white and a navy shirt.
async function logo(input, env, request) {
  if (tooMany(request.headers.get('CF-Connecting-IP') || 'unknown', seenLogos, LOGOS_PER_IP_PER_HOUR)) return json(429, { error: 'rate-limited' });
  const desc = typeof input.prompt === 'string' ? input.prompt.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
  if (desc.length < 3) return json(400, { error: 'bad-prompt' });
  const prompt =
    `Design an original, professional logo for a custom t-shirt print, based on this request from a customer: "${desc}". ` +
    'Spell any name or words in the request exactly as written. A clean flat vector style with bold shapes, a few solid colors and crisp edges; ' +
    'no gradients, no photo, no mockup, no shirt, no 3D effects, no tiny details. Center the whole logo with generous empty margin around it. ' +
    'The background must be pure plain white (#FFFFFF), perfectly flat, with nothing else on it. ' +
    'The logo will be printed on both white and navy blue fabric, so its outer edge must not be white: give it a solid colored shape, badge or outline that reads on both. ' +
    'Wholesome and suitable for all ages. Return only the logo image, square.';
  return generate([{ text: prompt }], env);
}

async function generate(parts, env) {
  const body = { contents: [{ parts }], generationConfig: { responseModalities: ['IMAGE'] } };

  const ask = (model) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify(body),
  });
  let res;
  try {
    res = await ask(env.TRYON_MODEL || MODEL);
    if (res.status === 404) { res.body && res.body.cancel(); res = await ask(FALLBACK); }  // model not available to this key: the other one
  } catch {
    return json(424, { error: 'upstream' });
  }
  // A 5xx from here would be replaced by Cloudflare's own error page, so the reason travels in a 424.
  // Only the kind of error goes back (e.g. RESOURCE_EXHAUSTED), never Google's full message, which can name the project.
  if (!res.ok) {
    let reason = '';
    try { const e = await res.json(); reason = (e.error && e.error.status) || ''; } catch { /* not JSON */ }
    return json(424, { error: 'upstream', status: res.status, reason: String(reason).slice(0, 40) });
  }
  // The answer (an image of 1-2 MB in base64) goes straight to the browser, which takes the image out.
  // Parsing it here would exceed the CPU time a free Cloudflare request is allowed.
  return new Response(res.body, { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
