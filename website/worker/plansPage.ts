// The public plans page (SaaS step 7): what the platform's own address shows (the bare platform
// domain and www). Built on the server from get_public_plans (20261204005), no scripts, so it
// works under the site's CSP and for search engines. Every "Choose" button opens the app's
// sign-up with that plan picked (?plan=<code>&cycle=...); the app keeps it until they are signed
// in. It names no business.
import { escapeHtml } from '../src/render';
import { formatPrice } from '../src/numbers';

export interface PublicPlan {
  code: string;
  name: string;
  kind: 'subscription' | 'perpetual' | string;
  description: string | null;
  monthly_price: number | null;
  annual_price: number | null;
  one_time_price: number | null;
  setup_fee: number | null;
  max_branches: number;
  max_staff: number;
  storage_mb: number;
  ai_daily_cap: number;
  addons_allowed: boolean;
  show_powered_by: boolean;
  modules: string[];
}

export interface PublicModule {
  key: string;
  name: string;
  tier: string;
  addable: boolean;
  addon_monthly_price: number | null;
  addon_annual_price: number | null;
}

export interface PublicPlans {
  platform_name: string | null;
  app_url: string | null;
  trial_enabled: boolean;
  trial_days: number;
  vat_percent: number;
  terms_url: string | null;
  contact_text: string | null;
  plans: PublicPlan[];
  modules: PublicModule[];
}

export type Cycle = 'monthly' | 'annual';

const money = (n: number) => formatPrice('KSh', Number(n) || 0);

/** The sign-up address for a plan, or null when the app's address isn't set yet. */
export function signupLink(appUrl: string | null, plan: string, cycle: Cycle): string | null {
  if (!appUrl || !/^https:\/\//.test(appUrl)) return null;
  const u = new URL(appUrl);
  u.searchParams.set('plan', plan);
  if (plan !== 'trial') u.searchParams.set('cycle', cycle);
  return u.toString();
}

function priceLine(p: PublicPlan, cycle: Cycle): string {
  if (p.kind === 'perpetual') {
    return p.one_time_price != null ? `<b>${escapeHtml(money(p.one_time_price))}</b> <span>once</span>` : '<b>Ask us</b>';
  }
  const v = cycle === 'annual' ? p.annual_price : p.monthly_price;
  return v != null ? `<b>${escapeHtml(money(v))}</b> <span>${cycle === 'annual' ? 'a year' : 'a month'}</span>` : '<b>Ask us</b>';
}

function planCard(p: PublicPlan, data: PublicPlans, cycle: Cycle, highlight: boolean): string {
  const names = new Map(data.modules.map((m) => [m.key, m.name]));
  const extras = p.modules.filter((k) => k !== 'own_domain').map((k) => names.get(k) ?? k);
  const lines = [
    `Up to ${p.max_branches} ${p.max_branches === 1 ? 'branch' : 'branches'} and ${p.max_staff} staff`,
    'Selling, stock, customers, money and staff',
    'KRA eTIMS receipts',
    ...extras,
    p.modules.includes('own_domain') ? 'Your own web address for the shop' : '',
    p.ai_daily_cap > 0 ? `${p.ai_daily_cap} AI questions a day` : '',
    p.addons_allowed ? 'Add single modules when you need them' : '',
  ].filter(Boolean);
  const link = signupLink(data.app_url, p.code, cycle);
  const setup = p.setup_fee && Number(p.setup_fee) > 0 ? `<p class="small">Plus ${escapeHtml(money(p.setup_fee))} to set up</p>` : '';
  return `<article class="plan${highlight ? ' best' : ''}">
  <h2>${escapeHtml(p.name)}</h2>
  ${p.description ? `<p class="desc">${escapeHtml(p.description)}</p>` : ''}
  <p class="price">${priceLine(p, cycle)}</p>
  ${setup}
  <ul>${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>
  ${link ? `<a class="btn" href="${escapeHtml(link)}">Choose ${escapeHtml(p.name)}</a>` : '<p class="small">Sign-up opens soon.</p>'}
</article>`;
}

/** The whole page. */
export function plansPageHtml(data: PublicPlans, cycle: Cycle, siteUrl: string): string {
  const name = data.platform_name || 'Shop software';
  const subs = data.plans.filter((p) => p.kind !== 'perpetual');
  const perpetual = data.plans.filter((p) => p.kind === 'perpetual');
  const best = subs.length >= 2 ? subs[Math.floor(subs.length / 2)]?.code : undefined;
  const trial = data.trial_enabled ? signupLink(data.app_url, 'trial', cycle) : null;
  const addons = data.modules.filter((m) => m.addable && (cycle === 'annual' ? m.addon_annual_price : m.addon_monthly_price) != null);
  const title = `${name}: plans and prices`;
  const description = `Sales, stock, customers and money for your shop. ${subs.map((p) => p.name).join(', ')} plans${data.trial_enabled ? `, free for ${data.trial_days} days` : ''}.`;
  const tab = (c: Cycle, label: string) =>
    `<a href="${c === 'annual' ? '?cycle=annual' : '?'}" class="${cycle === c ? 'on' : ''}"${cycle === c ? ' aria-current="page"' : ''}>${label}</a>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(siteUrl)}/">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${escapeHtml(siteUrl)}/">
<style>
:root{--bg:#fffdf9;--card:#fff;--text:#1f2937;--muted:#6b7280;--line:#e5e7eb;--accent:#f59e0b;--accent-text:#0f172a;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0f172a;--card:#111c33;--text:#e5e7eb;--muted:#9ca3af;--line:#233150;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.wrap{max-width:72rem;margin:0 auto;padding:32px 16px 48px}
header{text-align:center;margin-bottom:24px}h1{font-size:clamp(1.6rem,4vw,2.3rem);margin:0 0 8px}
.lead{color:var(--muted);max-width:40rem;margin:0 auto}
.tabs{display:inline-flex;gap:4px;padding:4px;border:1px solid var(--line);border-radius:12px;margin:20px 0 4px;background:var(--card)}
.tabs a{padding:6px 14px;border-radius:9px;color:var(--text);text-decoration:none;font-weight:600;font-size:14px}
.tabs a.on{background:var(--accent);color:var(--accent-text)}
.trial{margin:20px auto 0;max-width:40rem;border:1px solid var(--accent);border-radius:16px;padding:16px;text-align:center}
.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(16rem,1fr));margin-top:24px}
.plan{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:20px;display:flex;flex-direction:column}
.plan.best{border-color:var(--accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 35%,transparent)}
.plan h2{margin:0;font-size:1.2rem}.desc{color:var(--muted);margin:4px 0 0;font-size:14px}
.price{margin:14px 0 2px;font-size:14px;color:var(--muted)}.price b{font-size:1.5rem;color:var(--text)}
.plan ul{list-style:none;padding:0;margin:14px 0 18px;flex:1}.plan li{padding:4px 0 4px 22px;position:relative;font-size:14px}
.plan li:before{content:"";position:absolute;left:4px;top:11px;width:8px;height:8px;border-radius:50%;background:var(--accent)}
.btn{display:block;text-align:center;background:var(--accent);color:var(--accent-text);font-weight:700;padding:11px;border-radius:12px;text-decoration:none}
.btn:focus-visible,.tabs a:focus-visible{outline:2px solid var(--text);outline-offset:2px}
.small{font-size:13px;color:var(--muted);margin:4px 0}
section.more{margin-top:32px;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:20px}
section.more h2{font-size:1.05rem;margin:0 0 8px}
.addons{display:grid;gap:6px;grid-template-columns:repeat(auto-fit,minmax(14rem,1fr));padding:0;list-style:none;margin:0}
footer{margin-top:32px;text-align:center;font-size:13px;color:var(--muted)}footer a{color:inherit}
</style>
</head>
<body>
<div class="wrap">
<header>
  <h1>${escapeHtml(name)}</h1>
  <p class="lead">Sales, stock, customers and money for your shop, on your phone and computer. Each business sees only its own records.</p>
  <nav class="tabs" aria-label="Pay">${tab('monthly', 'Monthly')}${tab('annual', 'Yearly')}</nav>
  ${trial ? `<div class="trial"><b>Try it free for ${data.trial_days} days.</b> No payment to start. <a class="btn" style="display:inline-block;margin-top:10px;padding:9px 18px" href="${escapeHtml(trial)}">Start free trial</a></div>` : ''}
</header>
<main>
  <div class="grid">${subs.map((p) => planCard(p, data, cycle, p.code === best)).join('')}</div>
  ${addons.length ? `<section class="more"><h2>Add-ons for Pro</h2><ul class="addons">${addons
    .map((m) => `<li>${escapeHtml(m.name)}: <b>${escapeHtml(money((cycle === 'annual' ? m.addon_annual_price : m.addon_monthly_price) as number))}</b> ${cycle === 'annual' ? 'a year' : 'a month'}</li>`)
    .join('')}</ul></section>` : ''}
  ${perpetual.length ? `<div class="grid">${perpetual.map((p) => planCard(p, data, cycle, false)).join('')}</div>` : ''}
  <section class="more">
    <h2>Good to know</h2>
    <p class="small">${Number(data.vat_percent) > 0 ? `Prices are before VAT (${escapeHtml(String(Number(data.vat_percent)))}%).` : 'Prices include everything we charge.'} M-Pesa, card and SMS companies charge separately; the app shows estimates when you choose.</p>
    <p class="small">Moving to a smaller plan never deletes your records. If a payment is late, the app keeps working for a few days, then becomes read-only until it is paid.</p>
  </section>
</main>
<footer>
  ${data.contact_text ? `<p>${escapeHtml(data.contact_text)}</p>` : ''}
  ${data.terms_url ? `<p><a href="${escapeHtml(data.terms_url)}">Terms and conditions</a></p>` : ''}
</footer>
</div>
</body>
</html>`;
}
