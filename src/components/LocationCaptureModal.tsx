import React, { useState, useEffect, useRef } from 'react';
import { 
  MapPin, 
  X, 
  Navigation, 
  Camera, 
  Upload, 
  Trash2, 
  Check, 
  ExternalLink, 
  Compass, 
  RefreshCw, 
  AlertTriangle,
  FileText,
  Clock,
  Share2,
  Radio,
  Volume2,
  VolumeX,
  Sliders,
  Bell,
  ChevronDown
} from 'lucide-react';
import { SavedLocation, GeofenceTriggerType, LocationCheckpointConfig } from '../types';
import { toPersianDigits } from '../utils/jalali';
import { CameraCaptureModal } from './CameraCaptureModal';
import { ValidationAlertModal } from './ValidationAlertModal';
import { LocationReminderModal } from './LocationReminderModal';
import { openAndroidSettings } from '../utils/nativePermissions';
import { AppLanguage } from '../utils/i18n';

interface LocationCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (location: Omit<SavedLocation, 'id' | 'createdAt'>, createReminder?: boolean) => void;
  onUpdateLocation?: (id: string, location: Partial<SavedLocation>) => void;
  editingLocation?: SavedLocation | null;
  googleMapsApiKey?: string;
  language?: AppLanguage;
}

export const LocationCaptureModal: React.FC<LocationCaptureModalProps> = ({
  isOpen,
  onClose,
  onSave,
  onUpdateLocation,
  editingLocation,
  googleMapsApiKey,
  language = 'fa',
}) => {
  const isEn = language === 'en';
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [address, setAddress] = useState<string>('');
  const [isLocating, setIsLocating] = useState<boolean>(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [alsoCreateReminder, setAlsoCreateReminder] = useState(false);
  const [showValidationModal, setShowValidationModal] = useState(false);
  const [validationFieldName, setValidationFieldName] = useState(isEn ? 'Location Name' : 'نام / عنوان مکان');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Checkpoint & Geofence Sub-Feature State (زیرمجموعه ثبت مکان برای اعلام ورود/خروج)
  const [enableGeofence, setEnableGeofence] = useState<boolean>(false);
  const [geofenceRadius, setGeofenceRadius] = useState<number>(100);
  const [geofenceTriggerOn, setGeofenceTriggerOn] = useState<GeofenceTriggerType>('both');
  const [geofenceCustomMessage, setGeofenceCustomMessage] = useState<string>('');
  const [geofencePlayAudio, setGeofencePlayAudio] = useState<boolean>(true);
  const [showCollapsibleMediaAndGeofence, setShowCollapsibleMediaAndGeofence] = useState(false);

  // Virtual keyboard tracking: keeps footer button pinned directly above virtual keyboard
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;
    const handleViewportChange = () => {
      if (window.visualViewport) {
        setViewportHeight(window.visualViewport.height);
      }
    };
    window.visualViewport.addEventListener('resize', handleViewportChange);
    window.visualViewport.addEventListener('scroll', handleViewportChange);
    handleViewportChange();
    return () => {
      window.visualViewport?.removeEventListener('resize', handleViewportChange);
      window.visualViewport?.removeEventListener('scroll', handleViewportChange);
    };
  }, []);

  // Fetch GPS coordinates
  const fetchCurrentLocation = () => {
    if (!navigator.geolocation) {
      setLocationError('سخت‌افزار یا مرورگر شما از GPS پشتیبانی نمی‌کند.');
      return;
    }

    setIsLocating(true);
    setLocationError(null);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const acc = Math.round(position.coords.accuracy);

        setLatitude(lat);
        setLongitude(lng);
        setAccuracy(acc);
        setIsLocating(false);

        // Set default title if empty
        if (!title.trim()) {
          const nowStr = new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
          setTitle(`موقعیت ثبت‌شده (${toPersianDigits(nowStr)})`);
        }

        // Reverse geocoding lookup
        try {
          const resp = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=fa`
          );
          if (resp.ok) {
            const data = await resp.json();
            if (data && data.display_name) {
              setAddress(data.display_name);
            }
          }
        } catch {
          // Graceful fallback
        }
      },
      (error) => {
        setIsLocating(false);
        switch (error.code) {
          case error.PERMISSION_DENIED:
            setLocationError('دسترسی به GPS مسدود شده است. لطفاً در تنظیمات مرورگر اجازه موقعیت مکانی را صادر کنید.');
            break;
          case error.POSITION_UNAVAILABLE:
            setLocationError('سیگنال موقعیت مکانی GPS در دسترس نیست.');
            break;
          case error.TIMEOUT:
            setLocationError('زمان دریافت سیگنال موقعیت مکانی به پایان رسید.');
            break;
          default:
            setLocationError('خطا در دریافت موقعیت مکانی GPS.');
            break;
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );
  };

  useEffect(() => {
    if (isOpen) {
      if (editingLocation) {
        setTitle(editingLocation.title || '');
        setDescription(editingLocation.description || '');
        setLatitude(editingLocation.latitude ?? null);
        setLongitude(editingLocation.longitude ?? null);
        setAccuracy(editingLocation.accuracy ?? null);
        setAddress(editingLocation.address || '');
        setPhotoUrl(editingLocation.photoUrl || null);
        if (editingLocation.geofence) {
          setEnableGeofence(editingLocation.geofence.enabled !== false);
          setGeofenceRadius(editingLocation.geofence.radius || 100);
          setGeofenceTriggerOn(editingLocation.geofence.triggerOn || 'both');
          setGeofenceCustomMessage(editingLocation.geofence.customMessage || '');
          setGeofencePlayAudio(editingLocation.geofence.playAudio !== false);
        } else {
          setEnableGeofence(false);
          setGeofenceRadius(100);
          setGeofenceTriggerOn('both');
          setGeofenceCustomMessage('');
          setGeofencePlayAudio(true);
        }
        setShowCollapsibleMediaAndGeofence(!!(editingLocation.photoUrl || editingLocation.geofence?.enabled));
      } else {
        setTitle('');
        setDescription('');
        setPhotoUrl(null);
        setAddress('');
        setEnableGeofence(false);
        setGeofenceRadius(100);
        setGeofenceTriggerOn('both');
        setGeofenceCustomMessage('');
        setGeofencePlayAudio(true);
        setShowCollapsibleMediaAndGeofence(false);
        if (latitude === null) {
          fetchCurrentLocation();
        }
      }
      setLocationError(null);
      setValidationError(null);
      setAlsoCreateReminder(false);
    }
  }, [isOpen, editingLocation]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setPhotoUrl(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    if (!title.trim()) {
      setValidationFieldName('نام / عنوان مکان');
      setShowValidationModal(true);
      return;
    }

    if (latitude === null || longitude === null) {
      setValidationFieldName('موقعیت مکانی (GPS)');
      setShowValidationModal(true);
      return;
    }

    setValidationError(null);
    const finalTitle = title.trim();
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;

    const checkpointConfig: LocationCheckpointConfig | undefined = enableGeofence
      ? {
          enabled: true,
          radius: Math.max(10, Math.round(geofenceRadius)),
          triggerOn: geofenceTriggerOn,
          customMessage: geofenceCustomMessage.trim() || undefined,
          playAudio: geofencePlayAudio,
          lastTriggeredAt: editingLocation?.geofence?.lastTriggeredAt,
          hasTriggered: editingLocation?.geofence?.hasTriggered,
        }
      : undefined;

    if (editingLocation && onUpdateLocation) {
      onUpdateLocation(editingLocation.id, {
        title: finalTitle,
        description: description.trim(),
        latitude,
        longitude,
        accuracy: accuracy || undefined,
        address: address.trim() || undefined,
        photoUrl: photoUrl || undefined,
        googleMapsUrl: mapsUrl,
        geofence: checkpointConfig,
      });
    } else {
      onSave(
        {
          title: finalTitle,
          description: description.trim(),
          latitude,
          longitude,
          accuracy: accuracy || undefined,
          address: address.trim() || undefined,
          photoUrl: photoUrl || undefined,
          googleMapsUrl: mapsUrl,
          geofence: checkpointConfig,
        },
        alsoCreateReminder
      );
    }

    onClose();
  };

  if (!isOpen) return null;

  const googleMapsUrl = latitude && longitude 
    ? `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}` 
    : '';
  const googleDirectionsUrl = latitude && longitude 
    ? `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}` 
    : '';
  const embedMapUrl = latitude && longitude
    ? `https://maps.google.com/maps?q=${latitude},${longitude}&hl=fa&z=15&output=embed`
    : '';

  return (
    <>
      <div 
        className="fixed inset-0 z-50 flex flex-col justify-end sm:justify-center items-center p-0 sm:p-4 bg-black/80 backdrop-blur-sm overflow-hidden"
        style={{ height: viewportHeight ? `${viewportHeight}px` : '100dvh' }}
        dir={isEn ? 'ltr' : 'rtl'}
      >
        <div 
          className="bg-stone-900 border border-stone-800 rounded-t-3xl sm:rounded-3xl w-full max-w-xl overflow-hidden shadow-2xl flex flex-col transition-all duration-150"
          style={{ maxHeight: viewportHeight ? `${viewportHeight}px` : '94dvh' }}
        >
          {/* Header - Fixed & Solid, no scroll bleed-through */}
          <div className="shrink-0 flex items-center justify-between px-4 sm:px-6 py-3.5 border-b border-stone-800 bg-stone-900 z-10">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center flex-shrink-0">
                <MapPin className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base sm:text-lg font-black text-white">
                  {editingLocation 
                    ? (isEn ? 'Edit Saved Place' : 'ویرایش مکان ثبت‌شده') 
                    : (isEn ? 'Save GPS Location' : 'ثبت موقعیت مکانی (GPS)')}
                </h3>
                <p className="text-[11px] text-stone-400">
                  {isEn ? 'GPS coordinates, Google Maps & camera photo' : 'با تکیه بر GPS و سرویس Google Maps همراه با عکس دوربین'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-stone-400 hover:text-white hover:bg-stone-800 transition-colors cursor-pointer"
              title={isEn ? 'Close' : 'بستن'}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Form Content - Strictly bounded scroll container */}
          <div className="flex-1 min-h-0 p-4 sm:p-5 space-y-4 overflow-y-auto overscroll-contain">
            {/* Required Field Validation Alert Banner */}
            {validationError && (
              <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs font-bold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{validationError}</span>
              </div>
            )}

            {/* GPS Status Box */}
            <div className="p-4 rounded-2xl bg-stone-950 border border-stone-800/90 space-y-3.5 transition-all duration-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Navigation className={`w-5 h-5 ${isLocating ? 'text-amber-400 animate-spin' : 'text-emerald-400'}`} />
                  <span className="text-sm font-bold text-stone-200">
                    {isLocating 
                      ? (isEn ? 'Acquiring GPS location...' : 'در حال دریافت موقعیت مکانی...') 
                      : (isEn ? 'GPS Satellite Position' : 'موقعیت ماهواره‌ای GPS')}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={fetchCurrentLocation}
                  disabled={isLocating}
                  className="min-h-[48px] px-4 py-2.5 rounded-xl bg-stone-800 hover:bg-stone-700 active:scale-95 text-stone-200 hover:text-white text-xs sm:text-sm font-bold transition-all duration-200 disabled:opacity-50 cursor-pointer flex items-center gap-2 border border-stone-700/60"
                  title={isEn ? 'Refresh GPS position' : 'دریافت مجدد موقعیت'}
                >
                  <RefreshCw className={`w-4 h-4 ${isLocating ? 'animate-spin text-amber-400' : ''}`} />
                  <span>{isLocating ? (isEn ? 'Receiving...' : 'در حال دریافت...') : (isEn ? 'Refresh GPS' : 'بروزرسانی GPS')}</span>
                </button>
              </div>

              {/* In-progress banner */}
              {isLocating && (
                <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs sm:text-sm flex items-center gap-3 animate-pulse">
                  <div className="w-5 h-5 rounded-full border-2 border-amber-400 border-t-transparent animate-spin shrink-0" />
                  <div className="flex flex-col">
                    <span className="font-bold">{isEn ? 'Acquiring accurate GPS...' : 'در حال دریافت مختصات دقیق از ماهواره GPS…'}</span>
                    <span className="text-[11px] text-amber-400/80">{isEn ? 'Please wait a moment' : 'لطفاً چند لحظه صبر کنید'}</span>
                  </div>
                </div>
              )}

              {/* Location Error Banner with Try Again Button */}
              {locationError && !isLocating && (
                <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 space-y-3">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="w-5 h-5 flex-shrink-0 text-rose-400 mt-0.5" />
                    <div className="space-y-1">
                      <span className="text-xs sm:text-sm font-bold block">{isEn ? 'Location Error' : 'خطا در دریافت موقعیت مکانی'}</span>
                      <p className="text-xs text-rose-300/90 leading-relaxed">{locationError}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={fetchCurrentLocation}
                      className="min-h-[48px] px-4 py-2.5 rounded-xl bg-stone-800 hover:bg-stone-700 active:scale-95 text-white text-xs sm:text-sm font-bold transition-all duration-200 flex items-center justify-center gap-2 border border-stone-700 cursor-pointer"
                    >
                      <RefreshCw className="w-4 h-4" />
                      <span>{isEn ? 'Try Again' : 'تلاش دوباره'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => openAndroidSettings('location')}
                      className="min-h-[48px] px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 active:scale-95 text-stone-950 text-xs sm:text-sm font-black transition-all duration-200 flex items-center justify-center gap-2 shadow-md cursor-pointer"
                    >
                      <ExternalLink className="w-4 h-4" />
                      <span>{isEn ? 'Android Settings' : 'تنظیمات موقعیت اندروید'}</span>
                    </button>
                  </div>
                </div>
              )}

              {latitude !== null && longitude !== null ? (
                <div className="space-y-2.5 pt-1">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-stone-900/80 p-2.5 rounded-xl border border-stone-800 flex flex-col">
                      <span className="text-[11px] text-stone-400">{isEn ? 'Latitude (Lat)' : 'عرض جغرافیایی (Lat)'}</span>
                      <span className="font-mono font-bold text-emerald-400 text-xs sm:text-sm mt-0.5">
                        {isEn ? latitude.toFixed(6) : toPersianDigits(latitude.toFixed(6))}
                      </span>
                    </div>
                    <div className="bg-stone-900/80 p-2.5 rounded-xl border border-stone-800 flex flex-col">
                      <span className="text-[11px] text-stone-400">{isEn ? 'Longitude (Lng)' : 'طول جغرافیایی (Lng)'}</span>
                      <span className="font-mono font-bold text-emerald-400 text-xs sm:text-sm mt-0.5">
                        {isEn ? longitude.toFixed(6) : toPersianDigits(longitude.toFixed(6))}
                      </span>
                    </div>
                  </div>

                  {accuracy && (
                    <div className="flex items-center justify-between text-xs text-stone-400 px-1">
                      <span>{isEn ? 'GPS Accuracy:' : 'دقت ماهواره‌ای GPS:'}</span>
                      <span className="font-medium text-stone-300">
                        ± {isEn ? `${Math.round(accuracy)} meters` : `${toPersianDigits(accuracy)} متر`}
                      </span>
                    </div>
                  )}

                  {address && (
                    <div className="text-xs text-stone-300 bg-stone-900/60 p-2.5 rounded-xl border border-stone-800">
                      <span className="text-stone-400 font-bold block mb-1">{isEn ? 'Estimated Address:' : 'آدرس تخمینی:'}</span>
                      <span className="line-clamp-2 leading-relaxed">{address}</span>
                    </div>
                  )}
                </div>
              ) : !isLocating && !locationError && (
                <div className="text-xs sm:text-sm text-stone-400 text-center py-2">
                  {isEn ? 'No location acquired yet. Tap "Refresh GPS".' : 'هنوز موقعیتی دریافت نشده است. روی دکمه «بروزرسانی GPS» بزنید.'}
                </div>
              )}
            </div>

            {/* Google Maps Preview */}
            {latitude !== null && longitude !== null && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-stone-300">
                  <span className="flex items-center gap-1.5">
                    <Compass className="w-4 h-4 text-emerald-400" />
                    <span>{isEn ? 'Google Maps Preview' : 'پیش‌نمایش در Google Maps'}</span>
                  </span>

                  <div className="flex items-center gap-2">
                    <a
                      href={googleMapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 underline font-semibold"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span>{isEn ? 'Open in Google Maps' : 'باز کردن در گوگل‌مپ'}</span>
                    </a>
                  </div>
                </div>

                {/* Compact Map Preview (نقشه کوچکتر) */}
                <div className="relative h-32 sm:h-36 w-full rounded-2xl overflow-hidden border border-stone-800 bg-black shadow-inner">
                  <iframe
                    title="Google Maps"
                    src={embedMapUrl}
                    className="w-full h-full border-0"
                    loading="lazy"
                    allowFullScreen
                  />
                  
                  {/* Floating Action Quick Links */}
                  <div className="absolute bottom-2 left-2 flex items-center gap-1.5">
                    <a
                      href={googleDirectionsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2.5 py-1 rounded-lg bg-black/80 hover:bg-black text-white text-[10px] font-bold backdrop-blur-md border border-white/20 flex items-center gap-1"
                    >
                      <Navigation className="w-3 h-3 text-sky-400" />
                      <span>{isEn ? 'Directions' : 'مسیریابی'}</span>
                    </a>
                  </div>
                </div>
              </div>
            )}

            {/* Title & Description Fields */}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-stone-300 mb-1.5">
                  {isEn ? 'Location Name / Title:' : 'عنوان یا نام مکان:'}
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={isEn ? 'e.g. Parking spot, New warehouse, Doctor office...' : 'مثلاً: محل پارک خودرو، انبار جدید، مطب دکتر، لوکیشن جلسه کاری...'}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-stone-950 border border-stone-800 text-white placeholder-stone-500 text-sm focus:outline-none focus:border-emerald-500/70 focus:ring-1 focus:ring-emerald-500/50"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-stone-300 mb-1.5">
                  {isEn ? 'Notes & Details (Field Description):' : 'توضیحات و جزئیات تکمیلی (فیلد توضیح):'}
                </label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={isEn ? 'Floor number, buzzer code, contact person, access notes...' : 'توضیحات تکمیلی، شماره طبقه، کد زنگ، نام شخص مسئول، یادداشت دسترسی یا نکات مهم...'}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-stone-950 border border-stone-800 text-white placeholder-stone-500 text-sm focus:outline-none focus:border-emerald-500/70 focus:ring-1 focus:ring-emerald-500/50 resize-none leading-relaxed"
                />
              </div>
            </div>

            {/* Collapsible Section: Photo & Geofence (عکس و حصار مکانی) */}
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowCollapsibleMediaAndGeofence(!showCollapsibleMediaAndGeofence)}
                className="w-full min-h-[48px] py-2.5 px-3.5 rounded-2xl bg-stone-950/70 hover:bg-stone-900 border border-stone-800 hover:border-stone-700 text-stone-300 hover:text-white text-xs sm:text-sm font-bold flex items-center justify-between transition-all cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <div className="p-1 rounded-lg bg-emerald-500/10 text-emerald-400">
                    <Radio className="w-4 h-4" />
                  </div>
                  <span>{isEn ? 'Photo & Geofence (Collapsible)' : 'عکس و حصار مکانی (Geofence)'}</span>
                  {(photoUrl || enableGeofence) && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      {photoUrl && enableGeofence ? (isEn ? 'Photo + Geofence' : 'عکس + حصار فعال') : photoUrl ? (isEn ? 'Photo attached' : 'عکس ثبت‌شده') : (isEn ? 'Geofence active' : 'حصار فعال')}
                    </span>
                  )}
                </span>
                <ChevronDown className={`w-4 h-4 text-stone-400 transition-transform duration-200 ${showCollapsibleMediaAndGeofence ? 'rotate-180 text-emerald-400' : ''}`} />
              </button>

              {showCollapsibleMediaAndGeofence && (
                <div className="mt-3 space-y-4 animate-in fade-in duration-200">
                  {/* زیرمجموعه حصار مکانی و اعلام ورود/خروج (Geofence Sub-Feature) */}
                  <div className={`rounded-2xl border transition-all p-4 ${
              enableGeofence 
                ? 'bg-stone-950/90 border-emerald-500/50 ring-1 ring-emerald-500/30' 
                : 'bg-stone-950/40 border-stone-800'
            }`}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border transition-colors ${
                    enableGeofence
                      ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                      : 'bg-stone-800/80 border-stone-700 text-stone-400'
                  }`}>
                    <Radio className={`w-4 h-4 ${enableGeofence ? 'animate-pulse' : ''}`} />
                  </div>
                  <div>
                    <h4 className="text-xs sm:text-sm font-bold text-white flex items-center gap-1.5">
                      <span>{isEn ? 'Geofence Radius Alert' : 'حصار مکانی و اعلام ورود/خروج (Geofence)'}</span>
                      {enableGeofence && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/40">
                          {isEn ? 'Active' : 'فعال'}
                        </span>
                      )}
                    </h4>
                    <p className="text-[11px] text-stone-400">
                      {isEn 
                        ? 'Set radius boundary to announce when arriving or leaving this location' 
                        : 'تعیین محدوده شعاع مشخص و اعلام متناسب هنگام ورود یا خروج از آن یا هردو'}
                    </p>
                  </div>
                </div>

                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={enableGeofence}
                    onChange={(e) => setEnableGeofence(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-stone-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                </label>
              </div>

              {/* وقتی حصار مکانی فعال است */}
              {enableGeofence && (
                <div className="mt-4 pt-4 border-t border-stone-800/80 space-y-4 animate-in fade-in duration-200">
                  {/* 1. تعیین محدوده شعاع (Radius) */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs font-bold">
                      <span className="text-stone-300 flex items-center gap-1.5">
                        <Sliders className="w-3.5 h-3.5 text-emerald-400" />
                        <span>{isEn ? 'Geofence Radius Boundary:' : 'محدوده شعاع حصار مکانی:'}</span>
                      </span>
                      <span className="text-emerald-400 font-black px-2 py-0.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 font-mono">
                        {isEn ? `${geofenceRadius} meters` : `${toPersianDigits(geofenceRadius)} متر`}
                      </span>
                    </div>

                    {/* Quick Preset Buttons */}
                    <div className="grid grid-cols-5 gap-1.5">
                      {[50, 100, 200, 500, 1000].map((rVal) => (
                        <button
                          key={rVal}
                          type="button"
                          onClick={() => setGeofenceRadius(rVal)}
                          className={`py-1.5 px-1 rounded-xl text-xs font-bold transition-all text-center border cursor-pointer ${
                            geofenceRadius === rVal
                              ? 'bg-emerald-500 text-stone-950 border-emerald-400 font-black shadow-sm'
                              : 'bg-stone-900 hover:bg-stone-800 text-stone-300 border-stone-800'
                          }`}
                        >
                          {isEn 
                            ? (rVal >= 1000 ? `${rVal/1000}km` : `${rVal}m`) 
                            : (rVal >= 1000 ? `${toPersianDigits(rVal/1000)} کیلومتر` : `${toPersianDigits(rVal)} م`)}
                        </button>
                      ))}
                    </div>

                    {/* Interactive Slider */}
                    <div className="flex items-center gap-3 pt-1">
                      <input
                        type="range"
                        min="20"
                        max="2000"
                        step="10"
                        value={geofenceRadius}
                        onChange={(e) => setGeofenceRadius(Number(e.target.value))}
                        className="w-full accent-emerald-500 bg-stone-800 h-2 rounded-lg cursor-pointer"
                      />
                    </div>
                  </div>

                  {/* 2. شرط اعلام هشدار (Trigger on: enter / exit / both) */}
                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-stone-300">
                      {isEn ? 'Alert Trigger Condition:' : 'شرط اعلام و هشدار:'}
                    </label>

                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => setGeofenceTriggerOn('enter')}
                        className={`p-2.5 rounded-xl border text-xs font-bold flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                          geofenceTriggerOn === 'enter'
                            ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 font-black shadow-sm'
                            : 'bg-stone-900 border-stone-800 text-stone-400 hover:text-stone-200'
                        }`}
                      >
                        <span className="text-sm">🟢</span>
                        <span>{isEn ? 'On Arrival' : 'ورود به محدوده'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setGeofenceTriggerOn('exit')}
                        className={`p-2.5 rounded-xl border text-xs font-bold flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                          geofenceTriggerOn === 'exit'
                            ? 'bg-amber-500/20 border-amber-500 text-amber-300 font-black shadow-sm'
                            : 'bg-stone-900 border-stone-800 text-stone-400 hover:text-stone-200'
                        }`}
                      >
                        <span className="text-sm">🔴</span>
                        <span>{isEn ? 'On Departure' : 'خروج از محدوده'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setGeofenceTriggerOn('both')}
                        className={`p-2.5 rounded-xl border text-xs font-bold flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                          geofenceTriggerOn === 'both'
                            ? 'bg-sky-500/20 border-sky-500 text-sky-300 font-black shadow-sm'
                            : 'bg-stone-900 border-stone-800 text-stone-400 hover:text-stone-200'
                        }`}
                      >
                        <span className="text-sm">🔄</span>
                        <span>{isEn ? 'Arrival & Exit' : 'ورود و خروج (هردو)'}</span>
                      </button>
                    </div>
                  </div>

                  {/* 3. متن پیام اعلام اختصاصی (Optional Custom Alert Message) */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-bold text-stone-300">
                      {isEn ? 'Custom Announcement Message (Optional):' : 'متن اختصاصی اعلام و هشدار (اختیاری):'}
                    </label>
                    <input
                      type="text"
                      value={geofenceCustomMessage}
                      onChange={(e) => setGeofenceCustomMessage(e.target.value)}
                      placeholder={isEn 
                        ? 'e.g. Arrived at parking / Left office...' 
                        : 'مثلاً: رسیدن به پارکینگ / خروج از دفتر... (پیش‌فرض: ورود یا خروج از این مکان)'}
                      className="w-full px-3 py-2 rounded-xl bg-stone-900 border border-stone-800 text-white placeholder-stone-500 text-xs focus:outline-none focus:border-emerald-500/70"
                    />
                  </div>

                  {/* 4. پخش آلارم صوتی و اعلام گفتاری */}
                  <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-stone-900/80 border border-stone-800/80 cursor-pointer hover:border-emerald-500/30 transition-colors">
                    <input
                      type="checkbox"
                      checked={geofencePlayAudio}
                      onChange={(e) => setGeofencePlayAudio(e.target.checked)}
                      className="w-4 h-4 rounded accent-emerald-500 cursor-pointer"
                    />
                    <div className="flex items-center gap-1.5 text-xs text-stone-300">
                      <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="font-semibold">
                        {isEn ? 'Play sound alarm and read aloud message via TTS' : 'پخش آلارم صوتی و خواندن صوتی پیام اعلام'}
                      </span>
                    </div>
                  </label>
                </div>
              )}
            </div>

            {/* Camera Photo Capture Field */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-stone-300">
                {isEn ? 'Camera Photo of Location:' : 'عکس از محل توسط دوربین:'}
              </label>

              {photoUrl ? (
                <div className="relative rounded-2xl overflow-hidden border border-stone-800 bg-black aspect-video group">
                  <img
                    src={photoUrl}
                    alt={isEn ? 'Location photo' : 'عکس ثبت شده از لوکیشن'}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => setIsCameraOpen(true)}
                      className="px-3 py-1.5 rounded-xl bg-stone-900/90 text-white text-xs font-bold flex items-center gap-1.5 border border-white/20 hover:bg-black cursor-pointer"
                    >
                      <Camera className="w-3.5 h-3.5 text-amber-400" />
                      <span>{isEn ? 'Retake' : 'عکس مجدد'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPhotoUrl(null)}
                      className="px-3 py-1.5 rounded-xl bg-rose-600/90 text-white text-xs font-bold flex items-center gap-1.5 hover:bg-rose-700 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{isEn ? 'Delete Photo' : 'حذف عکس'}</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setIsCameraOpen(true)}
                    className="flex flex-col items-center justify-center gap-2 p-4 rounded-2xl bg-stone-950 border border-dashed border-stone-800 hover:border-emerald-500/50 hover:bg-emerald-500/5 text-stone-300 hover:text-emerald-300 transition-all cursor-pointer group"
                  >
                    <div className="w-10 h-10 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                      <Camera className="w-5 h-5" />
                    </div>
                    <span className="text-xs font-bold">{isEn ? 'Take Photo' : 'عکاسی با دوربین زنده'}</span>
                    <span className="text-[10px] text-stone-500">{isEn ? 'Open device camera' : 'باز کردن دوربین گوشی'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex flex-col items-center justify-center gap-2 p-4 rounded-2xl bg-stone-950 border border-dashed border-stone-800 hover:border-stone-700 hover:bg-stone-900/50 text-stone-300 hover:text-white transition-all cursor-pointer group"
                  >
                    <div className="w-10 h-10 rounded-full bg-stone-800 text-stone-400 flex items-center justify-center group-hover:scale-110 transition-transform">
                      <Upload className="w-5 h-5" />
                    </div>
                    <span className="text-xs font-bold">{isEn ? 'Pick from Gallery' : 'انتخاب از گالری'}</span>
                    <span className="text-[10px] text-stone-500">{isEn ? 'Upload existing photo' : 'آپلود عکس موجود'}</span>
                  </button>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </div>
              )}
            </div>
                </div>
              )}
            </div>

            {/* Also Create Reminder Toggle */}
            <label className="flex items-center gap-3 p-3 rounded-2xl bg-stone-950 border border-stone-800/80 cursor-pointer hover:border-amber-500/30 transition-colors">
              <input
                type="checkbox"
                checked={alsoCreateReminder}
                onChange={(e) => setAlsoCreateReminder(e.target.checked)}
                className="w-4 h-4 rounded accent-amber-500 cursor-pointer"
              />
              <div className="flex-1">
                <span className="text-xs font-bold text-white block">
                  {isEn ? 'Also add to Reminders list' : 'ثبت همزمان در لیست یادآورها'}
                </span>
                <span className="text-[10px] text-stone-400 block">
                  {isEn ? 'Creates a reminder with this place title & Google Maps link' : 'یک یادآور با عنوان همین مکان و لینک گوگل‌مپ ایجاد می‌کند'}
                </span>
              </div>
            </label>
          </div>

          {/* Sticky Footer - Always pinned at bottom with min-h-[48px] buttons */}
          <div className="sticky bottom-0 z-20 shrink-0 p-3 sm:p-4 border-t border-stone-800 bg-stone-900 shadow-2xl flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[48px] px-5 py-2.5 rounded-xl bg-stone-800 hover:bg-stone-700 active:scale-95 text-stone-200 hover:text-white text-xs sm:text-sm font-semibold transition-all duration-200 cursor-pointer flex items-center justify-center border border-stone-700/60"
            >
              {isEn ? 'Cancel' : 'انصراف'}
            </button>

            <button
              type="button"
              onClick={handleSave}
              className={`flex-1 sm:flex-initial min-h-[48px] px-6 py-2.5 rounded-xl text-xs sm:text-sm font-black flex items-center justify-center gap-2 transition-all duration-200 cursor-pointer active:scale-95 ${
                !title.trim() || latitude === null || longitude === null
                  ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300'
                  : 'bg-amber-500 hover:bg-amber-400 text-stone-950 font-black shadow-lg shadow-amber-500/25'
              }`}
            >
              <Check className={`w-4 h-4 stroke-[3] ${!title.trim() || latitude === null || longitude === null ? 'text-amber-300' : 'text-stone-950'}`} />
              <span className={!title.trim() || latitude === null || longitude === null ? 'text-amber-300 font-bold' : 'text-stone-950 font-black'}>
                {editingLocation 
                  ? (isEn ? 'Save Changes' : 'ذخیره تغییرات') 
                  : (isEn ? 'Save Place' : 'ثبت مکان')}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Pop-up alert for missing required fields per user request */}
      <ValidationAlertModal
        isOpen={showValidationModal}
        onClose={() => setShowValidationModal(false)}
        title={isEn ? 'Required Field Missing' : 'تکمیل فیلد اجباری'}
        fieldName={validationFieldName}
        language={language}
      />

      {/* Live Camera Viewfinder Modal */}
      <CameraCaptureModal
        isOpen={isCameraOpen}
        onClose={() => setIsCameraOpen(false)}
        onCapture={(dataUrl) => {
          setPhotoUrl(dataUrl);
          setIsCameraOpen(false);
        }}
      />
    </>
  );
};
