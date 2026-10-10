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
  BellRing,
  Radio
} from 'lucide-react';
import { SavedLocation, GeofenceTriggerType } from '../types';
import { toPersianDigits } from '../utils/jalali';
import { CameraCaptureModal } from './CameraCaptureModal';
import { ValidationAlertModal } from './ValidationAlertModal';
import { LocationReminderModal } from './LocationReminderModal';
import { AppLanguage } from '../utils/i18n';

export interface LocationGeofenceFormConfig {
  enabled: boolean;
  triggerOn: GeofenceTriggerType;
  radius: number;
  customReminderTitle?: string;
}

interface LocationCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (
    location: Omit<SavedLocation, 'id' | 'createdAt'>, 
    createReminder?: boolean,
    geofenceConfig?: LocationGeofenceFormConfig
  ) => void;
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
  const [showValidationModal, setShowValidationModal] = useState(false);
  const [validationFieldName, setValidationFieldName] = useState(isEn ? 'Location Name' : 'نام / عنوان مکان');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sub-tabs in modal: 'details' (مشخصات و GPS) vs 'geofence' (یادآور ورود/خروج)
  const [activeModalTab, setActiveModalTab] = useState<'details' | 'geofence'>('details');
  const [enableGeofenceReminder, setEnableGeofenceReminder] = useState<boolean>(false);
  const [geofenceRadius, setGeofenceRadius] = useState<number>(250);
  const [geofenceTriggerOn, setGeofenceTriggerOn] = useState<GeofenceTriggerType>('enter');
  const [geofenceCustomTitle, setGeofenceCustomTitle] = useState<string>('');

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
      } else {
        setTitle('');
        setDescription('');
        setPhotoUrl(null);
        setAddress('');
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
        },
        enableGeofenceReminder,
        enableGeofenceReminder
          ? {
              enabled: true,
              triggerOn: geofenceTriggerOn,
              radius: geofenceRadius,
              customReminderTitle: geofenceCustomTitle.trim() || undefined,
            }
          : undefined
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
          {/* Header */}
          <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-stone-800 bg-stone-900/90 sticky top-0 z-10">
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

          {/* Sub-Tabs Selector: مشخصات مکان (GPS) vs یادآور مکان‌محور (ورود/خروج) */}
          <div className="flex items-center gap-1.5 px-3 sm:px-6 py-2.5 bg-stone-950/90 border-b border-stone-800 shrink-0">
            <button
              type="button"
              onClick={() => setActiveModalTab('details')}
              className={`flex-1 flex items-center justify-center gap-1.5 sm:gap-2 py-2 px-2 sm:px-3 rounded-xl text-xs font-black transition-all cursor-pointer ${
                activeModalTab === 'details'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 shadow-sm'
                  : 'text-stone-400 hover:text-white hover:bg-stone-800/60'
              }`}
            >
              <MapPin className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{isEn ? '1. Place Info & GPS' : '۱. مشخصات و نقشه مکان'}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveModalTab('geofence')}
              className={`flex-1 flex items-center justify-center gap-1.5 sm:gap-2 py-2 px-2 sm:px-3 rounded-xl text-xs font-black transition-all cursor-pointer ${
                activeModalTab === 'geofence'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50 shadow-sm'
                  : 'text-stone-400 hover:text-white hover:bg-stone-800/60'
              }`}
            >
              <BellRing className="w-4 h-4 text-amber-400 shrink-0" />
              <span>{isEn ? '2. Geofence Alert' : '۲. یادآور مکان‌محور (ورود/خروج)'}</span>
              {enableGeofenceReminder && (
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
              )}
            </button>
          </div>

          {/* Form Content */}
          <div className="p-4 sm:p-6 space-y-4 sm:space-y-5 overflow-y-auto flex-1">
            {/* Required Field Validation Alert Banner */}
            {validationError && (
              <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs font-bold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{validationError}</span>
              </div>
            )}

            {/* TAB 1: DETAILS & GPS LOCATION */}
            {activeModalTab === 'details' && (
              <>
                {/* GPS Status Box */}
                <div className="p-3.5 rounded-2xl bg-stone-950 border border-stone-800/90 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Navigation className={`w-4 h-4 ${isLocating ? 'text-amber-400 animate-spin' : 'text-emerald-400'}`} />
                  <span className="text-xs font-bold text-stone-200">
                    {isLocating 
                      ? (isEn ? 'Fetching accurate GPS coordinates...' : 'در حال دریافت مختصات دقیق GPS...') 
                      : (isEn ? 'GPS Satellite Coordinates' : 'مختصات ماهواره‌ای GPS')}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={fetchCurrentLocation}
                  disabled={isLocating}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-300 hover:text-white text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                  title={isEn ? 'Refresh GPS position' : 'بازخوانی موقعیت GPS'}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLocating ? 'animate-spin text-amber-400' : ''}`} />
                  <span>{isEn ? 'Refresh GPS' : 'بروزرسانی GPS'}</span>
                </button>
              </div>

              {locationError && (
                <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 text-rose-400 mt-0.5" />
                  <span>{locationError}</span>
                </div>
              )}

              {latitude !== null && longitude !== null ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-stone-900/80 p-2 rounded-xl border border-stone-800 flex flex-col">
                      <span className="text-[10px] text-stone-400">{isEn ? 'Latitude (Lat)' : 'عرض جغرافیایی (Lat)'}</span>
                      <span className="font-mono font-bold text-emerald-400 text-xs sm:text-sm">
                        {isEn ? latitude.toFixed(6) : toPersianDigits(latitude.toFixed(6))}
                      </span>
                    </div>
                    <div className="bg-stone-900/80 p-2 rounded-xl border border-stone-800 flex flex-col">
                      <span className="text-[10px] text-stone-400">{isEn ? 'Longitude (Lng)' : 'طول جغرافیایی (Lng)'}</span>
                      <span className="font-mono font-bold text-emerald-400 text-xs sm:text-sm">
                        {isEn ? longitude.toFixed(6) : toPersianDigits(longitude.toFixed(6))}
                      </span>
                    </div>
                  </div>

                  {accuracy && (
                    <div className="flex items-center justify-between text-[11px] text-stone-400 px-1">
                      <span>{isEn ? 'GPS Accuracy:' : 'دقت ماهواره‌ای GPS:'}</span>
                      <span className="font-medium text-stone-300">
                        ± {isEn ? `${Math.round(accuracy)} meters` : `${toPersianDigits(accuracy)} متر`}
                      </span>
                    </div>
                  )}

                  {address && (
                    <div className="text-[11px] text-stone-300 bg-stone-900/60 p-2 rounded-xl border border-stone-800">
                      <span className="text-stone-400 font-bold block mb-0.5">{isEn ? 'Estimated Address:' : 'آدرس تخمینی:'}</span>
                      <span className="line-clamp-2 leading-relaxed">{address}</span>
                    </div>
                  )}
                </div>
              ) : !isLocating && (
                <div className="text-xs text-stone-400 text-center py-2">
                  {isEn ? 'No location acquired yet. Tap "Refresh GPS".' : 'هنوز موقعیتی دریافت نشده است. روی دکمه «بروزرسانی GPS» کلیک کنید.'}
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

                <div className="relative aspect-[16/9] w-full rounded-2xl overflow-hidden border border-stone-800 bg-black shadow-inner">
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

            {/* Quick Link: Also Create Reminder Toggle */}
            <label className="flex items-center gap-3 p-3 rounded-2xl bg-stone-950 border border-stone-800/80 cursor-pointer hover:border-amber-500/30 transition-colors">
              <input
                type="checkbox"
                checked={enableGeofenceReminder}
                onChange={(e) => setEnableGeofenceReminder(e.target.checked)}
                className="w-4 h-4 rounded accent-amber-500 cursor-pointer"
              />
              <div className="flex-1">
                <span className="text-xs font-bold text-white flex items-center gap-2">
                  <span>{isEn ? 'Also create location-based reminder' : 'تنظیم خودکار یادآور مکان‌محور (ورود/خروج)'}</span>
                  {enableGeofenceReminder && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold">
                      {isEn ? 'ON' : 'فعال'}
                    </span>
                  )}
                </span>
                <span className="text-[10px] text-stone-400 block">
                  {isEn ? 'Configure in Tab 2 or save now with standard 250m radius' : 'امکان تنظیم دقیق شعاع و شرط ورود/خروج در تب دوم'}
                </span>
              </div>
            </label>
          </>
        )}

        {/* TAB 2: GEOFENCE REMINDER SETTINGS (یادآوری مکان‌محور: ورود/خروج) */}
        {activeModalTab === 'geofence' && (
          <div className="space-y-4 animate-in fade-in">
            {/* Geofence Master Toggle Card */}
            <div 
              onClick={() => setEnableGeofenceReminder(!enableGeofenceReminder)}
              className={`p-4 rounded-2xl border-2 transition-all cursor-pointer flex items-center justify-between gap-3 ${
                enableGeofenceReminder
                  ? 'bg-amber-500/15 border-amber-500/80 shadow-lg shadow-amber-500/10'
                  : 'bg-stone-950/80 border-stone-800 hover:border-stone-700'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                  enableGeofenceReminder ? 'bg-amber-500 text-stone-950' : 'bg-stone-800 text-stone-400'
                }`}>
                  <BellRing className="w-5 h-5 stroke-[2.2]" />
                </div>
                <div>
                  <h4 className="font-bold text-sm text-white flex items-center gap-2">
                    <span>{isEn ? 'Enable Location Geofence Alert' : 'فعال‌سازی هشدار هوشمند ورود/خروج'}</span>
                    {enableGeofenceReminder && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold">
                        {isEn ? 'ACTIVE' : 'فعال'}
                      </span>
                    )}
                  </h4>
                  <p className="text-[11px] text-stone-400">
                    {isEn 
                      ? 'Trigger phone alarm & native notification when near or leaving this GPS location'
                      : 'پخش آلارم صوتی و اعلان گوشی به محض نزدیک‌شدن یا ترک این نقطه'}
                  </p>
                </div>
              </div>

              <input
                type="checkbox"
                checked={enableGeofenceReminder}
                onChange={(e) => setEnableGeofenceReminder(e.target.checked)}
                onClick={(e) => e.stopPropagation()}
                className="w-5 h-5 rounded accent-amber-500 cursor-pointer shrink-0"
              />
            </div>

            {enableGeofenceReminder ? (
              <div className="space-y-4 p-4 rounded-2xl bg-stone-950 border border-amber-500/30">
                {/* Trigger Condition: ورود vs خروج vs هر دو */}
                <div>
                  <label className="block text-xs font-bold text-stone-200 mb-2">
                    {isEn ? 'Alert Trigger Condition:' : 'زمان به صدا درآمدن آلارم:'}
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setGeofenceTriggerOn('enter')}
                      className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer ${
                        geofenceTriggerOn === 'enter'
                          ? 'bg-emerald-500/20 border-emerald-500/80 text-emerald-300 font-bold shadow-sm'
                          : 'bg-stone-900 border-stone-800 text-stone-400 hover:text-white'
                      }`}
                    >
                      <span className="text-xs block font-bold">{isEn ? 'On Arrival' : 'هنگام ورود'}</span>
                      <span className="text-[10px] text-stone-400 block mt-0.5">{isEn ? 'When entering' : 'رسیدن به محدوده'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setGeofenceTriggerOn('exit')}
                      className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer ${
                        geofenceTriggerOn === 'exit'
                          ? 'bg-rose-500/20 border-rose-500/80 text-rose-300 font-bold shadow-sm'
                          : 'bg-stone-900 border-stone-800 text-stone-400 hover:text-white'
                      }`}
                    >
                      <span className="text-xs block font-bold">{isEn ? 'On Departure' : 'هنگام خروج'}</span>
                      <span className="text-[10px] text-stone-400 block mt-0.5">{isEn ? 'When leaving' : 'ترک این محل'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setGeofenceTriggerOn('both')}
                      className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer ${
                        geofenceTriggerOn === 'both'
                          ? 'bg-amber-500/20 border-amber-500/80 text-amber-300 font-bold shadow-sm'
                          : 'bg-stone-900 border-stone-800 text-stone-400 hover:text-white'
                      }`}
                    >
                      <span className="text-xs block font-bold">{isEn ? 'Both' : 'ورود و خروج'}</span>
                      <span className="text-[10px] text-stone-400 block mt-0.5">{isEn ? 'Arrival & Exit' : 'هر دو حالت'}</span>
                    </button>
                  </div>
                </div>

                {/* Active Radius Selection */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-bold text-stone-200">
                      {isEn ? 'Active Radius Distance:' : 'شعاع حساسیت محدوده مکانی:'}
                    </label>
                    <span className="text-xs font-mono font-bold text-amber-400">
                      {toPersianDigits(geofenceRadius)} {isEn ? 'meters' : 'متر'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { val: 100, labelFa: '۱۰۰ متر', descFa: 'مغازه / ساختمان' },
                      { val: 250, labelFa: '۲۵۰ متر', descFa: 'کوچه / محله' },
                      { val: 500, labelFa: '۵۰۰ متر', descFa: 'منطقه / میدان' },
                      { val: 1000, labelFa: '۱۰۰۰ متر', descFa: '۱ کیلومتر' },
                    ].map((item) => (
                      <button
                        key={item.val}
                        type="button"
                        onClick={() => setGeofenceRadius(item.val)}
                        className={`p-2 rounded-xl border text-center transition-all cursor-pointer ${
                          geofenceRadius === item.val
                            ? 'bg-amber-500/20 border-amber-500/80 text-amber-300 font-bold shadow-sm'
                            : 'bg-stone-900 border-stone-800 text-stone-400 hover:text-white'
                        }`}
                      >
                        <span className="text-xs font-bold block">{item.labelFa}</span>
                        <span className="text-[10px] text-stone-500 block">{item.descFa}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Custom Reminder Title */}
                <div>
                  <label className="block text-xs font-bold text-stone-200 mb-1.5">
                    {isEn ? 'Reminder Alert Message (Optional):' : 'متن پیام هشدار یادآور (اختیاری):'}
                  </label>
                  <input
                    type="text"
                    value={geofenceCustomTitle}
                    onChange={(e) => setGeofenceCustomTitle(e.target.value)}
                    placeholder={
                      isEn 
                        ? `e.g. Arrived at ${title || 'location'}, remember to...` 
                        : `پیش‌فرض: ${geofenceTriggerOn === 'exit' ? 'خروج از' : 'رسیدن به'} ${title || 'مکان'}...`
                    }
                    className="w-full bg-stone-900 border border-stone-800 rounded-xl px-3.5 py-2 text-xs text-white placeholder-stone-500 focus:outline-none focus:border-amber-500"
                  />
                </div>

                {/* Summary Info */}
                <div className="p-3 rounded-xl bg-stone-900/80 border border-stone-800 text-[11px] text-stone-300 flex items-start gap-2">
                  <Radio className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5 animate-pulse" />
                  <p className="leading-relaxed">
                    {isEn 
                      ? `When your phone GPS detects you are within ${geofenceRadius}m of this spot, YAAD will trigger full-screen alarms and ring audio.`
                      : `به محض اینکه GPS گوشی شما تشخیص دهد در شعاع ${toPersianDigits(geofenceRadius)} متری این مکان قرار گرفته‌اید، زنگ هشدار رسا و اعلان یادآوری هوشمند به صدا درخواهد آمد.`}
                  </p>
                </div>
              </div>
            ) : (
              <div className="p-8 text-center rounded-2xl border border-dashed border-stone-800 bg-stone-950/40 space-y-2">
                <BellRing className="w-8 h-8 text-stone-600 mx-auto" />
                <p className="text-xs text-stone-400">
                  {isEn 
                    ? 'Geofence alert is currently turned off for this place.' 
                    : 'یادآور مکان‌محور در حال حاضر برای این مکان غیرفعال است.'}
                </p>
                <button
                  type="button"
                  onClick={() => setEnableGeofenceReminder(true)}
                  className="px-4 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-bold transition-all cursor-pointer active:scale-95"
                >
                  {isEn ? 'Turn On Geofence Alert' : 'روشن کردن هشدار ورود/خروج'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

          {/* Sticky Footer - Pinned directly above keyboard */}
          <div className="sticky bottom-0 z-20 shrink-0 p-3 sm:p-5 border-t border-stone-800 bg-stone-900/95 backdrop-blur shadow-2xl flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-300 text-xs sm:text-sm font-semibold transition-colors cursor-pointer"
            >
              {isEn ? 'Cancel' : 'انصراف'}
            </button>

            <button
              type="button"
              onClick={handleSave}
              className={`flex-1 sm:flex-initial px-6 py-2.5 rounded-xl text-xs sm:text-sm font-black flex items-center justify-center gap-2 transition-all cursor-pointer ${
                !title.trim() || latitude === null || longitude === null
                  ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300'
                  : 'bg-amber-500 hover:bg-amber-400 text-stone-950 font-black shadow-lg shadow-amber-500/25 active:scale-95'
              }`}
            >
              <Check className={`w-4 h-4 stroke-[3] ${!title.trim() || latitude === null || longitude === null ? 'text-amber-300' : 'text-stone-950'}`} />
              <span className={!title.trim() || latitude === null || longitude === null ? 'text-amber-300 font-bold' : 'text-stone-950 font-black'}>
                {editingLocation 
                  ? (isEn ? 'Save Changes' : 'ذخیره تغییرات مکان') 
                  : (isEn ? 'Save Location & Info' : 'ذخیره مکان و اطلاعات')}
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
