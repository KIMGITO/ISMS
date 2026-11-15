// A question from the assistant with answers to tap. The answer is sent back as the
// person's next message, so the assistant reads it like anything they type.

import React, { useState } from 'react';
import { Send, CheckCircle2 } from 'lucide-react';
import SearchableDropdown from '../SearchableDropdown';
import type { ChatQuestion } from '../../stores/uiStore';

interface Props {
  question: ChatQuestion;
  /** False while the assistant is answering, or when this is not the latest question. */
  enabled: boolean;
  onAnswer: (answer: string) => void;
}

export default function QuestionCard({ question, enabled, onAnswer }: Props) {
  const [picked, setPicked] = useState<string[]>([]);
  const [other, setOther] = useState('');
  const answered = question.answer != null;
  const locked = answered || !enabled;
  const { style, options } = question;

  const submit = (value?: string) => {
    const answer = (value ?? (style === 'multi' ? [...picked, ...(other.trim() ? [other.trim()] : [])].join(', ') : other.trim() || picked[0] || '')).trim();
    if (!answer || locked) return;
    onAnswer(answer);
  };

  const toggle = (opt: string) => {
    if (locked) return;
    setOther('');
    setPicked((cur) => (style === 'multi' ? (cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt]) : [opt]));
  };

  const chosen = (opt: string) =>
    answered ? question.answer!.split(', ').includes(opt) || question.answer === opt : picked.includes(opt);

  const needsSend = style !== 'buttons';
  const canSend = !locked && (picked.length > 0 || other.trim().length > 0);

  return (
    <div className="w-full rounded-xl border border-app-border bg-app-card p-3 space-y-2.5 shadow-xs">
      <p className="text-xs font-bold text-app-text">{question.question}</p>

      {style === 'buttons' && (
        <div className="flex flex-wrap gap-1.5">
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              disabled={locked}
              onClick={() => submit(opt)}
              className={`min-h-9 px-3.5 rounded-full border text-xs font-semibold transition ${
                chosen(opt)
                  ? 'bg-amber-500 border-amber-500 text-slate-950'
                  : 'bg-app-bg border-app-border text-app-text hover:border-amber-500 disabled:hover:border-app-border'
              } ${locked ? 'cursor-default' : 'cursor-pointer'} ${locked && !chosen(opt) ? 'opacity-50' : ''}`}
            >
              {opt}
            </button>
          ))}
        </div>
      )}

      {(style === 'single' || style === 'multi') && (
        <div className="space-y-1" role={style === 'single' ? 'radiogroup' : 'group'}>
          {options.map((opt) => (
            <label
              key={opt}
              className={`min-h-10 px-3 flex items-center gap-2.5 rounded-lg border text-xs transition ${
                chosen(opt) ? 'border-amber-500 bg-amber-500/10 text-app-text font-semibold' : 'border-app-border bg-app-bg text-app-text'
              } ${locked ? 'cursor-default' : 'cursor-pointer hover:border-amber-500/60'} ${locked && !chosen(opt) ? 'opacity-50' : ''}`}
            >
              <input
                type={style === 'single' ? 'radio' : 'checkbox'}
                checked={chosen(opt)}
                disabled={locked}
                onChange={() => toggle(opt)}
                className="accent-amber-500 w-4 h-4"
              />
              {opt}
            </label>
          ))}
        </div>
      )}

      {style === 'select' && (
        <SearchableDropdown
          items={options.map((o) => ({ id: o, label: o }))}
          selectedValue={answered ? question.answer! : picked[0] || ''}
          onChange={(v) => toggle(v)}
          placeholder="Choose one"
          disabled={locked}
        />
      )}

      {question.allowOther && !answered && (
        <input
          type="text"
          value={other}
          disabled={locked}
          placeholder="Or type another answer"
          onChange={(e) => { setOther(e.target.value); if (style !== 'multi') setPicked([]); }}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          className="w-full min-h-10 bg-app-bg border border-app-border rounded-lg px-3 text-xs text-app-text focus:outline-none focus:border-amber-500"
        />
      )}

      {answered ? (
        <p className="text-[10px] text-app-text-muted flex items-center gap-1">
          <CheckCircle2 size={11} className="text-emerald-500" /> Answered: {question.answer}
        </p>
      ) : (
        (needsSend || question.allowOther) && (
          <div className="flex justify-end">
            <button
              type="button"
              disabled={!canSend}
              onClick={() => submit()}
              className="min-h-9 px-4 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:bg-app-border disabled:text-app-text-muted text-slate-950 text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed"
            >
              <Send size={12} /> Send answer
            </button>
          </div>
        )
      )}
    </div>
  );
}
