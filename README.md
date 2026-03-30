# 🎵 TikTok OAuth Connect Page

A minimal Node.js + Express app with a single page to connect a TikTok account via OAuth 2.0.

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Configure credentials
```bash
copy .env.example .env
```
Then open `.env` and fill in:
| Variable | Where to find it |
|---|---|
| `TIKTOK_CLIENT_KEY` | [TikTok for Developers](https://developers.tiktok.com) → Your App → App Info |
| `TIKTOK_CLIENT_SECRET` | Same page, next to Client Key |
| `TIKTOK_REDIRECT_URI` | Must match exactly what you registered in Login Kit settings |
| `SESSION_SECRET` | Any long random string |

### 3. Register Redirect URI in your TikTok App
In [developers.tiktok.com](https://developers.tiktok.com) → **Login Kit** → **Redirect URI**, add:
```
http://localhost:3000/auth/tiktok/callback
```

### 4. Run the server
```bash
npm start
```
Open → [http://localhost:3000](http://localhost:3000)

---

## How it works

```
User clicks button
      │
      ▼
GET /auth/tiktok          →  Redirect to TikTok authorization page
                                (with state, scope, client_key)
      │
      ▼  (user approves)
GET /auth/tiktok/callback  →  Validate state, exchange code for token
                                  →  Fetch display_name + avatar
                                  →  Redirect to /?success=true
      │
      ▼
index.html shows success card
```

## Project Structure

```
TIKTOK/
├── server.js           # Express server + OAuth routes
├── public/
│   └── index.html      # Single page UI
├── .env.example        # Config template
├── package.json
└── README.md
```

## Visual Preview

- **Default**: Dark page with "Connect my TikTok" CTA
- **Success**: Avatar ring, display name, "You're connected!" message  
- **Error**: Contextual error banner with guidance

> ⚠️ For production, ensure your redirect URI uses `https` and is registered in your TikTok app.
