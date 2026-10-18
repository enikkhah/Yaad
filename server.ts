import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const isProd = process.env.NODE_ENV === 'production';

const DEFAULT_BACKUP_FOLDER_NAME = 'YAAD REMIDER';

function getSafeFolderDir(folderName?: string) {
  const cleaned = (folderName || DEFAULT_BACKUP_FOLDER_NAME)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .trim() || DEFAULT_BACKUP_FOLDER_NAME;
  return {
    folderName: cleaned,
    dirPath: path.resolve(process.cwd(), cleaned),
    filePath: path.join(path.resolve(process.cwd(), cleaned), 'yaad_backup.json'),
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
