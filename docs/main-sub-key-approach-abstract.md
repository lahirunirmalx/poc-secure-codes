# Abstract: Main/Sub Key Security Approach

## Overview

This solution introduces a two-level key model for secure and practical validation workflows. A single main key acts as the public reference, while multiple one-time sub keys handle actual usage events. The model is designed to keep day-to-day operations simple while enforcing strict one-time consumption, optional batch revocation when reissuing sub keys, and clear traceability through server-side audit events.

## Core problem addressed

Many real-world systems must share an identifier broadly but still prevent repeated or fraudulent use at the point of action. Traditional single-code designs often fail under replay, manual mistakes, or weak verification. This approach separates identity from usage so that public sharing does not automatically weaken control.

## Proposed approach

The system generates one main key and one-time sub keys linked to that main key. New sub keys can be appended or issued in a replace batch (revoking prior unconsumed keys) without rotating the main key. During validation, the platform resolves the input key type, verifies authenticity, and applies database-backed rules so sub keys are consumed at most once and not accepted after revocation. **Public API responses are intentionally minimal** (least privilege): they avoid echoing secrets or unnecessary internal identifiers. **Audit events** record resolve, consume, issue, and revoke outcomes using hashed key material and hashed actor hints for investigation without storing raw keys in the log row.

## Expected outcomes

- Reduce replay and duplicate-use incidents.
- Improve operational clarity for frontline teams.
- Provide auditable key lifecycle tracking via `audit_events`.
- Support stronger sub-key formats suitable for public-facing endpoints when combined with edge controls.
- Keep implementation maintainable and deployment-friendly.

## Scope

This abstract covers the solution concept and operational intent. Technical implementation details, threat handling, key formats, transactional reissue behavior, API response shapes, and audit schema are documented in the main technical design document (`main-sub-key-approach.md`).
