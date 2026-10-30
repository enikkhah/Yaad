import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { GoogleGenAI, Type } from '@google/genai';

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

// Smart AI Voice/Text Capture endpoint (Reminder, Occasion, Location, Idea)
app.post('/api/smart-capture', async (req: Request, res: Response) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    res.status(503).json({ ok: false, error: 'GEMINI_API_KEY not configured on server' });
    return;
  }

  try {
    const { messages, currentDraft, currentJalaliInfo, language = 'fa' } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ ok: false, error: 'messages array is required' });
      return;
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const systemPrompt =
      language === 'en'
        ? `You are a warm, friendly, conversational Smart Voice Assistant in the "Yaad" app.
Analyze the user's speech/text in a multi-turn conversation and classify it into one of 4 sections:
1. "reminder": tasks, appointments, meetings, medications, calls, or time-based alarms.
   - Required fields (isComplete = true): specific subject (title) + specific time (hour and minute, plus date/offsetDays).
   - If the user did not specify the title or the time, set isComplete = false and ask a warm, friendly, conversational English question in clarifyingQuestion about the exact missing field (e.g., "Got it! What day and what time should I remind you about this?" or "Sure thing! What is this reminder about?").
2. "occasion": birthdays, wedding anniversaries, memorial dates, or annual calendar events.
   - Required fields (isComplete = true): occasion title/name (title) + day (solarDay 1-31) + month (solarMonth 1-12).
   - If the title or date is missing, set isComplete = false and ask a warm, friendly question for the missing part (e.g., "Nice! What day and month is this occasion?").
3. "location": saving a GPS place, parked car spot, office/clinic address, or geofence.
   - Required fields (isComplete = true): place name (title).
   - If the place name is missing, set isComplete = false and ask: "I've got your location! What name would you like me to save this place under?"
4. "idea": thoughts, notes, startup ideas, shopping lists, or free-form notes without an alarm time.
   - Required fields (isComplete = true): idea title or content (title).

Current user date info: ${JSON.stringify(currentJalaliInfo || {})}
Current extracted draft so far: ${JSON.stringify(currentDraft || {})}

Important rules:
- Merge the user's new answer with currentDraft so previous fields are preserved.
- Your clarifyingQuestion and quickSuggestions MUST be 100% in English, written in a warm, friendly, conversational tone as a complete question sentence without parentheses so it sounds natural when spoken aloud.
- When all mandatory fields are complete (isComplete = true), state a friendly summary and ask: "Everything is ready! Should I go ahead and save this for you now?"`
        : `شما دستیار هوشمند صوتی صمیمی و خوش‌برخورد در اپلیکیشن «یاد» هستید.
لحن شما باید کاملاً صمیمی، گرم، دوستانه و محاوره‌ای محترمانه باشد (مثلاً از عباراتی مثل «برات ثبت کنم؟»، «ساعت چند بهت یادآوری کنم؟»، «موضوعش چیه؟»، «همه‌چی آماده است!» استفاده کنید و از جملات خشک و کتابی پرهیز کنید).
وظیفه شما تحلیل گفتار یا متن کاربر در یک گفتگوی چندمرحله‌ای و دسته‌بندی آن در یکی از ۴ بخش زیر است:
1. "reminder" (یادآور): کارها، قرارها، جلسات، داروها، تماس‌ها یا آلارم‌های زمانی.
   - اطلاعات ضروری برای تکمیل (isComplete = true): عنوان مشخص (title) + زمان و ساعت مشخص (hour و minute، و تاریخ یا offsetDays).
   - اگر کاربر عنوان یا ساعت را نگفته است، isComplete را false بگذارید و در clarifyingQuestion با لحن صمیمی و محاوره‌ای یک جمله سوالی کامل درباره همان مورد کسری بپرسید (مثلاً: «خب، برای این یادآور می‌خوای چه روزی و ساعت چند بهت خبر بدم؟» یا «ساعتش مشخص شد؛ حالا بگو موضوع این یادآور چیه تا برات ثبتش کنم؟»).
2. "occasion" (مناسبت): تولد، سالگرد ازدواج، سالگرد آشنایی، سالگرد فوت، یا مناسبت‌های سالانه.
   - اطلاعات ضروری برای تکمیل (isComplete = true): عنوان مناسبت (title) + روز شمسی (solarDay بین 1 تا 31) + ماه شمسی (solarMonth بین 1 تا 12).
   - اگر عنوان یا روز و ماه مشخص نیست، isComplete را false بگذارید و با یک جمله سوالی صمیمی و محاوره‌ای فارسی همان مورد را بپرسید (مثلاً: «چه مناسبت قشنگی! دقیقاً چه روزی و چه ماهیه؟»).
3. "location" (مکان): ذخیره موقعیت مکانی، محل پارک خودرو، آدرس مطب یا شرکت.
   - اطلاعات ضروری برای تکمیل (isComplete = true): نام مکان (title).
   - اگر نام مکان بیان نشده است، صمیمی بپرسید: «موقعیت مکانی رو گرفتم؛ دوست داری این مکان رو با چه اسمی برات ذخیره کنم؟».
4. "idea" (ایده): فکر جدید، یادداشت ذهنی یا ایده بدون نیاز به آلارم ساعتی.
   - اطلاعات ضروری برای تکمیل (isComplete = true): عنوان یا متن ایده (title).

اطلاعات زمان فعلی کاربر (تقویم شمسی):
${JSON.stringify(currentJalaliInfo || {})}

پیش‌نویس فعلی تا این لحظه:
${JSON.stringify(currentDraft || {})}

قوانین بسیار مهم:
- پیام جدید کاربر را با پیش‌نویس قبلی (currentDraft) ترکیب کنید تا اطلاعات قبلی حفظ و تکمیل شود.
- متن clarifyingQuestion و گزینه‌های quickSuggestions باید صددرصد به زبان فارسی صمیمی و محاوره‌ای، بدون هیچ کلمه انگلیسی یا پرانتز اضافی و در قالب یک جمله سوالی کامل باشد تا در خوانش صوتی کاملاً طبیعی و دوستانه شنیده شود.
- هنگامی که تمام ورودی‌های اجباری کامل شد (isComplete = true)، در clarifyingQuestion خلاصه را صمیمی بگویید و بپرسید: «همه‌چی آماده است! برات ثبتش کنم؟»`;

    const conversationText = messages
      .map(
        (m: { role: string; text: string }) =>
          `${m.role === 'user' ? (language === 'en' ? 'User' : 'کاربر') : language === 'en' ? 'Assistant' : 'دستیار'}: ${m.text}`
      )
      .join('\n');

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: conversationText,
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.3,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            intentType: {
              type: Type.STRING,
              description: "One of: 'reminder', 'occasion', 'location', 'idea', 'unknown'",
            },
            isComplete: {
              type: Type.BOOLEAN,
              description: 'True only when all required fields for the chosen intentType are present and unambiguous.',
            },
            shouldAutoSubmit: {
              type: Type.BOOLEAN,
              description: 'True if the user explicitly confirmed saving an already complete draft.',
            },
            clarifyingQuestion: {
              type: Type.STRING,
              description: 'Warm, friendly, conversational interrogative question in the requested language (Persian if fa, English if en).',
            },
            quickSuggestions: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '2 to 4 short clickable reply chips in the requested language.',
            },
            draft: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                description: { type: Type.STRING },
                category: { type: Type.STRING, description: "'work', 'family', or 'other'" },
                priority: { type: Type.STRING, description: "'high', 'medium', or 'low'" },
                offsetDays: {
                  type: Type.INTEGER,
                  description: '0 for today, 1 for tomorrow, 2 for day after tomorrow, etc. Null/-1 if explicit solar date used.',
                },
                hour: { type: Type.INTEGER, description: '0-23 hour for reminder, or -1 if not specified yet' },
                minute: { type: Type.INTEGER, description: '0-59 minute for reminder, or -1 if not specified yet' },
                solarYear: { type: Type.INTEGER, description: 'Jalali year if mentioned, else 0' },
                solarMonth: { type: Type.INTEGER, description: '1-12 Jalali month if mentioned, else 0' },
                solarDay: { type: Type.INTEGER, description: '1-31 Jalali day if mentioned, else 0' },
                occasionType: {
                  type: Type.STRING,
                  description: "'birthday', 'wedding', 'dating', 'memorial', 'family', 'work', or 'custom'",
                },
                personName: { type: Type.STRING },
                locationAddress: { type: Type.STRING },
                enableGeofence: { type: Type.BOOLEAN },
                recurrence: {
                  type: Type.STRING,
                  description: "'none', 'hourly', 'daily', 'weekly', 'monthly'",
                },
              },
            },
          },
          required: ['intentType', 'isComplete', 'clarifyingQuestion', 'quickSuggestions', 'draft'],
        },
      },
    });

    const rawText = response.text || '{}';
    const parsed = JSON.parse(rawText);
    res.json({ ok: true, result: parsed });
  } catch (err: any) {
    res.status(500).json({
      ok: false,
      error: err?.message || 'Smart capture AI analysis failed',
    });
  }
});

// In-memory cache for synthesized TTS prompts so greetings and common questions play instantaneously
const ttsMemoryCache = new Map<string, string>();

// Server-side Gemini TTS endpoint for warm, conversational Persian ('fa') & English ('en') spoken questions
app.post('/api/smart-tts', async (req: Request, res: Response) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    res.status(503).json({ ok: false, error: 'GEMINI_API_KEY not configured on server' });
    return;
  }

  try {
    const { text, language = 'fa' } = req.body || {};
    if (!text || typeof text !== 'string' || !text.trim()) {
      res.status(400).json({ ok: false, error: 'text is required' });
      return;
    }

    const cleanText = text.trim();
    const cacheKey = `${language}:${cleanText}`;
    const cachedAudio = ttsMemoryCache.get(cacheKey);
    if (cachedAudio) {
      res.json({ ok: true, audioBase64: cachedAudio, cached: true });
      return;
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash-lite-tts',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: cleanText,
              speechMetadata: {
                style:
                  language === 'en'
                    ? 'Warm, friendly, cheerful, conversational personal assistant asking a natural question'
                    : 'دستیار صوتی بسیار صمیمی، گرم، مهربان و محاوره‌ای به زبان فارسی روان با لحن طبیعی و دوستانه',
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Zephyr' },
          },
        },
      },
    });

    const audioBase64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!audioBase64) {
      res.status(500).json({ ok: false, error: 'No audio returned from TTS model' });
      return;
    }

    if (ttsMemoryCache.size > 60) {
      const firstKey = ttsMemoryCache.keys().next().value;
      if (firstKey) ttsMemoryCache.delete(firstKey);
    }
    ttsMemoryCache.set(cacheKey, audioBase64);

    res.json({ ok: true, audioBase64 });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'TTS generation failed' });
  }
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
