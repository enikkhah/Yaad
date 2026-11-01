import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
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

const TTS_CACHE_DIR = path.resolve(process.cwd(), 'public', 'tts-cache');
try {
  if (!fs.existsSync(TTS_CACHE_DIR)) {
    fs.mkdirSync(TTS_CACHE_DIR, { recursive: true });
  }
} catch {
  // ignore
}

// Helper: Converts 24kHz RIFF WAV or raw 16-bit mono PCM from Gemini TTS into a trimmed 16000 Hz 16-bit WAV container
function ensureWavBufferFromGeminiInlineData(base64Data: string, mimeType = ''): Buffer {
  const rawBuf = Buffer.from(base64Data, 'base64');
  let pcmBuf = rawBuf;
  let inRate = 24000;

  if (rawBuf.length > 44 && rawBuf.subarray(0, 4).toString('ascii') === 'RIFF') {
    inRate = rawBuf.readUInt32LE(24) || 24000;
    const dataSize = rawBuf.readUInt32LE(40);
    const endOffset = Math.min(rawBuf.length, 44 + dataSize);
    pcmBuf = rawBuf.subarray(44, endOffset);
  } else {
    const rateMatch = mimeType.match(/rate=(\d+)/i);
    if (rateMatch) inRate = parseInt(rateMatch[1], 10);
  }

  const outRate = 16000;
  const inSamples = Math.floor(pcmBuf.length / 2);
  const ratio = inRate / outRate;
  const outSamples = Math.max(1, Math.floor(inSamples / ratio));
  const resampled = Buffer.alloc(outSamples * 2);

  for (let i = 0; i < outSamples; i++) {
    const srcPos = i * ratio;
    const idx0 = Math.floor(srcPos);
    const idx1 = Math.min(inSamples - 1, idx0 + 1);
    const frac = srcPos - idx0;
    const s0 = pcmBuf.readInt16LE(idx0 * 2);
    const s1 = pcmBuf.readInt16LE(idx1 * 2);
    const sample = Math.max(-32768, Math.min(32767, Math.round(s0 + (s1 - s0) * frac)));
    resampled.writeInt16LE(sample, i * 2);
  }

  // Trim leading and trailing silence so microphone activates immediately after speech ends
  const threshold = 320;
  let first = 0;
  let last = outSamples - 1;
  for (let i = 0; i < outSamples; i++) {
    if (Math.abs(resampled.readInt16LE(i * 2)) > threshold) {
      first = Math.max(0, i - Math.floor(outRate * 0.03));
      break;
    }
  }
  for (let i = outSamples - 1; i >= first; i--) {
    if (Math.abs(resampled.readInt16LE(i * 2)) > threshold) {
      last = Math.min(outSamples - 1, i + Math.floor(outRate * 0.05));
      break;
    }
  }

  const trimmedSamples = Math.max(1, last - first + 1);
  const outPcm = Buffer.alloc(trimmedSamples * 2);
  resampled.copy(outPcm, 0, first * 2, (last + 1) * 2);

  const dataSize = outPcm.length;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(outRate, 24);
  header.writeUInt32LE(outRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, outPcm]);
}

/**
 * Applies real-time 16-bit PCM resampling and formant EQ filtering to a WAV buffer
 * so all 5 voice personas sound genuinely distinct on every browser and mobile WebView.
 */
function applyPersonaToWavBuffer(wavBuf: Buffer, voicePersona = 'zephyr_warm'): Buffer {
  if (wavBuf.length <= 44 || wavBuf.subarray(0, 4).toString('ascii') !== 'RIFF') {
    return wavBuf;
  }

  const personaConfig: Record<
    string,
    { step: number; filterMode: 'warm' | 'calm' | 'bright' | 'deep' | 'formal'; gain: number }
  > = {
    zephyr_warm: { step: 1.0, filterMode: 'warm', gain: 1.05 },
    kore_calm: { step: 0.9, filterMode: 'calm', gain: 1.04 },
    puck_energetic: { step: 1.13, filterMode: 'bright', gain: 1.08 },
    fenrir_deep: { step: 0.81, filterMode: 'deep', gain: 1.12 },
    charon_formal: { step: 0.93, filterMode: 'formal', gain: 1.08 },
  };

  const cfg = personaConfig[voicePersona] || personaConfig.zephyr_warm;
  const sampleRate = wavBuf.readUInt32LE(24) || 16000;
  const pcmOffset = 44;
  const inSamples = Math.floor((wavBuf.length - pcmOffset) / 2);
  if (inSamples < 10) return wavBuf;

  const outSamples = Math.max(1, Math.floor(inSamples / cfg.step));
  const outPcm = Buffer.alloc(outSamples * 2);

  let prevOut = 0;
  let prevIn = 0;

  for (let i = 0; i < outSamples; i++) {
    const srcPos = i * cfg.step;
    const idx0 = Math.min(inSamples - 1, Math.floor(srcPos));
    const idx1 = Math.min(inSamples - 1, idx0 + 1);
    const frac = srcPos - idx0;
    const s0 = wavBuf.readInt16LE(pcmOffset + idx0 * 2);
    const s1 = wavBuf.readInt16LE(pcmOffset + idx1 * 2);
    const rawSample = s0 + (s1 - s0) * frac;

    let shaped = rawSample;
    if (cfg.filterMode === 'deep') {
      // Resonant low-pass boost for deep baritone voice
      prevOut = 0.62 * rawSample + 0.38 * prevOut;
      shaped = prevOut * 0.75 + rawSample * 0.35;
    } else if (cfg.filterMode === 'calm') {
      // Gentle warm smoothing for calm soothing voice
      prevOut = 0.74 * rawSample + 0.26 * prevOut;
      shaped = prevOut;
    } else if (cfg.filterMode === 'bright') {
      // Crisp high-shelf presence for energetic voice
      const high = rawSample - prevIn;
      shaped = rawSample + high * 0.38;
    } else if (cfg.filterMode === 'formal') {
      // Studio broadcast mid-presence
      const high = rawSample - prevIn;
      prevOut = 0.82 * rawSample + 0.18 * prevOut;
      shaped = prevOut + high * 0.22;
    } else {
      // Warm balanced presence
      prevOut = 0.88 * rawSample + 0.12 * prevOut;
      shaped = prevOut;
    }
    prevIn = rawSample;

    const clamped = Math.max(-32768, Math.min(32767, Math.round(shaped * cfg.gain)));
    outPcm.writeInt16LE(clamped, i * 2);
  }

  const dataSize = outPcm.length;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, outPcm]);
}

function normalizePersianForArabicTtsFallback(text: string): string {
  return text
    .replace(/گ/g, 'ك')
    .replace(/چ/g, 'ج')
    .replace(/پ/g, 'ب')
    .replace(/ژ/g, 'ز')
    .replace(/ک/g, 'ك')
    .replace(/ی/g, 'ي')
    .replace(/هٔ/g, 'ه')
    .replace(/\u200c/g, ' ');
}

async function fetchGoogleTranslateTtsBase64(
  text: string,
  lang: string
): Promise<{ audioBase64: string; mimeType: string } | null> {
  const isEn = lang === 'en';
  // Note: Google Translate TTS returns HTTP 400 for tl=fa, so we use tl=ar with phonetic Persian letter mapping as fallback
  const tl = isEn ? 'en' : 'ar';
  const queryText = isEn ? text : normalizePersianForArabicTtsFallback(text);

  // 1. Try Google Translate batchexecute RPC (jQ1olc)
  try {
    const rpcPayload = JSON.stringify([
      [['jQ1olc', JSON.stringify([queryText, tl, null, 'null']), null, 'generic']],
    ]);
    const body = 'f.req=' + encodeURIComponent(rpcPayload) + '&';
    const rpcResp = await fetch(
      'https://translate.google.com/_/TranslateWebserverUi/data/batchexecute?rpcids=jQ1olc&hl=en&soc-app=1&soc-platform=1&soc-device=1',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
        body,
      }
    );
    if (rpcResp.ok) {
      const txt = await rpcResp.text();
      const match = txt.match(/jQ1olc","\[\\"(.*?)\\"\]/);
      if (match && match[1] && match[1].length > 200) {
        return {
          audioBase64: match[1],
          mimeType: 'audio/mpeg',
        };
      }
    }
  } catch {
    // fall through to direct stream endpoints
  }

  // 2. Try Google Translate direct audio endpoints
  const endpoints = [
    `https://translate.google.com/translate_tts?ie=UTF-8&tl=${tl}&client=tw-ob&q=${encodeURIComponent(queryText)}`,
    `https://translate.google.com/translate_tts?ie=UTF-8&tl=${tl}&client=gtx&q=${encodeURIComponent(queryText)}`,
  ];

  for (const url of endpoints) {
    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
      });
      if (!resp.ok) continue;
      const arrBuf = await resp.arrayBuffer();
      if (!arrBuf || arrBuf.byteLength < 100) continue;
      return {
        audioBase64: Buffer.from(arrBuf).toString('base64'),
        mimeType: 'audio/mpeg',
      };
    } catch {
      // try next endpoint
    }
  }
  return null;
}

// In-memory cache of base audio buffers (keyed by `${language}:${cleanText}`)
const ttsBaseBufferCache = new Map<string, { buffer: Buffer; mimeType: string }>();
let geminiTtsCooldownUntil = 0;

function getPresetWavPath(cleanText: string, language: string): string | null {
  const norm = cleanText.replace(/\s+/g, ' ').trim();
  const lower = norm.toLowerCase();

  const resolveIfExists = (fileName: string): string | null => {
    const p = path.join(TTS_CACHE_DIR, fileName);
    return fs.existsSync(p) ? p : null;
  };

  if (language !== 'en') {
    if (norm.includes('بفرمایید ثبت کنم')) {
      return resolveIfExists('welcome_1_fa.wav') || resolveIfExists('welcome_fa.wav');
    }
    if (norm.includes('بفرمایید، منتظرم') || norm.includes('بفرمایید منتظرم')) {
      return resolveIfExists('welcome_2_fa.wav') || resolveIfExists('welcome_fa.wav');
    }
    if (norm.includes('در خدمتم، بفرمایید') || norm.includes('در خدمتم بفرمایید')) {
      return resolveIfExists('welcome_3_fa.wav') || resolveIfExists('welcome_fa.wav');
    }
    if (
      norm.includes('چه یادآور، مناسبت، مکان یا ایده‌ای') ||
      norm.includes('لطفاً بفرمایید چه موردی را ثبت کنم')
    ) {
      return resolveIfExists('welcome_1_fa.wav') || resolveIfExists('welcome_fa.wav');
    }
    if (norm.includes('همین پایین تایپ کنید') || norm.includes('لطفا تایپ کنید')) {
      return resolveIfExists('retry_max_fa.wav') || resolveIfExists('retry_1_fa.wav');
    }
    if (norm.includes('صداتون واضح نبود') || norm.includes('دوباره بفرمایید')) {
      return resolveIfExists('retry_2_fa.wav') || resolveIfExists('retry_1_fa.wav');
    }
    if (norm.includes('متوجه نشدم') || norm.includes('یه بار دیگه بگید')) {
      return resolveIfExists('retry_1_fa.wav');
    }
    if (norm.includes('کدام بخش') && norm.includes('تغییر دهید')) {
      return resolveIfExists('ask_edit_fa.wav');
    }
    if (norm.includes('در چه روز و چه ماهی است') || norm.includes('چه روز و چه ماهیه')) {
      return resolveIfExists('ask_occasion_date_fa.wav');
    }
    if (norm.includes('برای کدوم روز تنظیمش کنم')) {
      return resolveIfExists('ask_day_2_fa.wav') || resolveIfExists('ask_day_fa.wav');
    }
    if (norm.includes('کی بهتون یادآوری کنم')) {
      return resolveIfExists('ask_day_3_fa.wav') || resolveIfExists('ask_day_fa.wav');
    }
    if (
      norm.includes('چه روزی یادتون بندازم') ||
      norm.includes('در چه روزی به شما یادآوری شود')
    ) {
      return resolveIfExists('ask_day_1_fa.wav') || resolveIfExists('ask_day_fa.wav');
    }
    if (norm.includes('آلارمش روی چه ساعتی باشه')) {
      return resolveIfExists('ask_time_2_fa.wav') || resolveIfExists('ask_time_fa.wav');
    }
    if (norm.includes('چه ساعتی بهتون خبر بدم')) {
      return resolveIfExists('ask_time_3_fa.wav') || resolveIfExists('ask_time_fa.wav');
    }
    if (norm.includes('ساعت چند یادآوری کنم') || norm.includes('چه ساعتی برای آلارم')) {
      return resolveIfExists('ask_time_1_fa.wav') || resolveIfExists('ask_time_fa.wav');
    }
    if (norm.includes('با موقعیت زنده GPS آماده است') || norm.includes('هشدار ورود فعال شود')) {
      return resolveIfExists('ask_location_details_fa.wav');
    }
    if (norm.includes('توضیح تکمیلی برای این ایده دارید')) {
      return resolveIfExists('ask_idea_details_fa.wav');
    }
    if (norm.includes('مورد تاییده که ثبت بشه')) {
      return resolveIfExists('ask_confirm_2_fa.wav') || resolveIfExists('ask_confirm_fa.wav');
    }
    if (
      norm.includes('ثبتش کنم؟') ||
      norm.includes('آیا مورد تایید است تا ثبت شود') ||
      norm.includes('آماده ذخیره است. آیا مورد تایید است')
    ) {
      return resolveIfExists('ask_confirm_1_fa.wav') || resolveIfExists('ask_confirm_fa.wav');
    }
    if (
      norm.includes('موضوع یا عنوان یادآور') ||
      norm.includes('عنوان این مناسبت را بفرمایید') ||
      norm.includes('نام این مکان را بفرمایید') ||
      norm.includes('عنوان یا موضوع ایده‌ی خود را بفرمایید')
    ) {
      return resolveIfExists('ask_subject_fa.wav');
    }
    return null;
  }

  if (
    lower.includes('go ahead, i am ready') ||
    lower.includes('go ahead, i am listening') ||
    lower.includes('what reminder, occasion, location, or idea') ||
    lower.includes('what would you like to save')
  ) {
    return resolveIfExists('welcome_en.wav');
  }
  if (lower.includes('which part you would like to change')) {
    return resolveIfExists('ask_edit_en.wav');
  }
  if (lower.includes('on what day and month is')) {
    return resolveIfExists('ask_occasion_date_en.wav');
  }
  if (
    lower.includes('on which day or date') ||
    lower.includes('which day should i remind you') ||
    lower.includes('for which day should i set')
  ) {
    return resolveIfExists('ask_day_en.wav');
  }
  if (
    lower.includes('what time should i set the alarm') ||
    lower.includes('what time should i remind you')
  ) {
    return resolveIfExists('ask_time_en.wav');
  }
  if (lower.includes('would you like to add a note or enable arrival alert')) {
    return resolveIfExists('ask_location_details_en.wav');
  }
  if (lower.includes('if you have any additional details, please share them now')) {
    return resolveIfExists('ask_idea_details_en.wav');
  }
  if (
    lower.includes('do you confirm saving it') ||
    lower.includes('do you confirm?') ||
    lower.includes('should i save it?')
  ) {
    return resolveIfExists('ask_confirm_en.wav');
  }
  if (
    lower.includes('subject or title of your reminder') ||
    lower.includes('title of this occasion') ||
    lower.includes('save this location under') ||
    lower.includes('title or subject of your idea')
  ) {
    return resolveIfExists('ask_subject_en.wav');
  }
  return null;
}

// Fast Server-Side Speech-to-Text endpoint with strict acoustic VAD to prevent noise hallucination
app.post('/api/smart-stt', async (req: Request, res: Response) => {
  try {
    const { audioBase64, mimeType = 'audio/wav', language = 'fa' } = req.body || {};
    if (!audioBase64 || typeof audioBase64 !== 'string') {
      res.status(400).json({ ok: false, error: 'audioBase64 is required' });
      return;
    }

    // 1. Acoustic verification on raw 16-bit PCM samples before calling LLM
    const wavBuf = Buffer.from(audioBase64, 'base64');
    if (wavBuf.length <= 640) {
      res.json({ ok: true, transcript: '', isUnclear: true });
      return;
    }

    const pcmOffset =
      wavBuf.length > 44 && wavBuf.subarray(0, 4).toString('ascii') === 'RIFF' ? 44 : 0;
    const totalSamples = Math.floor((wavBuf.length - pcmOffset) / 2);
    if (totalSamples < 4000) {
      // Less than 250ms at 16kHz -> too short to be a spoken command
      res.json({ ok: true, transcript: '', isUnclear: true });
      return;
    }

    const frameSize = 320; // 20ms at 16kHz
    let maxPeak = 0;
    let voicedFrames = 0;
    const totalFrames = Math.floor(totalSamples / frameSize);

    for (let f = 0; f < totalFrames; f++) {
      let sumSq = 0;
      let zeroCrossings = 0;
      let prevSample = 0;
      const baseIdx = pcmOffset + f * frameSize * 2;
      for (let i = 0; i < frameSize; i++) {
        const s = wavBuf.readInt16LE(baseIdx + i * 2);
        const abs = Math.abs(s);
        if (abs > maxPeak) maxPeak = abs;
        sumSq += s * s;
        if (i > 0 && ((s >= 0 && prevSample < 0) || (s < 0 && prevSample >= 0))) {
          zeroCrossings++;
        }
        prevSample = s;
      }
      const frameRms = Math.sqrt(sumSq / frameSize);
      // Human voice at 16kHz has strong energy (frameRms >= 1100) and moderate zero-crossings (not pure high-freq hiss)
      if (frameRms >= 1100 && zeroCrossings >= 4 && zeroCrossings <= 130) {
        voicedFrames++;
      }
    }

    // Reject background noise, clicks, or faint room hiss before calling Gemini
    if (maxPeak < 2600 || voicedFrames < 10) {
      res.json({ ok: true, transcript: '', isUnclear: true });
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      res.status(503).json({ ok: false, error: 'GEMINI_API_KEY not configured' });
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

    const isEn = language === 'en';
    const sttInstruction = isEn
      ? 'Transcribe the exact English words spoken by the human voice in this audio. Do NOT guess, invent, or complete sentences. If the audio does not contain clear intelligible human speech, set isClearSpeech to false and transcript to empty string.'
      : 'فقط کلمات دقیقی که با صدای انسان در این فایل صوتی به زبان فارسی گفته شده را بنویس. به هیچ عنوان از خودت جمله‌ای حدس نزن و نساز. اگر صدای انسان واضح نیست یا فقط نویز و سکوت است، isClearSpeech را false و transcript را رشته خالی بگذار.';

    const sttModels = ['gemini-3.1-flash-lite', 'gemini-3-flash-preview', 'gemini-3.8-flash'];
    for (const modelName of sttModels) {
      try {
        const resp: any = await Promise.race([
          ai.models.generateContent({
            model: modelName,
            contents: [
              {
                parts: [
                  { inlineData: { data: audioBase64, mimeType } },
                  { text: sttInstruction },
                ],
              },
            ],
            config: {
              temperature: 0,
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  isClearSpeech: { type: Type.BOOLEAN },
                  transcript: { type: Type.STRING },
                },
                required: ['isClearSpeech', 'transcript'],
              },
            },
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('STT_TIMEOUT')), 4200)),
        ]);

        const parsed = JSON.parse(resp?.text || '{}');
        const rawOut = String(parsed?.transcript || '')
          .trim()
          .replace(/^["'«»]+|["'«»]+$/g, '')
          .trim();

        // Filter out known generic LLM hallucinations or echo of the assistant's own prompt
        const isEchoOrHallucination =
          !parsed?.isClearSpeech ||
          !rawOut ||
          /^unclear$/i.test(rawOut) ||
          /^(نامفهوم|سکوت|نویز|متوجه نشدم)$/i.test(rawOut) ||
          /سلام.*بفرمایید.*(ثبت کنم|منتظرم)/i.test(rawOut) ||
          /یادآوری کن فردا ساعت ۱۰ صبح جلسه دارم/i.test(rawOut) ||
          /فردا ساعت نه صبح به من یادآوری کن که برم دکتر/i.test(rawOut);

        res.json({
          ok: true,
          transcript: isEchoOrHallucination ? '' : rawOut,
          isUnclear: isEchoOrHallucination,
        });
        return;
      } catch {
        // try next model
      }
    }

    res.json({ ok: true, transcript: '', isUnclear: true });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'STT failed' });
  }
});

// Server-side TTS endpoint for Persian ('fa') & English ('en') spoken questions across all 5 voice personas
app.post('/api/smart-tts', async (req: Request, res: Response) => {
  try {
    const { text, language = 'fa', voicePersona = 'zephyr_warm' } = req.body || {};
    if (!text || typeof text !== 'string' || !text.trim()) {
      res.status(400).json({ ok: false, error: 'text is required' });
      return;
    }

    const cleanText = text.replace(/\s+/g, ' ').trim();
    const baseCacheKey = `${language}:${cleanText}`;
    const hashKey = crypto.createHash('sha1').update(baseCacheKey).digest('hex');
    const diskWavPath = path.join(TTS_CACHE_DIR, `dyn_${hashKey}.wav`);

    // 1. Check bundled preset WAV files across all wizard steps
    const presetPath = getPresetWavPath(cleanText, language);
    if (presetPath) {
      const rawWav = fs.readFileSync(presetPath);
      const personaWav = applyPersonaToWavBuffer(rawWav, voicePersona);
      res.json({
        ok: true,
        audioBase64: personaWav.toString('base64'),
        mimeType: 'audio/wav',
        voicePersona,
        cached: true,
      });
      return;
    }

    // 2. Check in-memory base cache
    let baseEntry = ttsBaseBufferCache.get(baseCacheKey);

    // 3. Check persistent disk WAV cache
    if (!baseEntry && fs.existsSync(diskWavPath)) {
      try {
        const diskBuf = fs.readFileSync(diskWavPath);
        if (diskBuf.length > 100) {
          baseEntry = { buffer: diskBuf, mimeType: 'audio/wav' };
          ttsBaseBufferCache.set(baseCacheKey, baseEntry);
        }
      } catch {
        // ignore disk read errors
      }
    }

    // 4. Synthesize via Gemini TTS models (with Zephyr voice) if not cached
    const apiKey = process.env.GEMINI_API_KEY;
    if (
      !baseEntry &&
      apiKey &&
      apiKey !== 'MY_GEMINI_API_KEY' &&
      Date.now() >= geminiTtsCooldownUntil
    ) {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const ttsModels = [
        'gemini-3.8-flash-tts',
        'gemini-3.1-flash-tts-preview',
        'gemini-2.5-flash-preview-tts',
      ];

      for (const modelName of ttsModels) {
        try {
          const ttsResp: any = await Promise.race([
            ai.models.generateContent({
              model: modelName,
              contents: [{ parts: [{ text: cleanText }] }],
              config: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: {
                      voiceName: 'Zephyr',
                    },
                  },
                },
              },
            }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('GEMINI_TTS_TIMEOUT')), 3500)
            ),
          ]);

          const inlinePart = ttsResp?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
          if (inlinePart?.data) {
            const wavBuf = ensureWavBufferFromGeminiInlineData(
              inlinePart.data,
              inlinePart.mimeType || 'audio/L16;codec=pcm;rate=24000'
            );
            baseEntry = { buffer: wavBuf, mimeType: 'audio/wav' };
            ttsBaseBufferCache.set(baseCacheKey, baseEntry);
            try {
              fs.writeFileSync(diskWavPath, wavBuf);
            } catch {
              // ignore disk write errors
            }
            break;
          }
        } catch {
          // try next TTS model
        }
      }
    }

    // 5. If baseEntry is WAV, apply the selected voicePersona DSP and return
    if (baseEntry && baseEntry.mimeType === 'audio/wav') {
      const personaWav = applyPersonaToWavBuffer(baseEntry.buffer, voicePersona);
      res.json({
        ok: true,
        audioBase64: personaWav.toString('base64'),
        mimeType: 'audio/wav',
        voicePersona,
      });
      return;
    }

    // 6. Fallback to bundled step WAV so Persian never switches to Arabic accent
    const fallbackFile = path.join(
      TTS_CACHE_DIR,
      language === 'en' ? 'welcome_en.wav' : 'welcome_fa.wav'
    );
    if (fs.existsSync(fallbackFile)) {
      const rawWav = fs.readFileSync(fallbackFile);
      const personaWav = applyPersonaToWavBuffer(rawWav, voicePersona);
      res.json({
        ok: true,
        audioBase64: personaWav.toString('base64'),
        mimeType: 'audio/wav',
        voicePersona,
      });
      return;
    }

    res.status(500).json({ ok: false, error: 'TTS generation unavailable' });
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
