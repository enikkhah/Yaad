import React, { useState, useEffect } from 'react';
import { Download, X, Check, Smartphone, Monitor, Copy, FolderOpen, ShieldCheck } from 'lucide-react';
import appIcon from '../assets/images/icon.png';
import { AppLanguage } from '../utils/i18n';
import {
  requestLocalFolderPermission,
  checkLocalFolderPermissionStatus,
  AutoBackupSnapshot,
  LOCAL_BACKUP_FOLDER_NAME
} from '../utils/backupStorage';
import { requestNotificationPermission } from '../utils/nativeLocalNotifications';

interface InstallModalProps {
  isOpen: boolean;
  onClose: () => void;
  deferredPrompt: any;
  onInstalled: () => void;
  onRestoreBackup?: (snapshot: AutoBackupSnapshot) => void;
  language?: AppLanguage;
}

export const InstallModal: React.FC<InstallModalProps> = ({
  isOpen,
  onClose,
  deferredPrompt,
  onInstalled,
  onRestoreBackup,
  language = 'fa',
}) => {
  const isEn = language === 'en';
  const [copied, setCopied] = useState(false);
  const [folderGranted, setFolderGranted] = useState(false);
  const [isGrantingFolder, setIsGrantingFolder] = useState(false);
  const [folderStatusMsg, setFolderStatusMsg] = useState<string | null>(null);

  const currentUrl = typeof window !== 'undefined' ? window.location.href : 'https://ais-pre-2kjbmpbtqhmpvpj7qdxgez-911396278494.europe-west2.run.app';

  useEffect(() => {
    if (isOpen) {
      checkLocalFolderPermissionStatus().then((status) => {
        setFolderGranted(status);
      });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleGrantFolderPermission = async (interactive: boolean = true) => {
    setIsGrantingFolder(true);
    setFolderStatusMsg(null);
    try {
      await requestNotificationPermission().catch(() => {});
      const res = await requestLocalFolderPermission(interactive, LOCAL_BACKUP_FOLDER_NAME);
      setFolderGranted(res.granted);
      if (res.restoredSnapshot && onRestoreBackup) {
        onRestoreBackup(res.restoredSnapshot);
        setFolderStatusMsg(
          isEn
            ? `Folder "${res.folderName}" connected & previous backup restored!`
            : `پوشه «${res.folderName}» متصل شد و اطلاعات قبلی با موفقیت فراخوانی گردید!`
        );
      } else {
        setFolderStatusMsg(
          isEn
            ? `Access to folder "${res.folderName}" granted for automatic backup.`
            : `دسترسی به پوشه «${res.folderName}» جهت پشتیبان‌گیری و فراخوانی خودکار تایید شد.`
        );
      }
    } catch {
      // ignore
    } finally {
      setIsGrantingFolder(false);
    }
  };

  const handleInstallClick = async () => {
    // Request folder access & notification permission during installation as required
    await handleGrantFolderPermission(false);

    if (deferredPrompt) {
      try {
        deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (choice.outcome === 'accepted') {
          onInstalled();
          onClose();
        }
      } catch (err) {
        console.warn('Install prompt error:', err);
      }
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(currentUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md animate-in fade-in"
      dir={isEn ? 'ltr' : 'rtl'}
    >
      <div className="bg-stone-900 border border-stone-700/80 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-stone-800 flex items-center justify-between bg-stone-950/60">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl overflow-hidden border border-[#F7941E]/40 p-0.5 bg-black shadow-inner flex-shrink-0">
              <img src={`${appIcon}${appIcon.includes('?') ? '&' : '?'}v=f7941e`} alt="YAAD" className="w-full h-full object-cover rounded-lg sm:rounded-xl" />
            </div>
            <div>
              <h3 className="font-black text-white text-base">
                {isEn ? 'Install & Run YAAD' : 'نصب و اجرای یاد'}
              </h3>
              <p className="text-[11px] text-teal-400 font-medium">
                {isEn ? 'Progressive Web App (PWA) with Offline & Auto-Backup' : 'نسخه پیشرو وب (PWA) با پشتیبان‌گیری خودکار در پوشه YAAD'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-stone-400 hover:text-white hover:bg-stone-800 transition-colors"
            title={isEn ? 'Close' : 'بستن'}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Folder Access Permission on Install (پوشه YAAD) */}
          <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-black text-emerald-300">
                <FolderOpen className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>
                  {isEn
                    ? 'Automatic Local Backup Folder (YAAD)'
                    : 'مجوز پوشه پشتیبان محلی (YAAD) هنگام نصب'}
                </span>
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
                folderGranted
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                  : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
              }`}>
                {folderGranted ? (isEn ? 'Ready ✓' : 'فعال ✓') : (isEn ? 'Permission Needed' : 'نیاز به تایید')}
              </span>
            </div>

            <p className="text-[11px] text-stone-300 leading-relaxed">
              {isEn
                ? 'Grant access to the "YAAD" folder on your device so all reminders, locations, ideas, and occasions are automatically backed up and restored on every app open, close, and re-installation.'
                : 'جهت ذخیره و فراخوانی خودکار اطلاعات در پوشه «YAAD» در ریشه حافظه گوشی در هر بار بستن، باز شدن و نصب مجدد برنامه، دسترسی به حافظه را تایید نمایید.'}
            </p>

            {folderStatusMsg && (
              <div className="p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-200 text-[11px] flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>{folderStatusMsg}</span>
              </div>
            )}

            <button
              type="button"
              disabled={isGrantingFolder}
              onClick={() => handleGrantFolderPermission(true)}
              className="w-full min-h-[42px] py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95"
            >
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>
                {isGrantingFolder
                  ? (isEn ? 'Checking folder...' : 'در حال بررسی پوشه...')
                  : (isEn ? 'Grant Access to YAAD Folder & Restore' : 'تایید دسترسی پوشه YAAD و فراخوانی خودکار')}
              </span>
            </button>
          </div>

          {/* If 1-click install prompt is supported & ready */}
          {deferredPrompt ? (
            <div className="p-4 rounded-2xl bg-teal-500/10 border border-teal-500/30 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-teal-500/20 text-teal-300 flex items-center justify-center mx-auto">
                <Download className="w-6 h-6" />
              </div>
              <div>
                <h4 className="font-bold text-white text-sm">
                  {isEn ? 'One-Click Direct Install' : 'نصب مستقیم با یک کلیک'}
                </h4>
                <p className="text-xs text-stone-300 mt-1">
                  {isEn 
                    ? 'Your browser is ready to add the YAAD icon directly to your home screen or desktop.' 
                    : 'مرورگر شما آماده نصب مستقیم آیکون یاد روی صفحه اصلی گوشی یا کامپیوتر است.'}
                </p>
              </div>
              <button
                type="button"
                onClick={handleInstallClick}
                className="w-full py-3 rounded-xl bg-teal-500 hover:bg-teal-400 text-stone-950 font-black text-sm shadow-lg shadow-teal-500/30 active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Download className="w-4 h-4 stroke-[3]" />
                <span>{isEn ? 'Install YAAD Now' : 'نصب فوری اپلیکیشن'}</span>
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="p-3.5 rounded-2xl bg-indigo-500/10 border border-indigo-500/25 space-y-2">
                <div className="flex items-center gap-2 text-indigo-300 text-xs font-bold">
                  <Smartphone className="w-4 h-4 flex-shrink-0" />
                  <span>{isEn ? 'Installation Guide for Phone & PC' : 'راهنمای نصب اپلیکیشن روی گوشی و کامپیوتر'}</span>
                </div>
                <p className="text-[12px] text-stone-300 leading-relaxed">
                  {isEn
                    ? 'YAAD is a fully compliant Progressive Web App. Follow these steps to add the app icon to your phone home screen:'
                    : 'اپلیکیشن «یاد» دارای استاندارد کامل PWA است. برای اضافه کردن آیکون برنامه به صفحه اصلی و استفاده آفلاین مراحل زیر را انجام دهید:'}
                </p>
              </div>

              {/* Step by step guide */}
              <div className="space-y-2">
                <div className="flex items-start gap-3 p-3 rounded-xl bg-stone-950/70 border border-stone-800">
                  <div className="w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 text-xs font-black flex items-center justify-center flex-shrink-0 mt-0.5">
                    1
                  </div>
                  <div className="text-xs text-stone-300 leading-relaxed">
                    {isEn 
                      ? <>Tap the browser three-dots menu (<strong className="text-white">⋮</strong>) in Google Chrome.</>
                      : <>منوی سه‌نقطه (<strong className="text-white">⋮</strong>) در بالای مرورگر کروم را لمس کنید.</>}
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-xl bg-stone-950/70 border border-stone-800">
                  <div className="w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 text-xs font-black flex items-center justify-center flex-shrink-0 mt-0.5">
                    2
                  </div>
                  <div className="text-xs text-stone-300 leading-relaxed">
                    {isEn 
                      ? <>Select <strong className="text-white">"Install app"</strong> or <strong className="text-white">"Add to Home screen"</strong>.</>
                      : <>گزینه <strong className="text-white">«نصب برنامه» (Install app)</strong> یا <strong className="text-white">«افزودن به صفحه اصلی» (Add to Home screen)</strong> را انتخاب کنید.</>}
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-xl bg-stone-950/70 border border-stone-800">
                  <div className="w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 text-xs font-black flex items-center justify-center flex-shrink-0 mt-0.5">
                    3
                  </div>
                  <div className="text-xs text-stone-300 leading-relaxed">
                    {isEn 
                      ? 'The YAAD icon will be added to your home screen and launcher, running in full-screen native mode.'
                      : 'آیکون اختصاصی «یاد» به لیست برنامه‌های شما افزوده شده و مشابه یک برنامه نصبی اجرا خواهد شد.'}
                  </div>
                </div>
              </div>

              {/* Alternative in other browsers */}
              <div className="p-3 rounded-xl bg-stone-950/50 border border-stone-800 text-xs text-stone-400 space-y-1.5">
                <div className="font-bold text-stone-300 flex items-center gap-1.5">
                  <Monitor className="w-3.5 h-3.5 text-indigo-400" />
                  <span className="text-white font-bold">{isEn ? 'Other Browsers:' : 'در سایر مرورگرها:'}</span>
                </div>
                <p className="leading-relaxed">
                  {isEn 
                    ? <>On <strong>Samsung Internet</strong>: menu ➔ "Add page to" ➔ "Home screen". On <strong>iPhone (Safari)</strong>: tap Share button ➔ "Add to Home Screen".</>
                    : <>در <strong>سامسونگ اینترنت</strong> منوی سه خط ➔ «افزودن به صفحه اصلی»؛ و در <strong>آیفون (سافاری)</strong> دکمه اشتراک‌گذاری ➔ «Add to Home Screen» را بزنید.</>}
                </p>
              </div>
            </div>
          )}

          {/* Copy Direct Link */}
          <div className="pt-2 border-t border-stone-800 space-y-2">
            <label className="text-xs text-stone-400 font-medium block">
              {isEn ? 'Direct Link to Share or Open:' : 'لینک مستقیم اشتراک‌گذاری و باز کردن:'}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={currentUrl}
                className="flex-1 px-3 py-2 rounded-xl bg-stone-950 border border-stone-800 text-[11px] font-mono text-stone-300 select-all"
              />
              <button
                type="button"
                onClick={handleCopyLink}
                className="px-3 py-2 rounded-xl bg-stone-800 hover:bg-stone-700 text-white text-xs font-bold flex items-center gap-1.5 transition-all flex-shrink-0 cursor-pointer"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-teal-400" />}
                <span>{copied ? (isEn ? 'Copied!' : 'کپی شد') : (isEn ? 'Copy' : 'کپی لینک')}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-stone-800 bg-stone-950/80 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-white text-xs font-bold transition-colors cursor-pointer"
          >
            {isEn ? 'Got It' : 'متوجه شدم'}
          </button>
        </div>
      </div>
    </div>
  );
};
