const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { getTier, TIER_AMOUNTS_NGN, CURRENCY_BY_COUNTRY, getClientIp, lookupCountry, getNgnToCurrencyRate } = require('../geo');

const PLAN_IDS = {
  nigeria: process.env.FLW_PLAN_NIGERIA,
  africa: process.env.FLW_PLAN_AFRICA,
  row: process.env.FLW_PLAN_ROW
};

const FLW_BASE = 'https://api.flutterwave.com/v3';

// Public — shows the visitor's tier and a live-converted estimate before they sign up.
router.get('/pricing', async (req, res) => {
  const ip = getClientIp(req);
  const { countryCode, countryName } = await lookupCountry(ip);
  const tier = getTier(countryCode || 'NG');
  const amountNGN = TIER_AMOUNTS_NGN[tier];
  const currency = CURRENCY_BY_COUNTRY[countryCode] || 'USD';

  let displayAmount = null;
  let displayCurrency = null;
  if (currency !== 'NGN') {
    const rate = await getNgnToCurrencyRate(currency);
    if (rate) {
      displayAmount = Math.round(amountNGN * rate * 100) / 100;
      displayCurrency = currency;
    }
  }

  res.json({ tier, amountNGN, countryCode, countryName, displayAmount, displayCurrency });
});

router.post('/initialize', requireAuth, async (req, res) => {
  try {
    const userResult = await pool.query('SELECT * FROM users WHERE id=$1', [req.userId]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    const ip = getClientIp(req);
    const { countryCode } = await lookupCountry(ip);
    const tier = getTier(countryCode || 'NG');
    const amountNGN = TIER_AMOUNTS_NGN[tier];
    const planId = PLAN_IDS[tier];

    if (!planId) {
      return res.status(500).json({ error: `No Flutterwave payment plan configured for the "${tier}" tier yet.` });
    }

    const txRef = `studyai-${user.id}-${Date.now()}`;

    const initRes = await fetch(`${FLW_BASE}/payments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        tx_ref: txRef,
        amount: amountNGN, // NOTE: Flutterwave takes the amount in whole Naira, NOT kobo (unlike Paystack)
        currency: 'NGN',
        redirect_url: `${process.env.CLIENT_URL}/api/flutterwave/callback`,
        payment_plan: planId, // ties this charge to a recurring plan — Flutterwave auto-renews from here
        customer: { email: user.email, name: user.name },
        customizations: { title: 'StudyAI Tutor Premium' },
        meta: { userId: user.id, tier }
      })
    });
    const data = await initRes.json();
    if (data.status !== 'success' || !data.data || !data.data.link) {
      console.error('Flutterwave initialize error:', data);
      return res.status(500).json({ error: data.message || 'Could not start checkout.' });
    }

    await pool.query(
      'UPDATE users SET pricing_tier=$1, billing_country=$2, flw_tx_ref=$3 WHERE id=$4',
      [tier, countryCode, txRef, user.id]
    );
    res.json({ url: data.data.link });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not start checkout. Please try again.' });
  }
});

// Flutterwave redirects the browser here (GET) after checkout completes.
// We re-verify the transaction server-side rather than trusting the redirect
// query params alone, since those could be tampered with in the URL bar.
router.get('/callback', async (req, res) => {
  const { transaction_id, status } = req.query;
  if (!transaction_id || status !== 'successful') {
    return res.redirect(`${process.env.CLIENT_URL}/?checkout=cancelled`);
  }
  try {
    const verifyRes = await fetch(`${FLW_BASE}/transactions/${encodeURIComponent(transaction_id)}/verify`, {
      headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}` }
    });
    const data = await verifyRes.json();
    if (
      data.status === 'success' &&
      data.data &&
      data.data.status === 'successful' &&
      data.data.currency === 'NGN' &&
      data.data.meta &&
      data.data.meta.userId
    ) {
      await pool.query('UPDATE users SET premium=TRUE WHERE id=$1', [data.data.meta.userId]);
      return res.redirect(`${process.env.CLIENT_URL}/?checkout=success`);
    }
  } catch (e) {
    console.error(e);
  }
  res.redirect(`${process.env.CLIENT_URL}/?checkout=cancelled`);
});

// UNVERIFIED AGAINST LIVE DASHBOARD: Flutterwave's exact endpoint for cancelling
// one customer's individual subscription (as opposed to deactivating an entire
// payment plan for everyone) was not consistently documented across the sources
// available when this was written. This implementation is a best-effort guess
// at the REST shape based on Flutterwave's usual patterns — test this specific
// endpoint in test mode before relying on it, and check your Flutterwave
// dashboard/support if it 404s.
router.post('/cancel-subscription', requireAuth, async (req, res) => {
  try {
    const userResult = await pool.query('SELECT email, flw_subscription_id FROM users WHERE id=$1', [req.userId]);
    const user = userResult.rows[0];
    if (!user || !user.flw_subscription_id) {
      return res.status(400).json({ error: 'No active subscription found on this account.' });
    }
    const cancelRes = await fetch(`${FLW_BASE}/subscriptions/${encodeURIComponent(user.flw_subscription_id)}/cancel`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}` }
    });
    const data = await cancelRes.json();
    if (data.status !== 'success') {
      console.error('Flutterwave cancel error:', data);
      return res.status(500).json({ error: data.message || 'Could not cancel subscription. Please contact support.' });
    }
    await pool.query('UPDATE users SET premium=FALSE WHERE id=$1', [req.userId]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not cancel subscription. Please try again.' });
  }
});

// Mounted with express.json() (NOT raw) — Flutterwave verifies via a simple
// shared secret string in the 'verif-hash' header, not a computed signature,
// so the parsed JSON body is fine here (unlike Paystack's HMAC-based webhook).
async function webhookHandler(req, res) {
  const signature = req.headers['verif-hash'];
  if (!signature || signature !== process.env.FLW_WEBHOOK_HASH) {
    console.error('Flutterwave webhook signature mismatch');
    return res.status(401).send('Invalid signature');
  }

  const event = req.body;
  try {
    if (event.event === 'charge.completed' && event.data && event.data.status === 'successful') {
      const userId = event.data.meta && event.data.meta.userId;
      if (userId) {
        await pool.query('UPDATE users SET premium=TRUE WHERE id=$1', [userId]);
      }
      // If this charge is tied to a subscription, Flutterwave includes subscription
      // details on recurring charges — store the id so cancel-subscription can use it.
      if (event.data.subscription_id && userId) {
        await pool.query('UPDATE users SET flw_subscription_id=$1 WHERE id=$2', [String(event.data.subscription_id), userId]);
      }
    } else if (event.event === 'subscription.cancelled') {
      const subId = event.data && event.data.id;
      if (subId) {
        await pool.query('UPDATE users SET premium=FALSE WHERE flw_subscription_id=$1', [String(subId)]);
      }
    }
    res.sendStatus(200);
  } catch (e) {
    console.error('Flutterwave webhook handling error:', e);
    res.status(500).json({ error: 'Webhook handling failed' });
  }
}

module.exports = router;
module.exports.webhookHandler = webhookHandler;