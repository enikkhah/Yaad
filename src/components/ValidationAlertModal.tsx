import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ValidationAlertModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  message?: string;
  fieldName?: string;
}

export const ValidationAlertModal: React.FC<ValidationAlertModalProps> = ({
  isOpen,
  onClose,
  title = 'تکمیل فیلد اجباری',
  message,
  fieldName,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div 
        className="relative w-full max-w-sm bg-stone-900 border-2 border-amber-500 rounded-3xl p-5 sm:p-6 shadow-2xl shadow-amber-950/80 text-right space-y-4 animate-in zoom-in-95 duration-150"
        dir="rtl"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute left-4 top-4 p-1.5 rounded-full text-stone-400 hover:text-white hover:bg-stone-800 transition-colors"
          title="بستن"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Warning Icon Badge */}
        <div className="w-14 h-14 rounded-2xl bg-amber-500/15 border border-amber-500/40 text-amber-400 flex items-center justify-center mx-auto shadow-lg shadow-amber-500/10">
          <AlertTriangle className="w-7 h-7 animate-pulse text-amber-400" />
        </div>

        <div className="text-center space-y-2">
          <h3 className="text-base sm:text-lg font-black text-white">
            {title}
          </h3>
          <p className="text-xs sm:text-sm text-stone-300 leading-relaxed">
            {message ? (
              message
            ) : fieldName ? (
              <>
                فیلد اجباری <strong className="text-amber-400 underline decoration-amber-500/50">«{fieldName}»</strong> پر نشده است. لطفاً برای ثبت و ادامه، این فیلد را وارد کنید.
              </>
            ) : (
              'لطفاً فیلدهای اجباری مشخص‌شده را تکمیل فرمایید.'
            )}
          </p>
        </div>

        <div className="pt-2">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-3 rounded-2xl bg-amber-500 hover:bg-amber-400 text-stone-950 font-black text-xs sm:text-sm shadow-lg shadow-amber-500/25 transition-all active:scale-95 cursor-pointer"
          >
            متوجه شدم و تکمیل می‌کنم
          </button>
        </div>
      </div>
    </div>
  );
};
