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
import { toPersianDigits, matchesOccasionSearch } from '../utils/jalali';
import { AppLanguage } from '../utils/i18n';

interface OccasionsViewProps {
  occasions: Occasion[];
  onAddNew: () => void;
  onEdit: (occasion: Occasion) => void;
  onDelete: (id: string) => void;
  onCreateReminder: (occasion: Occasion) => void;
  language?: AppLanguage;
  globalSearchQuery?: string;
  onTriggerNotFoundPopup?: (query: string) => void;
}

export const OccasionsView: React.FC<OccasionsViewProps> = ({
  occasions,
  onAddNew,
  onEdit,
  onDelete,
  onCreateReminder,
  language = 'fa',
  globalSearchQuery = '',
  onTriggerNotFoundPopup,
}) => {
  const isEn = language === 'en';
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<OccasionType | 'all'>('all');

  const effectiveQuery = searchQuery.trim() || globalSearchQuery.trim();

  // Filter out deleted occasions (سطل بازیافت)
  const nonDeletedOccasions = occasions.filter((o) => !o.deletedAt);

  // Sort occasions by nearest days remaining
  const sortedOccasions = [...nonDeletedOccasions].sort((a, b) => {
    const nextA = calculateNextOccasionOccurrence(a).daysRemaining;
    const nextB = calculateNextOccasionOccurrence(b).daysRemaining;
    return nextA - nextB;
  });

  const filteredOccasions = sortedOccasions.filter((occ) => {
    if (selectedTypeFilter !== 'all' && occ.type !== selectedTypeFilter) {
      return false;
    }
    if (!effectiveQuery) return true;
    return matchesOccasionSearch(occ, effectiveQuery);
  });

  const todayCount = nonDeletedOccasions.filter((o) => calculateNextOccasionOccurrence(o).isToday).length;

  return (
    <section className="space-y-4 animate-in fade-in" dir={isEn ? 'ltr' : 'rtl'}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-stone-800/80">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 flex items-center justify-center shrink-0">
            <Cake className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-base sm:text-lg text-white flex items-center gap-2">
              <span>{isEn ? 'Occasions & Milestones' : 'مناسبت‌ها و تاریخ‌های مهم'}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-stone-800 text-stone-300 border border-stone-700 font-mono">
                {isEn ? occasions.length : toPersianDigits(occasions.length)}
              </span>
              {todayCount > 0 && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 font-bold flex items-center gap-1">
                  <PartyPopper className="w-3 h-3" />
                  {isEn ? `${todayCount} Today!` : `${toPersianDigits(todayCount)} مورد امروز!`}
                </span>
              )}
            </h3>
          </div>
        </div>

        <button
          type="button"
          onClick={onAddNew}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-black text-xs shadow-md shadow-indigo-500/20 transition-all justify-center cursor-pointer active:scale-95 self-stretch sm:self-auto"
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
        <div
          dir={isEn ? 'ltr' : 'rtl'}
          className="flex-1 flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-stone-900 border border-stone-800 focus-within:border-indigo-500 transition-colors"
        >
          <Search className="w-4 h-4 text-indigo-400 shrink-0 stroke-[2.5]" />
          <input
            type="text"
            dir={isEn ? 'ltr' : 'rtl'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={isEn ? 'Search occasions by title, name, date or notes...' : 'جست‌وجوی مناسبت بر اساس عنوان، نام شخص، تاریخ یا یادداشت...'}
            className="w-full bg-transparent border-0 text-white placeholder-stone-400 text-xs focus:outline-none min-w-0"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="p-1 text-stone-400 hover:text-white shrink-0 cursor-pointer"
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
                ? 'bg-indigo-500 text-white font-black'
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
                  ? 'bg-indigo-500 text-white font-black'
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
        <div className="py-12 px-4 text-center rounded-3xl border border-dashed border-stone-800/80 bg-stone-900/30 space-y-3.5 transition-all duration-200">
          <div className="w-14 h-14 rounded-2xl bg-pink-500/10 text-pink-400 border border-pink-500/20 flex items-center justify-center mx-auto shadow-inner">
            <CalendarHeart className="w-7 h-7" />
          </div>
          <div className="space-y-1">
            <h4 className="font-bold text-base text-white">
              {occasions.length === 0 
                ? (isEn ? 'No occasions registered yet' : 'هنوز مناسبتی ثبت نکرده‌اید!') 
                : (isEn ? 'No matching occasions found' : 'مناسبتی با این مشخصات یافت نشد')}
            </h4>
            <p className="text-xs text-stone-400 max-w-sm mx-auto leading-relaxed">
              {isEn 
                ? 'Keep track of birthdays, wedding anniversaries and special dates with automatic countdown and alarm reminders.'
                : 'تاریخ تولدها، سالگرد ازدواج و روزهای مهم را ثبت کنید تا با یادآور و آلارم هوشمند هرگز فراموش نشوند.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onAddNew}
            className="min-h-[48px] px-6 py-3 rounded-2xl bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-400 hover:to-rose-400 !text-white font-black text-xs sm:text-sm shadow-lg shadow-pink-500/25 cursor-pointer active:scale-95 flex items-center justify-center gap-2 mx-auto transition-all duration-200"
          >
            <Plus className="w-4 h-4 text-white stroke-[3]" />
            <span>{isEn ? 'Add First Occasion' : 'ثبت اولین مناسبت'}</span>
          </button>
        </div>
      )}
    </section>
  );
};
