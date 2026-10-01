# Launch checklist

## Must do (blocking)
- [ ] Apply migrations + seeds to a real Supabase project; run the DB suite's invariant queries against it; fix any default-grant differences.
- [ ] Smoke-test sign-up/login/email confirmation, onboarding, logging, deletion on the real project.
- [ ] Bootstrap the first super admin; enable MFA for all admin accounts.
- [ ] Nutritionist review of the 62 seed foods (currently `ai_estimated`, approximate); trainer review of exercise cues.
- [ ] Legal: Privacy Policy, Terms, consent wording (health data, AI processing, analytics), DPDP Act review, retention of billing records, age gate (18+).
- [ ] Choose the AI provider/model, set key + budget alerts; read real outputs for accuracy/safety; expand safety coverage (paraphrases, Hindi/regional languages).
- [ ] Payments: implement and sandbox-test a real provider (or launch free-only and keep Pro gated off); GST/invoicing; refunds policy.
- [ ] Adapt CSP/headers to your origins; deploy API behind TLS with `CORS_ORIGINS` set.
- [ ] Backups/PITR enabled; restore drill performed.
- [ ] Error tracking + uptime + alerting configured.

## Should do
- [ ] Rate limits for analytics events and feedback; shared rate limiter if >1 API instance.
- [ ] Server-side computation (or signed results) for the score/reports if gating must be tamper-proof.
- [ ] Analytics consent toggle; data-export job for large accounts; confirm-before-delete for log items.
- [ ] Load test (dashboard + coach), DB index review with real data volume.
- [ ] Manual screen-reader and real-device passes.
- [ ] Independent security review / penetration test.
- [ ] Brand/name clearance (domains, app stores, trademarks) — see PRD §50.

## Product backlog (PRD "should have")
Voice logging, photo food recognition (must stay user-confirmed + labelled), health integrations (need native wrapper/partner approvals), running analysis, advanced charts, notifications (email/push), landing page.
