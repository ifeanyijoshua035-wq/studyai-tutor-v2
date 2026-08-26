require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
const flutterwaveRoutes = require('./routes/flutterwave');

const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET', 'GEMINI_API_KEY'];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  console.error('Copy .env.example to .env and fill in real values before starting the server.');
  process.exit(1);
}

const app = express();
app.disable('x-powered-by'); // don't advertise the framework in response headers
app.set('trust proxy', 2); // Render's infra adds ~2 hops before reaching the app — a specific number satisfies express-rate-limit's safety check, unlike 'true'

app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
app.use(cookieParser());

// Flutterwave verifies webhooks via a simple shared secret string in the
// 'verif-hash' header (not a computed HMAC signature like Paystack used), so
// unlike Paystack's webhook, this one does NOT need express.raw() — the
// normal express.json() below is fine for it.
app.use(express.json({ limit: '15mb' })); // generous limit so base64 homework images fit

app.post('/api/flutterwave/webhook', flutterwaveRoutes.webhookHandler);

const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });
app.use('/api', apiLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/flutterwave', flutterwaveRoutes);

app.use(express.static(path.join(__dirname, '../public'), { maxAge: '1d' }));

// Static files (including "/" -> public/index.html automatically) are served above.
// Anything that reaches here didn't match a real file or API route.
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.status(404).sendFile(path.join(__dirname, '../public/404.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`StudyAI Tutor backend listening on port ${PORT}`));