// api/sheets-append.js
import { google } from 'googleapis';

const {
  GOOGLE_CLIENT_EMAIL,
  GOOGLE_PRIVATE_KEY,
  SHEET_ID,
  SHEET_NAME = 'Sheet1',
  ALLOW_ORIGIN = '*',
} = process.env;

// CORS helper
function withCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
}

// Flatten nested objects into dot.notation; arrays → JSON string
function flatten(obj, prefix = '', out = {}) {
  if (obj == null) return out;
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

async function getSheetsClient() {
  const auth = new google.auth.JWT({
    email: GOOGLE_CLIENT_EMAIL,
    key: GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}

export default async function handler(req, res) {
  withCORS(res);
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  try {
    // Parse JSON
    const body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
    const flat = flatten(body);

    const sheets = await getSheetsClient();

    // 1) Read current headers (first row)
    const getResp = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!1:1`,
      majorDimension: 'ROWS',
    });

    let headers = (getResp.data.values && getResp.data.values[0]) || [];
    headers = headers.map(h => (h == null ? '' : String(h)));

    // Ensure at least the Timestamp header
    if (headers.length === 0) headers = ['Timestamp'];

    // 2) Determine new keys (columns)
    const incomingKeys = Object.keys(flat).filter(k => k !== '_sheet');
    const missing = incomingKeys.filter(k => !headers.includes(k));

    // 3) If missing, update the header row (union)
    if (missing.length > 0) {
      const newHeaders = headers.concat(missing);
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!1:1`,
        valueInputOption: 'RAW',
        requestBody: { values: [newHeaders] },
      });
      headers = newHeaders;
    }

    // 4) Build row aligned to headers
    const row = headers.map((h, idx) => {
      if (idx === 0 && h === 'Timestamp') return new Date().toISOString();
      const v = flat[h];
      if (typeof v === 'boolean') return v;           // TRUE/FALSE in Sheets
      if (v == null) return '';
      return v;
    });

    // 5) Append
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: SHEET_NAME,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    // Don’t leak internals
    res.status(400).json({ ok: false, error: 'Bad Request' });
  }
}