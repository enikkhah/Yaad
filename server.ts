import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import webpush from 'web-push';

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const isProd = process.env.NODE_ENV === 'production';

// Stable VAPID keys for persistent Web Push
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BEI2Bc7gWMwyXnyRMpJ_GF4iYJaOAu2QSWi5Bvv8IvYdAWCazyukOdGAOOtGNVvJ6jH77hCJzmyvqs2eTrte__w';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'K5-Nmst_CaubF3KQ7DuJ3vFZ_wcAOBvDlPap99fftHQ';
const VAPID_EMAIL = 'mailto:notifications@yaad.app';

webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

app.use(express.json({ limit: '10mb' }));

interface ScheduledPushItem {
  id: string;
  subscription: webpush.PushSubscription;
  title: string;
  body: string;
  dueTimestamp: number;
  reminderId: string;
  sent?: boolean;
}

const SCHEDULE_FILE = path.resolve(process.cwd(), '.scheduled_push_alarms.json');
let scheduledAlarms: ScheduledPushItem[] = [];

// Load persistent schedule from disk
try {
  if (fs.existsSync(SCHEDULE_FILE)) {
    const raw = fs.readFileSync(SCHEDULE_FILE, 'utf-8');
    scheduledAlarms = JSON.parse(raw);
  }
} catch (e) {
  console.warn('Could not read scheduled push file:', e);
}

function saveScheduleToDisk() {
  try {
    fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(scheduledAlarms, null, 2), 'utf-8');
  } catch (e) {
    console.warn('Could not save scheduled push file:', e);
  }
}

// Background scheduler loop (runs every 1000ms on the Cloud server)
async function triggerDuePushes() {
  const now = Date.now();
  const due = scheduledAlarms.filter((a) => !a.sent && a.dueTimestamp <= now + 2000);

  for (const item of due) {
    item.sent = true;
    const payload = JSON.stringify({
      title: item.title,
      body: item.body,
      tag: `yadnik-alarm-${item.reminderId}`,
      data: {
        reminderId: item.reminderId,
        url: `/?alarmId=${item.reminderId}`,
      },
    });

    try {
      await webpush.sendNotification(item.subscription, payload, {
        urgency: 'high',
        TTL: 86400,
      });
      console.log(`[Push Success] Sent background alarm push for "${item.title}"`);
    } catch (err: any) {
      console.warn(`[Push Error] Failed to send push for "${item.title}":`, err?.statusCode || err?.message);
    }
  }

  if (due.length > 0) {
    // Keep only alarms from the last 24 hours to prevent memory bloating
    scheduledAlarms = scheduledAlarms.filter((a) => !a.sent || a.dueTimestamp > now - 24 * 3600 * 1000);
    saveScheduleToDisk();
  }
}

setInterval(triggerDuePushes, 1000);

// API Endpoints
app.get('/api/vapid-public-key', (_req: Request, res: Response) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// Schedule background pushes from the client
app.post('/api/schedule-push', (req: Request, res: Response) => {
  const { subscription, reminders } = req.body;
  if (!subscription || !Array.isArray(reminders)) {
    res.status(400).json({ error: 'subscription and reminders array are required' });
    return;
  }

  const now = Date.now();
  reminders.forEach((r: any) => {
    if (!r.id || !r.dueTimestamp || r.dueTimestamp < now - 60000) return;

    const timeStr = r.timeStr || new Date(r.dueTimestamp).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
    const body = `Today, ${timeStr}${r.description ? ' • ' + r.description : ''}`;

    // Remove any existing entry for this reminder ID to update with new timestamp
    scheduledAlarms = scheduledAlarms.filter((a) => a.reminderId !== r.id);

    scheduledAlarms.push({
      id: `${r.id}_${Date.now()}`,
      subscription,
      title: r.title || '🔔 یادآور YAAD',
      body,
      dueTimestamp: r.dueTimestamp,
      reminderId: r.id,
      sent: false,
    });
  });

  saveScheduleToDisk();
  res.json({ success: true, count: scheduledAlarms.length });
});

// Cancel a scheduled push
app.post('/api/cancel-push', (req: Request, res: Response) => {
  const { reminderId } = req.body;
  if (reminderId) {
    scheduledAlarms = scheduledAlarms.filter((a) => a.reminderId !== reminderId);
    saveScheduleToDisk();
  }
  res.json({ success: true });
});

// Test Push: schedules a push in N seconds so the user can test closing the app and seeing notification outside
app.post('/api/test-push', async (req: Request, res: Response) => {
  const { subscription, delaySeconds = 5 } = req.body;
  if (!subscription) {
    res.status(400).json({ error: 'subscription is required' });
    return;
  }

  const dueTimestamp = Date.now() + Math.max(1, delaySeconds) * 1000;
  scheduledAlarms.push({
    id: `test_${Date.now()}`,
    subscription,
    title: '🔔 یادآور آزمایشی خارج از برنامه (YAAD)',
    body: 'اعلان با موفقیت خارج از برنامه و روی سیستم‌عامل گوشی نمایش داده شد! لمس برای بازگشت به اپ.',
    dueTimestamp,
    reminderId: 'test_alert',
    sent: false,
  });

  saveScheduleToDisk();
  res.json({ success: true, dueInSeconds: delaySeconds });
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
