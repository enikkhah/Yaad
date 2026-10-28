import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

// Decode a non-interlaced 8-bit RGBA PNG into raw { width, height, data: Uint8Array }
function decodeRgbaPng(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!buffer.subarray(0, 8).equals(signature)) {
    throw new Error('Invalid PNG signature');
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  if (bitDepth !== 8 || colorType !== 6) {
    throw new Error(`Expected 8-bit RGBA PNG (got bitDepth=${bitDepth}, colorType=${colorType})`);
  }

  const compressed = Buffer.concat(idatChunks);
  const raw = zlib.inflateSync(compressed);
  const stride = width * 4;
  const pixels = new Uint8Array(width * height * 4);

  function paethPredictor(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
  }

  for (let y = 0; y < height; y++) {
    const filterType = raw[y * (stride + 1)];
    const rowStart = y * (stride + 1) + 1;
    const outRowStart = y * stride;

    for (let x = 0; x < stride; x++) {
      const rawByte = raw[rowStart + x];
      const a = x >= 4 ? pixels[outRowStart + x - 4] : 0;
      const b = y > 0 ? pixels[outRowStart - stride + x] : 0;
      const c = x >= 4 && y > 0 ? pixels[outRowStart - stride + x - 4] : 0;

      let val = rawByte;
      if (filterType === 1) val = (rawByte + a) & 0xff;
      else if (filterType === 2) val = (rawByte + b) & 0xff;
      else if (filterType === 3) val = (rawByte + Math.floor((a + b) / 2)) & 0xff;
      else if (filterType === 4) val = (rawByte + paethPredictor(a, b, c)) & 0xff;

      pixels[outRowStart + x] = val;
    }
  }

  return { width, height, data: pixels };
}

// CRC32 table for PNG chunks
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodeRgbaPng(width, height, rgbaData) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8-bit
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (stride + 1);
    raw[rowOffset] = 0; // Filter type 0 (None)
    Buffer.from(rgbaData.buffer, rgbaData.byteOffset + y * stride, stride).copy(raw, rowOffset + 1);
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

// High-quality premultiplied-alpha area averaging resize with optional padding ratio
function resizeRgba(src, targetWidth, targetHeight, paddingRatio = 0) {
  const dst = new Uint8Array(targetWidth * targetHeight * 4);
  const padX = Math.round(targetWidth * paddingRatio);
  const padY = Math.round(targetHeight * paddingRatio);
  const innerW = Math.max(1, targetWidth - padX * 2);
  const innerH = Math.max(1, targetHeight - padY * 2);

  const scaleX = src.width / innerW;
  const scaleY = src.height / innerH;

  for (let y = 0; y < innerH; y++) {
    const srcY0 = y * scaleY;
    const srcY1 = (y + 1) * scaleY;
    const yStart = Math.floor(srcY0);
    const yEnd = Math.min(src.height - 1, Math.ceil(srcY1));

    for (let x = 0; x < innerW; x++) {
      const srcX0 = x * scaleX;
      const srcX1 = (x + 1) * scaleX;
      const xStart = Math.floor(srcX0);
      const xEnd = Math.min(src.width - 1, Math.ceil(srcX1));

      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let aSum = 0;
      let weightSum = 0;

      for (let sy = yStart; sy <= yEnd; sy++) {
        const wy = Math.min(sy + 1, srcY1) - Math.max(sy, srcY0);
        if (wy <= 0) continue;
        for (let sx = xStart; sx <= xEnd; sx++) {
          const wx = Math.min(sx + 1, srcX1) - Math.max(sx, srcX0);
          if (wx <= 0) continue;
          const w = wx * wy;
          const idx = (sy * src.width + sx) * 4;
          const a = src.data[idx + 3] / 255;
          rSum += src.data[idx] * a * w;
          gSum += src.data[idx + 1] * a * w;
          bSum += src.data[idx + 2] * a * w;
          aSum += a * w;
          weightSum += w;
        }
      }

      const dstIdx = ((y + padY) * targetWidth + (x + padX)) * 4;
      if (weightSum > 0 && aSum > 0) {
        const finalAlpha = aSum / weightSum;
        dst[dstIdx] = Math.round(rSum / aSum);
        dst[dstIdx + 1] = Math.round(gSum / aSum);
        dst[dstIdx + 2] = Math.round(bSum / aSum);
        dst[dstIdx + 3] = Math.round(finalAlpha * 255);
      }
    }
  }

  return encodeRgbaPng(targetWidth, targetHeight, dst);
}

const rootDir = process.cwd();
const srcTransparentPath = path.join(rootDir, 'public', 'logo-transparent.png');
const srcBuffer = fs.readFileSync(srcTransparentPath);
const srcImage = decodeRgbaPng(srcBuffer);

// Recolor all non-transparent icon pixels uniformly to brand color #FF8C00 (R: 255, G: 140, B: 0)
for (let y = 0; y < srcImage.height; y++) {
  const targetR = 255;
  const targetG = 140;
  const targetB = 0;

  for (let x = 0; x < srcImage.width; x++) {
    const idx = (y * srcImage.width + x) * 4;
    const a = srcImage.data[idx + 3];
    if (a > 0) {
      srcImage.data[idx] = targetR;
      srcImage.data[idx + 1] = targetG;
      srcImage.data[idx + 2] = targetB;
      if (a > 24 && a < 255) {
        srcImage.data[idx + 3] = Math.min(255, Math.round(Math.pow(a / 255, 0.72) * 255));
      }
    } else {
      srcImage.data[idx] = 0;
      srcImage.data[idx + 1] = 0;
      srcImage.data[idx + 2] = 0;
      srcImage.data[idx + 3] = 0;
    }
  }
}

const recoloredFullBuffer = encodeRgbaPng(srcImage.width, srcImage.height, srcImage.data);
fs.writeFileSync(srcTransparentPath, recoloredFullBuffer);

// 1. Update web & Capacitor source icons with 100% transparent background and vibrant golden-amber color
const iconTargets = [
  { file: 'public/logo-transparent.png', size: 1024, pad: 0 },
  { file: 'src/assets/images/logo-transparent.png', size: 1024, pad: 0 },
  { file: 'src/assets/images/icon.png', size: 1024, pad: 0 },
  { file: 'public/icon.png', size: 1024, pad: 0 },
  { file: 'resources/icon.png', size: 1024, pad: 0 },
  { file: 'resources/icon-only.png', size: 1024, pad: 0 },
  { file: 'resources/icon-foreground.png', size: 1024, pad: 0.18 },
  { file: 'public/pwa-512x512.png', size: 512, pad: 0 },
  { file: 'public/pwa-maskable-512x512.png', size: 512, pad: 0.12 },
  { file: 'public/pwa-192x192.png', size: 192, pad: 0 },
  { file: 'public/pwa-maskable-192x192.png', size: 192, pad: 0.12 },
  { file: 'public/apple-touch-icon.png', size: 180, pad: 0 },
];

for (const target of iconTargets) {
  const fullPath = path.join(rootDir, target.file);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  if (target.size === 1024 && target.pad === 0) {
    fs.writeFileSync(fullPath, recoloredFullBuffer);
  } else {
    const outBuf = resizeRgba(srcImage, target.size, target.size, target.pad);
    fs.writeFileSync(fullPath, outBuf);
  }
  console.log(`Generated transparent icon: ${target.file} (${target.size}x${target.size})`);
}

// 2. If android/app/src/main/res exists, populate transparent Android launcher & notification icons
const androidResDir = path.join(rootDir, 'android', 'app', 'src', 'main', 'res');
if (fs.existsSync(path.join(rootDir, 'android'))) {
  const mipmapConfigs = [
    { folder: 'mipmap-mdpi', launcherSize: 48, fgSize: 108 },
    { folder: 'mipmap-hdpi', launcherSize: 72, fgSize: 162 },
    { folder: 'mipmap-xhdpi', launcherSize: 96, fgSize: 216 },
    { folder: 'mipmap-xxhdpi', launcherSize: 144, fgSize: 324 },
    { folder: 'mipmap-xxxhdpi', launcherSize: 192, fgSize: 432 },
  ];

  for (const cfg of mipmapConfigs) {
    const dir = path.join(androidResDir, cfg.folder);
    fs.mkdirSync(dir, { recursive: true });

    // Remove any default .webp launcher files that could override .png
    for (const file of fs.readdirSync(dir)) {
      if (file.startsWith('ic_launcher') && file.endsWith('.webp')) {
        fs.unlinkSync(path.join(dir, file));
      }
    }

    const launcherPng = resizeRgba(srcImage, cfg.launcherSize, cfg.launcherSize, 0.04);
    const foregroundPng = resizeRgba(srcImage, cfg.fgSize, cfg.fgSize, 0.18);

    fs.writeFileSync(path.join(dir, 'ic_launcher.png'), launcherPng);
    fs.writeFileSync(path.join(dir, 'ic_launcher_round.png'), launcherPng);
    fs.writeFileSync(path.join(dir, 'ic_launcher_foreground.png'), foregroundPng);
  }

  // Remove mipmap-anydpi-v26 so Android launchers render the genuine transparent PNG icon
  // instead of forcing an opaque white/black adaptive-icon background plate
  const anyDpiDir = path.join(androidResDir, 'mipmap-anydpi-v26');
  if (fs.existsSync(anyDpiDir)) {
    fs.rmSync(anyDpiDir, { recursive: true, force: true });
    console.log('Removed mipmap-anydpi-v26 to preserve transparent Android launcher icon background.');
  }

  // Also set ic_launcher_background color to transparent (#00000000)
  const valuesDir = path.join(androidResDir, 'values');
  fs.mkdirSync(valuesDir, { recursive: true });
  const bgXmlPath = path.join(valuesDir, 'ic_launcher_background.xml');
  fs.writeFileSync(
    bgXmlPath,
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#00000000</color>\n</resources>\n`,
    'utf8'
  );

  // Write drawable/ic_launcher.png and drawable/ic_stat_notification.png with transparent background
  const drawableDir = path.join(androidResDir, 'drawable');
  fs.mkdirSync(drawableDir, { recursive: true });
  const notifPng = resizeRgba(srcImage, 192, 192, 0);
  fs.writeFileSync(path.join(drawableDir, 'ic_launcher.png'), notifPng);
  fs.writeFileSync(path.join(drawableDir, 'ic_stat_notification.png'), notifPng);
  console.log('Generated transparent Android mipmap and drawable icons.');
}
