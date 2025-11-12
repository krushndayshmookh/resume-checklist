/***** CONFIG *****/
const SHEET_ID = 'YOUR_GOOGLE_SHEET_ID'; // e.g. 1aBc... from the Sheet URL
const SHEET_NAME = 'Sheet1';                          // target tab name
const ALLOW_ORIGINS = ['*'];                          // or restrict like ['https://your-site.example']
const MAX_BODY_BYTES = 100 * 1024;                    // basic guard (100 KB)

/***** UTIL *****/
function jsonOutput(obj, statusCode) {
  const out = ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
  if (statusCode && out.setStatusCode) out.setStatusCode(statusCode);
  return applyCORS(out);
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': (ALLOW_ORIGINS.includes('*') ? '*' : ALLOW_ORIGINS[0]),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-APP-KEY',
    'Vary': 'Origin'
  };
}

function applyCORS(out) {
  const h = corsHeaders();
  Object.keys(h).forEach(k => out.setHeader(k, h[k]));
  return out;
}

function doOptions() {
  return applyCORS(ContentService.createTextOutput('')
    .setMimeType(ContentService.MimeType.TEXT));
}

/** Flatten nested objects to dot.notation keys. Arrays are JSON-stringified. */
function flatten(obj, prefix = '', out = {}) {
  if (obj === null || obj === undefined) return out;
  if (Array.isArray(obj)) {
    out[prefix.replace(/\.$/, '')] = JSON.stringify(obj);
    return out;
  }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      flatten(v, key, out);
    }
    return out;
  }
  out[prefix.replace(/\.$/, '')] = obj;
  return out;
}

/***** HTTP *****/
function doGet() {
  return jsonOutput({ ok: false, error: 'GET not allowed' }, 405);
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonOutput({ ok: false, error: 'Empty body' }, 400);
    }
    if (e.postData.length && Number(e.postData.length) > MAX_BODY_BYTES) {
      return jsonOutput({ ok: false, error: 'Payload too large' }, 413);
    }

    const body = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);

    // Get current headers (row 1), ignoring trailing empties
    const lastCol = Math.max(1, sh.getLastColumn());
    const hdrVals = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    let headers = hdrVals.filter(h => String(h).trim() !== '');

    // Initialize headers if empty
    if (headers.length === 0) {
      headers = ['Timestamp']; // Always keep Timestamp first
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    }

    // Flatten body and ensure all keys exist as headers
    const flat = flatten(body); // dot.notation keys for nested objects

    // Ensure stable insertion order: add any missing keys in encounter order
    const newKeys = [];
    for (const key of Object.keys(flat)) {
      if (key === '_sheet') continue; // ignore control field
      if (!headers.includes(key)) newKeys.push(key);
    }
    if (newKeys.length) {
      headers = headers.concat(newKeys);
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    }

    // Build aligned row (Timestamp + all headers)
    const row = headers.map((h, idx) => {
      if (idx === 0 && h === 'Timestamp') return new Date(); // first col
      const val = flat[h];
      if (typeof val === 'boolean') return val;          // store booleans as TRUE/FALSE
      if (val === null || val === undefined) return '';  // blanks
      return val;
    });

    sh.getRange(sh.getLastRow() + 1, 1, 1, headers.length).setValues([row]);

    return jsonOutput({ ok: true });
  } catch (err) {
    // Do not leak details
    return jsonOutput({ ok: false, error: 'Bad Request' }, 400);
  }
}