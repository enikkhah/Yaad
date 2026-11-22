import React, { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { FolderOpen, RefreshCw, ShieldCheck, Upload, X, Check, AlertCircle } from 'lucide-react';
import { AppLanguage } from '../utils/i18n';
import {
  AutoBackupSnapshot,
  BackupFolderStatus,
  chooseAutoBackupFolder,
  importBackupFromFolderFiles,
  performAutoBackup,
  reconnectDesktopBackupFolder,
  getSnapshotItemCount,
} from '../utils/backupStorage';
import { AppSettings, IdeaNote, Occasion, Reminder, SavedLocation } from '../types';
import { toPersianDigits } from '../utils/jalali';

interface BackupFolderPromptModalProps {
  isOpen: boolean;
  mode: 'first_launch' | 'reminder' | 'reconnect';
  folderStatus: BackupFolderStatus | null;
  language?: AppLanguage;
  onClose: () => void;
  onSnoozeLater: () => void;
  onDismissForever: () => void;
  onRestoreSnapshot: (snapshot: AutoBackupSnapshot) => void;
  onFolderConnected: (folderName: string) => void;
  currentData: {
    reminders: Reminder[];
    ideas: IdeaNote[];
    savedLocations: SavedLocation[];
    occasions: Occasion[];
    settings?: AppSettings;
  };
}

export const BackupFolderPromptModal: React.FC<BackupFolderPromptModalProps> = ({
  isOpen,
  mode,
  folderStatus,
  language = 'fa',
  onClose,
  onSnoozeLater,
  onDismissForever,
  onRestoreSnapshot,
  onFolderConnected,
  currentData,
}) => {
  const isFa = language !== 'en';
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'info' | 'error'; text: string } | null>(null);
  const folderFilesInputRef = useRef<HTMLInputElement | null>(null);

  const handleChooseFolder = async () => {
    // Call chooseAutoBackupFolder synchronously on click (no preceding awaits!)
    // so Desktop showDirectoryPicker keeps user activation gesture intact.
    setBusy(true);
    setFeedback(null);
    try {
      const res = await chooseAutoBackupFolder();
      if (res.cancelled) {
        setBusy(false);
        return;
      }
      if (!res.granted) {
        if (res.unsupportedReason === 'iframe' || res.unsupportedReason === 'browser') {
          setFeedback({
            type: 'info',
            text: isFa
              ? 'انتخاب مستقیم پوشه در این مرورگر یا پنجره پیش‌نمایش فعال نیست؛ از گزینه «بازیابی از پوشه» یا پشتیبان‌گیری دستی در تنظیمات استفاده کنید.'
              : 'Direct persistent folder selection is unavailable in this browser or preview frame. You can still use "Restore from Folder" or JSON backup in Settings.',
          });
        } else {
          setFeedback({
            type: 'error',
            text: isFa
              ? 'اتصال پوشه پشتیبان انجام نشد. لطفاً دوباره تلاش کنید.'
              : 'Could not connect the backup folder. Please try again.',
          });
        }
        setBusy(false);
        return;
      }

      if (res.restoredSnapshot && getSnapshotItemCount(res.restoredSnapshot) > 0) {
        onRestoreSnapshot(res.restoredSnapshot);
      } else {
        await performAutoBackup(currentData);
      }
      onFolderConnected(res.folderName);
      onClose();
    } catch {
      setFeedback({
        type: 'error',
        text: isFa ? 'خطا در اتصال پوشه انتخاب‌شده.' : 'Failed to connect selected folder.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleRestoreFromFolder = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      if (folderStatus && !folderStatus.supported) {
        setBusy(false);
        folderFilesInputRef.current?.click();
        return;
      }
      const res = await chooseAutoBackupFolder();
      if (res.cancelled) {
        setBusy(false);
        return;
      }
      if (!res.granted) {
        setBusy(false);
        folderFilesInputRef.current?.click();
        return;
      }

      if (res.restoredSnapshot && getSnapshotItemCount(res.restoredSnapshot) > 0) {
        onRestoreSnapshot(res.restoredSnapshot);
        onFolderConnected(res.folderName);
        onClose();
      } else {
        await performAutoBackup(currentData);
        onFolderConnected(res.folderName);
        setFeedback({
          type: 'info',
          text: isFa
            ? `فایل پشتیبان قبلی در پوشه «${res.folderName}» یافت نشد، اما پوشه برای ذخیره خودکار از این لحظه متصل شد.`
            : `No previous backup file was found in "${res.folderName}", and the folder is now connected for auto-backup.`,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleReconnect = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await reconnectDesktopBackupFolder();
      if (!res.granted) {
        setFeedback({
          type: 'error',
          text: isFa
            ? 'دسترسی پوشه تایید نشد. می‌توانید دوباره پوشه را انتخاب کنید.'
            : 'Folder permission was not granted. You can re-select the folder.',
        });
        setBusy(false);
        return;
      }
      if (res.restoredSnapshot && getSnapshotItemCount(res.restoredSnapshot) > 0) {
        onRestoreSnapshot(res.restoredSnapshot);
      } else {
        await performAutoBackup(currentData);
      }
      onFolderConnected(res.folderName || 'YAAD');
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const isReconnect = mode === 'reconnect';
  const isFirstLaunch = mode === 'first_launch';
  const canPickPersistentFolder = folderStatus ? folderStatus.supported : true;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          style={{ willChange: 'opacity' }}
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75"
          dir={isFa ? 'rtl' : 'ltr'}
        >
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            style={{ willChange: 'transform, opacity' }}
            className="w-full max-w-md rounded-3xl bg-stone-900 border border-stone-700/80 shadow-2xl overflow-hidden flex flex-col"
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-stone-800 bg-stone-950/60 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-2xl bg-emerald-500/15 border border-emerald-500/35 text-emerald-400 flex items-center justify-center shrink-0">
                  {isReconnect ? <RefreshCw className="w-5 h-5" /> : <FolderOpen className="w-5 h-5" />}
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm sm:text-base font-black text-white truncate">
                    {isReconnect
                      ? isFa
                        ? 'اتصال مجدد پوشه پشتیبان'
                        : 'Reconnect Backup Folder'
                      : isFirstLaunch
                      ? isFa
                        ? 'پشتیبان‌گیری خودکار و بازیابی'
                        : 'Auto-Backup & Restore from Folder'
                      : isFa
                      ? 'یادآوری انتخاب پوشه پشتیبان'
                      : 'Choose Auto-Backup Folder'}
                  </h3>
                  <p className="text-[11px] text-emerald-400 font-bold truncate">
                    {isFa ? 'بدون نیاز به مجوز دسترسی حافظه' : 'Zero broad storage permissions'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onSnoozeLater}
                className="p-1.5 rounded-xl text-stone-400 hover:text-white hover:bg-stone-800 transition-colors cursor-pointer"
                title={isFa ? 'بستن' : 'Close'}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 space-y-4">
              <p className="text-xs sm:text-[13px] text-stone-300 leading-relaxed">
                {isReconnect
                  ? isFa
                    ? `مرورگر برای ادامه ذخیره خودکار فایل پشتیبان (yaad_backup.json) در پوشه «${folderStatus?.folderName || 'YAAD'}» نیاز به یک کلیک تایید دارد.`
                    : `Click below to re-authorize your connected folder "${folderStatus?.folderName || 'YAAD'}" so automatic JSON backups continue seamlessly.`
                  : isFirstLaunch
                  ? isFa
                    ? 'اگر از قبل نسخه پشتیبانی در پوشه‌ای دارید، همین حالا می‌توانید آن را بازیابی کنید؛ یا یک پوشه دلخواه را برای ذخیره خودکار اطلاعات در هر تغییر و هنگام باز و بسته شدن اپ انتخاب نمایید.'
                    : 'Already have a backup folder from before? Restore it right away, or pick a folder so YAAD automatically writes your JSON backup on every change and app open/close.'
                  : isFa
                  ? 'برای اینکه یادآورها، ایده‌ها، مکان‌ها و مناسبت‌های شما پس از حذف یا تعویض دستگاه هم محفوظ بمانند، یک پوشه پشتیبان خودکار انتخاب کنید تا فایل yaad_backup.json در هر تغییر و باز/بسته شدن برنامه ذخیره شود.'
                  : 'Select an auto-backup folder so your reminders, ideas, locations, and occasions are automatically saved to yaad_backup.json on every change and app open/close.'}
              </p>

              <div className="p-3 rounded-2xl bg-stone-950/70 border border-stone-800 flex items-start gap-2.5 text-[11px] text-stone-400 leading-relaxed">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  {isFa
                    ? 'اپلیکیشن هیچ دسترسی گسترده‌ای به فایل‌های گوشی نمی‌گیرد و فقط به پوشه‌ای که خودتان انتخاب می‌کنید دسترسی خواهد داشت.'
                    : 'No broad storage permissions are requested; access stays strictly scoped to the folder you pick.'}
                </span>
              </div>

              {feedback && (
                <div
                  className={`p-3 rounded-xl text-xs font-bold flex items-start gap-2 leading-relaxed ${
                    feedback.type === 'success'
                      ? 'bg-emerald-500/15 border border-emerald-500/40 text-emerald-300'
                      : feedback.type === 'info'
                      ? 'bg-sky-500/15 border border-sky-500/40 text-sky-200'
                      : 'bg-rose-500/15 border border-rose-500/40 text-rose-300'
                  }`}
                >
                  {feedback.type === 'success' ? (
                    <Check className="w-4 h-4 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  )}
                  <span>{feedback.text}</span>
                </div>
              )}

              {/* Actions */}
              <div className="space-y-2.5 pt-1">
                {isReconnect && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleReconnect}
                    className="w-full min-h-[46px] px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 font-black text-xs sm:text-sm shadow-lg transition-all active:scale-95 cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />
                    <span>
                      {isFa
                        ? `اتصال مجدد «${folderStatus?.folderName || 'پوشه'}»`
                        : `Reconnect "${folderStatus?.folderName || 'Folder'}"`}
                    </span>
                  </button>
                )}

                {canPickPersistentFolder && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleChooseFolder}
                    className="w-full min-h-[46px] px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs sm:text-sm shadow-lg shadow-emerald-950/40 transition-all active:scale-95 cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    <FolderOpen className="w-4 h-4 shrink-0" />
                    <span>
                      {isReconnect
                        ? isFa
                          ? 'انتخاب یک پوشه جدید'
                          : 'Choose a Different Folder'
                        : isFa
                        ? 'انتخاب پوشه پشتیبان خودکار'
                        : 'Choose Auto-Backup Folder'}
                    </span>
                  </button>
                )}

                {isFirstLaunch && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleRestoreFromFolder}
                    className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-black text-xs sm:text-sm shadow-md transition-all active:scale-95 cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    <Upload className="w-4 h-4 shrink-0" />
                    <span>{isFa ? 'بازیابی از پوشه' : 'Restore from Folder'}</span>
                  </button>
                )}

                {/* Hidden Desktop webkitdirectory fallback for unsupported browsers / iframe */}
                <input
                  ref={folderFilesInputRef}
                  type="file"
                  {...({ webkitdirectory: '', directory: '' } as any)}
                  multiple
                  className="hidden"
                  onChange={async (e) => {
                    const files = e.target.files;
                    e.target.value = '';
                    if (!files || files.length === 0) return;
                    setBusy(true);
                    setFeedback(null);
                    try {
                      const snap = await importBackupFromFolderFiles(files);
                      if (snap && getSnapshotItemCount(snap) > 0) {
                        onRestoreSnapshot(snap);
                        setFeedback({
                          type: 'success',
                          text: isFa
                            ? `${toPersianDigits(getSnapshotItemCount(snap))} مورد از پوشه با موفقیت بازیابی شد.`
                            : `Restored ${getSnapshotItemCount(snap)} item(s) from folder.`,
                        });
                        setTimeout(() => onClose(), 700);
                      } else {
                        setFeedback({
                          type: 'info',
                          text: isFa
                            ? 'فایل پشتیبان معتبر (yaad_backup.json) در پوشه انتخاب‌شده یافت نشد.'
                            : 'No valid yaad_backup.json was found in that folder.',
                        });
                      }
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              </div>
            </div>

            {/* Footer dismiss/snooze controls */}
            <div className="px-5 py-3 border-t border-stone-800 bg-stone-950/80 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={onSnoozeLater}
                className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-200 font-bold text-xs transition-colors cursor-pointer"
              >
                {isFa ? 'فعلاً نه (بعداً یادآوری کن)' : 'Remind Me Later'}
              </button>
              {!isReconnect && (
                <button
                  type="button"
                  onClick={onDismissForever}
                  className="min-h-[38px] px-3 py-1.5 rounded-xl text-stone-400 hover:text-stone-200 hover:bg-stone-800/60 font-bold text-xs transition-colors cursor-pointer"
                >
                  {isFa ? 'دیگر نشان نده' : "Don't Ask Again"}
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
