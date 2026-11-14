// supabase/functions/shared/slack.ts
// Posts to the developer's Slack channel through an incoming webhook.
// The webhook URL is the function secret SLACK_WEBHOOK_URL and never reaches the app.

export interface SlackMessage {
  /** Shown in notifications and as the fallback. */
  text: string;
  /** Lines shown under the heading, as Slack mrkdwn. */
  fields?: Array<[string, string]>;
  /** Longer text, such as a stack trace, shown in a code block. */
  code?: string;
  /** Link shown at the end. */
  link?: { label: string; url: string };
}

/** Escapes &, < and >, which Slack treats as markup. */
export function slackEscape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Returns true when Slack accepted the message. Never throws. */
export async function postToSlack(message: SlackMessage): Promise<boolean> {
  const webhook = Deno.env.get("SLACK_WEBHOOK_URL");
  if (!webhook) {
    console.error("[slack] SLACK_WEBHOOK_URL is not set; message not sent:", message.text);
    return false;
  }

  const blocks: unknown[] = [
    { type: "section", text: { type: "mrkdwn", text: message.text } },
  ];
  if (message.fields?.length) {
    blocks.push({
      type: "section",
      fields: message.fields.slice(0, 10).map(([label, value]) => ({
        type: "mrkdwn",
        text: `*${label}*\n${value || "—"}`,
      })),
    });
  }
  if (message.code) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "```" + message.code.slice(0, 2800).replace(/```/g, "'''") + "```" },
    });
  }
  if (message.link) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `<${message.link.url}|${slackEscape(message.link.label)}>` }],
    });
  }

  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message.text, blocks }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) console.error("[slack] Webhook answered", res.status, await res.text().catch(() => ""));
    return res.ok;
  } catch (err) {
    console.error("[slack] Webhook failed:", err);
    return false;
  }
}
