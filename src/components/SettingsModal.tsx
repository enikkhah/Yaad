import React, { useState, useEffect, useRef } from 'react';
import { AppSettings, AppTheme, PhoneAlarmSound, Reminder, IdeaNote, SavedLocation, Occasion } from '../types';
import { 
  X, 
  Palette, 
  Clock, 
  Cloud, 
  LogOut,
  Sliders,
  Bell,
  BarChart3,
  Sparkles,
  Type,
  Smartphone,
  CheckCircle2,
  Globe,
  Upload,
  Database,
  FileJson,
  MapPin,
  Camera,
  Mic,
  ShieldCheck,
  Check,
  AlertCircle,
  Download,
  Info,
  Volume2,
  Volume1,
  VolumeX,
  Play,
  Square,
  Music,
  Loader2,
  Navigation,
  Crosshair,
  Radio,
  Compass,
  ChevronDown,
  ChevronUp,
  Sun,
  Moon,
  Trash2,
  RotateCcw,
  Calendar,
  Lightbulb,
  Mail,
  ExternalLink,
  FolderOpen,
  HardDrive,
  RefreshCw
} from 'lucide-react';
import { getT } from '../utils/i18n';
import { APP_VERSION, APP_VERSION_INFO } from '../utils/version';
import { toPersianDigits, formatJalaliFull } from '../utils/jalali';
import { 
  isGeofenceTrackingEnabled, 
  setGeofenceTrackingEnabled, 
  getLastKnownPosition,
  UserPosition
} from '../utils/geofenceManager';
import { 
  isNativeAndroidApp,
  requestNotificationPermission,
  requestMicrophonePermission,
  requestCameraPermission,
  requestLocationPermission,
  requestLocalFolderPermission,
  requestAllNativePermissions,
  checkAllPermissionsStatus,
  openAndroidSettings,
  NativePermissionsStatus
} from '../utils/nativePermissions';
import {
  performAutoBackup,
  retrieveFromLocalYaadFolder,
  retrieveFromUserCloudSpace,
  selectUserCloudSpaceFolder,
  uploadToCustomCloudUrl,
  shareBackupToAnyCloudApp,
  LOCAL_BACKUP_FOLDER_NAME
} from '../utils/backupStorage';
import {
  uploadBackupToGoogleDrive,
  downloadBackupFromGoogleDrive,
  DRIVE_BACKUP_FOLDER_NAME
} from '../utils/googleSync';
import { CloudBackupProvider } from '../types';
import { PHONE_ALARM_SOUNDS, playPhoneAlarmSound, stopAlarmRinging, setGlobalVolume } from '../utils/audio';
import { syncNotificationSoundAndVolume, syncAllRemindersWithLocalNotifications } from '../utils/nativeLocalNotifications';
import { User } from 'firebase/auth';
import appIcon from '../assets/images/icon.png';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void;
  googleUser: User | null;
  googleToken: string | null;
  onGoogleSignIn: () => Promise<void>;
  onGoogleSignOut: () => Promise<void>;
  onOpenStats?: () => void;
  reminders?: Reminder[];
  ideas?: IdeaNote[];
  savedLocations?: SavedLocation[];
  occasions?: Occasion[];
  onRestoreData?: (data: { reminders?: Reminder[]; ideas?: IdeaNote[]; savedLocations?: SavedLocation[]; occasions?: Occasion[]; settings?: Partial<AppSettings> }, mode: 'replace' | 'merge') => void;
  onTestHeadsUpBanner?: (reminder: Reminder) => void;
  isGeofenceActive?: boolean;
  onToggleGeofenceActive?: (active: boolean) => void;
  onRestoreItem?: (id: string, type: 'reminder' | 'location' | 'occasion' | 'idea') => void;
  onPermanentDeleteItem?: (id: string, type: 'reminder' | 'location' | 'occasion' | 'idea') => void;
  onEmptyRecycleBin?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  googleUser,
  googleToken,
  onGoogleSignIn,
  onGoogleSignOut,
  onOpenStats,
  reminders = [],
  ideas = [],
  savedLocations = [],
  occasions = [],
  onRestoreData,
  onTestHeadsUpBanner,
  isGeofenceActive = true,
  onToggleGeofenceActive,
  onRestoreItem,
  onPermanentDeleteItem,
  onEmptyRecycleBin,
}) => {
  const currentLanguage = settings?.language || 'fa';
  const isFa = currentLanguage === 'fa';
  const t = getT(currentLanguage);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [mapsKeyInput, setMapsKeyInput] = useState(settings?.googleMapsApiKey || '');
  const [keySavedMessage, setKeySavedMessage] = useState(false);

  // Backup & Restore state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [backupSuccessMessage, setBackupSuccessMessage] = useState<string | null>(null);
  const [backupErrorMessage, setBackupErrorMessage] = useState<string | null>(null);
  const [pendingRestoreData, setPendingRestoreData] = useState<{
    reminders?: Reminder[];
    ideas?: IdeaNote[];
    savedLocations?: SavedLocation[];
    occasions?: Occasion[];
    settings?: Partial<AppSettings>;
  } | null>(null);

  const [playingSoundId, setPlayingSoundId] = useState<PhoneAlarmSound | null>(null);
  const soundTimeoutRef = useRef<number | null>(null);

  // Recycle Bin state
  const [isConfirmingEmptyBin, setIsConfirmingEmptyBin] = useState<boolean>(false);
  const [activeInfoDialog, setActiveInfoDialog] = useState<'privacy' | 'about' | null>(null);

  // Local & Cloud Folder Backup configuration state
  const normalizeFolderName = (name?: string) => {
    const trimmed = (name || '').trim();
    if (!trimmed || trimmed.toUpperCase() === 'YAAD REMIDER') return LOCAL_BACKUP_FOLDER_NAME;
    return trimmed;
  };
  const [localFolderInput, setLocalFolderInput] = useState<string>(
    normalizeFolderName(settings?.localBackupFolderName)
  );
  const [cloudProvider, setCloudProvider] = useState<CloudBackupProvider>(
    settings?.cloudBackupProvider || 'custom_cloud_folder'
  );
  const [cloudSpaceLabelInput, setCloudSpaceLabelInput] = useState<string>(
    settings?.cloudSpaceLabel || ''
  );
  const [cloudFolderInput, setCloudFolderInput] = useState<string>(
    normalizeFolderName(settings?.cloudBackupFolderName)
  );
  const [cloudUrlInput, setCloudUrlInput] = useState<string>(
    settings?.cloudCustomUrl || ''
  );
  const [cloudAuthInput, setCloudAuthInput] = useState<string>(
    settings?.cloudCustomAuth || ''
  );
  const [isLocalSyncing, setIsLocalSyncing] = useState<boolean>(false);
  const [isCloudSyncing, setIsCloudSyncing] = useState<boolean>(false);
  const [confirmCloudUpload, setConfirmCloudUpload] = useState<boolean>(false);
  const [folderPickerModalMode, setFolderPickerModalMode] = useState<'local' | 'cloud' | null>(null);
  const [pickerCustomPath, setPickerCustomPath] = useState<string>(LOCAL_BACKUP_FOLDER_NAME);
  const [pickerCloudServiceLabel, setPickerCloudServiceLabel] = useState<string>('');
  const [modalPermissionMessage, setModalPermissionMessage] = useState<string | null>(null);
  const nativeDirInputRef = useRef<HTMLInputElement | null>(null);

  // Native permissions state (for Android APK / PWA)
  const [nativePerms, setNativePerms] = useState<NativePermissionsStatus>({
    notifications: false,
    microphone: false,
    camera: false,
    location: false,
    storage: false,
  });
  const [isRequestingAllPerms, setIsRequestingAllPerms] = useState(false);

  // 6 Collapsible groups state: ظاهر، صدا، دسترسی‌ها، همگام‌سازی، پشتیبان، سطل بازیافت
  const [openSections, setOpenSections] = useState<{
    appearance: boolean;
    sound: boolean;
    permissions: boolean;
    sync: boolean;
    backup: boolean;
    recycleBin: boolean;
  }>({
    appearance: true,
    sound: false,
    permissions: false,
    sync: false,
    backup: false,
    recycleBin: false,
  });

  const toggleSection = (section: keyof typeof openSections) => {
    setOpenSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const deletedReminders = (reminders || []).filter((r) => !!r.deletedAt);
  const deletedIdeas = (ideas || []).filter((i) => !!i.deletedAt);
  const deletedLocations = (savedLocations || []).filter((l) => !!l.deletedAt);
  const deletedOccasions = (occasions || []).filter((o) => !!o.deletedAt);

  const allDeletedItems = [
    ...deletedReminders.map((r) => ({ id: r.id, type: 'reminder' as const, title: r.title, deletedAt: r.deletedAt! })),
    ...deletedIdeas.map((i) => ({ id: i.id, type: 'idea' as const, title: i.title, deletedAt: i.deletedAt! })),
    ...deletedLocations.map((l) => ({ id: l.id, type: 'location' as const, title: l.title, deletedAt: l.deletedAt! })),
    ...deletedOccasions.map((o) => ({ id: o.id, type: 'occasion' as const, title: o.title, deletedAt: o.deletedAt! })),
  ].sort((a, b) => b.deletedAt - a.deletedAt);

  useEffect(() => {
    if (isOpen) {
      checkAllPermissionsStatus().then(setNativePerms);
    } else {
      stopAlarmRinging();
      setPlayingSoundId(null);
      if (soundTimeoutRef.current) clearTimeout(soundTimeoutRef.current);
    }
  }, [isOpen]);

  const handleRequestPerm = async (type: 'notifications' | 'microphone' | 'camera' | 'location' | 'storage') => {
    if (type === 'notifications') {
      await requestNotificationPermission();
    } else if (type === 'microphone') {
      await requestMicrophonePermission();
    } else if (type === 'camera') {
      await requestCameraPermission();
    } else if (type === 'location') {
      await requestLocationPermission();
    } else if (type === 'storage') {
      const target = normalizeFolderName(localFolderInput);
      setPickerCustomPath(target);
      setModalPermissionMessage(null);
      setFolderPickerModalMode('local');
      const res = await requestLocalFolderPermission(false, target);
      if (res.folderName) {
        setLocalFolderInput(res.folderName);
        onUpdateSettings({ localBackupFolderName: res.folderName });
      }
    }
    const updated = await checkAllPermissionsStatus();
    setNativePerms(updated);
  };

  const handleRequestAllPerms = async () => {
    setIsRequestingAllPerms(true);
    const updated = await requestAllNativePermissions();
    setNativePerms(updated);
    setIsRequestingAllPerms(false);
  };

  useEffect(() => {
    return () => {
      stopAlarmRinging();
      if (soundTimeoutRef.current) clearTimeout(soundTimeoutRef.current);
    };
  }, []);

  const handlePreviewSound = (soundId: PhoneAlarmSound) => {
    if (soundTimeoutRef.current) {
      clearTimeout(soundTimeoutRef.current);
      soundTimeoutRef.current = null;
    }

    if (playingSoundId === soundId) {
      stopAlarmRinging();
      setPlayingSoundId(null);
    } else {
      stopAlarmRinging();
      setPlayingSoundId(soundId);
      const currentVol = settings?.alarmVolume !== undefined ? settings.alarmVolume : 0.85;
      playPhoneAlarmSound(soundId, currentVol);
      soundTimeoutRef.current = window.setTimeout(() => {
        setPlayingSoundId(null);
      }, 1900);
    }
  };

  const handleSelectSound = (soundId: PhoneAlarmSound) => {
    const updatedSettings = { ...settings, alarmSound: soundId };
    onUpdateSettings({ alarmSound: soundId });
    syncNotificationSoundAndVolume(soundId, settings.alarmVolume).catch(() => {});
    syncAllRemindersWithLocalNotifications(reminders, updatedSettings).catch(() => {});
  };

  const handleVolumeChange = (newVolume: number) => {
    const clamped = Math.max(0.0, Math.min(1.0, newVolume));
    onUpdateSettings({ alarmVolume: clamped });
    setGlobalVolume(clamped);
    syncNotificationSoundAndVolume(settings.alarmSound || 'digital-beep', clamped).catch(() => {});
  };

  const themes: { id: AppTheme; name: string; subtitle?: string; preview: string }[] = [
    { id: 'system', name: isFa ? 'خودکار (پیروی از گوشی)' : 'System (Auto)', preview: 'bg-gradient-to-r from-stone-900 to-stone-200 border-indigo-400' },
    { id: 'dark-gold', name: isFa ? 'مشکی نیلی' : 'Dark Indigo', preview: 'bg-stone-950 border-indigo-500' },
    { id: 'dark-slate', name: isFa ? 'آبی تیره' : 'Dark Slate', preview: 'bg-slate-950 border-sky-500' },
    { id: 'light-clean', name: isFa ? 'روشن مدرن' : 'Light Clean', preview: 'bg-stone-100 border-stone-400' },
    { id: 'sketch-contrast', name: isFa ? 'اسکچ خط‌چین' : 'Sketch High Contrast', preview: 'bg-black border-dashed border-white' },
    { id: 'jade_warm_light', name: isFa ? 'سبز یشمی و سفید گرم' : 'Jade Green & Warm White', preview: 'bg-[#168779] border-[#DDE1DA]' },
    { id: 'midnight_blue_silver', name: isFa ? 'آبی نیمه‌شب و نقره‌ای' : 'Midnight Blue & Silver', preview: 'bg-[#101722] border-[#9CBCE0]' },
  ];

  // Handle downloading JSON backup
  const handleDownloadBackup = () => {
    try {
      const backupPayload = {
        app: 'yad-reminder',
        version: 2,
        exportedAt: new Date().toISOString(),
        reminders: reminders || [],
        ideas: ideas || [],
        savedLocations: savedLocations || [],
        occasions: occasions || [],
        settings,
      };

      const dataStr = JSON.stringify(backupPayload, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const now = new Date();
      const dateTag = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      link.href = url;
      link.download = `yad-backup-${dateTag}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setBackupSuccessMessage(settings.language === 'en' ? 'Backup file downloaded successfully.' : 'فایل نسخه پشتیبان با موفقیت دانلود شد.');
      setBackupErrorMessage(null);
      setTimeout(() => setBackupSuccessMessage(null), 4000);
    } catch (err) {
      setBackupErrorMessage(settings.language === 'en' ? 'Error generating backup.' : 'خطا در تولید فایل پشتیبان.');
    }
  };

  // Handle uploading and parsing JSON backup
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = JSON.parse(text);

        // Basic verification
        if (!parsed || (typeof parsed !== 'object')) {
          throw new Error('فرمت فایل نامعتبر است.');
        }

        const validReminders = Array.isArray(parsed.reminders) ? parsed.reminders : [];
        const validIdeas = Array.isArray(parsed.ideas) ? parsed.ideas : [];
        const validLocations = Array.isArray(parsed.savedLocations) ? parsed.savedLocations : [];
        const validOccasions = Array.isArray(parsed.occasions) ? parsed.occasions : [];
        const validSettings = parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : undefined;

        if (
          validReminders.length === 0 &&
          validIdeas.length === 0 &&
          validLocations.length === 0 &&
          validOccasions.length === 0 &&
          !validSettings
        ) {
          throw new Error('در این فایل هیچ یادآور، مناسبت، ایده یا تنظیمی یافت نشد.');
        }

        setPendingRestoreData({
          reminders: validReminders,
          ideas: validIdeas,
          savedLocations: validLocations,
          occasions: validOccasions,
          settings: validSettings,
        });
        setBackupErrorMessage(null);
      } catch (err: any) {
        setBackupErrorMessage(err.message || 'خطا در خواندن فایل JSON. لطفاً از صحت فایل پشتیبان مطمئن شوید.');
        setPendingRestoreData(null);
      }
    };
    reader.onerror = () => {
      setBackupErrorMessage('خطا در بارگذاری فایل از حافظه.');
    };
    reader.readAsText(file);

    // Reset input
    if (e.target) {
      e.target.value = '';
    }
  };

  const handleConfirmRestore = (mode: 'replace' | 'merge') => {
    if (!pendingRestoreData || !onRestoreData) return;

    onRestoreData(pendingRestoreData, mode);
    setBackupSuccessMessage(
      mode === 'replace' 
        ? 'داده‌ها با موفقیت بازیابی و جایگزین شدند.' 
        : 'داده‌های فایل پشتیبان با موفقیت ادغام شدند.'
    );
    setPendingRestoreData(null);
    setTimeout(() => setBackupSuccessMessage(null), 4000);
  };

  const handleSaveMapsKey = () => {
    onUpdateSettings({ googleMapsApiKey: mapsKeyInput.trim() });
    setKeySavedMessage(true);
    setTimeout(() => setKeySavedMessage(false), 3000);
  };

  // Select / introduce local folder on device storage — ALWAYS opens interactive modal immediately
  const handleSelectLocalFolder = () => {
    const targetName = normalizeFolderName(localFolderInput);
    setPickerCustomPath(targetName);
    setModalPermissionMessage(null);
    setBackupErrorMessage(null);
    setFolderPickerModalMode('local');
  };

  const finalizeLocalFolderSelection = async (chosenFolder: string, requestDesktopPicker: boolean = false) => {
    const finalFolder = normalizeFolderName(chosenFolder);
    setIsLocalSyncing(true);
    setBackupErrorMessage(null);
    try {
      const res = await requestLocalFolderPermission(requestDesktopPicker, finalFolder);
      const effectiveFolder = normalizeFolderName(res.folderName || finalFolder);
      setLocalFolderInput(effectiveFolder);
      setPickerCustomPath(effectiveFolder);
      onUpdateSettings({ localBackupFolderName: effectiveFolder });
      await performAutoBackup({
        reminders,
        ideas,
        savedLocations,
        occasions,
        settings: { ...settings, localBackupFolderName: effectiveFolder },
      });
      const updatedPerms = await checkAllPermissionsStatus();
      setNativePerms({ ...updatedPerms, storage: true });
      const msg = isFa
        ? `دسترسی حافظه فعال شد و پوشه «${effectiveFolder}» ایجاد و نسخه پشتیبان در آن ذخیره گردید ✓`
        : `Storage access granted, folder "${effectiveFolder}" created and backup saved ✓`;
      setModalPermissionMessage(msg);
      setBackupSuccessMessage(msg);
      setTimeout(() => setBackupSuccessMessage(null), 5000);
    } catch {
      setBackupErrorMessage(isFa ? 'خطا در تنظیم پوشه محلی.' : 'Failed to configure local folder.');
    } finally {
      setIsLocalSyncing(false);
    }
  };

  // Recall from local Yaad reminder folder
  const handleRecallFromLocalFolder = async () => {
    setIsLocalSyncing(true);
    setBackupErrorMessage(null);
    try {
      const targetName = normalizeFolderName(localFolderInput);
      const snap = await retrieveFromLocalYaadFolder(targetName);
      if (snap) {
        setPendingRestoreData({
          reminders: snap.reminders || [],
          ideas: snap.ideas || [],
          savedLocations: snap.savedLocations || [],
          occasions: snap.occasions || [],
          settings: snap.settings,
        });
        setBackupSuccessMessage(
          isFa
            ? `نسخه پشتیبان از پوشه محلی «${targetName}» فراخوانی شد. نحوه اعمال را در کادر زیر انتخاب کنید.`
            : `Backup loaded from local folder "${targetName}". Confirm below.`
        );
      } else {
        setBackupErrorMessage(
          isFa
            ? `در پوشه محلی «${targetName}» هنوز فایل پشتیبانی یافت نشد.`
            : `No backup found in local folder "${targetName}".`
        );
      }
    } catch {
      setBackupErrorMessage(isFa ? 'خطا در فراخوانی از پوشه محلی.' : 'Error reading from local folder.');
    } finally {
      setIsLocalSyncing(false);
    }
  };

  // Select any cloud folder on device (OneDrive, Dropbox, iCloud, Mega, etc.) — ALWAYS opens interactive modal immediately
  const handleSelectAnyCloudFolder = () => {
    const targetCloudFolder = normalizeFolderName(cloudFolderInput);
    setPickerCustomPath(targetCloudFolder);
    setPickerCloudServiceLabel(cloudSpaceLabelInput.trim() || 'OneDrive');
    setModalPermissionMessage(null);
    setBackupErrorMessage(null);
    setFolderPickerModalMode('cloud');
  };

  const finalizeCloudFolderSelection = async (chosenFolder: string, serviceLabel?: string) => {
    const finalFolder = chosenFolder.trim() || DRIVE_BACKUP_FOLDER_NAME;
    const finalLabel = (serviceLabel !== undefined ? serviceLabel : cloudSpaceLabelInput).trim();
    setIsCloudSyncing(true);
    setBackupErrorMessage(null);
    try {
      setCloudFolderInput(finalFolder);
      if (finalLabel) setCloudSpaceLabelInput(finalLabel);
      onUpdateSettings({
        cloudBackupEnabled: true,
        cloudBackupProvider: 'custom_cloud_folder',
        cloudBackupFolderName: finalFolder,
        cloudSpaceLabel: finalLabel || undefined,
      });
      await performAutoBackup(
        {
          reminders,
          ideas,
          savedLocations,
          occasions,
          settings: {
            ...settings,
            cloudBackupEnabled: true,
            cloudBackupProvider: 'custom_cloud_folder',
            cloudBackupFolderName: finalFolder,
            cloudSpaceLabel: finalLabel || undefined,
          },
        },
        { immediateCloud: true, forceCloud: true, googleToken }
      );
      setBackupSuccessMessage(
        isFa
          ? `محل فضای ابری مورد نظر («${finalFolder}») ثبت شد و پشتیبان‌گیری انجام گردید.`
          : `Cloud space location ("${finalFolder}") configured and backed up.`
      );
      setTimeout(() => setBackupSuccessMessage(null), 5000);
    } catch {
      setBackupErrorMessage(isFa ? 'خطا در معرفی پوشه فضای ابری.' : 'Failed to set cloud folder.');
    } finally {
      setIsCloudSyncing(false);
      setFolderPickerModalMode(null);
    }
  };

  // Save Cloud Space Configuration (any provider, folder name, or custom URL)
  const handleSaveCloudFolder = () => {
    const cleanedFolder = cloudFolderInput.trim() || DRIVE_BACKUP_FOLDER_NAME;
    setCloudFolderInput(cleanedFolder);
    onUpdateSettings({
      cloudBackupProvider: cloudProvider,
      cloudBackupFolderName: cleanedFolder,
      cloudSpaceLabel: cloudSpaceLabelInput.trim() || undefined,
      cloudCustomUrl: cloudUrlInput.trim() || undefined,
      cloudCustomAuth: cloudAuthInput.trim() || undefined,
    });
    setBackupSuccessMessage(
      isFa
        ? `تنظیمات فضای ابری و پوشه «${cleanedFolder}» با موفقیت ذخیره شد.`
        : `Cloud space configuration and folder "${cleanedFolder}" saved.`
    );
    setTimeout(() => setBackupSuccessMessage(null), 3500);
  };

  // Execute confirmed upload to the user's selected Cloud Space (Custom Cloud Folder, WebDAV/URL, or Google Drive)
  const handleConfirmedCloudBackup = async () => {
    setConfirmCloudUpload(false);
    setIsCloudSyncing(true);
    setBackupErrorMessage(null);
    try {
      const targetCloudFolder = cloudFolderInput.trim() || DRIVE_BACKUP_FOLDER_NAME;
      const updatedSettings: AppSettings = {
        ...settings,
        cloudBackupProvider: cloudProvider,
        cloudBackupFolderName: targetCloudFolder,
        cloudSpaceLabel: cloudSpaceLabelInput.trim() || undefined,
        cloudCustomUrl: cloudUrlInput.trim() || undefined,
        cloudCustomAuth: cloudAuthInput.trim() || undefined,
      };
      onUpdateSettings({
        cloudBackupProvider: cloudProvider,
        cloudBackupFolderName: targetCloudFolder,
        cloudSpaceLabel: cloudSpaceLabelInput.trim() || undefined,
        cloudCustomUrl: cloudUrlInput.trim() || undefined,
        cloudCustomAuth: cloudAuthInput.trim() || undefined,
      });

      const snapshotPayload = {
        version: 3,
        updatedAt: Date.now(),
        folder: targetCloudFolder,
        reminders,
        ideas,
        savedLocations,
        occasions,
        settings: updatedSettings,
      };

      if (cloudProvider === 'google_drive') {
        const ok = await uploadBackupToGoogleDrive(snapshotPayload, googleToken, targetCloudFolder);
        if (!ok) {
          setBackupErrorMessage(
            isFa
              ? 'ارتباط با گوگل درایو برقرار نشد. لطفاً ابتدا وارد حساب گوگل شوید یا فضای ابری دیگری انتخاب کنید.'
              : 'Could not upload to Google Drive. Please sign in or select another cloud space.'
          );
          return;
        }
      } else if (cloudProvider === 'webdav_url') {
        if (!cloudUrlInput.trim()) {
          setBackupErrorMessage(
            isFa
              ? 'لطفاً آدرس اینترنتی (URL / WebDAV) فضای ابری مورد نظر خود را وارد کنید.'
              : 'Please enter the target Cloud / WebDAV URL.'
          );
          return;
        }
        const ok = await uploadToCustomCloudUrl(
          snapshotPayload,
          cloudUrlInput.trim(),
          targetCloudFolder,
          cloudAuthInput.trim()
        );
        if (!ok) {
          setBackupErrorMessage(
            isFa
              ? 'ارسال به آدرس ابری واردشده با خطا مواجه شد. آدرس یا دسترسی را بررسی کنید.'
              : 'Failed to upload to custom cloud URL.'
          );
          return;
        }
      } else {
        // 'custom_cloud_folder' (OneDrive, Dropbox, iCloud, Mega, or any user-selected folder)
        await performAutoBackup(
          {
            reminders,
            ideas,
            savedLocations,
            occasions,
            settings: { ...updatedSettings, cloudBackupEnabled: true },
          },
          { immediateCloud: true, forceCloud: true, googleToken }
        );
      }

      setBackupSuccessMessage(
        isFa
          ? `پشتیبان‌گیری در فضای ابری انتخابی (پوشه «${targetCloudFolder}») با موفقیت انجام شد.`
          : `Backup saved to selected cloud space (folder "${targetCloudFolder}").`
      );
      setTimeout(() => setBackupSuccessMessage(null), 4000);
    } catch {
      setBackupErrorMessage(isFa ? 'خطا در ذخیره در فضای ابری.' : 'Cloud backup failed.');
    } finally {
      setIsCloudSyncing(false);
    }
  };

  // Recall from whichever Cloud Space the user configured
  const handleRecallFromCloudDrive = async () => {
    setIsCloudSyncing(true);
    setBackupErrorMessage(null);
    try {
      const targetCloudFolder = cloudFolderInput.trim() || DRIVE_BACKUP_FOLDER_NAME;
      const snap = await retrieveFromUserCloudSpace(googleToken, {
        ...settings,
        cloudBackupProvider: cloudProvider,
        cloudBackupFolderName: targetCloudFolder,
        cloudCustomUrl: cloudUrlInput.trim() || undefined,
        cloudCustomAuth: cloudAuthInput.trim() || undefined,
      });
      if (snap) {
        setPendingRestoreData({
          reminders: snap.reminders || [],
          ideas: snap.ideas || [],
          savedLocations: snap.savedLocations || [],
          occasions: snap.occasions || [],
          settings: snap.settings,
        });
        setBackupSuccessMessage(
          isFa
            ? `فایل پشتیبان از فضای ابری انتخابی (پوشه «${targetCloudFolder}») دریافت شد. جهت اعمال در کادر زیر تایید نمایید.`
            : `Backup fetched from cloud space (folder "${targetCloudFolder}"). Confirm below.`
        );
      } else {
        setBackupErrorMessage(
          isFa
            ? `در فضای ابری معرفی‌شده (پوشه «${targetCloudFolder}») فایل پشتیبانی یافت نشد.`
            : `No backup found in the configured cloud space ("${targetCloudFolder}").`
        );
      }
    } catch {
      setBackupErrorMessage(isFa ? 'خطا در فراخوانی از فضای ابری.' : 'Failed to fetch from cloud space.');
    } finally {
      setIsCloudSyncing(false);
    }
  };

  // Share / send backup file to any cloud app installed on phone (OneDrive, Dropbox, Telegram, iCloud, Drive, etc.)
  const handleShareToAnyCloudApp = async () => {
    const targetCloudFolder = cloudFolderInput.trim() || DRIVE_BACKUP_FOLDER_NAME;
    await shareBackupToAnyCloudApp(
      {
        version: 3,
        updatedAt: Date.now(),
        folder: targetCloudFolder,
        reminders,
        ideas,
        savedLocations,
        occasions,
        settings,
      },
      targetCloudFolder
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div 
        id="settings-modal-panel"
        className="w-full max-w-xl bg-stone-900 border border-stone-800 rounded-3xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
      >
        {/* Header */}
        <div className="px-2.5 sm:px-5 py-3.5 border-b border-stone-800 flex items-center justify-between bg-stone-900/90">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl overflow-hidden border border-amber-500/30 flex-shrink-0 bg-stone-950 shadow-sm p-0.5">
              <img
                src={appIcon}
                alt="YAAD"
                className="w-full h-full object-cover rounded-[10px]"
                draggable={false}
              />
            </div>
            <h3 className="font-black text-base sm:text-lg text-white">
              {settings.language === 'en' ? 'YAAD Settings' : 'تنظیمات YAAD'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-stone-400 hover:text-white hover:bg-stone-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Settings Body */}
        <div className="flex-1 overflow-y-auto px-2.5 py-4 sm:p-5 space-y-3.5">
          
          {/* ========================================================= */}
          {/* 1. APPEARANCE & THEMES (ظاهر و پوسته‌ها) */}
          {/* ========================================================= */}
          <div className="rounded-2xl border border-stone-800 bg-stone-950/60 overflow-hidden transition-all shadow-sm">
            <button
              type="button"
              onClick={() => toggleSection('appearance')}
              className="w-full min-h-[48px] p-3.5 sm:p-4 bg-stone-900/60 hover:bg-stone-900 border-b border-stone-800/80 flex items-center justify-between gap-3 transition-colors cursor-pointer text-start"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
                  <Palette className="w-4.5 h-4.5" />
                </div>
                <div className="min-w-0">
                  <h4 className="text-xs sm:text-sm font-black text-white truncate">
                    {isFa ? '۱. ظاهر و تم برنامه' : '1. Appearance & Theme'}
                  </h4>
                  <p className="text-[11px] text-stone-400 truncate">
                    {isFa
                      ? `پوسته: ${themes.find((th) => th.id === settings.theme)?.name || 'پیش‌فرض'} • اندازه فونت • زبان`
                      : `Theme: ${settings.theme} • Font Size • Language`}
                  </p>
                </div>
              </div>
              <ChevronDown className={`w-4 h-4 text-stone-400 transition-transform duration-200 shrink-0 ${openSections.appearance ? 'rotate-180 text-indigo-400' : ''}`} />
            </button>

            {openSections.appearance && (
              <div className="p-3 sm:p-4 space-y-4 animate-in fade-in">
                {/* Theme Selection Chips (Small & Minimal) */}
                <div className="space-y-3">
                  <span className="text-xs font-bold text-stone-300 block">
                    {isFa ? 'انتخاب قالب ظاهری:' : 'Select Theme:'}
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
                    {themes.map((themeItem) => {
                      const isSelected = settings.theme === themeItem.id;
                      return (
                        <button
                          key={themeItem.id}
                          type="button"
                          onClick={() => onUpdateSettings({ theme: themeItem.id })}
                          className={`h-8 px-2 rounded-xl border text-center transition-all duration-150 flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 ${
                            isSelected
                              ? 'border-indigo-400 bg-indigo-500/20 text-indigo-300 font-bold shadow-xs ring-1 ring-indigo-400/40'
                              : 'border-stone-800 bg-stone-950/70 text-stone-300 hover:border-stone-700 hover:bg-stone-900'
                          }`}
                        >
                          <span className={`w-2.5 h-2.5 rounded-full border shrink-0 ${themeItem.preview}`} />
                          <span className="text-[11px] font-medium truncate">{themeItem.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 1.3 App Language */}
                <div className="space-y-2 pt-2 border-t border-stone-800/80">
                  <div className="flex items-center gap-2 text-xs font-bold text-stone-300">
                    <Globe className="w-3.5 h-3.5 text-indigo-400" />
                    <span>{isFa ? 'زبان برنامه (App Language)' : 'Language'}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        try {
                          localStorage.setItem('yaad_user_explicit_lang_choice', 'true');
                        } catch {}
                        onUpdateSettings({ language: 'fa' });
                      }}
                      className={`min-h-[48px] p-2.5 rounded-xl border text-center transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 text-white ${
                        (settings.language || 'fa') === 'fa'
                          ? 'border-indigo-500 bg-indigo-500/15 ring-1 ring-indigo-500/30 font-bold'
                          : 'border-stone-800 bg-stone-900/60 hover:bg-stone-900'
                      }`}
                    >
                      <span className="text-xs font-bold">فارسی (Persian)</span>
                      {(settings.language || 'fa') === 'fa' && <CheckCircle2 className="w-4 h-4 text-indigo-400" />}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        try {
                          localStorage.setItem('yaad_user_explicit_lang_choice', 'true');
                        } catch {}
                        onUpdateSettings({ language: 'en' });
                      }}
                      className={`min-h-[48px] p-2.5 rounded-xl border text-center transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 text-white ${
                        settings.language === 'en'
                          ? 'border-indigo-500 bg-indigo-500/15 ring-1 ring-indigo-500/30 font-bold'
                          : 'border-stone-800 bg-stone-900/60 hover:bg-stone-900'
                      }`}
                    >
                      <span className="text-xs font-bold">English (انگلیسی)</span>
                      {settings.language === 'en' && <CheckCircle2 className="w-4 h-4 text-indigo-400" />}
                    </button>
                  </div>
                </div>

                {/* 1.4 Font Size Slider */}
                <div className="space-y-2 pt-2 border-t border-stone-800/80">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold text-stone-300">
                      <Type className="w-3.5 h-3.5 text-indigo-400" />
                      <span>{isFa ? 'اندازه قلم و فونت متن‌ها' : 'Font Size'}</span>
                    </div>
                    <span className="font-mono text-xs text-indigo-300 font-black bg-stone-900 px-2 py-0.5 rounded-lg border border-indigo-500/30">
                      {isFa ? toPersianDigits(
                        typeof settings.fontSize === 'number'
                          ? settings.fontSize
                          : settings.fontSize === 'small'
                          ? 14
                          : settings.fontSize === 'large'
                          ? 18
                          : settings.fontSize === 'xlarge'
                          ? 21
                          : 16
                      ) : (
                        typeof settings.fontSize === 'number'
                          ? settings.fontSize
                          : settings.fontSize === 'small'
                          ? 14
                          : settings.fontSize === 'large'
                          ? 18
                          : settings.fontSize === 'xlarge'
                          ? 21
                          : 16
                      )}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-stone-400">{isFa ? 'الف' : 'A'}</span>
                    <input
                      type="range"
                      min="13"
                      max="23"
                      step="1"
                      value={
                        typeof settings.fontSize === 'number'
                          ? settings.fontSize
                          : settings.fontSize === 'small'
                          ? 14
                          : settings.fontSize === 'large'
                          ? 18
                          : settings.fontSize === 'xlarge'
                          ? 21
                          : 16
                      }
                      onChange={(e) => onUpdateSettings({ fontSize: parseInt(e.target.value, 10) })}
                      className="w-full accent-teal-500 h-2 bg-stone-800 rounded-lg cursor-pointer"
                    />
                    <span className="text-base font-black text-white">{isFa ? 'الف' : 'A'}</span>
                  </div>
                </div>

                {/* 1.5 Timeline Style */}
                <div className="space-y-2 pt-2 border-t border-stone-800/80">
                  <div className="flex items-center gap-2 text-xs font-bold text-stone-300">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                    <span>{isFa ? 'سبک نمایش تایم‌لاین' : 'Timeline Style'}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => onUpdateSettings({ timelineMode: 'modern' })}
                      className={`min-h-[48px] p-2.5 rounded-xl border text-center cursor-pointer active:scale-95 transition-all ${
                        (settings.timelineMode || 'modern') === 'modern'
                          ? 'border-indigo-500 bg-indigo-500/15 text-white ring-1 ring-indigo-500/30'
                          : 'border-stone-800 bg-stone-950/60 text-stone-400 hover:border-stone-700'
                      }`}
                    >
                      <div className="font-black text-xs text-indigo-300">{isFa ? 'مدرن نیلی' : 'Modern Indigo'}</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => onUpdateSettings({ timelineMode: 'sketch' })}
                      className={`min-h-[48px] p-2.5 rounded-xl border text-center cursor-pointer active:scale-95 transition-all ${
                        settings.timelineMode === 'sketch'
                          ? 'border-white bg-white/15 text-white ring-1 ring-white/40'
                          : 'border-stone-800 bg-stone-950/60 text-stone-400 hover:border-stone-700'
                      }`}
                    >
                      <div className="font-black text-xs text-white font-mono">{isFa ? 'اسکچ خط‌چین' : 'Sketch Border'}</div>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ========================================================= */}
          {/* 2. SOUND & ALERTS (صدا و هشدارها) */}
          {/* ========================================================= */}
          <div className="rounded-2xl border border-stone-800 bg-stone-950/60 overflow-hidden transition-all shadow-sm">
            <button
              type="button"
              onClick={() => toggleSection('sound')}
              className="w-full min-h-[48px] p-3.5 sm:p-4 bg-stone-900/60 hover:bg-stone-900 border-b border-stone-800/80 flex items-center justify-between gap-3 transition-colors cursor-pointer text-start"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
                  <Volume2 className="w-4.5 h-4.5" />
                </div>
                <div className="min-w-0">
                  <h4 className="text-xs sm:text-sm font-black text-white truncate">
                    {isFa ? '۲. صدا و هشدارها' : '2. Sound & Alerts'}
                  </h4>
                  <p className="text-[11px] text-stone-400 truncate">
                    {isFa
                      ? `بلندی: ${toPersianDigits(Math.round((settings.alarmVolume ?? 0.85) * 100))}٪ • ملودی آلارم`
                      : `Volume: ${Math.round((settings.alarmVolume ?? 0.85) * 100)}% • Alarm Melody`}
                  </p>
                </div>
              </div>
              <ChevronDown className={`w-4 h-4 text-stone-400 transition-transform duration-200 shrink-0 ${openSections.sound ? 'rotate-180 text-indigo-400' : ''}`} />
            </button>

            {openSections.sound && (
              <div className="p-3 sm:p-4 space-y-4 animate-in fade-in">
                {/* 2.1 Volume Slider and Presets */}
                <div className="p-3.5 rounded-2xl bg-stone-900/70 border border-stone-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold text-stone-200">
                      {((settings.alarmVolume ?? 0.85) <= 0.01) ? (
                        <VolumeX className="w-4 h-4 text-stone-500" />
                      ) : ((settings.alarmVolume ?? 0.85) < 0.5) ? (
                        <Volume1 className="w-4 h-4 text-indigo-400" />
                      ) : (
                        <Volume2 className="w-4 h-4 text-indigo-400" />
                      )}
                      <span>{isFa ? 'میزان بلندی صدا (ولوم)' : 'Alarm Volume'}</span>
                    </div>
                    <span className="font-mono text-xs font-black text-indigo-300 bg-stone-900 px-2.5 py-0.5 rounded-lg border border-indigo-500/30">
                      {isFa ? `${toPersianDigits(Math.round((settings.alarmVolume ?? 0.85) * 100))}٪` : `${Math.round((settings.alarmVolume ?? 0.85) * 100)}%`}
                    </span>
                  </div>

                  {/* Slider */}
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => handleVolumeChange(0)}
                      title={isFa ? 'بی‌صدا' : 'Mute'}
                      className="p-1 rounded hover:bg-stone-800 transition-colors"
                    >
                      <VolumeX 
                        className={`w-4 h-4 transition-colors ${
                          (settings.alarmVolume ?? 0.85) <= 0.01 ? 'text-indigo-400' : 'text-stone-500 hover:text-stone-300'
                        }`} 
                      />
                    </button>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={Math.round((settings.alarmVolume ?? 0.85) * 100)}
                      onChange={(e) => handleVolumeChange(parseInt(e.target.value, 10) / 100)}
                      className="w-full accent-indigo-500 h-2.5 bg-stone-800 rounded-lg cursor-pointer"
                    />
                    <button
                      type="button"
                      onClick={() => handleVolumeChange(1.0)}
                      title={isFa ? 'حداکثر صدا' : 'Max Volume'}
                      className="p-1 rounded hover:bg-stone-800 transition-colors"
                    >
                      <Volume2 
                        className={`w-4 h-4 transition-colors ${
                          (settings.alarmVolume ?? 0.85) >= 0.95 ? 'text-indigo-400' : 'text-stone-500 hover:text-stone-300'
                        }`} 
                      />
                    </button>
                  </div>

                  {/* Quick Volume Preset Chips */}
                  <div className="flex items-center gap-1.5 flex-wrap pt-1">
                    {[
                      { label: isFa ? 'بی‌صدا (۰٪)' : 'Mute (0%)', val: 0 },
                      { label: isFa ? 'آرام (۳۰٪)' : 'Low (30%)', val: 0.3 },
                      { label: isFa ? 'متوسط (۶۰٪)' : 'Med (60%)', val: 0.6 },
                      { label: isFa ? 'بلند (۸۵٪)' : 'High (85%)', val: 0.85 },
                      { label: isFa ? 'حداکثر (۱۰۰٪)' : 'Max (100%)', val: 1.0 },
                    ].map((chip) => {
                      const isActive = Math.abs((settings.alarmVolume ?? 0.85) - chip.val) < 0.05;
                      return (
                        <button
                          key={chip.val}
                          type="button"
                          onClick={() => handleVolumeChange(chip.val)}
                          className={`min-h-[36px] text-[11px] px-2.5 py-1 rounded-lg border font-bold transition-all cursor-pointer active:scale-95 ${
                            isActive
                              ? 'bg-indigo-500/20 border-indigo-500 text-indigo-300 shadow-sm'
                              : 'bg-stone-900 border-stone-800 text-stone-400 hover:text-stone-200 hover:border-stone-700'
                          }`}
                        >
                          {chip.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 2.2 Alarm Sound Selection */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-stone-200">
                      {isFa ? 'انتخاب ملودی و صدای زنگ:' : 'Select Alarm Tone:'}
                    </span>
                    <span className="text-[11px] text-stone-400">
                      {isFa ? 'برای شنیدن دکمه پخش را بزنید' : 'Play to test tone'}
                    </span>
                  </div>

                  <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                    {PHONE_ALARM_SOUNDS.map((soundItem) => {
                      const isSelected = (settings.alarmSound || 'digital-beep') === soundItem.id;
                      const isPlaying = playingSoundId === soundItem.id;

                      return (
                        <div
                          key={soundItem.id}
                          onClick={() => handleSelectSound(soundItem.id)}
                          className={`p-2.5 rounded-xl border transition-all flex items-center justify-between gap-3 cursor-pointer ${
                            isSelected
                              ? 'border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500/40 shadow-sm'
                              : 'border-stone-800/90 bg-stone-950/60 hover:border-stone-700 hover:bg-stone-900/50'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${
                              isSelected ? 'border-indigo-500 bg-indigo-500' : 'border-stone-600 bg-transparent'
                            }`}>
                              {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                            </div>

                            <div className="min-w-0">
                              <p className={`text-xs font-bold truncate ${isSelected ? 'text-indigo-300' : 'text-stone-200'}`}>
                                {isFa ? soundItem.label : soundItem.labelEn}
                              </p>
                              <p className="text-[10px] text-stone-400 truncate">
                                {isFa ? soundItem.desc : soundItem.descEn}
                              </p>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelectSound(soundItem.id);
                              handlePreviewSound(soundItem.id);
                            }}
                            className={`min-h-[40px] flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer active:scale-95 shrink-0 ${
                              isPlaying
                                ? 'bg-indigo-500 text-white font-black animate-pulse'
                                : isSelected
                                ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40'
                                : 'bg-stone-900 text-stone-300 border border-stone-700/80 hover:bg-stone-800'
                            }`}
                          >
                            {isPlaying ? (
                              <>
                                <Square className="w-3 h-3 fill-current" />
                                <span>{isFa ? 'توقف' : 'Stop'}</span>
                              </>
                            ) : (
                              <>
                                <Play className="w-3 h-3 fill-current text-indigo-400" />
                                <span>{isFa ? 'پخش' : 'Play'}</span>
                              </>
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 2.3 Additional Alarm Preferences */}
                <div className="pt-2 border-t border-stone-800/80">
                  <label className="min-h-[48px] flex items-center justify-between p-2.5 rounded-xl bg-stone-900/70 border border-stone-800 cursor-pointer">
                    <span className="text-xs font-bold text-white">
                      {settings.language === 'en' ? t.autoMicInput : 'میکروفون خودکار فرم'}
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.autoVoiceInput}
                      onChange={(e) => onUpdateSettings({ autoVoiceInput: e.target.checked })}
                      className="w-4 h-4 rounded accent-indigo-500"
                    />
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* ========================================================= */}
          {/* 3. PERMISSIONS HUB (دسترسی‌ها - ردیف فشرده) */}
          {/* ========================================================= */}
          <div className="rounded-2xl border border-stone-800 bg-stone-950/60 overflow-hidden transition-all shadow-sm">
            <button
              type="button"
              onClick={() => toggleSection('permissions')}
              className="w-full min-h-[48px] p-3.5 sm:p-4 bg-stone-900/60 hover:bg-stone-900 border-b border-stone-800/80 flex items-center justify-between gap-3 transition-colors cursor-pointer text-start"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400 shrink-0">
                  <ShieldCheck className="w-4.5 h-4.5" />
                </div>
                <div className="min-w-0">
                  <h4 className="text-xs sm:text-sm font-black text-white truncate">
                    {isFa ? '۳. مدیریت دسترسی‌ها' : '3. App Permissions'}
                  </h4>
                  <p className="text-[11px] text-stone-400 truncate">
                    {isFa
                      ? `${toPersianDigits(Object.values(nativePerms).filter(Boolean).length)} از ۵ دسترسی تایید شده است`
                      : `${Object.values(nativePerms).filter(Boolean).length} of 5 permissions granted`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {isNativeAndroidApp() && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                    Android APK
                  </span>
                )}
                <ChevronDown className={`w-4 h-4 text-stone-400 transition-transform duration-200 ${openSections.permissions ? 'rotate-180 text-sky-400' : ''}`} />
              </div>
            </button>

            {openSections.permissions && (
              <div className="p-3 sm:p-4 space-y-3 animate-in fade-in">
                {/* 3.1 وضعیت دسترسی‌ها توی یه ردیف فشرده (COMPACT PERMISSIONS ROW) */}
                <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
                  {/* 1. Notifications */}
                  <div
                    onClick={() => !nativePerms.notifications && handleRequestPerm('notifications')}
                    className={`min-h-[56px] p-2 rounded-xl border flex flex-col items-center justify-center text-center transition-all ${
                      nativePerms.notifications
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                        : 'bg-stone-900/80 border-stone-800 text-stone-400 hover:border-indigo-500/50 cursor-pointer active:scale-95'
                    }`}
                    title={isFa ? 'دسترسی اعلان‌ها' : 'Notifications'}
                  >
                    <div className="relative mb-1">
                      <Bell className={`w-4 h-4 ${nativePerms.notifications ? 'text-emerald-400' : 'text-stone-400'}`} />
                      <span className={`absolute -top-1 -end-1 w-2 h-2 rounded-full ${nativePerms.notifications ? 'bg-emerald-400' : 'bg-indigo-400 animate-pulse'}`} />
                    </div>
                    <span className="text-[10px] sm:text-[11px] font-bold text-stone-200 truncate w-full block">
                      {isFa ? 'اعلان' : 'Alert'}
                    </span>
                    <span className={`text-[9px] font-bold ${nativePerms.notifications ? 'text-emerald-400' : 'text-indigo-400'}`}>
                      {nativePerms.notifications ? 'تایید ✓' : (isFa ? 'تایید' : 'Allow')}
                    </span>
                  </div>

                  {/* 2. Microphone */}
                  <div
                    onClick={() => !nativePerms.microphone && handleRequestPerm('microphone')}
                    className={`min-h-[56px] p-2 rounded-xl border flex flex-col items-center justify-center text-center transition-all ${
                      nativePerms.microphone
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                        : 'bg-stone-900/80 border-stone-800 text-stone-400 hover:border-indigo-500/50 cursor-pointer active:scale-95'
                    }`}
                    title={isFa ? 'دسترسی میکروفون و صوت' : 'Microphone'}
                  >
                    <div className="relative mb-1">
                      <Mic className={`w-4 h-4 ${nativePerms.microphone ? 'text-emerald-400' : 'text-stone-400'}`} />
                      <span className={`absolute -top-1 -end-1 w-2 h-2 rounded-full ${nativePerms.microphone ? 'bg-emerald-400' : 'bg-indigo-400 animate-pulse'}`} />
                    </div>
                    <span className="text-[10px] sm:text-[11px] font-bold text-stone-200 truncate w-full block">
                      {isFa ? 'میکروفون' : 'Mic'}
                    </span>
                    <span className={`text-[9px] font-bold ${nativePerms.microphone ? 'text-emerald-400' : 'text-indigo-400'}`}>
                      {nativePerms.microphone ? 'تایید ✓' : (isFa ? 'تایید' : 'Allow')}
                    </span>
                  </div>

                  {/* 3. Camera */}
                  <div
                    onClick={() => !nativePerms.camera && handleRequestPerm('camera')}
                    className={`min-h-[56px] p-2 rounded-xl border flex flex-col items-center justify-center text-center transition-all ${
                      nativePerms.camera
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                        : 'bg-stone-900/80 border-stone-800 text-stone-400 hover:border-indigo-500/50 cursor-pointer active:scale-95'
                    }`}
                    title={isFa ? 'دسترسی دوربین' : 'Camera'}
                  >
                    <div className="relative mb-1">
                      <Camera className={`w-4 h-4 ${nativePerms.camera ? 'text-emerald-400' : 'text-stone-400'}`} />
                      <span className={`absolute -top-1 -end-1 w-2 h-2 rounded-full ${nativePerms.camera ? 'bg-emerald-400' : 'bg-indigo-400 animate-pulse'}`} />
                    </div>
                    <span className="text-[10px] sm:text-[11px] font-bold text-stone-200 truncate w-full block">
                      {isFa ? 'دوربین' : 'Camera'}
                    </span>
                    <span className={`text-[9px] font-bold ${nativePerms.camera ? 'text-emerald-400' : 'text-indigo-400'}`}>
                      {nativePerms.camera ? 'تایید ✓' : (isFa ? 'تایید' : 'Allow')}
                    </span>
                  </div>

                  {/* 4. GPS / Location */}
                  <div
                    onClick={() => !nativePerms.location && handleRequestPerm('location')}
                    className={`min-h-[56px] p-2 rounded-xl border flex flex-col items-center justify-center text-center transition-all ${
                      nativePerms.location
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                        : 'bg-stone-900/80 border-stone-800 text-stone-400 hover:border-indigo-500/50 cursor-pointer active:scale-95'
                    }`}
                    title={isFa ? 'دسترسی موقعیت مکانی GPS' : 'GPS Location'}
                  >
                    <div className="relative mb-1">
                      <MapPin className={`w-4 h-4 ${nativePerms.location ? 'text-emerald-400' : 'text-stone-400'}`} />
                      <span className={`absolute -top-1 -end-1 w-2 h-2 rounded-full ${nativePerms.location ? 'bg-emerald-400' : 'bg-indigo-400 animate-pulse'}`} />
                    </div>
                    <span className="text-[10px] sm:text-[11px] font-bold text-stone-200 truncate w-full block">
                      {isFa ? 'موقعیت' : 'GPS'}
                    </span>
                    <span className={`text-[9px] font-bold ${nativePerms.location ? 'text-emerald-400' : 'text-indigo-400'}`}>
                      {nativePerms.location ? 'تایید ✓' : (isFa ? 'تایید' : 'Allow')}
                    </span>
                  </div>

                  {/* 5. Folder / Storage (Yaad reminder) */}
                  <div
                    onClick={() => handleRequestPerm('storage')}
                    className={`min-h-[56px] p-2 rounded-xl border flex flex-col items-center justify-center text-center transition-all cursor-pointer active:scale-95 ${
                      nativePerms.storage
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                        : 'bg-stone-900/80 border-stone-800 text-stone-400 hover:border-indigo-500/50'
                    }`}
                    title={isFa ? 'دسترسی پوشه Yaad reminder' : 'Yaad reminder Folder'}
                  >
                    <div className="relative mb-1">
                      <FolderOpen className={`w-4 h-4 ${nativePerms.storage ? 'text-emerald-400' : 'text-stone-400'}`} />
                      <span className={`absolute -top-1 -end-1 w-2 h-2 rounded-full ${nativePerms.storage ? 'bg-emerald-400' : 'bg-indigo-400 animate-pulse'}`} />
                    </div>
                    <span className="text-[10px] sm:text-[11px] font-bold text-stone-200 truncate w-full block">
                      {isFa ? 'پوشه و حافظه' : 'Folders'}
                    </span>
                    <span className={`text-[9px] font-bold ${nativePerms.storage ? 'text-emerald-400' : 'text-indigo-400'}`}>
                      {nativePerms.storage ? 'تایید ✓' : (isFa ? 'تایید' : 'Allow')}
                    </span>
                  </div>
                </div>

                {/* 3.1B Dedicated Folder & Storage Permission Card inside App Permissions */}
                <div className="p-3 rounded-2xl bg-stone-900/80 border border-emerald-500/30 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-bold text-white">
                      <FolderOpen className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>
                        {isFa
                          ? 'دسترسی به پوشه‌ها و حافظه (پوشه Yaad reminder)'
                          : 'Folders & Storage Access (Yaad reminder)'}
                      </span>
                    </div>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
                        nativePerms.storage
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40'
                          : 'bg-amber-500/20 text-amber-300 border-amber-400/40'
                      }`}
                    >
                      {nativePerms.storage
                        ? isFa
                          ? 'فعال ✓'
                          : 'Active ✓'
                        : isFa
                          ? 'آماده فعال‌سازی'
                          : 'Ready'}
                    </span>
                  </div>

                  <p className="text-[11px] text-stone-300 leading-relaxed">
                    {isFa
                      ? 'نکته اندروید ۱۱ تا ۱۵: در نسخه‌های جدید اندروید، گزینه «دسترسی به پوشه‌ها» از داخل لیست عادی App Permissions حذف شده و به بخش «دسترسی ویژه برنامه‌ها ← دسترسی به همه فایل‌ها (All files access)» منتقل شده است. با دکمه‌های زیر می‌توانید مستقیماً پوشه Yaad reminder را ایجاد کنید یا صفحه دسترسی به همه فایل‌ها را باز نمایید:'
                      : 'Android 11–15 Note: Folder access is no longer inside standard App Permissions; Android moved it to "Special app access -> All files access". Use the buttons below to create the Yaad reminder folder directly or open All Files Access:'}
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={isLocalSyncing}
                      onClick={() => finalizeLocalFolderSelection(localFolderInput, false)}
                      className="min-h-[40px] px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-black flex items-center justify-center gap-1.5 shadow-sm cursor-pointer active:scale-95 transition-all"
                    >
                      <FolderOpen className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        {isFa
                          ? 'ایجاد مستقیم پوشه Yaad reminder'
                          : 'Create Yaad reminder Folder'}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => openAndroidSettings('all_files')}
                      className="min-h-[40px] px-3 py-2 rounded-xl bg-stone-950 hover:bg-stone-800 border border-stone-700 text-stone-200 hover:text-white text-[11px] font-bold flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 transition-all"
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                      <span>
                        {isFa
                          ? 'باز کردن «دسترسی به همه فایل‌ها» در اندروید'
                          : 'Open Android "All Files Access"'}
                      </span>
                    </button>
                  </div>
                </div>

                {/* 3.2 Request All Permissions at Once Button */}
                <button
                  type="button"
                  disabled={isRequestingAllPerms}
                  onClick={handleRequestAllPerms}
                  className="w-full min-h-[48px] py-2.5 px-3 rounded-xl bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white text-xs font-black transition-all shadow-md shadow-sky-950/40 active:scale-95 cursor-pointer flex items-center justify-center gap-2"
                >
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                  <span>
                    {isRequestingAllPerms
                      ? (isFa ? 'در حال ثبت درخواست‌ها...' : 'Requesting...')
                      : (isFa ? 'درخواست یکجای تمامی دسترسی‌های لازم' : 'Grant All Required Permissions')}
                  </span>
                </button>
              </div>
            )}
          </div>

          {/* ========================================================= */}
          {/* 4. SYNC & CLOUD SERVICES (همگام‌سازی) */}
          {/* ========================================================= */}
          <div className="rounded-2xl border border-stone-800 bg-stone-950/60 overflow-hidden transition-all shadow-sm">
            <button
              type="button"
              onClick={() => toggleSection('sync')}
              className="w-full min-h-[48px] p-3.5 sm:p-4 bg-stone-900/60 hover:bg-stone-900 border-b border-stone-800/80 flex items-center justify-between gap-3 transition-colors cursor-pointer text-start"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400 shrink-0">
                  <Cloud className="w-4.5 h-4.5" />
                </div>
                <div className="min-w-0">
                  <h4 className="text-xs sm:text-sm font-black text-white truncate">
                    {isFa ? '۴. همگام‌سازی و سرویس‌ها' : '4. Sync & Services'}
                  </h4>
                  <p className="text-[11px] text-stone-400 truncate">
                    {googleUser
                      ? (isFa ? `گوگل: ${googleUser.email}` : `Google: ${googleUser.email}`)
                      : (isFa ? 'اتصال به تقویم گوگل، نقشه و حصار مکانی' : 'Google Calendar, Maps & Geofence')}
                  </p>
                </div>
              </div>
              <ChevronDown className={`w-4 h-4 text-stone-400 transition-transform duration-200 shrink-0 ${openSections.sync ? 'rotate-180 text-sky-400' : ''}`} />
            </button>

            {openSections.sync && (
              <div className="p-3 sm:p-4 space-y-4 animate-in fade-in">
                {/* 4.1 Google Workspace Sync */}
                <div className="p-3.5 rounded-2xl bg-stone-900/70 border border-stone-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold text-stone-200">
                      <Cloud className="w-4 h-4 text-sky-400" />
                      <span>{isFa ? 'همگام‌سازی تقویم گوگل (Google Calendar)' : 'Google Calendar Sync'}</span>
                    </div>
                    {googleUser && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-bold">
                        {isFa ? 'متصل' : 'Connected'}
                      </span>
                    )}
                  </div>

                  <div className="p-3 rounded-xl bg-stone-950 border border-stone-800 flex items-center justify-between gap-3">
                    <div className="truncate">
                      {googleUser ? (
                        <p className="text-xs font-semibold text-white truncate">{googleUser.email}</p>
                      ) : (
                        <p className="text-xs text-stone-400">{isFa ? 'اتصال به تقویم و تسک‌های گوگل' : 'Connect to Google Calendar & Tasks'}</p>
                      )}
                    </div>

                    {googleUser ? (
                      <button
                        type="button"
                        onClick={onGoogleSignOut}
                        className="min-h-[40px] flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-700 hover:bg-rose-600 text-white text-xs font-bold cursor-pointer active:scale-95 shadow-sm"
                      >
                        <LogOut className="w-3.5 h-3.5 text-white" />
                        <span className="text-white">{isFa ? 'خروج' : 'Sign Out'}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={async () => {
                          setIsSigningIn(true);
                          try {
                            await onGoogleSignIn();
                          } finally {
                            setIsSigningIn(false);
                          }
                        }}
                        disabled={isSigningIn}
                        className="min-h-[44px] flex items-center gap-2 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-md shadow-blue-600/30 disabled:opacity-50"
                      >
                        <span>{isSigningIn ? (settings.language === 'en' ? 'Connecting...' : 'اتصال...') : (settings.language === 'en' ? 'Sign in with Google' : 'ورود با گوگل')}</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* 4.2 Geofence Radar */}
                <div className="p-3.5 rounded-2xl bg-stone-900/70 border border-stone-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold text-stone-200">
                      <Radio className={`w-4 h-4 ${isGeofenceActive ? 'text-emerald-400 animate-pulse' : 'text-stone-400'}`} />
                      <span>{isFa ? 'رادار پایش حصار مکانی (Geofence)' : 'Geofence Radar'}</span>
                    </div>
                    <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold border ${
                      isGeofenceActive 
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' 
                        : 'bg-stone-800 text-stone-400 border-stone-700'
                    }`}>
                      {isGeofenceActive ? (isFa ? 'فعال' : 'Active') : (isFa ? 'متوقف' : 'Paused')}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-stone-950 border border-stone-800/80">
                    <div>
                      <span className="text-xs font-bold text-white block">
                        {isFa ? 'پایش ورود/خروج حصارها' : 'Background Geofencing'}
                      </span>
                      <span className="text-[11px] text-stone-400">
                        {isFa ? 'پایش هوشمند GPS با مصرف بهینه باتری' : 'Low-battery GPS tracking'}
                      </span>
                    </div>

                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        checked={isGeofenceActive}
                        onChange={(e) => {
                          const next = e.target.checked;
                          setGeofenceTrackingEnabled(next);
                          if (onToggleGeofenceActive) onToggleGeofenceActive(next);
                        }}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-stone-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                    </label>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div className="flex items-center justify-between p-2 rounded-xl bg-stone-950 border border-stone-800">
                      <span className="text-stone-400 text-[11px]">{isFa ? 'حصارهای فعال:' : 'Active:'}</span>
                      <span className="font-bold text-emerald-400">
                        {isFa 
                          ? `${toPersianDigits(reminders.filter((r) => r.geofence && r.geofence.enabled && r.status !== 'completed').length)} مکان` 
                          : `${reminders.filter((r) => r.geofence && r.geofence.enabled && r.status !== 'completed').length} Places`}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={async () => {
                        const status = await requestLocationPermission();
                        if (status) {
                          alert(isFa ? 'مجوز موقعیت مکانی GPS فعال است.' : 'Location GPS permission is active.');
                        } else {
                          alert(isFa ? 'دسترسی GPS در مرورگر یا دستگاه شما مسدود است.' : 'Location permission is denied.');
                        }
                      }}
                      className="min-h-[40px] flex items-center justify-center gap-1.5 p-2 rounded-xl bg-stone-950 hover:bg-stone-800 border border-stone-800 text-stone-300 hover:text-white transition-colors cursor-pointer text-[11px] font-bold"
                    >
                      <Crosshair className="w-3.5 h-3.5 text-teal-400" />
                      <span>{isFa ? 'بررسی GPS' : 'Check GPS'}</span>
                    </button>
                  </div>
                </div>

                {/* 4.3 Google Maps API Settings */}
                <div className="p-3.5 rounded-2xl bg-stone-900/70 border border-stone-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-stone-200">
                      {settings.language === 'en' ? t.mapsServiceTitle : 'تنظیمات کلید Google Maps'}
                    </span>
                    <span className="text-[10px] text-stone-400">{settings.language === 'en' ? 'Optional' : 'اختیاری'}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={mapsKeyInput}
                      onChange={(e) => setMapsKeyInput(e.target.value)}
                      placeholder="Google Maps API Key"
                      className="flex-1 min-h-[44px] px-3 py-2 rounded-xl bg-stone-950 border border-stone-800 text-white placeholder-stone-600 text-xs font-mono focus:outline-none focus:border-emerald-500/70"
                    />
                    <button
                      type="button"
                      onClick={handleSaveMapsKey}
                      className="min-h-[44px] px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1 active:scale-95 transition-all cursor-pointer"
                    >
                      {keySavedMessage ? <Check className="w-4 h-4 text-white" /> : null}
                      <span>{keySavedMessage ? (settings.language === 'en' ? t.saved : 'ذخیره شد') : (settings.language === 'en' ? t.save : 'ذخیره')}</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ========================================================= */}
          {/* 5. BACKUP & SYSTEM (پشتیبان‌گیری و سیستم) */}
          {/* ========================================================= */}
          <div className="rounded-2xl border border-stone-800 bg-stone-950/60 overflow-hidden transition-all shadow-sm">
            <button
              type="button"
              onClick={() => toggleSection('backup')}
              className="w-full min-h-[48px] p-3.5 sm:p-4 bg-stone-900/60 hover:bg-stone-900 border-b border-stone-800/80 flex items-center justify-between gap-3 transition-colors cursor-pointer text-start"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                  <Database className="w-4.5 h-4.5" />
                </div>
                <div className="min-w-0">
                  <h4 className="text-xs sm:text-sm font-black text-white truncate">
                    {isFa ? '۵. پشتیبان‌گیری و اطلاعات' : '5. Backup & Data'}
                  </h4>
                  <p className="text-[11px] text-stone-400 truncate">
                    {isFa ? 'دانلود و بازیابی فایل JSON • آمار عملکرد' : 'JSON Export/Import • Performance Stats'}
                  </p>
                </div>
              </div>
              <ChevronDown className={`w-4 h-4 text-stone-400 transition-transform duration-200 shrink-0 ${openSections.backup ? 'rotate-180 text-emerald-400' : ''}`} />
            </button>

            {openSections.backup && (
              <div className="p-3 sm:p-4 space-y-4 animate-in fade-in">
                {/* 5.1 Item Count Badges */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                  <div className="p-2 rounded-xl bg-stone-900/80 border border-stone-800">
                    <span className="text-[10px] text-stone-500 block">{isFa ? 'یادآورها' : 'Reminders'}</span>
                    <span className="font-bold text-indigo-400 text-sm">{isFa ? toPersianDigits(reminders.length) : reminders.length}</span>
                  </div>
                  <div className="p-2 rounded-xl bg-stone-900/80 border border-stone-800">
                    <span className="text-[10px] text-stone-500 block">{isFa ? 'مناسبت‌ها' : 'Occasions'}</span>
                    <span className="font-bold text-pink-400 text-sm">{isFa ? toPersianDigits(occasions.length) : occasions.length}</span>
                  </div>
                  <div className="p-2 rounded-xl bg-stone-900/80 border border-stone-800">
                    <span className="text-[10px] text-stone-500 block">{isFa ? 'ایده‌ها' : 'Ideas'}</span>
                    <span className="font-bold text-sky-400 text-sm">{isFa ? toPersianDigits(ideas.length) : ideas.length}</span>
                  </div>
                  <div className="p-2 rounded-xl bg-stone-900/80 border border-stone-800">
                    <span className="text-[10px] text-stone-500 block">{isFa ? 'مکان‌های GPS' : 'GPS Places'}</span>
                    <span className="font-bold text-emerald-400 text-sm">{isFa ? toPersianDigits(savedLocations.length) : savedLocations.length}</span>
                  </div>
                </div>

                {/* Alerts */}
                {backupSuccessMessage && (
                  <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2 animate-in fade-in">
                    <Check className="w-4 h-4 flex-shrink-0 text-emerald-400" />
                    <span>{backupSuccessMessage}</span>
                  </div>
                )}
                {backupErrorMessage && (
                  <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2 animate-in fade-in">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-400" />
                    <span>{backupErrorMessage}</span>
                  </div>
                )}

                {/* 5.1A Local Folder Automatic Backup (پوشه محلی Yaad reminder) */}
                <div className="p-3.5 rounded-2xl bg-stone-900/75 border border-stone-800 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-bold text-white">
                      <HardDrive className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>
                        {isFa
                          ? 'پشتیبان‌گیری خودکار محلی در حافظه گوشی'
                          : 'Automatic Local Folder Backup'}
                      </span>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-bold">
                      {isFa ? 'فعال (خودکار)' : 'Auto Active'}
                    </span>
                  </div>

                  <p className="text-[11px] text-stone-400 leading-relaxed">
                    {isFa
                      ? 'در هر بار بستن، باز شدن و نصب مجدد برنامه، اطلاعات شما به‌صورت خودکار در پوشه محلی زیر ذخیره و فراخوانی می‌شود:'
                      : 'Automatically saves and restores your data in the specified local folder on every app open, close, and reinstall:'}
                  </p>

                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl bg-stone-950 border border-stone-800">
                      <FolderOpen className="w-4 h-4 text-emerald-400 shrink-0" />
                      <input
                        type="text"
                        value={localFolderInput}
                        onChange={(e) => setLocalFolderInput(e.target.value)}
                        placeholder="Yaad reminder"
                        className="w-full bg-transparent text-xs font-mono text-white focus:outline-none"
                      />
                    </div>
                    <button
                      type="button"
                      disabled={isLocalSyncing}
                      onClick={handleSelectLocalFolder}
                      className="min-h-[40px] px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all cursor-pointer active:scale-95 flex items-center justify-center gap-1.5 shrink-0"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      <span>{isFa ? 'معرفی / انتخاب محل پوشه' : 'Select / Set Folder'}</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      type="button"
                      disabled={isLocalSyncing}
                      onClick={() => finalizeLocalFolderSelection(localFolderInput)}
                      className="min-h-[40px] px-3 py-2 rounded-xl bg-stone-950 hover:bg-stone-800 border border-stone-800 text-stone-200 text-[11px] font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>{isFa ? 'ذخیره فوری در پوشه محلی' : 'Save to Local Folder'}</span>
                    </button>
                    <button
                      type="button"
                      disabled={isLocalSyncing}
                      onClick={handleRecallFromLocalFolder}
                      className="min-h-[40px] px-3 py-2 rounded-xl bg-stone-950 hover:bg-stone-800 border border-stone-800 text-stone-200 text-[11px] font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 text-sky-400 ${isLocalSyncing ? 'animate-spin' : ''}`} />
                      <span>{isFa ? 'فراخوانی از پوشه محلی' : 'Recall from Local Folder'}</span>
                    </button>
                  </div>
                </div>

                {/* 5.1B Optional Cloud Backup in ANY User-Requested Space (به انتخاب کاربر در هر فضای ابری دلخواه - غیر الزامی) */}
                <div className="p-3.5 rounded-2xl bg-stone-900/75 border border-stone-800 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-xs font-bold text-white">
                        <Cloud className="w-4 h-4 text-sky-400 shrink-0" />
                        <span>
                          {isFa
                            ? 'پشتیبان‌گیری در فضای ابری دلخواه کاربر (اختیاری)'
                            : 'Cloud Backup in Any User Space (Optional)'}
                        </span>
                      </div>
                      <p className="text-[11px] text-stone-400 mt-0.5 leading-relaxed">
                        {isFa
                          ? 'استفاده از فضای ابری کاملاً اختیاری است. می‌توانید هر فضای ابری مورد نظر خود (OneDrive، Dropbox، iCloud، Mega، WebDAV، گوگل درایو یا هر پوشه دلخواه) را معرفی کنید.'
                          : 'Optional cloud storage. Use any cloud space you prefer (OneDrive, Dropbox, iCloud, Mega, WebDAV, Google Drive, or any custom folder).'}
                      </p>
                    </div>

                    {/* High-Contrast Sliding Toggle Switch for Optional Cloud Backup */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={Boolean(settings.cloudBackupEnabled)}
                      onClick={() =>
                        onUpdateSettings({ cloudBackupEnabled: !settings.cloudBackupEnabled })
                      }
                      className={`inline-flex items-center gap-2 px-2.5 py-1.5 rounded-xl border transition-all cursor-pointer shrink-0 ${
                        settings.cloudBackupEnabled
                          ? 'bg-emerald-500/20 border-emerald-400/80 text-white'
                          : 'bg-stone-950 border-stone-700 text-stone-300'
                      }`}
                    >
                      <span className="text-[11px] font-bold text-white">
                        {settings.cloudBackupEnabled
                          ? isFa ? 'فعال' : 'ON'
                          : isFa ? 'غیرفعال' : 'OFF'}
                      </span>
                      <div
                        className={`relative w-11 h-6 rounded-full transition-colors border ${
                          settings.cloudBackupEnabled
                            ? 'bg-emerald-500 border-emerald-300'
                            : 'bg-stone-700 border-stone-500'
                        }`}
                      >
                        <span
                          className={`absolute top-[2px] w-4.5 h-4.5 rounded-full bg-white shadow-md transition-all ${
                            settings.cloudBackupEnabled ? 'start-[22px]' : 'start-[2px]'
                          }`}
                        />
                      </div>
                    </button>
                  </div>

                  {/* Cloud Provider / Method Selector (Any Cloud Space, not just Google) */}
                  <div className="space-y-2 pt-2 border-t border-stone-800/80">
                    <label className="text-[11px] text-stone-300 font-bold block">
                      {isFa
                        ? 'نوع فضای ابری مورد نظر خود را انتخاب کنید:'
                        : 'Select Your Preferred Cloud Space Type:'}
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setCloudProvider('custom_cloud_folder');
                          onUpdateSettings({ cloudBackupProvider: 'custom_cloud_folder' });
                        }}
                        className={`p-2 rounded-xl border text-[11px] font-bold text-center transition-all cursor-pointer ${
                          cloudProvider === 'custom_cloud_folder'
                            ? 'bg-sky-500/20 border-sky-400 text-white shadow-sm'
                            : 'bg-stone-950 border-stone-800 text-stone-400 hover:text-stone-200'
                        }`}
                      >
                        {isFa
                          ? 'پوشه هر فضای ابری (OneDrive / Dropbox / iCloud / ...)'
                          : 'Any Cloud Folder (OneDrive / Dropbox / iCloud)'}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setCloudProvider('webdav_url');
                          onUpdateSettings({ cloudBackupProvider: 'webdav_url' });
                        }}
                        className={`p-2 rounded-xl border text-[11px] font-bold text-center transition-all cursor-pointer ${
                          cloudProvider === 'webdav_url'
                            ? 'bg-sky-500/20 border-sky-400 text-white shadow-sm'
                            : 'bg-stone-950 border-stone-800 text-stone-400 hover:text-stone-200'
                        }`}
                      >
                        {isFa
                          ? 'سرور / لینک ابری دلخواه (WebDAV / Nextcloud)'
                          : 'Custom Cloud URL / WebDAV Server'}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setCloudProvider('google_drive');
                          onUpdateSettings({ cloudBackupProvider: 'google_drive' });
                        }}
                        className={`p-2 rounded-xl border text-[11px] font-bold text-center transition-all cursor-pointer ${
                          cloudProvider === 'google_drive'
                            ? 'bg-sky-500/20 border-sky-400 text-white shadow-sm'
                            : 'bg-stone-950 border-stone-800 text-stone-400 hover:text-stone-200'
                        }`}
                      >
                        {isFa ? 'گوگل درایو (Google Drive)' : 'Google Drive'}
                      </button>
                    </div>
                  </div>

                  {/* Cloud Folder / Path Specification */}
                  <div className="space-y-2 pt-1">
                    <label className="text-[11px] text-stone-300 font-bold block">
                      {isFa
                        ? 'معرفی محل و نام پوشه در فضای ابری مورد نظر:'
                        : 'Target Cloud Space & Folder Name:'}
                    </label>

                    {cloudProvider === 'custom_cloud_folder' && (
                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                        <input
                          type="text"
                          value={cloudSpaceLabelInput}
                          onChange={(e) => setCloudSpaceLabelInput(e.target.value)}
                          placeholder={
                            isFa
                              ? 'نام سرویس دلخواه (مثلاً OneDrive، Dropbox، iCloud، Mega...)'
                              : 'Cloud service name (e.g. OneDrive, Dropbox, iCloud, Mega...)'
                          }
                          className="flex-1 px-3 py-2 rounded-xl bg-stone-950 border border-stone-800 text-xs text-white placeholder-stone-500 focus:outline-none focus:border-sky-500/60"
                        />
                        <button
                          type="button"
                          disabled={isCloudSyncing}
                          onClick={handleSelectAnyCloudFolder}
                          className="min-h-[40px] px-3 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition-all cursor-pointer active:scale-95 flex items-center justify-center gap-1.5 shrink-0"
                        >
                          <FolderOpen className="w-3.5 h-3.5" />
                          <span>
                            {isFa ? 'انتخاب پوشه فضای ابری از دستگاه' : 'Browse Cloud Folder'}
                          </span>
                        </button>
                      </div>
                    )}

                    {cloudProvider === 'webdav_url' && (
                      <div className="space-y-2">
                        <input
                          type="url"
                          dir="ltr"
                          value={cloudUrlInput}
                          onChange={(e) => setCloudUrlInput(e.target.value)}
                          placeholder="https://your-cloud-server.com/remote.php/dav/files/user"
                          className="w-full px-3 py-2 rounded-xl bg-stone-950 border border-stone-800 text-xs font-mono text-white placeholder-stone-500 focus:outline-none focus:border-sky-500/60"
                        />
                        <input
                          type="password"
                          dir="ltr"
                          value={cloudAuthInput}
                          onChange={(e) => setCloudAuthInput(e.target.value)}
                          placeholder={
                            isFa
                              ? 'توکن یا نام‌کاربری:رمزعبور (اختیاری - مثلاً user:pass)'
                              : 'Auth Token or username:password (Optional)'
                          }
                          className="w-full px-3 py-2 rounded-xl bg-stone-950 border border-stone-800 text-xs font-mono text-white placeholder-stone-500 focus:outline-none focus:border-sky-500/60"
                        />
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl bg-stone-950 border border-stone-800">
                        <Cloud className="w-4 h-4 text-sky-400 shrink-0" />
                        <input
                          type="text"
                          value={cloudFolderInput}
                          onChange={(e) => setCloudFolderInput(e.target.value)}
                          placeholder="Yaad reminder"
                          className="w-full bg-transparent text-xs font-mono text-white focus:outline-none"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleSaveCloudFolder}
                        className="min-h-[40px] px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition-all cursor-pointer active:scale-95 shrink-0"
                      >
                        {isFa ? 'ثبت محل' : 'Save Location'}
                      </button>
                    </div>
                  </div>

                  {/* Provider-specific & Universal Cloud Sync Controls */}
                  {cloudProvider === 'google_drive' && !googleUser && (
                    <div className="p-2.5 rounded-xl bg-stone-950 border border-stone-800 flex items-center justify-between gap-2">
                      <span className="text-[11px] text-stone-400">
                        {isFa
                          ? 'در صورت تمایل به استفاده از گوگل درایو، وارد حساب شوید:'
                          : 'Sign in with Google if you wish to use Google Drive:'}
                      </span>
                      <button
                        type="button"
                        onClick={async () => {
                          setIsSigningIn(true);
                          try {
                            await onGoogleSignIn();
                          } finally {
                            setIsSigningIn(false);
                          }
                        }}
                        disabled={isSigningIn}
                        className="min-h-[38px] px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs cursor-pointer shrink-0"
                      >
                        {isSigningIn
                          ? isFa ? 'اتصال...' : 'Connecting...'
                          : isFa ? 'ورود با گوگل' : 'Sign in with Google'}
                      </button>
                    </div>
                  )}

                  <div className="space-y-2 pt-1">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <button
                        type="button"
                        disabled={isCloudSyncing}
                        onClick={() => setConfirmCloudUpload(true)}
                        className="min-h-[40px] px-3 py-2 rounded-xl bg-stone-950 hover:bg-stone-800 border border-stone-800 text-stone-200 text-[11px] font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Cloud className="w-3.5 h-3.5 text-emerald-400" />
                        <span>{isFa ? 'ذخیره در فضای ابری' : 'Save to Cloud Space'}</span>
                      </button>

                      <button
                        type="button"
                        disabled={isCloudSyncing}
                        onClick={handleRecallFromCloudDrive}
                        className="min-h-[40px] px-3 py-2 rounded-xl bg-stone-950 hover:bg-stone-800 border border-stone-800 text-stone-200 text-[11px] font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 text-sky-400 ${isCloudSyncing ? 'animate-spin' : ''}`} />
                        <span>{isFa ? 'فراخوانی از فضای ابری' : 'Restore from Cloud'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleShareToAnyCloudApp}
                        className="min-h-[40px] px-3 py-2 rounded-xl bg-stone-950 hover:bg-stone-800 border border-stone-800 text-stone-200 text-[11px] font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-amber-400" />
                        <span>
                          {isFa
                            ? 'ارسال به هر برنامه ابری گوشی'
                            : 'Send to Any Cloud App'}
                        </span>
                      </button>
                    </div>

                    {/* Confirmation Dialog for Manual Cloud Backup Overwrite */}
                    {confirmCloudUpload && (
                      <div className="p-3 rounded-xl bg-sky-500/10 border border-sky-500/30 space-y-2 animate-in fade-in">
                        <p className="text-xs text-stone-200">
                          {isFa
                            ? `آیا مایلید فایل پشتیبان فعلی در پوشه «${cloudFolderInput.trim() || DRIVE_BACKUP_FOLDER_NAME}» فضای ابری انتخابی ذخیره و به‌روزرسانی شود؟`
                            : `Update backup file in cloud folder "${cloudFolderInput.trim() || DRIVE_BACKUP_FOLDER_NAME}"?`}
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={handleConfirmedCloudBackup}
                            className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold cursor-pointer"
                          >
                            {isFa ? 'تایید و ذخیره' : 'Confirm'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmCloudUpload(false)}
                            className="px-3 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-300 text-xs font-bold cursor-pointer"
                          >
                            {isFa ? 'انصراف' : 'Cancel'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* 5.2 Download & Upload Buttons (min 48px) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={handleDownloadBackup}
                    className="min-h-[48px] flex items-center justify-center gap-2 p-3 rounded-xl bg-stone-900 hover:bg-stone-800 border border-stone-700/80 text-white font-bold text-xs shadow-sm hover:border-emerald-500/50 transition-all cursor-pointer active:scale-95"
                  >
                    <Download className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>{isFa ? 'دانلود فایل پشتیبان (JSON)' : 'Download Backup (JSON)'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="min-h-[48px] flex items-center justify-center gap-2 p-3 rounded-xl bg-stone-900 hover:bg-stone-800 border border-stone-700/80 text-white font-bold text-xs shadow-sm hover:border-sky-500/50 transition-all cursor-pointer active:scale-95"
                  >
                    <Upload className="w-4 h-4 text-sky-400 shrink-0" />
                    <span>{isFa ? 'بازیابی از فایل JSON' : 'Restore from JSON File'}</span>
                  </button>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json,application/json"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </div>

                {/* Pending Restore Confirmation Box */}
                {pendingRestoreData && (
                  <div className="p-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 space-y-3 animate-in fade-in">
                    <div className="flex items-center gap-2 text-xs font-bold text-indigo-300">
                      <FileJson className="w-4 h-4 shrink-0" />
                      <span>{isFa ? 'فایل پشتیبان با موفقیت شناسایی شد:' : 'Backup file parsed:'}</span>
                    </div>

                    <div className="text-xs text-stone-300 space-y-1 pr-2">
                      <p>• {isFa ? 'تعداد یادآورها:' : 'Reminders:'} <strong className="text-white">{isFa ? toPersianDigits(pendingRestoreData.reminders?.length || 0) : (pendingRestoreData.reminders?.length || 0)}</strong></p>
                      <p>• {isFa ? 'تعداد مناسبت‌ها:' : 'Occasions:'} <strong className="text-white">{isFa ? toPersianDigits(pendingRestoreData.occasions?.length || 0) : (pendingRestoreData.occasions?.length || 0)}</strong></p>
                      <p>• {isFa ? 'تعداد ایده‌ها:' : 'Ideas:'} <strong className="text-white">{isFa ? toPersianDigits(pendingRestoreData.ideas?.length || 0) : (pendingRestoreData.ideas?.length || 0)}</strong></p>
                      <p>• {isFa ? 'تعداد مکان‌های GPS:' : 'GPS Places:'} <strong className="text-white">{isFa ? toPersianDigits(pendingRestoreData.savedLocations?.length || 0) : (pendingRestoreData.savedLocations?.length || 0)}</strong></p>
                    </div>

                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => handleConfirmRestore('replace')}
                        className="min-h-[44px] flex-1 py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition-colors cursor-pointer active:scale-95"
                      >
                        {isFa ? 'جایگزینی داده‌ها (Overwrite)' : 'Overwrite Data'}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleConfirmRestore('merge')}
                        className="min-h-[44px] flex-1 py-2 px-3 rounded-xl bg-stone-800 hover:bg-stone-700 text-white font-bold text-xs transition-colors cursor-pointer active:scale-95 border border-stone-700"
                      >
                        {isFa ? 'افزودن و ادغام (Merge)' : 'Merge Data'}
                      </button>

                      <button
                        type="button"
                        onClick={() => setPendingRestoreData(null)}
                        className="min-h-[44px] py-2 px-3 rounded-xl bg-stone-900 hover:bg-stone-800 text-white font-bold text-xs cursor-pointer active:scale-95 border border-stone-800"
                      >
                        {isFa ? 'انصراف' : 'Cancel'}
                      </button>
                    </div>
                  </div>
                )}

                {/* 5.3 Performance Statistics Modal Trigger */}
                {onOpenStats && (
                  <div className="pt-2 border-t border-stone-800/80">
                    <div className="flex items-center justify-between p-3 rounded-2xl bg-stone-900/80 border border-stone-800 hover:border-indigo-500/40 transition-all">
                      <div className="w-9 h-9 rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-400 flex items-center justify-center flex-shrink-0">
                        <BarChart3 className="w-5 h-5" />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenStats();
                        }}
                        className="min-h-[44px] px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-sm active:scale-95 transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5"
                      >
                        <span>{settings.language === 'en' ? t.viewStats : 'مشاهده آمار'}</span>
                        <span className="text-indigo-200">←</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ========================================================= */}
          {/* 6. RECYCLE BIN (سطل بازیافت) */}
          {/* ========================================================= */}
          <div className="border border-stone-800 rounded-2xl overflow-hidden bg-stone-900/40">
            <button
              type="button"
              onClick={() => toggleSection('recycleBin')}
              className="w-full flex items-center justify-between p-3.5 sm:p-4 bg-stone-900/80 hover:bg-stone-800/80 transition-colors text-right cursor-pointer"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-rose-500/15 text-rose-400 border border-rose-500/30 flex items-center justify-center shrink-0">
                  <Trash2 className="w-4 h-4" />
                </div>
                <div className="text-right">
                  <span className="font-bold text-sm text-white block">
                    {isFa ? 'سطل بازیافت' : 'Recycle Bin'}
                  </span>
                  <span className="text-[11px] text-stone-400 block">
                    {allDeletedItems.length > 0
                      ? (isFa ? `${toPersianDigits(allDeletedItems.length)} مورد در سطل بازیافت` : `${allDeletedItems.length} items in bin`)
                      : (isFa ? 'خالی' : 'Empty')}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {allDeletedItems.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                    {isFa ? toPersianDigits(allDeletedItems.length) : allDeletedItems.length}
                  </span>
                )}
                {openSections.recycleBin ? (
                  <ChevronUp className="w-4 h-4 text-stone-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-stone-400" />
                )}
              </div>
            </button>

            {openSections.recycleBin && (
              <div className="p-3.5 sm:p-4 border-t border-stone-800/80 space-y-3.5 animate-in fade-in">
                {/* Header note & Empty Bin button */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 pb-2 border-b border-stone-800/80">
                  <span className="text-xs text-stone-400 leading-relaxed">
                    {isFa 
                      ? 'موارد حذف‌شده (یادآور، مکان، مناسبت، ایده) تا زمان خالی کردن در این بخش نگهداری می‌شوند.' 
                      : 'Deleted items are kept here until permanently emptied.'}
                  </span>

                  {allDeletedItems.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setIsConfirmingEmptyBin(true)}
                      className="min-h-[44px] px-3.5 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 text-xs font-bold border border-rose-500/30 transition-all flex items-center gap-1.5 cursor-pointer shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                      <span>{isFa ? 'خالی کردن سطل' : 'Empty Bin'}</span>
                    </button>
                  )}
                </div>

                {/* Empty Bin Confirmation Dialog */}
                {isConfirmingEmptyBin && (
                  <div className="p-3.5 rounded-2xl bg-rose-950/40 border border-rose-500/40 space-y-2.5 animate-in fade-in">
                    <p className="text-xs text-rose-200 font-bold leading-relaxed">
                      {isFa 
                        ? 'آیا از حذف دائمی تمام موارد موجود در سطل بازیافت اطمینان دارید؟ این عملیات قابل بازگشت نیست.'
                        : 'Are you sure you want to permanently delete all items in the Recycle Bin? This cannot be undone.'}
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          onEmptyRecycleBin?.();
                          setIsConfirmingEmptyBin(false);
                        }}
                        className="min-h-[44px] flex-1 py-2 px-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs transition-colors cursor-pointer"
                      >
                        {isFa ? 'بله، خالی کن' : 'Yes, Empty'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsConfirmingEmptyBin(false)}
                        className="min-h-[44px] py-2 px-3 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-300 text-xs font-bold transition-colors cursor-pointer"
                      >
                        {isFa ? 'انصراف' : 'Cancel'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Items List */}
                {allDeletedItems.length === 0 ? (
                  <div className="py-8 text-center text-xs text-stone-500 font-medium space-y-1">
                    <Trash2 className="w-6 h-6 mx-auto text-stone-600" />
                    <p>{isFa ? 'سطل بازیافت خالی است' : 'Recycle bin is empty'}</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {allDeletedItems.map((item) => {
                      const getTypeIcon = () => {
                        switch (item.type) {
                          case 'reminder':
                            return <Bell className="w-3.5 h-3.5 text-indigo-400" />;
                          case 'location':
                            return <MapPin className="w-3.5 h-3.5 text-cyan-400" />;
                          case 'occasion':
                            return <Calendar className="w-3.5 h-3.5 text-rose-400" />;
                          case 'idea':
                            return <Lightbulb className="w-3.5 h-3.5 text-indigo-300" />;
                        }
                      };

                      const getTypeName = () => {
                        switch (item.type) {
                          case 'reminder':
                            return isFa ? 'یادآور' : 'Reminder';
                          case 'location':
                            return isFa ? 'مکان' : 'Location';
                          case 'occasion':
                            return isFa ? 'مناسبت' : 'Occasion';
                          case 'idea':
                            return isFa ? 'ایده' : 'Idea';
                        }
                      };

                      return (
                        <div
                          key={`${item.type}-${item.id}`}
                          className="p-3 rounded-xl bg-stone-900 border border-stone-800 flex items-center justify-between gap-3"
                        >
                          <div className="space-y-1 min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              {getTypeIcon()}
                              <span className="text-[11px] font-bold text-stone-400">
                                {getTypeName()}
                              </span>
                            </div>
                            <h4 className="text-xs font-bold text-white truncate">
                              {item.title}
                            </h4>
                            <span className="text-[10px] text-stone-500 block">
                              {isFa ? 'حذف در:' : 'Deleted:'} {formatJalaliFull(item.deletedAt, isFa ? 'fa' : 'en')}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {/* Restore Button */}
                            <button
                              type="button"
                              onClick={() => onRestoreItem?.(item.id, item.type)}
                              className="min-h-[44px] min-w-[44px] px-2.5 py-1.5 rounded-xl bg-emerald-600/15 hover:bg-emerald-600/25 text-emerald-300 border border-emerald-500/25 text-xs font-bold flex items-center gap-1 transition-all cursor-pointer"
                              title={isFa ? 'بازیابی' : 'Restore'}
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">{isFa ? 'بازیابی' : 'Restore'}</span>
                            </button>

                            {/* Permanent Delete Button */}
                            <button
                              type="button"
                              onClick={() => onPermanentDeleteItem?.(item.id, item.type)}
                              className="min-h-[44px] min-w-[44px] p-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 text-xs font-bold flex items-center justify-center transition-all cursor-pointer"
                              title={isFa ? 'حذف دائمی' : 'Permanent Delete'}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ========================================================= */}
          {/* 7. MINIMAL APP INFO & LINKS (بعد از بخش سطل زباله) */}
          {/* ========================================================= */}
          <div className="pt-2">
            <div className="rounded-2xl border border-stone-800/90 bg-stone-950/70 p-3.5 sm:p-4 space-y-3">
              {/* Row 1: App Version */}
              <div className="flex items-center justify-between pb-2.5 border-b border-stone-800/80">
                <div className="flex items-center gap-2">
                  <img src={appIcon} alt="YAAD" className="w-5 h-5 rounded-md object-cover" />
                  <span className="text-xs font-bold text-stone-300">
                    {isFa ? 'ورژن اپ' : 'App Version'}
                  </span>
                </div>
                <span className="font-mono text-xs font-black text-indigo-400 bg-indigo-500/10 border border-indigo-500/25 px-2.5 py-0.5 rounded-lg" dir="ltr">
                  v{APP_VERSION}
                </span>
              </div>

              {/* Row 2: Minimal Links (Privacy, About, Support Email) */}
              <div className="grid grid-cols-3 gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setActiveInfoDialog(activeInfoDialog === 'privacy' ? null : 'privacy')}
                  className={`py-2 px-2.5 rounded-xl border font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    activeInfoDialog === 'privacy'
                      ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                      : 'bg-stone-900/80 hover:bg-stone-800 border-stone-800 text-stone-300 hover:text-white'
                  }`}
                >
                  <ShieldCheck className="w-4 h-4 text-emerald-400 drop-shadow-[0_0_6px_rgba(16,185,129,0.4)] shrink-0" />
                  <span className="truncate">{isFa ? 'حریم خصوصی' : 'Privacy'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveInfoDialog(activeInfoDialog === 'about' ? null : 'about')}
                  className={`py-2 px-2.5 rounded-xl border font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    activeInfoDialog === 'about'
                      ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300'
                      : 'bg-stone-900/80 hover:bg-stone-800 border-stone-800 text-stone-300 hover:text-white'
                  }`}
                >
                  <Info className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                  <span className="truncate">{isFa ? 'درباره‌ی' : 'About'}</span>
                </button>

                <a
                  href="mailto:YAADreminder@gmail.com?subject=YAAD%20App%20Support"
                  className="py-2 px-2.5 rounded-xl bg-stone-900/80 hover:bg-stone-800 border border-stone-800 text-stone-300 hover:text-indigo-300 font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                  title="YAADreminder@gmail.com"
                >
                  <Mail className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                  <span className="truncate">{isFa ? 'پشتیبانی' : 'Support'}</span>
                </a>
              </div>

              {/* Expandable Minimal Info Content for Privacy or About */}
              {activeInfoDialog === 'privacy' && (
                <div className="p-3 rounded-xl bg-stone-900/90 border border-emerald-500/30 text-[11px] text-stone-300 leading-relaxed space-y-2.5 animate-in fade-in">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span className="font-bold text-emerald-300">{isFa ? 'حریم خصوصی و امنیت داده‌ها' : 'Privacy Policy'}</span>
                    </div>
                    <button type="button" onClick={() => setActiveInfoDialog(null)} className="text-stone-400 hover:text-white">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p>
                    {isFa
                      ? 'تمامی یادآورها، ایده‌ها، مناسبت‌ها و موقعیت‌های مکانی شما به صورت خصوصی در حافظه دستگاه شما ذخیره می‌شوند و بدون اجازه شما به هیچ سرور خارجی ارسال نمی‌گردند.'
                      : 'All your reminders, ideas, occasions, and saved locations are stored locally on your device and are never shared without your explicit consent.'}
                  </p>
                  <a
                    href="https://enikkhah.github.io/Yaad/privacy.html"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-sm shadow-emerald-950/50 cursor-pointer active:scale-95"
                  >
                    <ShieldCheck className="w-3.5 h-3.5 text-white shrink-0" />
                    <span>{isFa ? 'مشاهده' : 'View Privacy Policy'}</span>
                    <ExternalLink className="w-3 h-3 text-emerald-100 shrink-0" />
                  </a>
                </div>
              )}

              {activeInfoDialog === 'about' && (
                <div className="p-3 rounded-xl bg-stone-900/90 border border-stone-800 text-[11px] text-stone-300 leading-relaxed space-y-1.5 animate-in fade-in">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-indigo-300">{isFa ? 'درباره‌ی اپلیکیشن یاد (YAAD)' : 'About YAAD'}</span>
                    <button type="button" onClick={() => setActiveInfoDialog(null)} className="text-stone-400 hover:text-white">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p>
                    {isFa
                      ? `دستیار هوشمند مدیریت زمان، یادآورهای گفتاری، مناسبت‌ها، ایده‌ها و حصار زمانی مکان‌محور (Geofence) • نسخه ${toPersianDigits(APP_VERSION)}`
                      : `Smart time management assistant for spoken reminders, occasions, ideas, and location-based Geofence alerts • Version ${APP_VERSION}`}
                  </p>
                </div>
              )}

              {/* Direct Support Email Display */}
              <div className="pt-1 flex items-center justify-between text-[11px] text-stone-400">
                <span>{isFa ? 'ارتباط با پشتیبانی:' : 'Support Email:'}</span>
                <a
                  href="mailto:YAADreminder@gmail.com?subject=YAAD%20App%20Support"
                  className="font-mono text-indigo-400 hover:text-indigo-300 underline flex items-center gap-1"
                  dir="ltr"
                >
                  <span>YAADreminder@gmail.com</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          </div>

        </div>

        {/* Footer - Sticky above keyboard (دکمه تأیید همیشه پایین و ثابت، حداقل ۴۸ پیکسل) */}
        <div className="sticky bottom-0 z-20 shrink-0 px-3 sm:px-5 py-3 border-t border-stone-800 flex justify-end bg-stone-900/95 backdrop-blur shadow-2xl">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto min-h-[48px] px-8 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-black text-xs sm:text-sm shadow-md transition-all active:scale-95 cursor-pointer flex items-center justify-center gap-2"
          >
            {settings.language === 'en' ? t.confirm : 'تأیید'}
          </button>
        </div>

        {/* Hidden Native Directory / File Input for Mobile & Cross-Origin Fallback */}
        <input
          ref={nativeDirInputRef}
          type="file"
          {...({ webkitdirectory: '', directory: '' } as any)}
          multiple
          className="hidden"
          onChange={async (e) => {
            const files = e.target.files;
            if (!files || files.length === 0) return;
            const firstFile = files[0] as any;
            const relPath: string = firstFile.webkitRelativePath || '';
            const pickedDirName = relPath ? relPath.split('/')[0] : LOCAL_BACKUP_FOLDER_NAME;
            const finalPath =
              pickedDirName.toUpperCase().includes('YAAD')
                ? pickedDirName
                : `${pickedDirName}/${LOCAL_BACKUP_FOLDER_NAME}`;
            setPickerCustomPath(finalPath);

            // Check if a yaad_backup.json exists inside the selected folder
            for (let i = 0; i < files.length; i++) {
              if (files[i].name === 'yaad_backup.json' || files[i].name.endsWith('.json')) {
                try {
                  const text = await files[i].text();
                  const parsed = JSON.parse(text);
                  if (parsed && Array.isArray(parsed.reminders)) {
                    setPendingRestoreData({
                      reminders: parsed.reminders || [],
                      ideas: parsed.ideas || [],
                      savedLocations: parsed.savedLocations || [],
                      occasions: parsed.occasions || [],
                      settings: parsed.settings,
                    });
                  }
                } catch {
                  // ignore invalid json
                }
                break;
              }
            }
            e.target.value = '';
          }}
        />

        {/* Interactive Folder & Storage Location Picker Modal (پنجره اخذ دسترسی حافظه و ایجاد / معرفی محل پوشه Yaad reminder) */}
        {folderPickerModalMode && (
          <div
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
            onClick={() => setFolderPickerModalMode(null)}
          >
            <div
              className="w-full max-w-md rounded-3xl bg-stone-900 border border-stone-700 p-5 space-y-3.5 shadow-2xl text-stone-100 animate-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
              dir={isFa ? 'rtl' : 'ltr'}
            >
              <div className="flex items-center justify-between gap-2 border-b border-stone-800 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                    <FolderOpen className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-black text-white">
                      {folderPickerModalMode === 'local'
                        ? isFa
                          ? 'دسترسی حافظه و ایجاد پوشه Yaad reminder'
                          : 'Storage Access & Yaad reminder Folder'
                        : isFa
                          ? 'انتخاب و معرفی محل پوشه در فضای ابری'
                          : 'Select Cloud Backup Folder Location'}
                    </h4>
                    <p className="text-[11px] text-stone-400">
                      {isFa
                        ? 'ابتدا دسترسی حافظه را تایید کنید و مسیر پوشه را انتخاب نمایید:'
                        : 'Grant storage access and choose your folder location:'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setFolderPickerModalMode(null)}
                  className="p-1.5 rounded-xl text-stone-400 hover:text-white hover:bg-stone-800 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* STEP 1: Storage Permission Grant & Direct Folder Creation Box */}
              <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-black text-emerald-300">
                    <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>
                      {isFa ? '۱. وضعیت دسترسی به حافظه دستگاه' : '1. Device Storage Permission'}
                    </span>
                  </div>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
                      nativePerms.storage
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/50'
                        : 'bg-amber-500/20 text-amber-300 border-amber-400/50'
                    }`}
                  >
                    {nativePerms.storage
                      ? isFa
                        ? 'تایید شده ✓'
                        : 'Granted ✓'
                      : isFa
                        ? 'نیاز به فعال‌سازی'
                        : 'Action Needed'}
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-2">
                  <button
                    type="button"
                    disabled={isLocalSyncing}
                    onClick={() => finalizeLocalFolderSelection(pickerCustomPath, false)}
                    className="w-full min-h-[42px] py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs flex items-center justify-center gap-1.5 shadow-md shadow-emerald-950/50 cursor-pointer active:scale-95 transition-all"
                  >
                    <ShieldCheck className="w-4 h-4 shrink-0" />
                    <span>
                      {isLocalSyncing
                        ? isFa
                          ? 'در حال ایجاد پوشه...'
                          : 'Creating folder...'
                        : isFa
                          ? `تایید دسترسی حافظه و ایجاد پوشه «${pickerCustomPath}»`
                          : `Grant Storage & Create "${pickerCustomPath}"`}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => openAndroidSettings('all_files')}
                    className="w-full min-h-[38px] py-1.5 px-3 rounded-xl bg-stone-950/90 hover:bg-stone-800 border border-stone-700 text-stone-300 hover:text-white font-bold text-[11px] flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                    <span>
                      {isFa
                        ? 'باز کردن صفحه «دسترسی به همه فایل‌ها (All files access)» در اندروید'
                        : 'Open Android "All Files Access" Settings'}
                    </span>
                  </button>
                </div>

                {modalPermissionMessage && (
                  <div className="p-2.5 rounded-xl bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 text-[11px] font-bold flex items-center gap-2 animate-in fade-in">
                    <Check className="w-4 h-4 text-emerald-300 shrink-0" />
                    <span>{modalPermissionMessage}</span>
                  </div>
                )}
              </div>

              {/* STEP 2: Preset Storage Locations */}
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
                <label className="text-[11px] font-bold text-stone-300 block">
                  {isFa ? '۲. انتخاب محل ذخیره پوشه:' : '2. Select Folder Location:'}
                </label>
                {(folderPickerModalMode === 'local'
                  ? [
                      {
                        path: 'Documents/Yaad reminder',
                        labelFa: 'پوشه اسناد گوشی (Documents / Yaad reminder) — پیشنهادی',
                        labelEn: 'Device Documents (Documents / Yaad reminder)',
                      },
                      {
                        path: 'Download/Yaad reminder',
                        labelFa: 'پوشه دانلودهای گوشی (Download / Yaad reminder)',
                        labelEn: 'Device Downloads (Download / Yaad reminder)',
                      },
                      {
                        path: 'InternalStorage/Yaad reminder',
                        labelFa: 'ریشه حافظه داخلی (Internal Storage / Yaad reminder)',
                        labelEn: 'Internal Storage Root (Yaad reminder)',
                      },
                      {
                        path: 'Yaad reminder',
                        labelFa: 'پوشه پیش‌فرض برنامه (Yaad reminder)',
                        labelEn: 'Default App Folder (Yaad reminder)',
                      },
                    ]
                  : [
                      {
                        path: 'OneDrive/Yaad reminder',
                        service: 'OneDrive',
                        labelFa: 'وان‌درایو مایکروسافت (OneDrive / Yaad reminder)',
                        labelEn: 'Microsoft OneDrive (OneDrive / Yaad reminder)',
                      },
                      {
                        path: 'Dropbox/Yaad reminder',
                        service: 'Dropbox',
                        labelFa: 'دراپ‌باکس (Dropbox / Yaad reminder)',
                        labelEn: 'Dropbox (Dropbox / Yaad reminder)',
                      },
                      {
                        path: 'GoogleDrive/Yaad reminder',
                        service: 'Google Drive',
                        labelFa: 'پوشه گوگل درایو (Google Drive / Yaad reminder)',
                        labelEn: 'Google Drive Folder (GoogleDrive / Yaad reminder)',
                      },
                      {
                        path: 'iCloudDrive/Yaad reminder',
                        service: 'iCloud Drive',
                        labelFa: 'آی‌کلود درایو (iCloud Drive / Yaad reminder)',
                        labelEn: 'iCloud Drive (iCloudDrive / Yaad reminder)',
                      },
                      {
                        path: 'MEGA/Yaad reminder',
                        service: 'MEGA',
                        labelFa: 'فضای ابری مگا (MEGA / Yaad reminder)',
                        labelEn: 'MEGA Cloud (MEGA / Yaad reminder)',
                      },
                    ]
                ).map((item: any) => {
                  const isSelected = pickerCustomPath === item.path;
                  return (
                    <button
                      key={item.path}
                      type="button"
                      onClick={() => {
                        setPickerCustomPath(item.path);
                        if (item.service) setPickerCloudServiceLabel(item.service);
                      }}
                      className={`w-full p-2.5 rounded-xl border text-start transition-all flex items-center justify-between gap-2 cursor-pointer ${
                        isSelected
                          ? 'bg-emerald-500/20 border-emerald-400 text-white shadow-sm'
                          : 'bg-stone-950/80 hover:bg-stone-800 border-stone-800 text-stone-300'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-bold truncate">
                          {isFa ? item.labelFa : item.labelEn}
                        </div>
                        <div className="text-[10px] font-mono text-stone-400 truncate" dir="ltr">
                          /{item.path}/yaad_backup.json
                        </div>
                      </div>
                      {isSelected && <Check className="w-4 h-4 text-emerald-400 shrink-0" />}
                    </button>
                  );
                })}
              </div>

              {/* Browse from Device File Manager + Direct Save to Phone Downloads */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => nativeDirInputRef.current?.click()}
                  className="min-h-[40px] px-3 py-2 rounded-xl bg-stone-800 hover:bg-stone-700 border border-stone-700 text-stone-200 text-[11px] font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>{isFa ? 'مرور از فایل‌منیجر دستگاه' : 'Browse Device Files'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    handleDownloadBackup();
                  }}
                  className="min-h-[40px] px-3 py-2 rounded-xl bg-stone-800 hover:bg-stone-700 border border-stone-700 text-stone-200 text-[11px] font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                  <span>{isFa ? 'ذخیره فایل در پوشه Download گوشی' : 'Save File to Downloads'}</span>
                </button>
              </div>

              {/* Custom Path Input */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-stone-300 block">
                  {isFa ? 'مسیر یا نام پوشه (قابل ویرایش):' : 'Folder Path (Editable):'}
                </label>
                <input
                  type="text"
                  dir="ltr"
                  value={pickerCustomPath}
                  onChange={(e) => setPickerCustomPath(e.target.value)}
                  placeholder="Documents/Yaad reminder"
                  className="w-full px-3 py-2.5 rounded-xl bg-stone-950 border border-emerald-500/50 text-xs font-mono text-white focus:outline-none focus:border-emerald-400"
                />
              </div>

              {/* Confirm & Cancel Buttons */}
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={async () => {
                    if (folderPickerModalMode === 'local') {
                      await finalizeLocalFolderSelection(pickerCustomPath, false);
                      setFolderPickerModalMode(null);
                    } else {
                      await finalizeCloudFolderSelection(pickerCustomPath, pickerCloudServiceLabel);
                    }
                  }}
                  className="flex-1 min-h-[44px] py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-950/50 cursor-pointer active:scale-95 transition-all"
                >
                  <Check className="w-4 h-4" />
                  <span>{isFa ? 'ایجاد پوشه و ذخیره در این مسیر' : 'Create Folder & Save'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setFolderPickerModalMode(null)}
                  className="min-h-[44px] py-2.5 px-4 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-300 font-bold text-xs cursor-pointer"
                >
                  {isFa ? 'بستن' : 'Close'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
