import { createContext, useContext, useState, useCallback, useRef, ReactNode } from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';

export interface ConfirmOptions {
  title:        string;
  message:      string;
  confirmText?: string;
  danger?:      boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen]       = useState(false);
  const [opts, setOpts]       = useState<ConfirmOptions>({ title: '', message: '' });
  const resolveRef            = useRef<(v: boolean) => void>(() => {});

  const confirm: ConfirmFn = useCallback((options) => {
    setOpts(options);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  function handleConfirm() { setOpen(false); resolveRef.current(true);  }
  function handleCancel()  { setOpen(false); resolveRef.current(false); }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}

      {open && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">

            {/* Header */}
            <div className="flex items-start gap-3 p-5 pb-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${opts.danger ? 'bg-red-100' : 'bg-amber-100'}`}>
                {opts.danger
                  ? <Trash2        className="w-5 h-5 text-red-600" />
                  : <AlertTriangle className="w-5 h-5 text-amber-600" />}
              </div>
              <div className="flex-1 min-w-0 pt-0.5">
                <h3 className="font-bold text-slate-800 text-base leading-tight">{opts.title}</h3>
                <p className="text-slate-500 text-sm mt-1 leading-relaxed">{opts.message}</p>
              </div>
              <button onClick={handleCancel} className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Actions */}
            <div className="flex gap-3 p-5 pt-3">
              <button
                onClick={handleCancel}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold text-sm hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                className={`flex-1 py-2.5 rounded-xl font-bold text-sm text-white transition-colors ${
                  opts.danger ? 'bg-red-500 hover:bg-red-600' : 'bg-amber-500 hover:bg-amber-600'
                }`}
              >
                {opts.confirmText ?? 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be inside ConfirmProvider');
  return ctx;
}
