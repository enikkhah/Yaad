import React, { useState } from 'react';
import { 
  MapPin, 
  ExternalLink, 
  Navigation, 
  Trash2, 
  Copy, 
  Check, 
  Image as ImageIcon, 
  Share2, 
  Calendar, 
  Loader2,
  Pencil
} from 'lucide-react';
import { SavedLocation } from '../types';
import { formatJalaliFull, toPersianDigits } from '../utils/jalali';
import { AppLanguage } from '../utils/i18n';

interface SavedLocationCardProps {
  location: SavedLocation;
  onDelete: (id: string) => void;
  onEdit?: (location: SavedLocation) => void;
  onViewPhoto?: (url: string) => void;
  language?: AppLanguage;
}

export const SavedLocationCard: React.FC<SavedLocationCardProps> = ({
  location,
  onDelete,
  onEdit,
  onViewPhoto,
  language = 'fa',
}) => {
  const [copied, setCopied] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const formattedDate = language === 'en' 
    ? new Date(location.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : formatJalaliFull(location.createdAt);

  const copyToClipboard = () => {
    const textToCopy = `${location.title}\nCoordinates: ${location.latitude}, ${location.longitude}\nGoogle Maps: ${location.googleMapsUrl}`;
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const googleDirectionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${location.latitude},${location.longitude}`;

  return (
    <div 
      className="bg-stone-900 border border-stone-800 hover:border-emerald-500/40 rounded-2xl p-4 sm:p-5 shadow-md space-y-3 transition-all group flex flex-col justify-between" 
      dir={language === 'en' ? 'ltr' : 'rtl'}
    >
      <div className="space-y-3">
        {/* Header: Title, Date, Actions */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center flex-shrink-0 mt-0.5">
              <MapPin className="w-4 h-4" />
            </div>
            <div>
              <h4 className="font-bold text-white text-sm sm:text-base leading-snug line-clamp-2">
                {location.title}
              </h4>
              <div className="flex items-center gap-1.5 text-[11px] text-stone-400 mt-0.5">
                <Calendar className="w-3 h-3 text-stone-500" />
                <span>{formattedDate}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {onEdit && (
              <button
                type="button"
                onClick={() => onEdit(location)}
                className="p-2 rounded-xl text-stone-400 hover:text-amber-400 hover:bg-stone-800 transition-colors cursor-pointer"
                title={language === 'en' ? 'Edit place' : 'ویرایش مکان'}
              >
                <Pencil className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => onDelete(location.id)}
              className="p-2 rounded-xl text-stone-400 hover:text-rose-400 hover:bg-stone-800 transition-colors cursor-pointer"
              title={language === 'en' ? 'Delete place' : 'حذف مکان'}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Photo Thumbnail if present */}
        {location.photoUrl && (
          <div 
            onClick={() => onViewPhoto && onViewPhoto(location.photoUrl!)}
            className="relative rounded-xl overflow-hidden aspect-video bg-stone-950 border border-stone-800/80 cursor-pointer group/img"
          >
            {!imgLoaded && (
              <div className="absolute inset-0 flex items-center justify-center text-stone-500 gap-1 text-xs">
                <Loader2 className="w-4 h-4 animate-spin text-teal-400" />
                <span>{language === 'en' ? 'Loading image...' : 'بارگذاری تصویر...'}</span>
              </div>
            )}
            <img
              src={location.photoUrl}
              alt={location.title}
              loading="lazy"
              decoding="async"
              onLoad={() => setImgLoaded(true)}
              className={`w-full h-full object-cover group-hover/img:scale-105 transition-transform duration-300 ${
                imgLoaded ? 'opacity-100' : 'opacity-0'
              }`}
            />
            <div className="absolute inset-0 bg-black/35 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-bold gap-1 backdrop-blur-[1px]">
              <ImageIcon className="w-4 h-4" />
              <span>{language === 'en' ? 'Enlarge' : 'مشاهده بزرگنمایی'}</span>
            </div>
          </div>
        )}

        {/* Description Note if present */}
        {location.description && (
          <p className="text-xs text-stone-200 whitespace-pre-wrap leading-relaxed bg-stone-950/70 p-2.5 rounded-xl border border-stone-800/60 font-sans">
            {location.description}
          </p>
        )}

        {/* Address & Coordinates */}
        <div className="space-y-1.5 text-[11px] bg-stone-950/40 p-2 rounded-xl border border-stone-800/40">
          <div className="flex items-center justify-between text-stone-400">
            <span className="font-mono text-teal-400 font-semibold">
              {language === 'en' 
                ? `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`
                : `${toPersianDigits(location.latitude.toFixed(5))}, ${toPersianDigits(location.longitude.toFixed(5))}`}
            </span>
            {location.accuracy && (
              <span className="text-[10px] text-stone-500">
                {language === 'en' 
                  ? `Accuracy: ±${Math.round(location.accuracy)}m`
                  : `دقت GPS: ±${toPersianDigits(Math.round(location.accuracy))} متر`}
              </span>
            )}
          </div>
          {location.address && (
            <p className="text-stone-300 text-[11px] leading-relaxed line-clamp-2">
              {location.address}
            </p>
          )}
        </div>
      </div>

      {/* Footer Quick Action Buttons */}
      <div className="pt-2 border-t border-stone-800/80 flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1.5">
          {/* Directions Button */}
          <a
            href={googleDirectionsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-teal-500/20 hover:bg-teal-600 text-teal-300 hover:text-white border border-teal-500/30 text-xs font-bold transition-all active:scale-95"
            title={language === 'en' ? 'Open directions in Google Maps' : 'مسیریابی در نقشه گوگل'}
          >
            <Navigation className="w-3.5 h-3.5" />
            <span>{language === 'en' ? 'Directions' : 'مسیریابی'}</span>
          </a>

          {/* Copy Coordinates */}
          <button
            type="button"
            onClick={copyToClipboard}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-300 hover:text-white border border-stone-700 text-xs font-medium transition-colors active:scale-95"
            title={language === 'en' ? 'Copy coordinates and link' : 'کپی لینک و مشخصات'}
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400">{language === 'en' ? 'Copied' : 'کپی شد'}</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>{language === 'en' ? 'Copy' : 'کپی'}</span>
              </>
            )}
          </button>
        </div>

        {/* View on Google Maps Link */}
        <a
          href={location.googleMapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-[11px] text-stone-400 hover:text-teal-300 transition-colors"
          title={language === 'en' ? 'View on Google Maps' : 'مشاهده در گوگل‌مپ'}
        >
          <span>{language === 'en' ? 'View Map' : 'مشاهده'}</span>
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </div>
  );
};
