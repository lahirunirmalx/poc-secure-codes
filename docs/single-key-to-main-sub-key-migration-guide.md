# Single-Key to Main/Sub-Key Migration Guide

## Purpose

This document explains how to replace a legacy single-key system with the Main/Sub-Key approach in a controlled way. It is written for decision makers and implementers who need a clear path from concept to proof of concept (POC), then production rollout.

## 1) Abstract migration model

### Legacy model (single key)

- One key represents identity and usage at the same time.
- Validation is usually binary: valid or invalid.
- Replay prevention is weak or inconsistent.
- Tracking and audit quality are limited.

### Target model (main + sub keys)

- Main key represents shared identity/reference.
- Sub keys represent one-time usage rights.
- Validation separates "who this belongs to" from "can this be used now."
- Consumption is explicit, one-time, and auditable.

### Why this abstraction matters

This separation removes the biggest weakness in single-key systems: public sharing and usage control are no longer the same thing. The main key can remain easy to share, while sub keys enforce strict operational control.

## 2) Migration strategy (phased)

### Phase A - Discovery and baseline

- Inventory current single-key generation, storage, and validation flows.
- Identify where replay, fraud, or manual override issues happen today.
- Capture baseline metrics:
  - duplicate use rate
  - invalid key incident rate
  - average validation time
  - support/escalation volume

Deliverable: a baseline report used to compare POC and post-migration results.

### Phase B - Compatibility design

- Define how legacy keys and new keys coexist during transition.
- Add a resolver layer that can detect key type (legacy vs main/sub).
- Keep existing user flow stable while new logic runs behind feature flags.

Deliverable: compatibility plan with fallback behavior.

### Phase C - POC implementation

- Generate one main key with a fixed number of one-time sub keys.
- Enable scan/manual input for both key families.
- Enforce one-time sub key consumption with clear status responses; support **append** and **replace** reissue (transactional replace: bump generation, revoke unconsumed keys in batch, then issue new keys).
- Use **stronger sub-key formats** for new issuance (alphanumeric + signature); keep legacy numeric sub-key validation during transition if old codes remain in the field.
- Record **resolve, consume, issue, and revoke** outcomes in an `audit_events` table (hashed key material, minimal PII).
- Expose **least-privilege API responses** on public paths (do not return full key echoes or unnecessary internal IDs).

Deliverable: working POC in a limited environment (pilot team, test tenant, or staging).

### Phase D - Controlled rollout

- Start with a low-risk segment (for example one location or one campaign).
- Run dual validation paths for a short period (legacy + new).
- Monitor incidents and operational friction daily.
- Expand rollout only after acceptance thresholds are met.

Deliverable: go/no-go decision and rollout expansion plan.

### Phase E - Legacy retirement

- Freeze new issuance of legacy single keys.
- Define sunset date for remaining active legacy keys.
- Remove legacy validation paths after sunset and final audit.

Deliverable: clean cutover to Main/Sub-Key as system of record.

## 3) POC scope and boundaries

### In scope

- Main key generation and sub key issuance (including append/replace flows).
- Key resolution (identify key type from input).
- One-time consume behavior for sub keys and revocation semantics for replace.
- Audit logs (`audit_events`) for resolve, consume, issue, and revoke.
- Mobile-friendly validation flow.

### Out of scope (for initial POC)

- Full enterprise analytics pipelines.
- Advanced anomaly scoring or ML-based fraud detection.
- Large-scale multi-region optimization.
- Deep partner self-service portals.

Keep the POC narrow. Prove reliability first, then add sophistication.

## 4) Data and API transition mapping (high level)

### Data mapping

- Legacy `single_key` -> target `main_key` (identity reference).
- Legacy usage event -> target `sub_key consume` event.
- Legacy status flags -> target explicit `consumed/unconsumed` state.

### API mapping

- Legacy `validate(key)` -> target `resolve(key)` + `consume(sub_key)`; optional `GET .../subkeys` after main resolve; optional `POST .../subkeys/issue` for append/replace.
- Legacy result codes -> target explicit outcomes:
  - invalid / tampered
  - valid_main (response may expose only `mainId` on public endpoints)
  - valid_sub_available / consumed / revoked
  - already_consumed

Public endpoints should return **operationally useful but minimal** payloads (least privilege). Richer detail belongs in authenticated operator tools or log analysis over `audit_events`.

## 5) Operational controls during migration

- Feature flag all new validation paths.
- Add rate limiting on key resolution and consume endpoints.
- Add dashboard metrics for:
  - success rate
  - replay attempts
  - already-consumed responses
  - revoke/replace volume and generation drift
  - audit event rates by `event_type` / `outcome`
  - fallback-to-legacy count (if legacy sub keys supported)
- Define rollback trigger conditions before rollout starts.

## 6) POC success criteria

Use objective criteria, not opinion:

- Replay attempts are blocked at 100% for tested paths.
- No increase in frontline validation time beyond agreed threshold.
- Incident rate is equal to or lower than legacy baseline.
- Support team can explain outcomes from logs without engineering help.
- Pilot stakeholders approve operational usability.

## 7) Common migration risks and mitigations

- **Risk: dual-system confusion**
  - Mitigation: clear operator UI labels for key type and status.
- **Risk: incomplete fallback logic**
  - Mitigation: explicit compatibility tests before pilot start.
- **Risk: noisy rollout**
  - Mitigation: start with small cohort and daily monitoring.
- **Risk: over-engineered first release**
  - Mitigation: keep POC scope strict; defer non-critical features.

## 8) Recommended rollout timeline (example)

- Week 1: discovery + baseline
- Week 2: compatibility design + resolver integration
- Week 3: POC build + test
- Week 4: pilot rollout + monitoring
- Week 5: evaluation + expand or iterate

Adjust based on team size and business criticality.

## 9) Final guidance

Do not treat this as a pure code migration. It is an operational control upgrade.
If the team keeps the abstraction clear (main = identity, sub = one-time usage) and runs a disciplined POC, the transition is usually straightforward and measurable.
