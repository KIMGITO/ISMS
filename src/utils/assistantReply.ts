// Splits an assistant reply into the text people read, the tasks it prepared and the
// questions it asks. The model writes these as tagged JSON lines:
//   [PENDING_ACTION: {"type":"settle_debt", ...}]
//   [ASK: {"question":"Which customer?","options":["Jane","John"],"style":"buttons"}]
// Brace counting (not a regex) finds where each JSON ends, so nested objects work.

import type { ChatQuestion } from '../stores/uiStore';

export interface DraftFromReply {
  type: string;
  title: string;
  summary: string;
  params: Record<string, any>;
}

export interface ParsedReply {
  text: string;
  drafts: DraftFromReply[];
  questions: ChatQuestion[];
}

const TAG = /\[?\s*(PENDING_?ACTION|ACTION_TRIGGER|ASK|QUESTION|CHOICES?)\s*:\s*\{/gi;

function blocks(text: string): { tag: string; full: string; json: string }[] {
  const out: { tag: string; full: string; json: string }[] = [];
  TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG.exec(text)) !== null) {
    const start = m.index + m[0].length - 1;
    let depth = 0;
    let inString = false;
    let escape = false;
    let i = start;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\' && inString) { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) break;
    }
    if (depth !== 0) continue;
    const close = text.slice(i + 1).match(/^\s*\]/);
    const end = i + 1 + (close ? close[0].length : 0);
    out.push({ tag: m[1].toUpperCase(), full: text.slice(m.index, end), json: text.slice(start, i + 1) });
    TAG.lastIndex = end;
  }
  return out;
}

function toQuestion(raw: any): ChatQuestion | null {
  const question = String(raw?.question ?? raw?.text ?? raw?.prompt ?? '').trim();
  const options = (Array.isArray(raw?.options) ? raw.options : Array.isArray(raw?.choices) ? raw.choices : [])
    .map((o: any) => String(typeof o === 'object' && o ? o.label ?? o.value ?? '' : o ?? '').trim())
    .filter(Boolean)
    .filter((o: string, i: number, all: string[]) => all.indexOf(o) === i)
    .slice(0, 30);
  if (!question || options.length === 0) return null;
  const asked = String(raw?.style ?? raw?.type ?? '').toLowerCase();
  let style: ChatQuestion['style'] =
    asked.includes('multi') || asked.includes('check') || raw?.multiple === true ? 'multi'
    : asked.includes('select') || asked.includes('drop') ? 'select'
    : asked.includes('radio') || asked.includes('single') ? 'single'
    : 'buttons';
  // Long lists read better as a dropdown, and many buttons do not fit a phone.
  if (style !== 'multi' && options.length > 6) style = 'select';
  return { question, style, options, allowOther: raw?.allowOther === true || raw?.other === true };
}

export function parseAssistantReply(reply: string): ParsedReply {
  let text = reply;
  const drafts: DraftFromReply[] = [];
  const questions: ChatQuestion[] = [];
  for (const b of blocks(reply)) {
    text = text.replace(b.full, '');
    let data: any;
    try { data = JSON.parse(b.json); } catch { continue; }
    if (b.tag.startsWith('PENDING') || b.tag === 'ACTION_TRIGGER') {
      const type = data?.type || data?.action;
      if (!type) continue;
      drafts.push({
        type: String(type),
        title: String(data.title || 'Assistant task'),
        summary: String(data.summary || ''),
        params: data.params && typeof data.params === 'object' ? data.params : {},
      });
    } else {
      const q = toQuestion(data);
      if (q) questions.push(q);
    }
  }
  return { text: text.replace(/\n{3,}/g, '\n\n').trim(), drafts, questions };
}
