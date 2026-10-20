import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const isProd = process.env.NODE_ENV === 'production';

const DEFAULT_BACKUP_FOLDER_NAME = 'Yaad reminder';
const SERVER_BACKUP_ROOT = path.join(os.tmpdir(), 'yaad_server_backups');

function getSafeFolderDir(folderName?: string) {
  const raw = (folderName || DEFAULT_BACKUP_FOLDER_NAME).trim();
  const normalized =
    raw.toUpperCase() === 'YAAD REMIDER' ? DEFAULT_BACKUP_FOLDER_NAME : raw;
  const cleaned =
    normalized
      .replace(/\.\./g, '')
      .replace(/[<>:"\\|?*\x00-\x1F]/g, '_')
      .replace(/^\/+|\/+$/g, '')
      .trim() || DEFAULT_BACKUP_FOLDER_NAME;
  const dirPath = path.resolve(SERVER_BACKUP_ROOT, cleaned);
  return {
    folderName: cleaned,
    dirPath,
    filePath: path.join(dirPath, 'yaad_backup.json'),
  };
}

function ensureBackupFolder(folderName?: string) {
  const info = getSafeFolderDir(folderName);
  try {
    if (!fs.existsSync(info.dirPath)) {
      fs.mkdirSync(info.dirPath, { recursive: true });
    }
  } catch (err) {
    console.warn('[Server] Could not create backup folder:', err);
  }
  return info;
}

ensureBackupFolder(DEFAULT_BACKUP_FOLDER_NAME);

app.use(express.json({ limit: '15mb' }));

// Health check endpoint
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', time: Date.now(), folder: DEFAULT_BACKUP_FOLDER_NAME });
});

// Origin / Referer-restricted Firebase Configuration endpoint (prevents exposing keys in public repository bundles)
app.get('/api/firebase-config', (req: Request, res: Response) => {
  const origin = String(req.headers.origin || req.headers.referer || '');
  const host = String(req.headers.host || '');
  const isAllowedOrigin =
    !origin ||
    origin.includes('localhost') ||
    origin.includes('127.0.0.1') ||
    origin.includes('.run.app') ||
    origin.includes('enikkhah.github.io') ||
    origin.startsWith('capacitor://') ||
    host.includes('localhost') ||
    host.includes('.run.app');

  if (!isAllowedOrigin) {
    res.status(403).json({ ok: false, error: 'Unauthorized origin for Firebase configuration' });
    return;
  }

  try {
    // 1. Prefer environment variables if configured
    if (process.env.VITE_FIREBASE_API_KEY && process.env.VITE_FIREBASE_PROJECT_ID) {
      res.json({
        ok: true,
        config: {
          apiKey: process.env.VITE_FIREBASE_API_KEY,
          authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || `${process.env.VITE_FIREBASE_PROJECT_ID}.firebaseapp.com`,
          projectId: process.env.VITE_FIREBASE_PROJECT_ID,
          storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || `${process.env.VITE_FIREBASE_PROJECT_ID}.firebasestorage.app`,
          messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
          appId: process.env.VITE_FIREBASE_APP_ID || '',
          oAuthClientId: process.env.VITE_FIREBASE_OAUTH_CLIENT_ID || '',
        },
      });
      return;
    }

    // 2. Fallback to server-side gitignored firebase-applet-config.json (never committed to public Git repo)
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(raw);
      res.json({ ok: true, config: parsed });
      return;
    }

    res.status(404).json({ ok: false, message: 'Firebase config not configured on server' });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: 'Failed to load Firebase config' });
  }
});

// Get latest backup from local YAAD REMIDER (or custom named) folder
app.get('/api/local-folder-backup', (req: Request, res: Response) => {
  try {
    const requestedFolder = typeof req.query.folder === 'string' ? req.query.folder : DEFAULT_BACKUP_FOLDER_NAME;
    const info = ensureBackupFolder(requestedFolder);
    if (!fs.existsSync(info.filePath)) {
      res.status(404).json({ ok: false, message: `No backup file in ${info.folderName} folder yet` });
      return;
    }
    const raw = fs.readFileSync(info.filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    res.json({ ok: true, folder: info.folderName, backup: parsed });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'Failed to read local folder backup' });
  }
});

// Save backup to local YAAD REMIDER (or custom named) folder
app.post('/api/local-folder-backup', (req: Request, res: Response) => {
  try {
    const payload = req.body;
    if (!payload || typeof payload !== 'object') {
      res.status(400).json({ ok: false, error: 'Invalid backup payload' });
      return;
    }
    const info = ensureBackupFolder(payload.folder || DEFAULT_BACKUP_FOLDER_NAME);
    fs.writeFileSync(info.filePath, JSON.stringify(payload, null, 2), 'utf-8');
    res.json({
      ok: true,
      folder: info.folderName,
      filePath: `${info.folderName}/yaad_backup.json`,
      updatedAt: payload.updatedAt || Date.now(),
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'Failed to write local folder backup' });
  }
});

// Proxy for any user-specified Cloud / WebDAV / Nextcloud / Custom Server URL
app.post('/api/custom-cloud-backup', async (req: Request, res: Response) => {
  try {
    const { action, endpointUrl, folderName, authHeader, payload } = req.body || {};
    if (!endpointUrl || typeof endpointUrl !== 'string') {
      res.status(400).json({ ok: false, error: 'Missing cloud endpointUrl' });
      return;
    }

    const cleanBase = endpointUrl.trim().replace(/\/+$/, '');
    const cleanFolder = encodeURIComponent((folderName || DEFAULT_BACKUP_FOLDER_NAME).trim());
    const targetFileUrl = cleanBase.endsWith('.json')
      ? cleanBase
      : `${cleanBase}/${cleanFolder}/yaad_backup.json`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (authHeader && typeof authHeader === 'string' && authHeader.trim()) {
      const trimmedAuth = authHeader.trim();
      headers['Authorization'] =
        trimmedAuth.startsWith('Bearer ') || trimmedAuth.startsWith('Basic ')
          ? trimmedAuth
          : trimmedAuth.includes(':')
          ? `Basic ${Buffer.from(trimmedAuth).toString('base64')}`
          : `Bearer ${trimmedAuth}`;
    }

    if (action === 'download') {
      const response = await fetch(targetFileUrl, { method: 'GET', headers });
      if (!response.ok) {
        res.status(response.status).json({ ok: false, error: `Cloud server returned ${response.status}` });
        return;
      }
      const data = await response.json();
      res.json({ ok: true, backup: data });
      return;
    }

    // Default action: upload (try PUT first for WebDAV/S3/Nextcloud, fallback to POST)
    if (!cleanBase.endsWith('.json')) {
      try {
        await fetch(`${cleanBase}/${cleanFolder}`, {
          method: 'MKCOL',
          headers,
        }).catch(() => {});
      } catch {
        // ignore if MKCOL not needed
      }
    }

    let putRes = await fetch(targetFileUrl, {
      method: 'PUT',
      headers,
      body: JSON.stringify(payload, null, 2),
    });

    if (!putRes.ok && putRes.status === 405) {
      putRes = await fetch(targetFileUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload, null, 2),
      });
    }

    if (!putRes.ok) {
      res.status(putRes.status).json({ ok: false, error: `Cloud server returned ${putRes.status}` });
      return;
    }

    res.json({ ok: true, targetFileUrl });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'Custom cloud request failed' });
  }
});

async function startServer() {
  if (!isProd) {
    // Vite middleware in development
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Production static serving
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] YAAD full-stack server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('[Server Error] Failed to start server:', err);
});
