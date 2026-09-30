import { AppTheme } from '../types';

export interface ThemeStyles {
  // Main background and text
  bg: string;
  text: string;
  selection: string;
  // Subtle card / container styling
  cardBg: string;
  cardBorder: string;
  cardHoverBorder: string;
  cardShadow: string;
  // Button styling (soft turquoise default, adapted per theme)
  btnSecondary: string;
  btnPrimary: string;
  // Header bar
  headerBg: string;
  headerBorder: string;
  // Accent color tokens
  accentText: string;
  accentBorder: string;
  accentBadge: string;
  // Sliders and highlights
  accentRing: string;
}

export const getThemeStyles = (theme: AppTheme = 'dark-gold'): ThemeStyles => {
  switch (theme) {
    case 'dark-slate':
      return {
        bg: 'bg-slate-950 text-slate-100',
        text: 'text-slate-100',
        selection: 'selection:bg-teal-500 selection:text-slate-950',
        cardBg: 'bg-slate-900/85',
        cardBorder: 'border-teal-500/25',
        cardHoverBorder: 'hover:border-teal-400/50',
        cardShadow: 'shadow-lg shadow-teal-950/30',
        btnSecondary: 'bg-slate-800/90 hover:bg-slate-800 text-teal-200 border border-teal-500/30 hover:border-teal-400/60 shadow-sm shadow-teal-950/20 active:scale-95 transition-all',
        btnPrimary: 'bg-teal-600 hover:bg-teal-500 text-white font-bold shadow-md shadow-teal-600/30 active:scale-95 transition-all',
        headerBg: 'bg-slate-900/90',
        headerBorder: 'border-teal-500/20',
        accentText: 'text-teal-400',
        accentBorder: 'border-teal-500/40',
        accentBadge: 'bg-teal-500/15 text-teal-300 border border-teal-500/30',
        accentRing: 'ring-teal-500/40',
      };

    case 'light-clean':
      return {
        bg: 'bg-stone-50 text-stone-900',
        text: 'text-stone-900',
        selection: 'selection:bg-teal-500 selection:text-white',
        cardBg: 'bg-white/95',
        cardBorder: 'border-teal-600/20',
        cardHoverBorder: 'hover:border-teal-600/40',
        cardShadow: 'shadow-md shadow-teal-950/5',
        btnSecondary: 'bg-stone-100 hover:bg-stone-200/80 text-teal-800 border border-teal-600/25 hover:border-teal-600/40 shadow-sm active:scale-95 transition-all',
        btnPrimary: 'bg-teal-600 hover:bg-teal-700 text-white font-bold shadow-md shadow-teal-700/20 active:scale-95 transition-all',
        headerBg: 'bg-white/90',
        headerBorder: 'border-teal-600/20',
        accentText: 'text-teal-700',
        accentBorder: 'border-teal-600/40',
        accentBadge: 'bg-teal-50 text-teal-800 border border-teal-600/30',
        accentRing: 'ring-teal-600/40',
      };

    case 'sketch-contrast':
      return {
        bg: 'bg-black text-white font-mono',
        text: 'text-white',
        selection: 'selection:bg-teal-400 selection:text-white',
        cardBg: 'bg-zinc-950/90',
        cardBorder: 'border-teal-500/40 border-dashed',
        cardHoverBorder: 'hover:border-teal-400',
        cardShadow: 'shadow-2xl shadow-teal-950/50',
        btnSecondary: 'bg-zinc-900 hover:bg-zinc-800 text-teal-300 border border-dashed border-teal-500/50 hover:border-teal-300 active:scale-95 transition-all',
        btnPrimary: 'bg-teal-600 hover:bg-teal-500 text-white font-black border border-teal-400 active:scale-95 transition-all',
        headerBg: 'bg-black/95',
        headerBorder: 'border-teal-500/30 border-dashed',
        accentText: 'text-teal-400',
        accentBorder: 'border-teal-400/50',
        accentBadge: 'bg-zinc-900 text-teal-300 border border-teal-400/40',
        accentRing: 'ring-teal-400',
      };

    case 'dark-gold':
    default:
      // Dark Charcoal base with elegant mild turquoise (فیروزه‌ای خفیف) buttons and frames
      return {
        bg: 'bg-stone-950 text-stone-100',
        text: 'text-stone-100',
        selection: 'selection:bg-teal-500 selection:text-white',
        cardBg: 'bg-stone-900/85',
        cardBorder: 'border-teal-500/20',
        cardHoverBorder: 'hover:border-teal-400/40',
        cardShadow: 'shadow-xl shadow-black/40',
        btnSecondary: 'bg-stone-900/90 hover:bg-stone-800/90 text-teal-200 border border-teal-500/25 hover:border-teal-400/50 shadow-sm shadow-teal-950/20 active:scale-95 transition-all',
        btnPrimary: 'bg-teal-600 hover:bg-teal-500 text-white font-black shadow-md shadow-teal-600/30 active:scale-95 transition-all',
        headerBg: 'bg-stone-900/90',
        headerBorder: 'border-teal-500/20',
        accentText: 'text-teal-400',
        accentBorder: 'border-teal-500/30',
        accentBadge: 'bg-teal-500/10 text-teal-300 border border-teal-500/25',
        accentRing: 'ring-teal-500/30',
      };
  }
};
