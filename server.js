require('dotenv').config();
const express = require('express');
const session = require('express-session');
const crypto = require('crypto');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

// ─── PKCE helpers ─────────────────────────────────────────────────────────────
function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// ─── Session middleware ──────────────────────────────────────────────────────
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false, httpOnly: true, maxAge: 10 * 60 * 1000 }
}));

// ─── Static files ────────────────────────────────────────────────────────────
// The 'public' directory natively maps 'public/privacy/' to '/privacy/' and 'public/terms/' to '/terms/'
app.use(express.static(path.join(__dirname, 'public')));

// ─── TikTok OAuth Config ─────────────────────────────────────────────────────
const CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY || 'YOUR_CLIENT_KEY';
const CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET || 'YOUR_CLIENT_SECRET';
const REDIRECT_URI = process.env.TIKTOK_REDIRECT_URI || `${BASE_URL}/auth/tiktok/callback`;
const SCOPE = 'user.info.basic';

const TIKTOK_AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const TIKTOK_TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';

// ─── Routes ──────────────────────────────────────────────────────────────────

/**
 * GET /auth/tiktok
 * Step 1: Redirect to TikTok authorization page.
 */
app.get('/auth/tiktok', (req, res) => {
  if (CLIENT_KEY === 'YOUR_CLIENT_KEY') {
    return res.send(`
      <html><body style="font-family:sans-serif;padding:40px;background:#0a0a0a;color:#fff;">
        <h2>⚠️ Credentials not configured</h2>
        <p>Copy <code>.env.example</code> to <code>.env</code> and set your <strong>TIKTOK_CLIENT_KEY</strong> and <strong>TIKTOK_CLIENT_SECRET</strong>.</p>
        <p>Get them at <a href="https://developers.tiktok.com" style="color:#ff2d55">developers.tiktok.com</a></p>
        <a href="/" style="color:#aaa">← Back</a>
      </body></html>
    `);
  }

  const state = uuidv4();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  req.session.oauthState = state;
  req.session.codeVerifier = codeVerifier;

  const params = new URLSearchParams({
    client_key: CLIENT_KEY,
    response_type: 'code',
    scope: SCOPE,
    redirect_uri: REDIRECT_URI,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    lang: 'en'
  });

  console.log(`[TikTok OAuth] Initiating auth — state: ${state.substring(0, 8)}... challenge: ${codeChallenge.substring(0, 12)}...`);
  res.redirect(`${TIKTOK_AUTH_URL}?${params.toString()}`);
});

/**
 * GET /auth/tiktok/callback
 * Step 2: Receive authorization code from TikTok & Exchange for Access Token
 */
app.get('/auth/tiktok/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  // Validate state
  if (state !== req.session.oauthState) {
    return res.status(400).send(callbackPage({
      success: false,
      title: 'Security Error',
      message: 'State mismatch — possible CSRF attack. Please try again.',
      code: null,
    }));
  }

  delete req.session.oauthState;
  const codeVerifier = req.session.codeVerifier;
  delete req.session.codeVerifier;

  if (error) {
    return res.status(400).send(callbackPage({
      success: false,
      title: 'Authorization Denied',
      message: `TikTok returned an error: <strong>${error}</strong>${error_description ? ' — ' + error_description : ''}`,
      code: null,
    }));
  }

  if (!code) {
    return res.status(400).send(callbackPage({
      success: false,
      title: 'No Code Received',
      message: 'TikTok did not return an authorization code.',
      code: null,
    }));
  }

  console.log(`[TikTok OAuth] ✅ Authorization code received: ${code.substring(0, 10)}...`);
  console.log(`[TikTok OAuth]    code_verifier available: ${!!codeVerifier}`);

  try {
    // ── Exchange code for access token ────────────────────────────────────
    const tokenResponse = await axios.post(
      TIKTOK_TOKEN_URL,
      new URLSearchParams({
        client_key: CLIENT_KEY,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI,
        code_verifier: codeVerifier,
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    const { access_token, refresh_token, open_id, expires_in } = tokenResponse.data;

    if (!access_token) {
      console.error('[TikTok OAuth] No access_token in response:', tokenResponse.data);
      throw new Error('Token exchange returned success but no access_token was found.');
    }

    console.log(`[TikTok OAuth] 🔑 Successfully obtained access token for open_id: ${open_id}`);

    // In a real SaaS, you would now save these tokens to your database associated with the user ID!
    // e.g. db.users.update({ tiktokToken: access_token, tiktokRefresh: refresh_token })

    return res.send(callbackPage({
      success: true,
      title: 'Success: Secure Token Retrieved!',
      message: 'Your SaaS now has permanent API access to this TikTok account. In production, these tokens would be saved silently to your secure database.',
      code: `Access Token:  ${access_token.substring(0, 20)}...
Refresh Token: ${refresh_token.substring(0, 20)}...
Open ID:       ${open_id}
Expires In:    ${expires_in} seconds`,
    }));

  } catch (err) {
    const errMsg = err.response?.data?.message || err.response?.data?.error_description || err.message || 'unknown_error';
    console.error('[TikTok OAuth] Token exchange failed:', errMsg);

    return res.status(500).send(callbackPage({
      success: false,
      title: 'Token Exchange Failed',
      message: 'We received the authorization code, but failed to exchange it for an access token.',
      code: `Error details: ${errMsg}`,
    }));
  }
});

/**
 * GET /privacy
 * Privacy Policy page.
 */
app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
});

/**
 * GET /terms
 * Terms of Service page.
 */
app.get('/terms', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'terms.html'));
});

// ─── Callback HTML helper ─────────────────────────────────────────────────────
function callbackPage({ success, title, message, code }) {
  const iconColor = success ? '#00c9a7' : '#ff4d4d';
  const icon = success ? '✅' : '❌';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>${title} — TikTok Connect</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet"/>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Inter',sans-serif;background:#0a0a0a;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
    .card{background:#111;border:1px solid rgba(255,255,255,0.08);border-radius:20px;padding:48px 40px;max-width:520px;width:100%;text-align:center;box-shadow:0 24px 80px rgba(0,0,0,.6)}
    .icon{font-size:3rem;margin-bottom:20px}
    h1{font-size:1.6rem;font-weight:700;letter-spacing:-.03em;margin-bottom:12px}
    .msg{color:rgba(255,255,255,.55);font-size:.9rem;line-height:1.7;margin-bottom:28px}
    .code-block{background:#0d0d0d;border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:16px 20px;text-align:left;margin-bottom:28px}
    .code-label{font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.35);margin-bottom:8px}
    .code-value{font-family:monospace;font-size:.82rem;color:#00f2ea;word-break:break-all;line-height:1.6}
    .btn{display:inline-block;padding:13px 28px;border-radius:12px;border:1px solid rgba(255,255,255,0.1);color:#fff;text-decoration:none;font-weight:600;font-size:.9rem;background:rgba(255,255,255,0.05);transition:background .2s}
    .btn:hover{background:rgba(255,255,255,.1)}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${title}</h1>
    <p class="msg">${message}</p>
    ${code ? `<div class="code-block"><div class="code-label">Authorization Code</div><div class="code-value">${code}</div></div>` : ''}
    <a href="/" class="btn">← Back to Home</a>
  </div>
</body>
</html>`;
}

// ─── Start server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🎵 TikTok Connect running at ${BASE_URL}`);
  console.log(`   Auth:     ${BASE_URL}/auth/tiktok`);
  console.log(`   Callback: ${REDIRECT_URI}`);
  console.log(`   Privacy:  ${BASE_URL}/privacy`);
  console.log(`   Terms:    ${BASE_URL}/terms\n`);
});
