import React, { useState } from 'react';
import { 
  Cake, 
  Plus, 
  Search, 
  X, 
  CalendarHeart,
  PartyPopper,
  Filter
} from 'lucide-react';
import { Occasion, OccasionType } from '../types';
import { OccasionCard } from './OccasionCard';
import { OCCASION_TYPES, calculateNextOccasionOccurrence } from '../utils/occasionUtils';
import { toPersianDigits } from '../utils/jalali';
import { AppLanguage } from '../utils/i18n';

interface OccasionsViewProps {
  occasions: Occasion[];
  onAddNew: () => void;
  onEdit: (occasion: Occasion) => void;
  onDelete: (id: string) => void;
  onCreateReminder: (occasion: Occasion) => void;
  language?: AppLanguage;
}

export const OccasionsView: React.FC<OccasionsViewProps> = ({
  occasions,
  onAddNew,
  onEdit,
  onDelete,
  onCreateReminder,
  language = 'fa',
}) => {
  const isEn = language === 'en';
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<OccasionType | 'all'>('all');

  // Sort occasions by nearest days remaining
  const sortedOccasions = [...occasions].sort((a, b) => {
    const nextA = calculateNextOccasionOccurrence(a).daysRemaining;
    const nextB = calculateNextOccasionOccurrence(b).daysRemaining;
    return nextA - nextB;
  });

  const filteredOccasions = sortedOccasions.filter((occ) => {
    if (selectedTypeFilter !== 'all' && occ.type !== selectedTypeFilter) {
      return false;
    }
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      occ.title.toLowerCase().includes(q) ||
      (occ.personName && occ.personName.toLowerCase().includes(q)) ||
      (occ.customNote && occ.customNote.toLowerCase().includes(q))
    );
  });

  const todayCount = occasions.filter((o) => calculateNextOccasionOccurrence(o).isToday).length;

  return (
    <section className="space-y-4 animate-in fade-in" dir={isEn ? 'ltr' : 'rtl'}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-stone-800/80">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-pink-500/20 to-rose-500/20 border border-pink-500/40 text-pink-400 flex items-center justify-center shrink-0">
            <Cake className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-base sm:text-lg text-white flex items-center gap-2">
              <span>{isEn ? 'Occasions & Milestones' : 'مناسبت‌ها و تاریخ‌های مهم'}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-pink-500/15 text-pink-300 border border-pink-500/30 font-mono">
                {isEn ? occasions.length : toPersianDigits(occasions.length)}
              </span>
              {todayCount > 0 && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 font-bold flex items-center gap-1 animate-pulse">
                  <PartyPopper className="w-3 h-3" />
                  {isEn ? `${todayCount} Today!` : `${toPersianDigits(todayCount)} مورد امروز!`}
                </span>
              )}
            </h3>
            <p className="text-[11px] text-stone-400">
              {isEn 
                ? 'Birthdays, anniversaries, memorial days & family milestones' 
                : 'تولد، سالگرد ازدواج، آشنایی، یادبود و مناسبت‌های سالانه'}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onAddNew}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-400 hover:to-rose-400 !text-white font-bold text-xs shadow-md shadow-pink-500/20 transition-all justify-center cursor-pointer active:scale-95 self-stretch sm:self-auto"
        >
          <Plus className="w-4 h-4 text-white stroke-[3]" />
          <span className="text-white font-black">
            {isEn ? 'Add New Occasion' : 'ثبت مناسبت جدید'}
          </span>
        </button>
      </div>

      {/* Search & Category Filter */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-stone-400 absolute start-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={isEn ? 'Search occasions by title, name or notes...' : 'جست‌وجوی مناسبت بر اساس عنوان، نام شخص یا یادداشت...'}
            className="w-full ps-9 pe-3 py-2 rounded-xl bg-stone-900 border border-stone-800 text-white placeholder-stone-500 text-xs focus:outline-none focus:border-pink-500/60"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute end-2.5 top-1/2 -translate-y-1/2 p-1 text-stone-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filter Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          <button
            type="button"
            onClick={() => setSelectedTypeFilter('all')}
            className={`px-2.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
              selectedTypeFilter === 'all'
                ? 'bg-pink-500 text-stone-950 font-black'
                : 'bg-stone-900 text-stone-400 hover:text-white border border-stone-800'
            }`}
          >
            {isEn ? 'All' : 'همه'}
          </button>
          {OCCASION_TYPES.map((t) => (
            <button
              key={t.type}
              type="button"
              onClick={() => setSelectedTypeFilter(t.type)}
              className={`px-2.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
                selectedTypeFilter === t.type
                  ? 'bg-pink-500 text-stone-950 font-black'
                  : 'bg-stone-900 text-stone-400 hover:text-white border border-stone-800'
              }`}
            >
              {isEn ? t.labelEn : t.labelFa}
            </button>
          ))}
        </div>
      </div>

      {/* Cards Grid */}
      {filteredOccasions.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
          {filteredOccasions.map((occ) => (
            <OccasionCard
              key={occ.id}
              occasion={occ}
              onEdit={onEdit}
              onDelete={onDelete}
              onCreateReminder={onCreateReminder}
              language={language}
            />
          ))}
        </div>
      ) : (
        <div className="py-12 text-center rounded-2xl border border-dashed border-stone-800 bg-stone-900/40 space-y-3">
          <div className="w-12 h-12 rounded-full bg-pink-500/10 text-pink-400 border border-pink-500/20 flex items-center justify-center mx-auto">
            <CalendarHeart className="w-6 h-6" />
          </div>
          <h4 className="font-bold text-sm text-white">
            {occasions.length === 0 
              ? (isEn ? 'No occasions registered yet' : 'هنوز مناسبتی ثبت نشده است') 
              : (isEn ? 'No matching occasions found' : 'مناسبتی با این مشخصات یافت نشد')}
          </h4>
          <p className="text-xs text-stone-400 max-w-sm mx-auto leading-relaxed">
            {isEn 
              ? 'Keep track of birthdays, wedding anniversaries and special dates with automatic countdown and alarm reminders.'
              : 'تاریخ تولد، سالگرد ازدواج، آشنایی و روزهای مهم را ثبت کنید تا با شمارش معکوس و آلارم هوشمند هرگز فراموش نشوند.'}
          </p>
          <button
            type="button"
            onClick={onAddNew}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-400 hover:to-rose-400 !text-white font-black text-xs shadow-md cursor-pointer active:scale-95 flex items-center gap-1.5 mx-auto"
          >
            <Plus className="w-4 h-4 text-white stroke-[3]" />
            <span className="text-white font-black">
              {isEn ? 'Add First Occasion' : 'ثبت اولین مناسبت'}
            </span>
          </button>
        </div>
      )}
    </section>
  );
};
