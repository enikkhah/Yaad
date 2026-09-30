import React, { useState } from 'react';
import { Reminder, StatsTimeframe } from '../types';
import { toPersianDigits } from '../utils/jalali';
import { AppLanguage, getT } from '../utils/i18n';
import { 
  BarChart3, 
  CheckCircle2, 
  Clock, 
  XCircle, 
  Layers, 
  X, 
  Briefcase, 
  Heart, 
  Tag, 
  TrendingUp 
} from 'lucide-react';

interface StatisticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  reminders: Reminder[];
  language?: AppLanguage;
}

export const StatisticsModal: React.FC<StatisticsModalProps> = ({
  isOpen,
  onClose,
  reminders,
  language = 'fa',
}) => {
  const [timeframe, setTimeframe] = useState<StatsTimeframe>('weekly');
  const t = getT(language);
  const formatNum = (n: number) => (language === 'en' ? n.toString() : toPersianDigits(n));

  if (!isOpen) return null;

  // Filter reminders based on timeframe
  const now = Date.now();
  const getWindowDays = () => {
    switch (timeframe) {
      case 'weekly':
        return 7;
      case 'monthly':
        return 30;
      case 'yearly':
        return 365;
    }
  };

  const cutoffMs = now - getWindowDays() * 86400000;
  const filteredReminders = reminders.filter((r) => r.createdAt >= cutoffMs || r.dueTimestamp >= cutoffMs);

  const total = filteredReminders.length;
  const completed = filteredReminders.filter((r) => r.status === 'completed').length;
  const postponed = filteredReminders.filter((r) => r.status === 'postponed' || r.postponeCount > 0).length;
  const cancelled = filteredReminders.filter((r) => r.status === 'cancelled').length;
  const pending = filteredReminders.filter((r) => r.status === 'pending' && r.dueTimestamp >= now).length;

  const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

  // Category counts
  const workCount = filteredReminders.filter((r) => r.category === 'work').length;
  const familyCount = filteredReminders.filter((r) => r.category === 'family').length;
  const otherCount = filteredReminders.filter((r) => r.category === 'other').length;

  // Priority counts
  const highCount = filteredReminders.filter((r) => r.priority === 'high').length;
  const medCount = filteredReminders.filter((r) => r.priority === 'medium').length;
  const lowCount = filteredReminders.filter((r) => r.priority === 'low').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-sm overflow-y-auto" dir={language === 'en' ? 'ltr' : 'rtl'}>
      <div className="bg-stone-900 border border-stone-800 rounded-3xl w-full max-w-xl p-3.5 sm:p-6 shadow-2xl space-y-4 sm:space-y-6 my-auto max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 sm:pb-4 border-b border-stone-800">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className="p-2 sm:p-2.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <BarChart3 className="w-5 h-5" />
            </div>
            <h2 className="text-base sm:text-lg font-bold text-white">
              {language === 'en' ? t.statsTitle : 'آمار جامع یادآوری‌ها'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-stone-400 hover:text-white hover:bg-stone-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Timeframe Selector */}
        <div className="flex p-1.5 bg-stone-950 rounded-2xl border border-stone-800 text-xs sm:text-sm font-bold">
          <button
            type="button"
            onClick={() => setTimeframe('weekly')}
            className={`flex-1 py-2.5 sm:py-3 rounded-xl transition-all ${
              timeframe === 'weekly'
                ? 'bg-amber-600 text-white shadow-md font-black border border-amber-400/40'
                : 'text-stone-400 hover:text-white'
            }`}
          >
            {t.statsWeekly}
          </button>
          <button
            type="button"
            onClick={() => setTimeframe('monthly')}
            className={`flex-1 py-2.5 sm:py-3 rounded-xl transition-all ${
              timeframe === 'monthly'
                ? 'bg-amber-600 text-white shadow-md font-black border border-amber-400/40'
                : 'text-stone-400 hover:text-white'
            }`}
          >
            {t.statsMonthly}
          </button>
          <button
            type="button"
            onClick={() => setTimeframe('yearly')}
            className={`flex-1 py-2.5 sm:py-3 rounded-xl transition-all ${
              timeframe === 'yearly'
                ? 'bg-amber-600 text-white shadow-md font-black border border-amber-400/40'
                : 'text-stone-400 hover:text-white'
            }`}
          >
            {t.statsYearly}
          </button>
        </div>

        {/* 4 Main Core Metrics Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* Total Reminders */}
          <div className="p-4 sm:p-5 rounded-2xl bg-stone-950/80 border border-stone-800 flex flex-col items-center text-center">
            <div className="p-2.5 rounded-xl bg-stone-800 text-stone-300 mb-2">
              <Layers className="w-5 h-5" />
            </div>
            <span className="text-2xl sm:text-3xl font-black font-mono text-white">
              {formatNum(total)}
            </span>
            <span className="text-xs sm:text-sm text-stone-400 mt-1 font-medium">{t.statsTotal}</span>
          </div>

          {/* Completed Reminders */}
          <div className="p-4 sm:p-5 rounded-2xl bg-emerald-950/30 border border-emerald-500/30 flex flex-col items-center text-center">
            <div className="p-2.5 rounded-xl bg-emerald-500/20 text-emerald-400 mb-2">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <span className="text-2xl sm:text-3xl font-black font-mono text-emerald-400">
              {formatNum(completed)}
            </span>
            <span className="text-xs sm:text-sm text-emerald-300/90 mt-1 font-medium">{t.statsDone}</span>
          </div>

          {/* Postponed Reminders */}
          <div className="p-4 sm:p-5 rounded-2xl bg-amber-950/30 border border-amber-500/30 flex flex-col items-center text-center">
            <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-400 mb-2">
              <Clock className="w-5 h-5" />
            </div>
            <span className="text-2xl sm:text-3xl font-black font-mono text-amber-400">
              {formatNum(postponed)}
            </span>
            <span className="text-xs sm:text-sm text-amber-300/90 mt-1 font-medium">{t.statsPostponed}</span>
          </div>

          {/* Cancelled / Pending */}
          <div className="p-4 sm:p-5 rounded-2xl bg-rose-950/30 border border-rose-500/30 flex flex-col items-center text-center">
            <div className="p-2.5 rounded-xl bg-rose-500/20 text-rose-400 mb-2">
              <XCircle className="w-5 h-5" />
            </div>
            <span className="text-2xl sm:text-3xl font-black font-mono text-rose-400">
              {formatNum(cancelled)}
            </span>
            <span className="text-xs sm:text-sm text-rose-300/90 mt-1 font-medium">{language === 'en' ? 'Cancelled' : 'کنسل شده'}</span>
          </div>
        </div>

        {/* Completion Rate */}
        <div className="p-4 rounded-2xl bg-stone-950/60 border border-stone-800 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs font-bold text-white">
                {language === 'en' ? 'Completion & Productivity Rate' : 'نرخ تحقق و بهره‌وری یادآوری‌ها'}
              </div>
              <div className="text-[11px] text-stone-400">
                {language === 'en' ? 'Percentage of completed reminders in this timeframe' : 'درصد یادآورهای تکمیل‌شده از کل موارد این دوره'}
              </div>
            </div>
          </div>
          <div className="text-right">
            <span className="text-xl font-black font-mono text-emerald-400">
              {formatNum(completionRate)}%
            </span>
          </div>
        </div>

        {/* Breakdown by Category */}
        <div className="p-4 rounded-2xl bg-stone-950/60 border border-stone-800 space-y-3">
          <h3 className="text-xs font-bold text-stone-300">
            {language === 'en' ? 'Breakdown by Category' : 'تفکیک بر اساس دسته‌بندی'}
          </h3>
          <div className="space-y-2">
            {/* Work */}
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 text-cyan-300">
                <Briefcase className="w-3.5 h-3.5" />
                <span>{t.categoryWork}</span>
              </div>
              <span className="font-mono font-bold text-stone-200">
                {formatNum(workCount)} {language === 'en' ? 'reminders' : 'یادآور'}
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-stone-800 overflow-hidden">
              <div
                className="h-full bg-cyan-400 rounded-full transition-all"
                style={{ width: `${total ? (workCount / total) * 100 : 0}%` }}
              />
            </div>

            {/* Family */}
            <div className="flex items-center justify-between text-xs pt-1">
              <div className="flex items-center gap-2 text-rose-300">
                <Heart className="w-3.5 h-3.5" />
                <span>{t.categoryFamily}</span>
              </div>
              <span className="font-mono font-bold text-stone-200">
                {formatNum(familyCount)} {language === 'en' ? 'reminders' : 'یادآور'}
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-stone-800 overflow-hidden">
              <div
                className="h-full bg-rose-400 rounded-full transition-all"
                style={{ width: `${total ? (familyCount / total) * 100 : 0}%` }}
              />
            </div>

            {/* Other */}
            <div className="flex items-center justify-between text-xs pt-1">
              <div className="flex items-center gap-2 text-emerald-300">
                <Tag className="w-3.5 h-3.5" />
                <span>{t.categoryOther}</span>
              </div>
              <span className="font-mono font-bold text-stone-200">
                {formatNum(otherCount)} {language === 'en' ? 'reminders' : 'یادآور'}
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-stone-800 overflow-hidden">
              <div
                className="h-full bg-emerald-400 rounded-full transition-all"
                style={{ width: `${total ? (otherCount / total) * 100 : 0}%` }}
              />
            </div>
          </div>
        </div>

        {/* Breakdown by Priority */}
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div className="p-3 rounded-xl bg-red-950/20 border border-red-500/30">
            <span className="text-[11px] text-red-400 block mb-1">{t.priorityHigh}</span>
            <span className="font-mono font-bold text-white text-base">
              {formatNum(highCount)}
            </span>
          </div>
          <div className="p-3 rounded-xl bg-amber-950/20 border border-amber-500/30">
            <span className="text-[11px] text-amber-400 block mb-1">{t.priorityMedium}</span>
            <span className="font-mono font-bold text-white text-base">
              {formatNum(medCount)}
            </span>
          </div>
          <div className="p-3 rounded-xl bg-blue-950/20 border border-blue-500/30">
            <span className="text-[11px] text-blue-400 block mb-1">{t.priorityLow}</span>
            <span className="font-mono font-bold text-white text-base">
              {formatNum(lowCount)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
