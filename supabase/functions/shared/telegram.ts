// supabase/functions/shared/telegram.ts
// Sends alerts to the developer's Telegram chat through a bot.
// The bot token and chat ID are the function secrets TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID
// and never reach the app.

export interface AlertMessage {
  /** First lines of the message, already escaped (Telegram HTML: <b>, <i>, <code>). */
  text: string;
  /** Label and value lines shown under the heading. Values are escaped here. */
  fields?: Array<[string, string]>;
  /** Longer text, such as a stack trace, shown in a code block. Escaped here. */
  code?: string;
  /** Link shown at the end. */
  link?: { label: string; url: string };
}

/** Escapes &, < and >, which Telegram HTML treats as markup. */
export function htmlEscape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Returns true when Telegram accepted the message. Never throws. */
export async function sendAlert(message: AlertMessage): Promise<boolean> {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID");
  if (!token || !chatId) {
    console.error("[telegram] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not set; message not sent:", message.text);
    return false;
  }

  const parts = [message.text];
  if (message.fields?.length) {
    parts.push(
      message.fields
        .slice(0, 10)
        .map(([label, value]) => `<b>${htmlEscape(label)}:</b> ${htmlEscape(value || "—")}`)
        .join("\n"),
    );
  }
  if (message.code) {
    // Telegram allows 4096 characters per message; leave room for the rest.
    parts.push(`<pre>${htmlEscape(message.code.slice(0, 2800))}</pre>`);
  }
  if (message.link) {
    parts.push(`<a href="${htmlEscape(message.link.url)}">${htmlEscape(message.link.label)}</a>`);
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: parts.join("\n\n"),
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) console.error("[telegram] Telegram answered", res.status, await res.text().catch(() => ""));
    return res.ok;
  } catch (err) {
    console.error("[telegram] Sending failed:", err);
    return false;
  }
}
