# ISMS Production Readiness, Security & Infrastructure Hardening

**Project:** ISMS --- Integrated Shop Management System\
**Execution model:** Phased audit → remediation → verification →
documentation\
**Hosting direction:** Cloudflare for web delivery and edge services; do
not use Vercel.

------------------------------------------------------------------------

## 1. Mission

Prepare ISMS for secure commercial production and sustained growth.
Audit and improve its infrastructure, security, availability, data
protection, deployment process, scalability, monitoring, recovery and
operating costs.

This is an engineering task, not a code-cleanup exercise. Do not merely
list problems: fix issues that are safe and authorized to fix, test the
fixes, and document evidence. Work in priority order, beginning with the
highest-risk issues.

## 2. Non-negotiable rules

1.  **Inspect before changing.** Map the current codebase, database,
    services, deployment configuration and integrations before proposing
    changes.
2.  **Cloudflare, not Vercel.** Treat Cloudflare as the intended web
    platform. Inspect the current setup and plan the appropriate
    Cloudflare deployment path. Do not create or retain Vercel as the
    target deployment platform. Identify the actual Cloudflare products
    required rather than assuming every product is needed.
3.  **Preserve existing functionality and data.** Do not rewrite working
    systems or change business behaviour unnecessarily.
4.  **No destructive action without approval.** Never reset or drop a
    production database, delete records or storage, rotate live
    credentials, change DNS, alter billing, or make irreversible
    provider changes without explicit owner authorization.
5.  **No security by frontend alone.** Enforce authorization and
    business rules on trusted server-side or database layers.
6.  **Protect secrets.** Never print, commit, expose, or place private
    keys and credentials in frontend code, logs, reports or screenshots.
    Use placeholders when documenting configuration.
7.  **Do not invent success.** A configuration is not complete merely
    because code was written. Verify provider-side settings, deployment
    status, tests and actual behaviour.
8.  **Test safely.** Use local or staging environments for security
    testing, load testing, migrations and recovery drills. Never run
    destructive or uncontrolled tests against production.
9.  **Make small, reviewable changes.** Group related fixes, explain the
    impact, test them, and preserve a clear change history.
10. **Keep costs proportionate.** Prefer the simplest architecture that
    meets measured requirements. Do not introduce Kubernetes,
    microservices, multi-region deployment, paid services or extra
    vendors without a demonstrated need.
11. **Record blockers honestly.** If access, credentials, plan features
    or provider configuration are unavailable, document the exact
    blocker and the owner action required. Continue safe independent
    work.
12. **Do not weaken controls to make tests pass.** Never disable RLS,
    authentication, validation, TLS, backups or security checks as a
    workaround.
13. **Respect privacy and tenant boundaries.** Use synthetic or
    anonymized data in test environments. Do not copy real customer or
    financial data into unsecured tools.
14. **Keep documentation current.** Every material change must be
    reflected in the relevant documentation and checklist.
15. **Stop on unexpected risk.** If an action could cause data loss,
    extended downtime, security exposure or financial inconsistency,
    stop and request approval.

## 3. Cloudflare hosting direction

Cloudflare is the intended platform for web delivery. First inspect the
repository and current provider configuration, then recommend and
implement the suitable Cloudflare architecture.

Evaluate only what ISMS actually needs, which may include:

-   **Cloudflare DNS** for domain DNS management.
-   **Cloudflare Pages or Workers** for hosting and serving the web
    application, depending on the framework, build output, routing and
    server-side requirements.
-   **Cloudflare CDN/cache** for appropriate static assets and public
    content.
-   **Cloudflare WAF and security features** where available and
    justified by the account plan.
-   **Cloudflare Turnstile** only where bot protection is useful and
    correctly integrated.
-   **Cloudflare R2** only if object storage needs justify it; do not
    migrate Cloudinary or other storage automatically.
-   **Cloudflare Workers** for edge/server-side logic only where it is a
    good fit. Do not move Supabase business logic to Workers without a
    clear reason.

Important Cloudflare rules:

-   Confirm whether the app is a static Vite SPA or requires server-side
    rendering, server routes or other runtime features before choosing
    Pages or Workers.
-   Verify SPA fallback/routing, environment variables, build commands,
    output directories, custom domains, TLS and cache behaviour.
-   Never cache authenticated pages, private API responses or
    tenant-specific data publicly.
-   Do not put Supabase service-role keys or other privileged secrets in
    browser-exposed `VITE_*` variables.
-   Keep Supabase as the database/auth platform unless the audit
    establishes a justified, approved migration.
-   Verify Supabase access from the Cloudflare-hosted app, including
    CORS, redirects, authentication callbacks and allowed origins.
-   Create a documented deployment and rollback procedure.
-   Do not change live DNS or production traffic until the Cloudflare
    deployment has been tested and the owner approves the cutover.
-   Remove obsolete Vercel-specific configuration only after confirming
    it is no longer needed and the Cloudflare deployment is verified.

## 4. Severity and prioritization

Classify every finding:

-   **P0 --- Critical:** Active compromise, cross-tenant data exposure,
    exposed privileged credentials, destructive financial/data integrity
    vulnerability, or imminent major outage.
-   **P1 --- High:** Serious exploitable weakness, unreliable recovery,
    major availability risk or material financial exposure.
-   **P2 --- Medium:** Meaningful security, operational, performance or
    scalability weakness without immediate severe impact.
-   **P3 --- Low:** Hardening, maintainability or efficiency
    improvement.

For each finding record:

-   ID and title
-   Severity and confidence
-   Affected component
-   Evidence (file, configuration, test or provider setting)
-   Attack/failure scenario
-   Business impact
-   Root cause
-   Recommended remediation
-   Dependencies and risks
-   Verification test and expected result
-   Status and residual risk

Work P0 first, then P1, P2 and P3. Do not conceal unresolved findings or
lower their severity to make a phase appear complete.

## 5. Required phase workflow

For every phase:

1.  **Discover:** Inspect relevant code, schema, configuration, provider
    settings and documentation.
2.  **Baseline:** Record the current behaviour and tests before changing
    anything.
3.  **Assess:** Create evidence-based findings and rank them.
4.  **Plan:** Propose minimal, safe fixes with dependencies and rollback
    considerations.
5.  **Implement:** Fix the highest-priority authorized issues in small
    groups.
6.  **Verify:** Run relevant automated and manual tests. Record actual
    results.
7.  **Regression test:** Confirm critical existing workflows still work.
8.  **Document:** Update architecture, security, operations and change
    records.
9.  **Report:** State what is fixed, what remains, what was not tested
    and why.
10. **Continue:** Move to the next phase only when exit criteria are met
    or remaining blockers are explicitly accepted by the owner.

Do not make a large unreviewed batch of changes across multiple phases.

------------------------------------------------------------------------

# 6. Phased audit and remediation plan

## Phase 0 --- Discovery and architecture baseline

**Goal:** Establish what actually exists before changing it.

Checklist:

-   [x] Inspect the complete repository structure and identify the
    application entry points.
-   [x] Identify frontend framework, build tool, runtime requirements
    and deployment output.
-   [x] Map Supabase usage: database, Auth, Storage, Realtime, Edge
    Functions and scheduled jobs.
-   [x] Inventory all third-party integrations, including payments,
    email, push notifications and media storage.
-   [-] Identify all environments, domains, DNS records and current
    hosting configuration.
-   [x] Identify all secrets by name and location without printing their
    values.
-   [x] Review package scripts, dependencies, lockfiles and CI/CD
    workflows.
-   [x] Identify existing tests, monitoring, backups and operational
    documentation.
-   [x] Draw a current-state architecture and dependency diagram.
-   [x] Record known unknowns and provider access required.

> **Phase 0 status (2026-11-23):** done. Report: [docs/infrastructure/architecture.md](infrastructure/architecture.md). DNS is `[-]`: no custom domain is attached yet, so there are no records to inspect.

**Deliverables:** Current architecture map, service inventory, data-flow
map, environment inventory and prioritized initial findings.

**Exit criteria:** The actual architecture and deployment requirements
are understood. No assumptions about Cloudflare compatibility remain
unverified.

## Phase 1 --- Critical security and data isolation

**Goal:** Prevent unauthorized access, tenant data leakage and
compromise of privileged operations.

Checklist:

-   [x] Audit every Supabase table, view, function and exposed schema
    for access control.
-   [x] Verify RLS is enabled wherever tenant or user data requires
    protection.
-   [x] Test cross-tenant access using separate test businesses and
    accounts.
-   [ ] Verify branch-level permissions where applicable.
-   [-] Verify that client-supplied tenant, branch, role and owner
    identifiers cannot grant access.
-   [x] Review database grants, `SECURITY DEFINER` functions, search
    paths and privileged RPCs.
-   [x] Inspect Edge Functions and API endpoints for server-side
    authorization.
-   [-] Test IDOR, privilege escalation and authorization bypass
    scenarios.
-   [-] Review authentication, password/OTP flows, session lifecycle and
    account recovery.
-   [!] Protect owner and administrator accounts with appropriate MFA
    and access controls.
-   [x] Search source code and Git history for accidentally committed
    credentials; do not expose any discovered secret in output.
-   [x] Verify privileged keys are server-side only and not bundled into
    the browser application.
-   [-] Review CORS, redirect URLs, allowed origins and security
    headers.
-   [-] Review input validation, SQL injection, XSS, CSRF where
    applicable, and unsafe file uploads.
-   [x] Review dependency vulnerabilities and high-risk abandoned
    packages.
-   [ ] Verify logs and error messages do not leak secrets or sensitive
    personal/financial data.

> **Phase 1 status (2026-11-23):** in progress. P0 SEC-01 fixed and verified on live; P1s SEC-02 to SEC-05 open (owner actions). Report: [docs/security/security-assessment.md](security/security-assessment.md); findings: [docs/security/threat-register.md](security/threat-register.md); index: [docs/production-readiness.md](production-readiness.md).

**Tests:** Cross-tenant denial tests, role/permission matrix tests,
unauthenticated access tests, privileged-function tests, secret scanning
and dependency scanning.

**Exit criteria:** No known P0 security finding remains; tenant
isolation and critical authorization rules have passing tests.

## Phase 2 --- Financial and inventory data integrity

**Goal:** Ensure that critical business records cannot be duplicated,
forged, silently altered or left partially committed.

Checklist:

-   [x] Trace critical transaction flows from client to trusted
    database/server logic.
-   [-] Verify stock, sales, production, debt, wallet and payment
    operations use safe atomic transactions where required.
-   [x] Test concurrent updates and race conditions.
-   [x] Add or verify idempotency for retried submissions and payment
    callbacks.
-   [-] Verify payment callbacks using the provider's supported
    verification process.
-   [-] Prevent client-controlled amounts, ownership or payment status
    from being trusted.
-   [x] Verify duplicate webhook and replay handling.
-   [ ] Verify immutable or auditable histories for sensitive financial
    changes.
-   [ ] Verify correction/reversal workflows preserve original records.
-   [x] Check constraints, foreign keys and numeric precision for
    financial values.
-   [x] Test interrupted requests and retry behaviour.
-   [-] Confirm that failed operations do not leave partial stock or
    financial changes.

> **Phase 2 status (2026-11-23):** in progress. FIN-01/FIN-02 fixed in code and tested (44 cases); live push of `20261201002` and app release pending; SEC-10 (M-Pesa STK query) open. Report: [docs/security/phase-2-financial-integrity.md](security/phase-2-financial-integrity.md).

**Tests:** Duplicate request tests, concurrent POS/stock tests, replayed
callback tests, interrupted transaction tests and reconciliation tests.

**Exit criteria:** Critical business transactions are consistent,
auditable and safely retryable.

## Phase 3 --- Backup, restoration and disaster recovery

**Goal:** Prove that ISMS data can be recovered after realistic failure
scenarios.

Checklist:

-   [ ] Inspect the actual Supabase backup and point-in-time recovery
    options available on the current plan.
-   [ ] Confirm backup frequency, retention, coverage and restore
    limitations.
-   [ ] Design encrypted independent backups where required.
-   [ ] Ensure backups are protected from ordinary application
    credentials and unauthorized deletion.
-   [ ] Include required database objects, schema, functions and
    configuration in recovery documentation.
-   [ ] Define RPO and RTO based on business requirements and provider
    capabilities.
-   [ ] Initially assess a 15-minute RPO and 2-hour RTO for critical
    data; do not promise either without evidence.
-   [ ] Restore a backup into an isolated environment.
-   [ ] Verify restored records, relationships, constraints and critical
    workflows.
-   [ ] Record actual restoration time and data-loss window.
-   [ ] Document recovery steps, owners, credentials access process and
    escalation.
-   [ ] Schedule recurring restoration drills.

**Tests:** A real isolated restoration exercise, integrity checks and
post-restore application smoke tests.

**Exit criteria:** A tested recovery process exists, with measured
RPO/RTO and documented limitations.

## Phase 4 --- Cloudflare deployment, DNS and edge security

**Goal:** Establish a safe, supportable Cloudflare-based web deployment.

Checklist:

-   [ ] Determine whether the application is compatible with Cloudflare
    Pages, Workers or another suitable Cloudflare deployment model.
-   [ ] Confirm whether server-side rendering, server routes or
    Node-specific runtime features are required.
-   [ ] Verify build command, output directory, routing and SPA fallback
    behaviour.
-   [ ] Create or verify a separate staging deployment.
-   [ ] Configure environment variables and secrets safely.
-   [ ] Verify that no privileged secret is exposed in frontend bundles
    or source maps.
-   [ ] Configure custom domain, DNS and TLS in a controlled manner.
-   [ ] Verify Supabase Auth redirects, CORS and allowed origins after
    deployment.
-   [ ] Configure appropriate cache rules; never publicly cache
    authenticated or tenant-specific responses.
-   [ ] Evaluate WAF, rate limiting, bot protection and DDoS protections
    available on the account plan.
-   [ ] Test application routes, assets, uploads, authentication and API
    calls on the Cloudflare deployment.
-   [ ] Document rollback and DNS cutover steps.
-   [ ] Obtain owner approval before switching production DNS or
    traffic.
-   [ ] Remove Vercel-specific deployment configuration only after
    successful Cloudflare verification and approval.

**Tests:** Staging deployment, route tests, authentication tests, cache
isolation tests, TLS checks and deployment rollback rehearsal.

**Exit criteria:** Cloudflare deployment is verified in staging;
production cutover is separately approved.

## Phase 5 --- Availability, monitoring and incident detection

**Goal:** Detect failures independently and reduce the impact of
outages.

Checklist:

-   [ ] Establish an external uptime check for the public application.
-   [ ] Monitor API and database availability.
-   [ ] Monitor latency, error rates and failed requests.
-   [ ] Monitor database capacity, connections and storage.
-   [ ] Monitor scheduled jobs, queues and Edge Function failures where
    applicable.
-   [ ] Monitor payment callback failures and reconciliation delays.
-   [ ] Monitor backup completion and age.
-   [ ] Monitor domain and certificate expiration.
-   [ ] Configure actionable alerts through independent channels.
-   [ ] Test alerts by deliberately creating safe test failures.
-   [ ] Establish incident severity, ownership and escalation.
-   [ ] Ensure logs are useful, access-controlled and do not contain
    secrets.
-   [ ] Define a monthly availability objective, initially targeting
    99.9%, and measure it rather than claiming it.

**Tests:** Synthetic outage checks, alert delivery tests and failure
simulation in staging.

**Exit criteria:** Monitoring and alerts are operational and have been
demonstrated.

## Phase 6 --- Network, API and attack resistance

**Goal:** Reduce exposure to automated abuse and common application
attacks.

Checklist:

-   [ ] Assess DDoS exposure and available Cloudflare protections.
-   [ ] Apply rate limits to authentication, OTP, public APIs and
    sensitive operations.
-   [ ] Review request size and upload limits.
-   [ ] Verify security headers and content security policy.
-   [ ] Review CORS and origin validation.
-   [ ] Test injection, XSS, CSRF where relevant, IDOR and broken access
    control.
-   [ ] Review bot protection and abuse patterns.
-   [ ] Review webhook authentication, timestamp validation and replay
    protection.
-   [ ] Ensure sensitive endpoints have abuse monitoring.
-   [ ] Run dependency and secret scans in CI.
-   [ ] Establish a responsible process for security updates.
-   [ ] Arrange an independent penetration test before major enterprise
    expansion.

**Tests:** Controlled staging security tests. Do not perform
denial-of-service testing against production.

**Exit criteria:** High-risk exposures are fixed or have documented,
owner-accepted mitigations.

## Phase 7 --- CI/CD, environments and release safety

**Goal:** Make deployments repeatable and reduce the risk of releasing
broken or vulnerable code.

Checklist:

-   [ ] Separate development, staging and production configuration.
-   [ ] Protect production branches and deployment permissions.
-   [ ] Add automated build and type checks.
-   [ ] Add unit and integration tests for critical flows.
-   [ ] Add RLS and tenant-isolation tests.
-   [ ] Add dependency and secret scanning.
-   [ ] Validate database migrations before deployment.
-   [ ] Use backward-compatible migration strategies where possible.
-   [ ] Add deployment health checks and smoke tests.
-   [ ] Document application rollback.
-   [ ] Document database recovery separately; application rollback does
    not reverse every migration safely.
-   [ ] Verify Cloudflare deployment workflows and environment
    separation.
-   [ ] Ensure failed checks prevent release.

**Exit criteria:** A repeatable release pipeline works and
rollback/recovery procedures have been tested.

## Phase 8 --- Performance and growth capacity

**Goal:** Measure current capacity and identify bottlenecks before they
affect customers.

Assess hypothetical growth stages of 10, 100, 1,000, 10,000 and 100,000
businesses. These are planning scenarios, not capacity claims.

Checklist:

-   [ ] Establish current response-time and error-rate baselines.
-   [ ] Identify slow database queries and missing indexes.
-   [ ] Review pagination and large data retrieval.
-   [ ] Identify N+1 requests and unnecessary realtime subscriptions.
-   [ ] Review connection pooling and database connection limits.
-   [ ] Review large tables and retention requirements.
-   [ ] Review frontend bundle size and asset delivery.
-   [ ] Evaluate caching without exposing private data.
-   [ ] Evaluate queues and background workers for slow or retryable
    tasks.
-   [ ] Load-test critical workflows in an isolated environment.
-   [ ] Test concurrent logins, sales, inventory updates and payment
    callbacks.
-   [ ] Measure throughput, latency, error rates and resource
    consumption.
-   [ ] Recommend scaling changes only when measurements justify them.

**Exit criteria:** A performance baseline, repeatable load tests and
evidence-based scaling plan exist.

## Phase 9 --- Multi-tenant and geographic expansion

**Goal:** Support more businesses, branches and markets without
weakening isolation or reliability.

Checklist:

-   [ ] Review tenant and branch data model.
-   [ ] Verify user membership across businesses and branches.
-   [ ] Review tenant-specific configuration and permissions.
-   [ ] Assess per-tenant usage limits and abuse controls.
-   [ ] Review currency precision and multi-currency requirements.
-   [ ] Review time-zone handling and date boundaries.
-   [ ] Assess data retention and deletion requirements.
-   [ ] Review applicable data protection and data residency obligations
    for target markets.
-   [ ] Assess regional hosting and disaster recovery requirements.
-   [ ] Document when separate databases, regions or services become
    justified.

**Exit criteria:** A documented expansion design exists and does not
rely on untested assumptions.

## Phase 10 --- Cost, operations and final readiness

**Goal:** Keep the platform economically sustainable and operationally
accountable.

Checklist:

-   [ ] Record actual costs for Cloudflare, Supabase, storage, email,
    notifications and other providers.
-   [ ] Estimate cost per business and per active user.
-   [ ] Model costs at the agreed growth stages.
-   [ ] Configure budget and usage alerts where available.
-   [ ] Identify wasteful queries, storage and bandwidth.
-   [ ] Document provider ownership, account recovery and billing
    contacts.
-   [ ] Document incident response for account compromise, data breach,
    outage and data loss.
-   [ ] Document operational responsibilities and escalation.
-   [ ] Review all unresolved risks and accepted exceptions.
-   [ ] Produce a final evidence-based readiness assessment.

**Final classification:** Not Ready / Conditionally Ready / Production
Ready / Enterprise Ready.

Do not award a status based only on code completion. Require evidence,
tests and verified provider configuration.

------------------------------------------------------------------------

# 7. Required project checklist and status tracking

Maintain this file as the master checklist. Update it as work
progresses. Use these statuses consistently:

-   `[ ]` Not started
-   `[-]` In progress
-   `[x]` Completed and verified
-   `[!]` Blocked or requires owner action
-   `[?]` Investigated; decision required

A task is **not complete** merely because code was changed. Mark it
`[x]` only after the relevant test or provider-side verification
succeeds.

For every phase, maintain a separate report containing:

-   Findings and severity
-   Evidence and affected components
-   Changes made
-   Tests executed and actual results
-   Regression results
-   Provider-side actions completed or outstanding
-   Remaining risks and limitations
-   Owner decisions required
-   Next recommended task

Never mark a whole phase complete while P0 findings remain unresolved.
Any exception must be explicit and approved by the owner.

## 8. Required final documentation

Create or update a clear, navigable documentation set:

1.  `docs/infrastructure/architecture.md`
2.  `docs/security/security-assessment.md`
3.  `docs/security/threat-register.md`
4.  `docs/operations/backup-and-recovery.md`
5.  `docs/operations/monitoring-and-alerting.md`
6.  `docs/operations/incident-response.md`
7.  `docs/deployment/cloudflare-deployment.md`
8.  `docs/deployment/release-and-rollback.md`
9.  `docs/scalability/capacity-and-performance.md`
10. `docs/infrastructure/cost-management.md`
11. `docs/production-readiness.md`

Adapt paths if the repository already has an established documentation
structure. Avoid duplicate or conflicting documents. Include a table of
contents and links between related sections.

Do not put live credentials, recovery codes, private keys or sensitive
customer data in documentation.

------------------------------------------------------------------------

# 9. First instruction --- Start now

**Begin with Phase 0, then Phase 1.**

For the initial pass:

1.  Inspect the repository and available provider configuration.
2.  Do not change production infrastructure, DNS, credentials or
    production data.
3.  Produce the architecture and dependency inventory.
4.  Produce the severity-ranked findings with evidence.
5.  Identify all P0 and P1 risks.
6.  Present a practical Phase 1 remediation sequence.
7.  Identify which fixes can be safely completed in code and which
    require owner/provider action.

After the initial assessment, begin safe, reversible Phase 1 fixes. Ask
for approval before destructive or externally consequential actions.

Work in small batches. Test each batch. Update this checklist and the
relevant documentation immediately. At the end of each session, report
exactly what was completed, verified, blocked and still outstanding.

**Do not skip phases, silently defer critical findings, or claim
production readiness without evidence.**
