import { Category, Priority } from '../types';
import { fromPersianDigits } from './jalali';

export interface ParsedReminderData {
  title: string;
  description: string;
  category: Category;
  priority: Priority;
  suggestedTimestamp?: number;
}

export function parseSmsOrText(rawText: string): ParsedReminderData {
  const clean = rawText.trim();
  const normalized = fromPersianDigits(clean);

  // Category detection
  let category: Category = 'other';
  if (/جلسه|شرکت|پروژه|قرارداد|دفتر|اداره|بانک|قسط|مشتری|ایمیل|مدیر|کار|همکار|چک/i.test(clean)) {
    category = 'work';
  } else if (/مامان|بابا|مادر|پدر|همسر|بچه|دختر|پسر|منزل|خونه|خرید|مهمونی|مهمانی|تولد|پزشک|دکتر|دارو/i.test(clean)) {
    category = 'family';
  }

  // Priority detection
  let priority: Priority = 'medium';
  if (/فوری|مهم|سریع|اورژانسی|تاکید|مهلت آخر|ضرب‌الاجل/i.test(clean)) {
    priority = 'high';
  } else if (/آرام|فرصت|هروقت|مطالعه/i.test(clean)) {
    priority = 'low';
  }

  // Time extraction: look for patterns like "ساعت 18:30" or "ساعت 18" or "18:30"
  let suggestedTimestamp: number | undefined;
  const now = new Date();
  let targetHour = now.getHours() + 1;
  let targetMinute = 0;
  let dayOffset = 0;

  if (/فردا/i.test(clean)) {
    dayOffset = 1;
    targetHour = 10; // default tomorrow morning
  } else if (/پس‌فردا|پس فردا/i.test(clean)) {
    dayOffset = 2;
    targetHour = 10;
  } else if (/امشب/i.test(clean)) {
    dayOffset = 0;
    targetHour = 20;
  } else if (/عصر/i.test(clean)) {
    targetHour = 17;
  } else if (/ظهر/i.test(clean)) {
    targetHour = 13;
  } else if (/صبح/i.test(clean)) {
    targetHour = 9;
  }

  // Look for exact time pattern HH:MM or HH
  const timeRegex = /(?:ساعت\s*)?(\d{1,2})(?::(\d{2}))?/i;
  const match = normalized.match(timeRegex);
  if (match && match[1]) {
    const parsedH = parseInt(match[1], 10);
    if (parsedH >= 0 && parsedH <= 23) {
      targetHour = parsedH;
      if (match[2]) {
        targetMinute = parseInt(match[2], 10);
      }
    }
  }

  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + dayOffset);
  targetDate.setHours(targetHour, targetMinute, 0, 0);

  // If time is earlier today, move to tomorrow
  if (dayOffset === 0 && targetDate.getTime() <= now.getTime()) {
    targetDate.setDate(targetDate.getDate() + 1);
  }
  suggestedTimestamp = targetDate.getTime();

  // Extract a concise title
  let title = clean.split('\n')[0] || clean;
  if (title.length > 50) {
    title = title.substring(0, 48) + '...';
  }

  return {
    title: title.trim(),
    description: clean !== title ? clean : '',
    category,
    priority,
    suggestedTimestamp,
  };
}
