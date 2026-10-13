import React, { useState } from 'react';
import { 
  MapPin, 
  ExternalLink, 
  Navigation, 
  Trash2, 
  Copy, 
  Check, 
  Image as ImageIcon, 
  Calendar, 
  Loader2,
  Pencil,
  BellRing,
  Lightbulb,
  Radio,
  Pause,
  Play,
  Volume2,
  Sliders,
  Crosshair,
  Bell
} from 'lucide-react';
import { SavedLocation } from '../types';
import { formatJalaliFull, toPersianDigits } from '../utils/jalali';
import { AppLanguage } from '../utils/i18n';
import { calculateHaversineDistance } from '../utils/geofenceManager';

interface SavedLocationCardProps {
  location: SavedLocation;
  onDelete: (id: string) => void;
  onEdit?: (location: SavedLocation) => void;
  onCreateReminderFromLocation?: (location: SavedLocation) => void;
  onCreateIdeaFromLocation?: (location: SavedLocation) => void;
  onViewPhoto?: (url: string) => void;
  language?: AppLanguage;
  userPosition?: { latitude: number; longitude: number } | null;
  onToggleCheckpoint?: (locationId: string) => void;
  onSimulateCheckpointTrigger?: (location: SavedLocation, type: 'enter' | 'exit') => void;
  isGeofenceServiceActive?: boolean;
}

export const SavedLocationCard: React.FC<SavedLocationCardProps> = ({
  location,
  onDelete,
  onEdit,
  onCreateReminderFromLocation,
  onCreateIdeaFromLocation,
  onViewPhoto,
  language = 'fa',
  userPosition = null,
  onToggleCheckpoint,
  onSimulateCheckpointTrigger,
  isGeofenceServiceActive = true,
}) => {
  const isEn = language === 'en';
  const [copied, setCopied] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const formattedDate = isEn 
    ? new Date(location.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : formatJalaliFull(location.createdAt);

  const copyToClipboard = () => {
    const textToCopy = `${location.title}\nCoordinates: ${location.latitude}, ${location.longitude}\nGoogle Maps: ${location.googleMapsUrl}`;
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const googleDirectionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${location.latitude},${location.longitude}`;

  // Geofence Checkpoint calculations
  const hasGeofence = !!location.geofence;
  const isCheckpointActive = location.geofence?.enabled === true;
  const radius = location.geofence?.radius || 100;
  const triggerOn = location.geofence?.triggerOn || 'both';

  const distance = userPosition
    ? calculateHaversineDistance(
        userPosition.latitude,
        userPosition.longitude,
        location.latitude,
        location.longitude
      )
    : null;

  const isInside = distance !== null ? distance <= radius : null;

  const triggerOnText = triggerOn === 'enter'
    ? (isEn ? 'On Arrival' : 'ورود به محدوده')
    : triggerOn === 'exit'
    ? (isEn ? 'On Departure' : 'خروج از محدوده')
    : (isEn ? 'Arrival & Departure' : 'ورود و خروج (هر دو)');

  return (
    <div 
      className={`bg-stone-900 border rounded-2xl p-4 sm:p-5 shadow-md space-y-3 transition-all group flex flex-col justify-between ${
        isCheckpointActive
          ? 'border-emerald-500/40 hover:border-emerald-400/80 shadow-emerald-500/5 ring-1 ring-emerald-500/20'
          : 'border-stone-800 hover:border-stone-700'
      }`} 
      dir={isEn ? 'ltr' : 'rtl'}
    >
      <div className="space-y-3">
        {/* Header: Title, Date, Actions */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2.5">
            <div className={`w-8 h-8 rounded-xl border flex items-center justify-center flex-shrink-0 mt-0.5 ${
              isCheckpointActive
                ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400'
                : 'bg-stone-800 border-stone-700 text-stone-400'
            }`}>
              <MapPin className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <h4 className="font-bold text-white text-sm sm:text-base leading-snug line-clamp-2">
                  {location.title}
                </h4>
                {isCheckpointActive && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/40 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>{isEn ? 'Geofence Active' : 'حصار مکانی فعال'}</span>
                  </span>
                )}
              </div>
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
                title={isEn ? 'Edit place' : 'ویرایش مکان'}
              >
                <Pencil className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => onDelete(location.id)}
              className="p-2 rounded-xl text-stone-400 hover:text-rose-400 hover:bg-stone-800 transition-colors cursor-pointer"
              title={isEn ? 'Delete place' : 'حذف مکان'}
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
                <span>{isEn ? 'Loading image...' : 'بارگذاری تصویر...'}</span>
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
              <span>{isEn ? 'Enlarge' : 'مشاهده بزرگنمایی'}</span>
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
              {isEn 
                ? `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`
                : `${toPersianDigits(location.latitude.toFixed(5))}, ${toPersianDigits(location.longitude.toFixed(5))}`}
            </span>
            {location.accuracy && (
              <span className="text-[10px] text-stone-500">
                {isEn 
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

        {/* GEOFENCE SUB-FEATURE BOX (زیرمجموعه حصار مکانی و اعلام ورود/خروج) */}
        {hasGeofence ? (
          <div className={`p-3 rounded-2xl border text-xs space-y-2 transition-all ${
            isCheckpointActive
              ? 'bg-emerald-950/30 border-emerald-500/40'
              : 'bg-stone-950/80 border-stone-800 text-stone-400'
          }`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Radio className={`w-3.5 h-3.5 ${isCheckpointActive ? 'text-emerald-400 animate-pulse' : 'text-stone-500'}`} />
                <span className="font-bold text-white text-[11px]">
                  {isCheckpointActive 
                    ? (isEn ? 'Location Fence (Geofence)' : 'حصار مکانی (Geofence)') 
                    : (isEn ? 'Geofence Paused' : 'حصار مکانی غیرفعال')}
                </span>
              </div>

              {/* Pause / Resume Button */}
              {onToggleCheckpoint && (
                <button
                  type="button"
                  onClick={() => onToggleCheckpoint(location.id)}
                  className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border transition-colors cursor-pointer flex items-center gap-1 ${
                    isCheckpointActive
                      ? 'bg-stone-800 hover:bg-stone-700 text-stone-300 border-stone-700'
                      : 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border-emerald-500/40 font-bold'
                  }`}
                  title={isCheckpointActive ? (isEn ? 'Pause Geofence' : 'توقف موقت حصار مکانی') : (isEn ? 'Activate Geofence' : 'فعال‌سازی حصار مکانی')}
                >
                  {isCheckpointActive ? (
                    <>
                      <Pause className="w-2.5 h-2.5 text-stone-400" />
                      <span>{isEn ? 'Pause' : 'توقف'}</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-2.5 h-2.5 text-emerald-400" />
                      <span>{isEn ? 'Activate' : 'فعال‌سازی'}</span>
                    </>
                  )}
                </button>
              )}
            </div>

            {/* Checkpoint Details: Radius and Trigger condition */}
            <div className="grid grid-cols-2 gap-1.5 text-[11px]">
              <div className="bg-stone-900/80 p-1.5 rounded-lg border border-stone-800/80 flex items-center justify-between">
                <span className="text-stone-400">{isEn ? 'Radius:' : 'شعاع محدوده:'}</span>
                <span className="font-mono font-bold text-emerald-300">
                  {isEn ? `${radius}m` : `${toPersianDigits(radius)} متر`}
                </span>
              </div>
              <div className="bg-stone-900/80 p-1.5 rounded-lg border border-stone-800/80 flex items-center justify-between">
                <span className="text-stone-400">{isEn ? 'Condition:' : 'شرط اعلام:'}</span>
                <span className="font-bold text-emerald-300 text-[10px] truncate">
                  {triggerOnText}
                </span>
              </div>
            </div>

            {/* Live Distance to Checkpoint */}
            {distance !== null && (
              <div className={`p-1.5 rounded-lg border flex items-center justify-between text-[11px] ${
                isInside 
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300' 
                  : 'bg-stone-900/80 border-stone-800 text-stone-300'
              }`}>
                <span className="flex items-center gap-1 text-stone-400">
                  <Crosshair className="w-3 h-3 text-teal-400" />
                  <span>{isEn ? 'Your distance:' : 'فاصله شما:'}</span>
                </span>
                <span className="font-bold font-mono">
                  {isEn ? `${distance} meters` : `${toPersianDigits(distance)} متر`}
                  {' '}
                  <span className={isInside ? 'text-emerald-400 font-extrabold' : 'text-stone-400'}>
                    ({isInside ? (isEn ? 'Inside' : '🟢 داخل محدوده') : (isEn ? 'Outside' : 'خارج از محدوده')})
                  </span>
                </span>
              </div>
            )}

            {/* Test Simulation Buttons */}
            {onSimulateCheckpointTrigger && isCheckpointActive && (
              <div className="pt-1 flex items-center gap-1.5">
                <span className="text-[10px] text-stone-400">{isEn ? 'Simulate alert:' : 'تست اعلام:'}</span>
                <button
                  type="button"
                  onClick={() => onSimulateCheckpointTrigger(location, 'enter')}
                  className="px-2 py-0.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold cursor-pointer transition-colors"
                >
                  {isEn ? 'Enter Test' : 'تست ورود'}
                </button>
                <button
                  type="button"
                  onClick={() => onSimulateCheckpointTrigger(location, 'exit')}
                  className="px-2 py-0.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-[10px] font-bold cursor-pointer transition-colors"
                >
                  {isEn ? 'Exit Test' : 'تست خروج'}
                </button>
              </div>
            )}
          </div>
        ) : (
          /* Button to add checkpoint to this location */
          onEdit && (
            <button
              type="button"
              onClick={() => onEdit(location)}
              className="w-full py-1.5 px-2.5 rounded-xl border border-dashed border-emerald-500/40 bg-emerald-500/5 hover:bg-emerald-500/15 text-emerald-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
            >
              <Radio className="w-3.5 h-3.5 text-emerald-400" />
              <span>{isEn ? '+ Configure Geofence' : '+ فعال‌سازی حصار مکانی و محدوده شعاع (Geofence)'}</span>
            </button>
          )
        )}
      </div>

      {/* Footer Quick Action Buttons */}
      <div className="pt-2.5 border-t border-stone-800/80 flex flex-col gap-2 text-xs">
        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-1.5">
            {/* Directions Button */}
            <a
              href={googleDirectionsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-teal-500/20 hover:bg-teal-600 text-teal-300 hover:text-white border border-teal-500/30 text-xs font-bold transition-all active:scale-95"
              title={isEn ? 'Open directions in Google Maps' : 'مسیریابی در نقشه گوگل'}
            >
              <Navigation className="w-3.5 h-3.5" />
              <span>{isEn ? 'Directions' : 'مسیریابی'}</span>
            </a>

            {/* Copy Coordinates */}
            <button
              type="button"
              onClick={copyToClipboard}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-300 hover:text-white border border-stone-700 text-xs font-medium transition-colors active:scale-95 cursor-pointer"
              title={isEn ? 'Copy coordinates and link' : 'کپی لینک و مشخصات'}
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">{isEn ? 'Copied' : 'کپی شد'}</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>{isEn ? 'Copy' : 'کپی'}</span>
                </>
              )}
            </button>

            {/* Note / Idea Link if available */}
            {onCreateIdeaFromLocation && (
              <button
                type="button"
                onClick={() => onCreateIdeaFromLocation(location)}
                className="px-2 py-1.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-300 hover:text-white border border-stone-700 text-xs font-medium transition-colors cursor-pointer"
                title={isEn ? 'Create Idea note' : 'ایجاد یادداشت'}
              >
                <Lightbulb className="w-3.5 h-3.5 text-sky-400" />
              </button>
            )}
          </div>

          {/* View on Google Maps Link */}
          <a
            href={location.googleMapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[11px] text-stone-400 hover:text-teal-300 transition-colors"
            title={isEn ? 'View on Google Maps' : 'مشاهده در گوگل‌مپ'}
          >
            <span>{isEn ? 'View Map' : 'مشاهده'}</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    </div>
  );
};
