import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { findSimilarProjects, buildPricingBreakdown, formatProposalSections, generateProposalStream, extractClientInfoStream } from './generate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const upload = multer({ dest: path.join(__dirname, 'uploads/'), limits: { fileSize: 20 * 1024 * 1024 } });
const portfolio = JSON.parse(fs.readFileSync(path.join(__dirname, 'portfolio.json'), 'utf-8'));

const APP_PASSWORD = process.env.APP_PASSWORD;
const SECRET = process.env.SESSION_SECRET;

function signToken(data) {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64');
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  const sigBuf = Buffer.from(sig, 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  const data = JSON.parse(Buffer.from(payload, 'base64').toString());
  if (Date.now() - data.ts > 24 * 60 * 60 * 1000) return null;
  return data;
}

function authMiddleware(req, res, next) {
  const token = req.headers.cookie?.match(/auth=([^;]+)/)?.[1];
  if (!verifyToken(token)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// --- Server-Sent Events helpers -------------------------------------------
// The AI routes stream their response so bytes keep flowing to the browser.
// This defeats the production host's proxy idle-timeout, which was severing
// long/large generations mid-flight (surfaced in the UI as "Failed to fetch").
function beginSSE(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // ask nginx-style proxies not to buffer
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  // Heartbeat comment lines keep the connection alive even before the model
  // starts emitting tokens (e.g. while a large PDF is parsed). Clients ignore
  // lines that don't start with "data: ".
  return setInterval(() => { try { res.write(': keepalive\n\n'); } catch {} }, 15000);
}

function sseSend(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

export function createApp(options = {}) {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(__dirname, 'public')));

  const auth = options.skipAuth ? (req, res, next) => next() : authMiddleware;

  // Auth
  app.post('/login', (req, res) => {
    if (req.body.password !== APP_PASSWORD) return res.status(401).json({ error: 'Wrong password' });
    const token = signToken({ ts: Date.now() });
    const secure = process.env.NODE_ENV === 'production' ? ' Secure;' : '';
    res.setHeader('Set-Cookie', `auth=${token}; HttpOnly;${secure} Path=/; SameSite=Strict; Max-Age=86400`);
    res.json({ success: true });
  });

  app.get('/check-auth', (req, res) => {
    const token = req.headers.cookie?.match(/auth=([^;]+)/)?.[1];
    res.json({ authenticated: !!verifyToken(token) });
  });

  // Portfolio
  app.get('/portfolio', auth, (req, res) => {
    res.json(portfolio);
  });

  // Similar projects
  app.post('/similar-projects', auth, (req, res) => {
    const { sector, keywords } = req.body;
    const projects = findSimilarProjects(sector || '', keywords || '');
    res.json({ projects });
  });

  // Pricing calculator
  app.post('/calculate-pricing', auth, (req, res) => {
    const result = buildPricingBreakdown(req.body);
    res.json(result);
  });

  // Extract client info from uploaded content
  app.post('/extract-client-info', auth, upload.array('files', 10), async (req, res) => {
    const heartbeat = beginSSE(res);
    req.on('close', () => clearInterval(heartbeat));
    try {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return sseSend(res, { error: 'ANTHROPIC_API_KEY not configured' });

      const anthropicClient = new Anthropic({ apiKey, maxRetries: 3 });
      let content = req.body.transcript || '';

      if (req.files?.length) {
        for (const file of req.files) {
          if (file.mimetype === 'application/pdf') {
            const pdfParse = (await import('pdf-parse')).default;
            const buffer = fs.readFileSync(file.path);
            const data = await pdfParse(buffer);
            content += '\n\n' + data.text;
          } else {
            content += '\n\n' + fs.readFileSync(file.path, 'utf-8');
          }
        }
      }

      if (!content.trim()) {
        return sseSend(res, { error: 'No content to extract from' });
      }

      const info = await extractClientInfoStream(content, anthropicClient, (delta) => sseSend(res, { text: delta }));
      sseSend(res, { done: true, ...info });
    } catch (err) {
      console.error('[Extract Error]', err.message);
      sseSend(res, { error: err.message });
    } finally {
      clearInterval(heartbeat);
      for (const file of req.files || []) {
        try { fs.unlinkSync(file.path); } catch {}
      }
      res.end();
    }
  });

  // Generate proposal from transcript/notes
  app.post('/generate', auth, upload.array('files', 10), async (req, res) => {
    const heartbeat = beginSSE(res);
    req.on('close', () => clearInterval(heartbeat));
    try {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return sseSend(res, { error: 'ANTHROPIC_API_KEY not configured' });

      const anthropicClient = new Anthropic({ apiKey, maxRetries: 3 });
      const { clientName, contactName, sector, projectType, keywords, notes } = req.body;

      // Read uploaded files
      let transcript = req.body.transcript || '';
      if (req.files?.length) {
        for (const file of req.files) {
          if (file.mimetype === 'application/pdf') {
            const pdfParse = (await import('pdf-parse')).default;
            const buffer = fs.readFileSync(file.path);
            const data = await pdfParse(buffer);
            transcript += '\n\n' + data.text;
          } else {
            transcript += '\n\n' + fs.readFileSync(file.path, 'utf-8');
          }
        }
      }

      if (!transcript && !notes) {
        return sseSend(res, { error: 'Please provide a transcript, notes, or upload files' });
      }

      const generated = await generateProposalStream(
        clientName, sector, transcript, notes, anthropicClient,
        { contactName, projectType, keywords },
        (delta) => sseSend(res, { text: delta })
      );
      const sections = formatProposalSections(generated);
      const similar = findSimilarProjects(sector, clientName);

      sseSend(res, { done: true, sections, similar, raw: generated });
    } catch (err) {
      console.error('[Generate Error]', err.message);
      sseSend(res, { error: err.message });
    } finally {
      clearInterval(heartbeat);
      for (const file of req.files || []) {
        try { fs.unlinkSync(file.path); } catch {}
      }
      res.end();
    }
  });

  // Main page
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  return app;
}

// Start server if run directly
if (!process.env.VITEST) {
  if (!APP_PASSWORD || !SECRET) {
    console.error('FATAL: APP_PASSWORD and SESSION_SECRET must be set in environment variables');
    process.exit(1);
  }
  const PORT = process.env.PORT || 3000;
  const app = createApp();
  app.listen(PORT, '0.0.0.0', () => {
    console.log('='.repeat(50));
    console.log('Proposal Generator');
    console.log(`Open http://localhost:${PORT} in your browser`);
    console.log('='.repeat(50));
  });
}
