const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { isValidSubject } = require('../subjects');

const FREE_DAILY_LIMIT = 5;

function todayDateStr() {
  return new Date().toISOString().slice(0, 10);
}

function dateStr(d) {
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

router.get('/:subject', requireAuth, async (req, res) => {
  const { subject } = req.params;
  if (!isValidSubject(subject)) return res.status(400).json({ error: 'Unknown subject' });
  const result = await pool.query(
    'SELECT role, content, created_at FROM chat_messages WHERE user_id=$1 AND subject=$2 ORDER BY created_at ASC',
    [req.userId, subject]
  );
  res.json({ messages: result.rows });
});

router.get('/activity/recent', requireAuth, async (req, res) => {
  const result = await pool.query(
    'SELECT subject, question, created_at FROM activity WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20',
    [req.userId]
  );
  res.json({ activity: result.rows });
});

router.post('/', requireAuth, async (req, res) => {
  const { subject, question, imageBase64, imageMediaType } = req.body;

  if (!isValidSubject(subject)) return res.status(400).json({ error: 'Unknown subject' });
  if (!question && !imageBase64) return res.status(400).json({ error: 'Ask a question or attach an image.' });
  if (imageBase64 && Buffer.byteLength(imageBase64, 'base64') > 10 * 1024 * 1024) {
    return res.status(413).json({ error: 'Image is too large (max 10MB).' });
  }

  const userResult = await pool.query('SELECT * FROM users WHERE id=$1', [req.userId]);
  const user = userResult.rows[0];
  if (!user) return res.status(404).json({ error: 'User not found' });

  const today = todayDateStr();
  const questionsToday = dateStr(user.last_question_date) === today ? user.questions_today : 0;
  if (!user.premium && questionsToday >= FREE_DAILY_LIMIT) {
    return res.status(403).json({ error: 'Daily free limit reached', limitReached: true });
  }

  const historyResult = await pool.query(
    'SELECT role, content FROM chat_messages WHERE user_id=$1 AND subject=$2 ORDER BY created_at ASC',
    [req.userId, subject]
  );
  const messages = historyResult.rows.map((r) => ({ role: r.role, content: r.content }));

  const userContent = [];
  if (imageBase64 && imageMediaType) {
    userContent.push({ type: 'image', source: { type: 'base64', media_type: imageMediaType, data: imageBase64 } });
  }
  if (question) userContent.push({ type: 'text', text: question });
  messages.push({
    role: 'user',
    content: userContent.length === 1 && userContent[0].type === 'text' ? question : userContent
  });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Convert our internal {role, content} shape into Gemini's {role, parts} shape.
  // Gemini uses 'model' instead of 'assistant', and 'parts' instead of a flat string/array.
  function toGeminiParts(content) {
    if (typeof content === 'string') return [{ text: content }];
    return content.map((c) => {
      if (c.type === 'image') return { inlineData: { mimeType: c.source.media_type, data: c.source.data } };
      return { text: c.text };
    });
  }
  const geminiContents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: toGeminiParts(m.content)
  }));

  const GEMINI_MODEL = 'gemini-3.6-flash';
  const systemPrompt = `You are Eze, a patient, encouraging ${subject} tutor. Explain concepts clearly and step by step, ` +
    'appropriate to the student\'s apparent level. Use LaTeX with single dollar signs for inline math ' +
    '(e.g. $E=mc^2$) and double dollar signs for standalone equations. Use fenced code blocks with a ' +
    'language tag for any code. Keep responses concise and focused.';

  let fullText = '';
  let upstream;
  try {
    upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse&key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: geminiContents
        })
      }
    );
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: 'Could not reach the tutor service.' })}\n\n`);
    return res.end();
  }

  if (!upstream.ok || !upstream.body) {
    const errBody = await upstream.text().catch(() => '');
    console.error('Gemini API error:', upstream.status, errBody);
    res.write(`data: ${JSON.stringify({ error: 'The tutor service returned an error.' })}\n\n`);
    return res.end();
  }

  try {
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        try {
          const chunk = JSON.parse(payload);
          const candidate = chunk.candidates && chunk.candidates[0];
          const parts = candidate && candidate.content && candidate.content.parts;
          if (parts) {
            for (const p of parts) {
              if (p.text) {
                fullText += p.text;
                res.write(`data: ${JSON.stringify({ text: p.text })}\n\n`);
              }
            }
          }
        } catch (e) { /* ignore malformed lines */ }
      }
    }
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: 'Connection interrupted.' })}\n\n`);
    return res.end();
  }

  if (!fullText) fullText = "Sorry — I couldn't come up with an answer for that. Could you rephrase your question?";

  await pool.query(
    'INSERT INTO chat_messages (user_id, subject, role, content) VALUES ($1,$2,$3,$4)',
    [req.userId, subject, 'user', question || '[Image attached]']
  );
  await pool.query(
    'INSERT INTO chat_messages (user_id, subject, role, content) VALUES ($1,$2,$3,$4)',
    [req.userId, subject, 'assistant', fullText]
  );
  await pool.query(
    'INSERT INTO activity (user_id, subject, question) VALUES ($1,$2,$3)',
    [req.userId, subject, question || '[Uploaded Image]']
  );
  await pool.query(
    `UPDATE users
     SET questions_today = CASE WHEN last_question_date = $1 THEN questions_today + 1 ELSE 1 END,
         last_question_date = $1
     WHERE id = $2`,
    [today, req.userId]
  );

  res.write('data: [DONE]\n\n');
  res.end();
});

module.exports = router;