import React, { useState } from 'react';
import { 
  Cake, 
  Plus, 
  Search, 
  X, 
  CalendarHeart,
  PartyPopper,
  HeartHandshake,
  Sparkles,
  Flame,
  Users,
  Briefcase
} from 'lucide-react';
import { Occasion, OccasionType } from '../types';
import { OccasionCard } from './OccasionCard';
import { OCCASION_TYPES, getOccasionTypeMeta, calculateNextOccasionOccurrence } from '../utils/occasionUtils';
import { toPersianDigits, matchesOccasionSearch } from '../utils/jalali';
import { AppLanguage } from '../utils/i18n';

interface OccasionsViewProps {
  occasions: Occasion[];
  onAddNew: (defaultType?: OccasionType) => void;
  onEdit: (occasion: Occasion) => void;
  onDelete: (id: string) => void;
  onCreateReminder: (occasion: Occasion) => void;
  language?: AppLanguage;
  globalSearchQuery?: string;
  selectedTypeFilter?: OccasionType | 'all';
  onSelectTypeFilter?: (type: OccasionType | 'all') => void;
}

export const OccasionsView: React.FC<OccasionsViewProps> = ({
  occasions,
  onAddNew,
  onEdit,
  onDelete,
  onCreateReminder,
  language = 'fa',
  globalSearchQuery = '',
  selectedTypeFilter: controlledTypeFilter,
  onSelectTypeFilter,
}) => {
  const isEn = language === 'en';
  const [searchQuery, setSearchQuery] = useState('');
  const [internalTypeFilter, setInternalTypeFilter] = useState<OccasionType | 'all'>('all');

  const selectedTypeFilter = controlledTypeFilter !== undefined ? controlledTypeFilter : internalTypeFilter;
  const setSelectedTypeFilter = (nextType: OccasionType | 'all') => {
    if (onSelectTypeFilter) {
      onSelectTypeFilter(nextType);
    } else {
      setInternalTypeFilter(nextType);
    }
  };

  const activeMeta = selectedTypeFilter !== 'all' ? getOccasionTypeMeta(selectedTypeFilter) : null;

  const renderTypeIcon = (iconName: string, className = 'w-4 h-4') => {
    switch (iconName) {
      case 'Cake':
        return <Cake className={className} />;
      case 'HeartHandshake':
        return <HeartHandshake className={className} />;
      case 'Sparkles':
        return <Sparkles className={className} />;
      case 'Flame':
        return <Flame className={className} />;
      case 'Users':
        return <Users className={className} />;
      case 'Briefcase':
        return <Briefcase className={className} />;
      case 'CalendarHeart':
      default:
        return <CalendarHeart className={className} />;
    }
  };

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

  const todayCount = filteredOccasions.filter((o) => calculateNextOccasionOccurrence(o).isToday).length;

  const handleAddClick = () => {
    onAddNew(selectedTypeFilter !== 'all' ? selectedTypeFilter : undefined);
  };

  const addButtonLabel = activeMeta
    ? (isEn ? `Add ${activeMeta.labelEn}` : `ثبت ${activeMeta.labelFa}`)
    : (isEn ? 'Add New Occasion' : 'ثبت مناسبت جدید');

  return (
    <section className="space-y-4 animate-in fade-in" dir={isEn ? 'ltr' : 'rtl'}>
      {/* Header with Dynamic Mood & Color per Selected Occasion Type */}
      <div
        className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 sm:p-4 rounded-2xl border transition-all duration-300 ${
          activeMeta
            ? `bg-gradient-to-br ${activeMeta.headerBgClass}`
            : 'bg-stone-900/60 border-stone-800/80'
        }`}
      >
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 transition-colors ${
              activeMeta
                ? `${activeMeta.badgeBg} ${activeMeta.borderCol} ${activeMeta.accentTextClass}`
                : 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400'
            }`}
          >
            {activeMeta ? renderTypeIcon(activeMeta.iconName, 'w-5 h-5') : <Cake className="w-5 h-5" />}
          </div>
          <div className="space-y-0.5">
            <h3 className="font-bold text-base sm:text-lg text-white flex items-center gap-2 flex-wrap">
              <span>
                {activeMeta
                  ? (isEn ? activeMeta.moodTitleEn : activeMeta.moodTitleFa)
                  : (isEn ? 'Occasions & Milestones' : 'مناسبت‌ها و تاریخ‌های مهم')}
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-stone-800 text-stone-300 border border-stone-700 font-mono">
                {isEn ? filteredOccasions.length : toPersianDigits(filteredOccasions.length)}
              </span>
              {todayCount > 0 && (
                <span
                  className={`text-xs px-2 py-0.5 rounded-full border font-bold flex items-center gap-1 ${
                    activeMeta
                      ? `${activeMeta.badgeBg} ${activeMeta.badgeText} ${activeMeta.borderCol}`
                      : 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                  }`}
                >
                  {selectedTypeFilter === 'memorial' ? <Flame className="w-3 h-3" /> : <PartyPopper className="w-3 h-3" />}
                  {isEn ? `${todayCount} Today!` : `${toPersianDigits(todayCount)} مورد امروز!`}
                </span>
              )}
            </h3>
            <p className="text-[11px] text-stone-300/90 leading-relaxed">
              {activeMeta
                ? (isEn ? activeMeta.moodDescEn : activeMeta.moodDescFa)
                : (isEn
                    ? 'Select an occasion category below or view all upcoming birthdays, anniversaries, and memorials.'
                    : 'با کلیک روی هر یک از تب‌های زیر، حال و هوا و امکانات متناسب با همان نوع مناسبت تنظیم می‌شود.')}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleAddClick}
          className="btn-brand-submit flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-xs transition-all justify-center cursor-pointer active:scale-95 self-stretch sm:self-auto shrink-0"
        >
          <Plus className="w-4 h-4 stroke-[3]" />
          <span className="font-black">{addButtonLabel}</span>
        </button>
      </div>

      {/* Occasion Type Tabs (تب‌های نوع مناسبت با رنگ‌بندی و آیکون اختصاصی) */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1.5 pt-0.5 scrollbar-none">
        <button
          type="button"
          onClick={() => setSelectedTypeFilter('all')}
          className={`min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer flex items-center gap-1.5 border shrink-0 ${
            selectedTypeFilter === 'all'
              ? 'bg-indigo-500 border-indigo-400 text-white font-black shadow-md shadow-indigo-500/20'
              : 'bg-stone-900 text-stone-400 hover:text-white border-stone-800'
          }`}
        >
          <CalendarHeart className="w-3.5 h-3.5 shrink-0" />
          <span>{isEn ? 'All Occasions' : 'همه مناسبت‌ها'}</span>
          <span className="text-[10px] font-mono opacity-80">
            ({isEn ? nonDeletedOccasions.length : toPersianDigits(nonDeletedOccasions.length)})
          </span>
        </button>
        {OCCASION_TYPES.map((t) => {
          const isSelected = selectedTypeFilter === t.type;
          const count = nonDeletedOccasions.filter((o) => o.type === t.type).length;
          return (
            <button
              key={t.type}
              type="button"
              onClick={() => setSelectedTypeFilter(t.type)}
              className={`min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer flex items-center gap-1.5 border shrink-0 ${
                isSelected
                  ? `${t.activeTabClass} font-black`
                  : 'bg-stone-900 text-stone-300 hover:text-white border-stone-800 hover:border-stone-700'
              }`}
            >
              <span className={isSelected ? 'text-current' : t.accentTextClass}>
                {renderTypeIcon(t.iconName, 'w-3.5 h-3.5')}
              </span>
              <span>{isEn ? t.labelEn : t.labelFa}</span>
              {count > 0 && (
                <span className="text-[10px] font-mono opacity-85">
                  ({isEn ? count : toPersianDigits(count)})
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Search Bar */}
      <div
        dir={isEn ? 'ltr' : 'rtl'}
        className="flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-stone-900 border border-stone-800 focus-within:border-indigo-500 transition-colors"
      >
        <Search className={`w-4 h-4 shrink-0 stroke-[2.5] ${activeMeta ? activeMeta.accentTextClass : 'text-indigo-400'}`} />
        <input
          type="text"
          dir={isEn ? 'ltr' : 'rtl'}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={
            activeMeta
              ? (isEn
                  ? `Search in ${activeMeta.labelEn}...`
                  : `جست‌وجو در بخش «${activeMeta.labelFa}» بر اساس عنوان، نام یا تاریخ...`)
              : (isEn
                  ? 'Search occasions by title, name, date or notes...'
                  : 'جست‌وجوی مناسبت بر اساس عنوان، نام شخص، تاریخ یا یادداشت...')
          }
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
        <div
          className={`py-12 px-4 text-center rounded-3xl border border-dashed space-y-3.5 transition-all duration-300 ${
            activeMeta
              ? `bg-gradient-to-br ${activeMeta.headerBgClass}`
              : 'border-stone-800/80 bg-stone-900/30'
          }`}
        >
          <div
            className={`w-14 h-14 rounded-2xl border flex items-center justify-center mx-auto shadow-inner ${
              activeMeta
                ? `${activeMeta.badgeBg} ${activeMeta.borderCol} ${activeMeta.accentTextClass}`
                : 'bg-pink-500/10 text-pink-400 border-pink-500/20'
            }`}
          >
            {activeMeta ? renderTypeIcon(activeMeta.iconName, 'w-7 h-7') : <CalendarHeart className="w-7 h-7" />}
          </div>
          <div className="space-y-1">
            <h4 className="font-bold text-base text-white">
              {activeMeta
                ? (isEn
                    ? `No "${activeMeta.labelEn}" registered yet`
                    : `هنوز موردی در بخش «${activeMeta.labelFa}» ثبت نشده است`)
                : nonDeletedOccasions.length === 0
                ? (isEn ? 'No occasions registered yet' : 'هنوز مناسبتی ثبت نکرده‌اید!')
                : (isEn ? 'No matching occasions found' : 'مناسبتی با این مشخصات یافت نشد')}
            </h4>
            <p className="text-xs text-stone-300/90 max-w-md mx-auto leading-relaxed">
              {activeMeta
                ? (isEn ? activeMeta.moodDescEn : activeMeta.moodDescFa)
                : (isEn
                    ? 'Keep track of birthdays, wedding anniversaries, memorials, and special dates with automatic countdown and alarm reminders.'
                    : 'تاریخ تولدها، سالگرد ازدواج، سالگرد درگذشت عزیزان و روزهای مهم را ثبت کنید تا با یادآور هوشمند هرگز فراموش نشوند.')}
            </p>
          </div>
          <button
            type="button"
            onClick={handleAddClick}
            className="btn-brand-submit min-h-[48px] px-6 py-3 rounded-2xl font-black text-xs sm:text-sm cursor-pointer active:scale-95 flex items-center justify-center gap-2 mx-auto transition-all duration-200"
          >
            <Plus className="w-4 h-4 stroke-[3]" />
            <span>{addButtonLabel}</span>
          </button>
        </div>
      )}
    </section>
  );
};

