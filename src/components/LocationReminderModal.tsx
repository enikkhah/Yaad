import React, { useState, useEffect } from 'react';
import { 
  MapPin, 
  X, 
  Navigation, 
  Compass, 
  Check, 
  AlertTriangle,
  BellRing,
  Volume2,
  Zap,
  Tag
} from 'lucide-react';
import { SavedLocation, LocationGeofenceConfig, GeofenceTriggerType, Category, Priority, Reminder } from '../types';
import { toPersianDigits } from '../utils/jalali';
import { AppLanguage } from '../utils/i18n';
import { ValidationAlertModal } from './ValidationAlertModal';

interface LocationReminderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (reminder: Omit<Reminder, 'id' | 'createdAt' | 'status' | 'postponeCount'>) => void;
  savedLocations: SavedLocation[];
  initialLocation?: SavedLocation | null;
  language?: AppLanguage;
}

const RADIUS_OPTIONS = [
  { value: 100, labelFa: '۱۰۰ متر (بسیار دقیق - مناسب ساختمان/مغازه)', labelEn: '100m (Building/Shop)' },
  { value: 250, labelFa: '۲۵۰ متر (پیش‌فرض - مناسب کوچه و محله)', labelEn: '250m (Neighborhood)' },
  { value: 500, labelFa: '۵۰۰ متر (مناسب منطقه و میدان اصلی)', labelEn: '500m (District)' },
  { value: 1000, labelFa: '۱۰۰۰ متر (۱ کیلومتر - مناسب ورودی شهر یا بزرگراه)', labelEn: '1000m (1 km - City/Highway entry)' },
];

export const LocationReminderModal: React.FC<LocationReminderModalProps> = ({
  isOpen,
  onClose,
  onSave,
  savedLocations,
  initialLocation = null,
  language = 'fa',
}) => {
  const isEn = language === 'en';

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<Category>('work');
  const [priority, setPriority] = useState<Priority>('medium');
  const [useFlash, setUseFlash] = useState(true);
  const [voiceReadAloud, setVoiceReadAloud] = useState(true);

  // Selected Location
  const [selectedLocationId, setSelectedLocationId] = useState<string>('');
  const [customLat, setCustomLat] = useState<number | null>(null);
  const [customLng, setCustomLng] = useState<number | null>(null);
  const [customLocName, setCustomLocName] = useState<string>('');
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  // Geofence settings
  const [radius, setRadius] = useState<number>(250);
  const [triggerOn, setTriggerOn] = useState<GeofenceTriggerType>('enter');

  const [showValidationModal, setShowValidationModal] = useState(false);
  const [validationFieldName, setValidationFieldName] = useState('');

  // Synchronize initial location when opened
  useEffect(() => {
    if (isOpen) {
      if (initialLocation) {
        setSelectedLocationId(initialLocation.id);
        setCustomLat(initialLocation.latitude);
        setCustomLng(initialLocation.longitude);
        setCustomLocName(initialLocation.title);
        setTitle(isEn ? `Arrive at ${initialLocation.title}` : `رسیدن به ${initialLocation.title}`);
        setDescription(initialLocation.description || '');
      } else if (savedLocations.length > 0) {
        setSelectedLocationId(savedLocations[0].id);
        setCustomLat(savedLocations[0].latitude);
        setCustomLng(savedLocations[0].longitude);
        setCustomLocName(savedLocations[0].title);
        setTitle(isEn ? `Arrive at ${savedLocations[0].title}` : `رسیدن به ${savedLocations[0].title}`);
        setDescription(savedLocations[0].description || '');
      } else {
        setSelectedLocationId('custom');
        fetchCurrentGps();
      }
    }
  }, [isOpen, initialLocation, savedLocations]);

  // Handle location dropdown change
  const handleSelectLocation = (locId: string) => {
    setSelectedLocationId(locId);
    if (locId === 'custom') {
      fetchCurrentGps();
    } else {
      const found = savedLocations.find((l) => l.id === locId);
      if (found) {
        setCustomLat(found.latitude);
        setCustomLng(found.longitude);
        setCustomLocName(found.title);
        if (!title.trim() || title.startsWith('رسیدن به') || title.startsWith('خروج از') || title.startsWith('Arrive at') || title.startsWith('Leave')) {
          const prefix = triggerOn === 'enter' ? (isEn ? 'Arrive at ' : 'رسیدن به ') : (isEn ? 'Leave ' : 'خروج از ');
          setTitle(`${prefix}${found.title}`);
        }
      }
    }
  };

  // Fetch current GPS for ad-hoc custom location
  const fetchCurrentGps = () => {
    if (!navigator.geolocation) {
      setLocationError(isEn ? 'GPS not supported on device' : 'سخت‌افزار دستگاه از GPS پشتیبانی نمی‌کند');
      return;
    }
    setIsLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCustomLat(pos.coords.latitude);
        setCustomLng(pos.coords.longitude);
        setIsLocating(false);
        const name = isEn ? 'Current Location' : 'موقعیت فعلی من';
        setCustomLocName(name);
        if (!title.trim()) {
          setTitle(triggerOn === 'enter' ? (isEn ? 'Arrive at Current Location' : 'رسیدن به موقعیت فعلی') : (isEn ? 'Leave Current Location' : 'خروج از موقعیت فعلی'));
        }
      },
      (err) => {
        setIsLocating(false);
        setLocationError(isEn ? 'Could not access GPS' : 'دسترسی به GPS با خطا مواجه شد');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleSave = () => {
    if (!title.trim()) {
      setValidationFieldName(isEn ? 'Reminder Title' : 'عنوان یادآور');
      setShowValidationModal(true);
      return;
    }

    if (customLat === null || customLng === null) {
      setValidationFieldName(isEn ? 'Location Coordinates' : 'مختصات جغرافیایی مکان');
      setShowValidationModal(true);
      return;
    }

    const geofenceConfig: LocationGeofenceConfig = {
      enabled: true,
      latitude: customLat,
      longitude: customLng,
      radius,
      locationName: customLocName || (isEn ? 'Designated Place' : 'محل مشخص‌شده'),
      triggerOn,
      savedLocationId: selectedLocationId !== 'custom' ? selectedLocationId : undefined,
      hasTriggered: false,
    };

    onSave({
      title: title.trim(),
      description: description.trim() || undefined,
      category,
      priority,
      dueTimestamp: Date.now() + 3600000 * 24 * 7, // fallback 1 week if time checked
      useFlash,
      ringTune: 'work',
      voiceReadAloud,
      geofence: geofenceConfig,
    });

    onClose();
  };

  if (!isOpen) return null;

  const embedMapUrl = customLat && customLng
    ? `https://maps.google.com/maps?q=${customLat},${customLng}&hl=fa&z=15&output=embed`
    : '';

  return (
    <>
      <div 
        className="fixed inset-0 z-50 flex flex-col justify-end sm:justify-center items-center p-0 sm:p-4 bg-black/85 backdrop-blur-sm overflow-hidden"
        dir={isEn ? 'ltr' : 'rtl'}
      >
        <div 
          className="bg-stone-900 border border-stone-800 rounded-t-3xl sm:rounded-3xl w-full max-w-xl overflow-hidden shadow-2xl flex flex-col max-h-[95dvh]"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-stone-800 bg-stone-900 sticky top-0 z-10">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/40 text-amber-400 flex items-center justify-center flex-shrink-0">
                <BellRing className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base sm:text-lg font-black text-white">
                  {isEn ? 'Location-Based Reminder (Geofence)' : 'یادآور ورود یا خروج از مکان (Geofence)'}
                </h3>
                <p className="text-[11px] text-stone-400">
                  {isEn ? 'Alert triggers when you enter or leave this area' : 'هنگام ورود یا خروج از محدوده جغرافیایی هشدار صوتی و اعلان فعال می‌شود'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-stone-400 hover:text-white hover:bg-stone-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Form Body */}
          <div className="p-4 sm:p-6 space-y-4 overflow-y-auto">
            {/* Location Selector */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-stone-300">
                {isEn ? 'Target Place:' : 'مکان مورد نظر برای یادآوری:'}
              </label>

              <select
                value={selectedLocationId}
                onChange={(e) => handleSelectLocation(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-stone-950 border border-stone-800 text-white text-sm focus:outline-none focus:border-amber-500/70"
              >
                {savedLocations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    📍 {loc.title} {loc.address ? `(${loc.address.slice(0, 30)}...)` : ''}
                  </option>
                ))}
                <option value="custom">
                  🎯 {isEn ? '+ Record current GPS position now' : '+ ثبت موقعیت GPS فعلی همین الان'}
                </option>
              </select>
            </div>

            {/* GPS coordinates & map preview */}
            {customLat !== null && customLng !== null && (
              <div className="p-3 rounded-2xl bg-stone-950 border border-stone-800 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5 text-emerald-400 font-bold">
                    <MapPin className="w-4 h-4" />
                    <span>{customLocName || (isEn ? 'Selected Coordinates' : 'مختصات مکان')}</span>
                  </div>
                  <span className="font-mono text-stone-400 text-[11px]">
                    {customLat.toFixed(5)}, {customLng.toFixed(5)}
                  </span>
                </div>

                {embedMapUrl && (
                  <div className="relative aspect-[16/8] w-full rounded-xl overflow-hidden border border-stone-800/80 bg-black">
                    <iframe
                      title="Geofence Map"
                      src={embedMapUrl}
                      className="w-full h-full border-0 pointer-events-none opacity-85"
                      loading="lazy"
                    />
                  </div>
                )}
              </div>
            )}

            {/* Trigger condition: Enter vs Exit */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-stone-300">
                {isEn ? 'When to trigger alert?' : 'زمان ارسال هشدار:'}
              </label>

              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setTriggerOn('enter');
                    if (customLocName && (!title.trim() || title.startsWith('خروج از') || title.startsWith('Leave'))) {
                      setTitle(isEn ? `Arrive at ${customLocName}` : `رسیدن به ${customLocName}`);
                    }
                  }}
                  className={`p-2.5 rounded-xl border text-xs font-bold transition-all cursor-pointer flex flex-col items-center gap-1 ${
                    triggerOn === 'enter'
                      ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-md'
                      : 'bg-stone-950 border-stone-800 text-stone-400 hover:text-white'
                  }`}
                >
                  <Compass className="w-4 h-4 text-emerald-400" />
                  <span>{isEn ? 'On Arrival' : 'هنگام ورود'}</span>
                  <span className="text-[10px] text-stone-500 font-normal">{isEn ? 'Enter zone' : 'رسیدن به مقصد'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setTriggerOn('exit');
                    if (customLocName && (!title.trim() || title.startsWith('رسیدن به') || title.startsWith('Arrive at'))) {
                      setTitle(isEn ? `Leave ${customLocName}` : `خروج از ${customLocName}`);
                    }
                  }}
                  className={`p-2.5 rounded-xl border text-xs font-bold transition-all cursor-pointer flex flex-col items-center gap-1 ${
                    triggerOn === 'exit'
                      ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-md'
                      : 'bg-stone-950 border-stone-800 text-stone-400 hover:text-white'
                  }`}
                >
                  <Navigation className="w-4 h-4 text-rose-400" />
                  <span>{isEn ? 'On Departure' : 'هنگام خروج'}</span>
                  <span className="text-[10px] text-stone-500 font-normal">{isEn ? 'Leave zone' : 'ترک محدوده'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setTriggerOn('both')}
                  className={`p-2.5 rounded-xl border text-xs font-bold transition-all cursor-pointer flex flex-col items-center gap-1 ${
                    triggerOn === 'both'
                      ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-md'
                      : 'bg-stone-950 border-stone-800 text-stone-400 hover:text-white'
                  }`}
                >
                  <BellRing className="w-4 h-4 text-amber-400" />
                  <span>{isEn ? 'Both' : 'ورود و خروج'}</span>
                  <span className="text-[10px] text-stone-500 font-normal">{isEn ? 'Both events' : 'هر دو حالت'}</span>
                </button>
              </div>
            </div>

            {/* Geofence Radius Selection */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <label className="font-bold text-stone-300">
                  {isEn ? 'Detection Radius:' : 'شعاع محدوده جغرافیایی (Radius):'}
                </label>
                <span className="font-bold text-amber-400">
                  {isEn ? `${radius} meters` : `${toPersianDigits(radius)} متر`}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {RADIUS_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setRadius(opt.value)}
                    className={`p-2.5 rounded-xl border text-xs text-right transition-all cursor-pointer ${
                      radius === opt.value
                        ? 'bg-amber-500/15 border-amber-500 text-amber-300 font-bold'
                        : 'bg-stone-950 border-stone-800 text-stone-400 hover:text-stone-200'
                    }`}
                  >
                    {isEn ? opt.labelEn : opt.labelFa}
                  </button>
                ))}
              </div>
            </div>

            {/* Title & Notes */}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-stone-300 mb-1.5">
                  {isEn ? 'Reminder Title:' : 'عنوان یادآور:'}
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={isEn ? 'e.g. Pick up documents at warehouse...' : 'مثلاً: تحویل مدارک از انبار، خرید نان، یادآوری کلید...'}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-stone-950 border border-stone-800 text-white placeholder-stone-500 text-sm focus:outline-none focus:border-amber-500/70"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-stone-300 mb-1.5">
                  {isEn ? 'Description / Checklist Notes:' : 'توضیحات و چک‌لیست اقلام:'}
                </label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={isEn ? 'Optional details to read upon arrival...' : 'توضیحات اختیاری، نام افراد یا چک‌لیست اقلامی که باید بردارید...'}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-stone-950 border border-stone-800 text-white placeholder-stone-500 text-sm focus:outline-none focus:border-amber-500/70 resize-none leading-relaxed"
                />
              </div>
            </div>

            {/* Category & Audio Toggles */}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-xs font-bold text-stone-400 mb-1.5">
                  {isEn ? 'Category:' : 'دسته‌بندی:'}
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as Category)}
                  className="w-full px-3 py-2 rounded-xl bg-stone-950 border border-stone-800 text-white text-xs"
                >
                  <option value="work">{isEn ? 'Work' : 'کاری'}</option>
                  <option value="family">{isEn ? 'Family' : 'خانواده'}</option>
                  <option value="other">{isEn ? 'Other' : 'سایر'}</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-stone-400 mb-1.5">
                  {isEn ? 'Priority:' : 'اولویت:'}
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as Priority)}
                  className="w-full px-3 py-2 rounded-xl bg-stone-950 border border-stone-800 text-white text-xs"
                >
                  <option value="high">{isEn ? 'High' : 'فوری'}</option>
                  <option value="medium">{isEn ? 'Medium' : 'متوسط'}</option>
                  <option value="low">{isEn ? 'Normal' : 'عادی'}</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-4 pt-1">
              <label className="flex items-center gap-2 cursor-pointer text-xs text-stone-300">
                <input
                  type="checkbox"
                  checked={useFlash}
                  onChange={(e) => setUseFlash(e.target.checked)}
                  className="rounded accent-amber-500"
                />
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                <span>{isEn ? 'Screen Flash' : 'فلش نوری صفحه'}</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-xs text-stone-300">
                <input
                  type="checkbox"
                  checked={voiceReadAloud}
                  onChange={(e) => setVoiceReadAloud(e.target.checked)}
                  className="rounded accent-amber-500"
                />
                <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>{isEn ? 'Read aloud title' : 'خواندن صوتی عنوان'}</span>
              </label>
            </div>
          </div>

          {/* Footer */}
          <div className="p-4 sm:p-5 border-t border-stone-800 bg-stone-900 flex items-center justify-between gap-3">
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
              className="flex-1 sm:flex-initial px-6 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 text-xs sm:text-sm font-black flex items-center justify-center gap-2 shadow-lg shadow-amber-500/25 active:scale-95 transition-all cursor-pointer"
            >
              <Check className="w-4 h-4 stroke-[3]" />
              <span>{isEn ? 'Activate Geofence Reminder' : 'فعال‌سازی یادآور مکان‌محور'}</span>
            </button>
          </div>
        </div>
      </div>

      <ValidationAlertModal
        isOpen={showValidationModal}
        onClose={() => setShowValidationModal(false)}
        title={isEn ? 'Required Field Missing' : 'تکمیل فیلد اجباری'}
        fieldName={validationFieldName}
        language={language}
      />
    </>
  );
};
