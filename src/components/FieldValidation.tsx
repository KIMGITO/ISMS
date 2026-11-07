// src/components/FieldValidation.tsx
// Replaces the browser's own form-validation bubbles ("Please fill out this field"),
// which make the app look like a web page, with the app's own message under the field.
//
// Works for every form at once: the browser still checks `required`, `type="email"`,
// `min`, `pattern` and so on, but its bubble is suppressed and this shows instead.
// Render <FieldValidationHost /> once near the root of the app.

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle } from 'lucide-react';
import { nativeUiService } from '../core/native/NativeUiService';

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/** The field's name as people see it: its label, else its placeholder. */
function fieldName(el: Field): string {
  const fromLabel =
    (el.labels && el.labels[0]?.textContent) ||
    el.getAttribute('aria-label') ||
    (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent) ||
    el.closest('label')?.textContent ||
    '';
  const name = (fromLabel || ('placeholder' in el ? el.placeholder : '') || '').replace(/[*:]/g, '').trim();
  return name.length > 0 && name.length <= 40 ? name : '';
}

/** A short, plain message for why the value isn't accepted. */
export function messageFor(el: Field): string {
  const v = el.validity;
  const name = fieldName(el);
  const lower = name ? name.charAt(0).toLowerCase() + name.slice(1) : '';
  if (v.valueMissing) {
    if (el instanceof HTMLSelectElement) return name ? `Choose ${lower}` : 'Choose an option';
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) return 'Tick this to continue';
    return name ? `Enter ${lower}` : 'This is needed';
  }
  if (v.typeMismatch) {
    if (el instanceof HTMLInputElement && el.type === 'email') return 'Enter an email like name@example.com';
    if (el instanceof HTMLInputElement && el.type === 'url') return 'Enter a web address like https://…';
    return 'Check the format';
  }
  if (el instanceof HTMLInputElement) {
    if (v.rangeUnderflow) return `Use ${el.min} or more`;
    if (v.rangeOverflow) return `Use ${el.max} or less`;
    if (v.stepMismatch) return el.step === '1' ? 'Use a whole number' : 'Check the amount';
    if (v.tooShort) return `Use at least ${el.minLength} characters`;
    if (v.badInput) return 'Enter a number';
  }
  if (v.tooLong) return 'That is too long';
  if (v.patternMismatch) return el.title || 'Check the format';
  return 'Check this field';
}

interface Shown {
  el: Field;
  text: string;
  rect: DOMRect;
}

export function FieldValidationHost() {
  const [shown, setShown] = useState<Shown | null>(null);

  useEffect(() => {
    let lastFlag = 0;

    // "invalid" doesn't bubble, so listen in the capture phase
    const onInvalid = (e: Event) => {
      const el = e.target as Field;
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) return;
      e.preventDefault(); // no browser bubble
      el.setAttribute('aria-invalid', 'true');

      // A submit fires "invalid" for every bad field; point at the first one only
      const now = Date.now();
      if (now - lastFlag < 300) return;
      lastFlag = now;

      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      nativeUiService.hapticError();
      // Measure after the scroll settles
      window.setTimeout(() => setShown({ el, text: messageFor(el), rect: el.getBoundingClientRect() }), 220);
    };

    // Fixing the field clears its error
    const onInput = (e: Event) => {
      const el = e.target as Field;
      if (el?.getAttribute?.('aria-invalid') === 'true' && el.checkValidity?.()) {
        el.removeAttribute('aria-invalid');
        setShown((s) => (s?.el === el ? null : s));
      }
    };

    document.addEventListener('invalid', onInvalid, true);
    document.addEventListener('input', onInput, true);
    document.addEventListener('change', onInput, true);
    return () => {
      document.removeEventListener('invalid', onInvalid, true);
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('change', onInput, true);
    };
  }, []);

  // Follow the field if the page scrolls or resizes; hide after a while
  useEffect(() => {
    if (!shown) return;
    const update = () => {
      if (!shown.el.isConnected) return setShown(null);
      setShown((s) => (s ? { ...s, rect: s.el.getBoundingClientRect() } : s));
    };
    const timer = window.setTimeout(() => setShown(null), 4000);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [shown?.el]);

  const rect = shown?.rect;
  const fitsBelow = rect ? rect.bottom + 44 < window.innerHeight : true;

  return (
    <AnimatePresence>
      {shown && rect && (
        <motion.div
          key="field-error"
          role="alert"
          initial={{ opacity: 0, y: fitsBelow ? -4 : 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="fixed z-[10001] pointer-events-none max-w-[calc(100vw-1rem)] px-2.5 py-1.5 rounded-md bg-red-600 text-white text-xs font-medium shadow-lg flex items-center gap-1.5"
          style={{
            left: Math.max(8, Math.min(rect.left, window.innerWidth - 240)),
            top: fitsBelow ? rect.bottom + 6 : undefined,
            bottom: fitsBelow ? undefined : window.innerHeight - rect.top + 6,
          }}
        >
          <AlertCircle size={13} className="shrink-0" aria-hidden="true" />
          {shown.text}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
