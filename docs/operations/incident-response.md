# Incident response

Severity levels and the first 15 minutes are in [DEPLOYMENT_AND_MONITORING.md](../DEPLOYMENT_AND_MONITORING.md) section 4. This page adds who does what.

## Who

| Role | Who | Does |
|---|---|---|
| On call | The developer (Telegram alerts) | Answers every P1 and P2 alert |
| Business owner | Each shop's owner | Reports problems (About this app → Report a problem), tells their staff |
| Providers | Supabase, Cloudflare, Safaricom, Airtel, Paystack | Fix outages on their side; check their status pages first |

There is one person on call. When they can't respond (travel, no network), say so in advance to owners and who to call instead.

## How fast

| Level | First response | Owners told | Fixed or worked around |
|---|---|---|---|
| P1: can't trade | 15 min | 30 min | 4 h |
| P2: something is wrong | Same day | If it affects them | 2 days |
| P3: small | Next release | No | When planned |

## Escalation

1. Alert in Telegram (watchdog, crash, deploy, uptime monitor) or a "We can't work" report.
2. No answer to a P1 in 15 minutes: the uptime tool's email reaches the same person on a second channel.
3. Provider at fault: open a ticket with the provider (Supabase dashboard → Support; Cloudflare → Support; Safaricom Daraja → support email) and tell owners.

## After

Write three lines (what broke, why, what stops it happening again) in the problem report or `docs/operations/incidents.md`. A P1 that the alerts didn't catch means a new watchdog check or monitor.
