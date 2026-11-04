import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const isProd = process.env.NODE_ENV === 'production';

const DEFAULT_BACKUP_FOLDER_NAME = 'YAAD';
const SERVER_BACKUP_ROOT = path.join(os.tmpdir(), 'yaad_server_backups');

function getSafeFolderDir(_folderName?: string) {
  const cleaned = DEFAULT_BACKUP_FOLDER_NAME;
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
    origin.startsWith('http://') ||
    origin.startsWith('https://') ||
    host.includes('localhost') ||
    host.includes('.run.app');

  if (!isAllowedOrigin) {
    res.status(403).json({ ok: false, error: 'Unauthorized origin for Firebase configuration' });
    return;
  }

  try {
    const oAuthClientId =
      process.env.VITE_GOOGLE_CLIENT_ID ||
      process.env.VITE_FIREBASE_OAUTH_CLIENT_ID ||
      process.env.VITE_GOOGLE_ANDROID_CLIENT_ID ||
      '';

    // 1. Prefer environment variables if configured
    if (process.env.VITE_FIREBASE_API_KEY && process.env.VITE_FIREBASE_PROJECT_ID) {
      res.json({
        ok: true,
        config: {
          apiKey: process.env.VITE_FIREBASE_API_KEY,
          authDomain:
            process.env.VITE_FIREBASE_AUTH_DOMAIN ||
            `${process.env.VITE_FIREBASE_PROJECT_ID}.firebaseapp.com`,
          projectId: process.env.VITE_FIREBASE_PROJECT_ID,
          storageBucket:
            process.env.VITE_FIREBASE_STORAGE_BUCKET ||
            `${process.env.VITE_FIREBASE_PROJECT_ID}.firebasestorage.app`,
          messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
          appId: process.env.VITE_FIREBASE_APP_ID || '',
          oAuthClientId,
        },
      });
      return;
    }

    // 2. Fallback to server-side gitignored firebase-applet-config.json (never committed to public Git repo)
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(raw);
      res.json({
        ok: true,
        config: {
          ...parsed,
          oAuthClientId: parsed.oAuthClientId || oAuthClientId,
        },
      });
      return;
    }

    res.json({
      ok: Boolean(oAuthClientId),
      config: oAuthClientId ? { oAuthClientId } : null,
      message: 'Firebase config not configured on server',
    });
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
