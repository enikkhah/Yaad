import React, { useState } from 'react';
import { IdeaNote } from '../types';
import { AppLanguage } from '../utils/i18n';
import { 
  Lightbulb, 
  Trash2, 
  Play, 
  Video, 
  PenTool, 
  Cloud, 
  Check, 
  Calendar,
  Volume2,
  Tag,
  Briefcase,
  Heart,
  Image as ImageIcon,
  Loader2,
  Pencil
} from 'lucide-react';
import { formatJalaliFull } from '../utils/jalali';

interface IdeaCardProps {
  idea: IdeaNote;
  onDelete: (id: string) => void;
  onEdit?: (idea: IdeaNote) => void;
  onSyncToGoogle?: (idea: IdeaNote) => void;
  onViewImage?: (url: string) => void;
  language?: AppLanguage;
}

export const IdeaCard: React.FC<IdeaCardProps> = ({ idea, onDelete, onEdit, onSyncToGoogle, onViewImage, language = 'fa' }) => {
  const [drawingLoaded, setDrawingLoaded] = useState(false);

  const getCategoryBadge = () => {
    switch (idea.category) {
      case 'work':
        return (
          <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800">
            <Briefcase className="w-3 h-3" /> {language === 'en' ? 'Work' : 'کاری'}
          </span>
        );
      case 'family':
        return (
          <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-rose-950 text-rose-300 border border-rose-800">
            <Heart className="w-3 h-3" /> {language === 'en' ? 'Family' : 'خانواده'}
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800">
            <Tag className="w-3 h-3" /> {language === 'en' ? 'Personal/Other' : 'شخصی/سایر'}
          </span>
        );
    }
  };

  return (
    <div 
      className="p-4 rounded-2xl bg-stone-900/90 border border-stone-800 hover:border-teal-500/50 transition-all shadow-md flex flex-col justify-between space-y-3"
      dir={language === 'en' ? 'ltr' : 'rtl'}
    >
      {/* Header */}
      <div>
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            {getCategoryBadge()}
            {idea.googleSynced && (
              <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-sky-950 text-sky-300 border border-sky-800">
                <Cloud className="w-3 h-3" /> {language === 'en' ? 'Google Tasks' : 'گوگل Tasks'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {onEdit && (
              <button
                type="button"
                onClick={() => onEdit(idea)}
                className="p-1.5 rounded-lg text-stone-400 hover:text-amber-400 hover:bg-stone-800 transition-colors"
                title={language === 'en' ? 'Edit idea' : 'ویرایش ایده'}
              >
                <Pencil className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => onDelete(idea.id)}
              className="p-1.5 rounded-lg text-stone-500 hover:text-red-400 hover:bg-stone-800 transition-colors"
              title={language === 'en' ? 'Delete idea' : 'حذف ایده'}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        <h4 className="font-extrabold text-base text-stone-100 leading-snug">{idea.title}</h4>
        {idea.content && (
          <p className="text-xs sm:text-sm text-stone-300 mt-2 leading-relaxed whitespace-pre-wrap">
            {idea.content}
          </p>
        )}
      </div>

      {/* Media attachments */}
      <div className="space-y-2.5 pt-1">
        {/* Audio Memo */}
        {idea.audioRecordUrl && (
          <div className="p-2.5 rounded-xl bg-stone-950 border border-stone-800 flex flex-col gap-1.5">
            <span className="text-xs text-amber-400 font-bold flex items-center gap-1.5">
              <Volume2 className="w-3.5 h-3.5" /> {language === 'en' ? 'Audio Memo' : 'یادداشت صوتی'}
            </span>
            <audio controls src={idea.audioRecordUrl} preload="none" className="w-full h-9" />
          </div>
        )}

        {/* Video Memo */}
        {idea.videoRecordUrl && (
          <div className="rounded-xl overflow-hidden border border-stone-800 bg-stone-950">
            <span className="text-xs text-amber-400 font-bold px-2.5 py-1.5 flex items-center gap-1.5">
              <Video className="w-3.5 h-3.5" /> {language === 'en' ? 'Video Memo' : 'یادداشت ویدیویی'}
            </span>
            <video controls preload="metadata" src={idea.videoRecordUrl} className="w-full max-h-52 object-cover" />
          </div>
        )}

        {/* Drawing Sketch - Optimized Lazy Loaded */}
        {idea.drawingDataUrl && (
          <div 
            onClick={() => onViewImage && onViewImage(idea.drawingDataUrl!)}
            className="rounded-xl overflow-hidden border border-stone-800 bg-stone-950 p-1.5 relative group cursor-pointer"
          >
            <div className="flex items-center justify-between pb-1 px-1">
              <span className="text-xs text-amber-400 font-bold flex items-center gap-1.5">
                <PenTool className="w-3.5 h-3.5" /> {language === 'en' ? 'Pen Sketch' : 'طرح رسم‌شده با قلم'}
              </span>
              <span className="text-[10px] text-stone-400 opacity-0 group-hover:opacity-100 transition-opacity">
                {language === 'en' ? 'Enlarge' : 'بزرگنمایی'}
              </span>
            </div>

            <div className="relative min-h-[100px] flex items-center justify-center bg-stone-900/50 rounded-lg overflow-hidden">
              {!drawingLoaded && (
                <div className="absolute inset-0 flex items-center justify-center text-stone-500 gap-1.5 text-xs">
                  <Loader2 className="w-4 h-4 animate-spin text-teal-400" />
                  <span>{language === 'en' ? 'Loading image...' : 'درحال بارگذاری تصویر...'}</span>
                </div>
              )}
              <img 
                src={idea.drawingDataUrl} 
                alt={language === 'en' ? 'Sketch' : 'طرح دست‌نویس'} 
                loading="lazy"
                decoding="async"
                onLoad={() => setDrawingLoaded(true)}
                className={`w-full max-h-48 object-contain rounded-lg transition-opacity duration-300 ${
                  drawingLoaded ? 'opacity-100' : 'opacity-0'
                }`} 
              />
            </div>
          </div>
        )}
      </div>

      {/* Footer Timestamp */}
      <div className="pt-2 border-t border-stone-800/60 flex items-center justify-between text-xs text-stone-400">
        <span className="flex items-center gap-1.5">
          <Calendar className="w-3.5 h-3.5 text-stone-400" />
          {language === 'en' ? new Date(idea.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : formatJalaliFull(idea.createdAt)}
        </span>
      </div>
    </div>
  );
};
