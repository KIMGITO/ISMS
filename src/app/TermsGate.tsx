// First launch on a device: the short terms, accepted once and remembered here.
import { useState } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { Checkbox } from '../components/shared/Checkbox';

/** True once this device has accepted the terms (current or legacy key). */
export function termsAcceptedOnDevice(): boolean {
  return (
    localStorage.getItem('isms_terms_accepted') === 'true' ||
    localStorage.getItem('kkm_terms_accepted') === 'true'
  );
}

export function TermsGate({ onAccepted }: { onAccepted: () => void }) {
  const { showToast } = useAppStore();
  const [agreeChecked, setAgreeChecked] = useState(true);

  const handleAcceptTerms = () => {
    // Remembered on this device; the legacy key keeps older builds happy.
    localStorage.setItem('isms_terms_accepted', 'true');
    localStorage.setItem('kkm_terms_accepted', 'true');
    // When it was accepted, for the record.
    localStorage.setItem('isms_terms_accepted_at', new Date().toISOString());
    onAccepted();
    showToast('Welcome', 'Thanks for accepting the terms.', undefined, 'success');
  };

  return (
    <motion.div
      key="terms-accept"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex-1 min-h-0 flex flex-col items-center px-4 md:px-8 pt-[calc(1rem+var(--inset-top))] pb-[calc(1rem+var(--inset-bottom))] md:pt-[calc(2rem+var(--inset-top))] md:pb-[calc(2rem+var(--inset-bottom))] bg-slate-100 text-slate-900 overflow-y-auto select-none"
    >
      <div className="my-auto shrink-0 w-full max-w-md bg-white border border-slate-200 rounded-3xl shadow-sm p-6 md:p-8 space-y-5 animate-fade-in">
        <div className="text-center space-y-2">
          <div className="mx-auto w-12 h-12 bg-amber-500 rounded-2xl flex items-center justify-center text-slate-950 font-bold text-lg">
            <ShieldCheck size={22} />
          </div>
          <h1 className="text-xl font-bold font-display tracking-tight text-amber-600">
            Terms & Agreement
          </h1>
          <p className="text-[10px] text-slate-500 font-bold">
            Please read and accept to continue
          </p>
        </div>

        <div className="max-h-[220px] overflow-y-auto bg-slate-50 border border-slate-200 rounded-2xl p-4 text-[10px] text-slate-500 font-medium leading-relaxed space-y-3 text-left">
          <div>
            <p className="font-bold text-slate-800 mb-1">
              1. Who can use the app
            </p>
            <p>
              Only invited staff may use the app. Keep your password and PIN to yourself. Every change is recorded with your name.
            </p>
          </div>

          <div>
            <p className="font-bold text-slate-800 mb-1">
              2. Customer information
            </p>
            <p>
              Customer details are used for sales, receipts and points. They are never sold or shared.
            </p>
          </div>

          <div>
            <p className="font-bold text-slate-800 mb-1">
              3. Checking sales
            </p>
            <p>
              Check items and the total before finishing a sale.
            </p>
          </div>

          <div>
            <p className="font-bold text-slate-800 mb-1">
              4. Working without internet
            </p>
            <p>
              Offline sales send when the internet is back. Check before ending your shift.
            </p>
          </div>

          <div>
            <p className="font-bold text-slate-800 mb-1">
              5. The AI assistant
            </p>
            <p>
              The assistant can make mistakes. Check figures before relying on them.
            </p>
          </div>
        </div>

        <Checkbox
          className="py-1 text-left"
          checked={agreeChecked}
          onChange={setAgreeChecked}
          label={
            <span className="text-[10.5px] text-slate-700 leading-normal font-semibold">
              I agree to these terms.
            </span>
          }
        />

        <button
          type="button"
          onClick={handleAcceptTerms}
          disabled={!agreeChecked}
          className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:hover:bg-amber-500 text-slate-950 font-semibold rounded-xl text-xs cursor-pointer transition flex items-center justify-center gap-1.5"
        >
          <span>Continue </span>
          <ArrowRight size={12} />
        </button>
      </div>
    </motion.div>
  );
}
