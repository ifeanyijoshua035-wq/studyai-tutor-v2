const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000
};

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' }
});

function signToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    premium: u.premium,
    autoSpeak: u.auto_speak,
    questionsToday: u.questions_today,
    lastQuestionDate: u.last_question_date
  };
}

router.post('/signup', authLimiter, async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    const normalizedEmail = email.trim().toLowerCase();

    const existing = await pool.query('SELECT id FROM users WHERE email=$1', [normalizedEmail]);
    if (existing.rows.length) return res.status(409).json({ error: 'An account with this email already exists.' });

    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash) VALUES ($1,$2,$3)
       RETURNING id, name, email, premium, auto_speak, questions_today, last_question_date`,
      [name.trim(), normalizedEmail, hash]
    );
    const user = result.rows[0];
    res.cookie('session', signToken(user.id), COOKIE_OPTS);
    res.json({ user: publicUser(user) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Missing fields' });
    const normalizedEmail = email.trim().toLowerCase();

    const result = await pool.query('SELECT * FROM users WHERE email=$1', [normalizedEmail]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Incorrect email or password.' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Incorrect email or password.' });

    res.cookie('session', signToken(user.id), COOKIE_OPTS);
    res.json({ user: publicUser(user) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie('session', COOKIE_OPTS);
  res.json({ ok: true });
});

router.get('/me', requireAuth, async (req, res) => {
  const result = await pool.query('SELECT * FROM users WHERE id=$1', [req.userId]);
  if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
  res.json({ user: publicUser(result.rows[0]) });
});

router.patch('/preferences', requireAuth, async (req, res) => {
  const { autoSpeak } = req.body;
  await pool.query('UPDATE users SET auto_speak=$1 WHERE id=$2', [!!autoSpeak, req.userId]);
  res.json({ ok: true });
});

// NOTE: password reset is intentionally not implemented. Users who forget
// their password are told to create a new account with a different email.
// See public/index-v2.html's "Forgot password?" modal for the user-facing
// message this corresponds to.

module.exports = router;