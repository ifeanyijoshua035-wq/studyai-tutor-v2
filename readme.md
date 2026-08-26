# StudyAI Tutor — Backend

A real Node.js/Express + PostgreSQL backend: bcrypt password hashing, JWT
sessions in httpOnly cookies, server-enforced daily question limits, real
Flutterwave subscriptions, and a chat endpoint that streams the model's
answer to the browser without ever exposing your API key client-side.

## 1. Local setup

```bash
npm install
psql "your-database-connection-string" -f schema.sql
cp .env.example .env
# then edit .env with real values
npm run dev      # or: npm start
```

Visit `http://localhost:3000`.

## 2. Environment variables

| Variable | Where to get it |
|---|---|
| `DATABASE_URL` | Your Postgres connection string |
| `JWT_SECRET` | `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `GEMINI_API_KEY` | aistudio.google.com → Get API Key |
| `IPINFO_TOKEN` | ipinfo.io/signup (optional but recommended — dedicated free quota) |
| `FLW_SECRET_KEY` / `FLW_PUBLIC_KEY` | Flutterwave Dashboard → Settings → API Keys |
| `FLW_WEBHOOK_HASH` | A password you make up yourself — enter the same string in Flutterwave's dashboard under Settings → Webhooks |
| `FLW_PLAN_NIGERIA/AFRICA/ROW` | Create 3 Payment Plans in Flutterwave's dashboard, paste each plan's ID here |
| `CLIENT_URL` | Your real deployed URL (or `http://localhost:3000` locally) |

## 3. Flutterwave setup

1. Create/verify your Flutterwave business account.
2. Get your API keys from Settings → API Keys (use test keys first).
3. Create three recurring Payment Plans (Settings → Payment Plans):
   "Nigeria Premium" ₦3,000/mo, "Africa Premium" ₦5,000/mo, "Global Premium"
   ₦8,000/mo. Copy each plan's ID into the matching env var.
4. Set your webhook URL (Settings → Webhooks) to
   `https://yourdomain.com/api/flutterwave/webhook`, and set the same
   "Secret hash" value as your `FLW_WEBHOOK_HASH`.
5. Test the full flow in test mode before switching to live keys.

## 4. Deploying

Push to GitHub, connect the repo to a host like Render (Web Service +
managed Postgres), set all the environment variables above in the host's
dashboard, and deploy. Update `CLIENT_URL` and your Flutterwave webhook URL
to match your real deployed domain once you have one.

## 5. Two frontend versions

- `public/index.html` — original design (dark, electric-blue "lightning" theme).
- `public/index-v2.html` — redesigned version drawing on Uli line art and a
  warm indigo/ochre palette, grounded in Nsukka (where this business is
  registered) and the meaning of "Eze" (king, in Igbo). Same full feature
  set underneath — both talk to the exact same backend routes.

To make V2 your live homepage: rename the current `index.html` to something
like `index-old.html` as a backup, then rename `index-v2.html` to
`index.html`.

## 6. Known limitations, on purpose

- **Password recovery is disabled.** A forgotten password means creating a
  new account with a different email — there is no reset flow.
- **Free Postgres databases on some hosts expire** after a fixed number of
  days unless upgraded to a paid tier — check your host's policy and
  calendar a reminder well before that date.

## Project layout

```
studyai-backend/
├── package.json
├── schema.sql
├── .env.example
├── README.md
├── src/
│   ├── server.js
│   ├── db.js
│   ├── geo.js
│   ├── subjects.js
│   ├── middleware/auth.js
│   └── routes/
│       ├── auth.js
│       ├── chat.js
│       └── flutterwave.js
└── public/
    ├── index.html       # original design
    ├── index-v2.html     # redesigned version
    ├── privacy.html
    ├── terms.html
    ├── 404.html
    ├── robots.txt
    └── sitemap.xml
```