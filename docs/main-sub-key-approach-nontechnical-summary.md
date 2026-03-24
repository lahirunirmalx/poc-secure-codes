# Main/Sub Key Approach - Non-Technical Summary

## What this is trying to solve

This approach solves a simple business problem:

- You need one master access reference that can be shared widely.
- You also need smaller one-time access codes for actual use.
- You must prevent reuse, misuse, and confusion during verification.

In short, it lets teams share one "main identity" while controlling real usage through limited, trackable one-time keys.

## Why someone needs this kind of system

Teams usually need this when they have to balance **easy sharing** and **strong control** at the same time.

Without a system like this, common problems appear:

- People reuse the same code many times.
- Staff cannot quickly tell if a code is valid or already used.
- Fake or edited codes are hard to detect consistently.
- Records do not clearly show who used what and when.
- Operations become manual, slow, and error-prone.

This approach reduces those real-world risks by separating identity and usage:

- Main key = the public reference.
- Sub key = the one-time action token.

If sub keys are leaked or misused, operators can **issue a fresh batch** and (when needed) **invalidate unused sub keys** from an older batch **without changing the main key**. The system also keeps an **audit trail** of validation and usage events to support support and investigations.

## Practical value for business and operations

This design gives clear operational benefits:

- **Better control:** one-time sub keys stop repeated unauthorized reuse.
- **Better traceability:** each action can be tied to a specific key event.
- **Faster frontline workflows:** staff can scan or type and get a clear result.
- **Lower fraud and mistakes:** invalid or replayed keys are blocked reliably.
- **Cleaner support process:** easier to explain what happened when incidents occur.

## Typical scenarios where this helps

- Event entry or pass validation with one-time redemption.
- Voucher or coupon redemption where replay must be blocked.
- Controlled handout systems (tickets, claims, approvals).
- Partner programs where one public reference maps to many one-time uses.
- Any workflow that needs quick validation on mobile devices.

## Why this approach is practical

The key idea is not complexity. It is operational clarity.

- A single main reference keeps communication simple.
- One-time sub keys enforce strict usage rules.
- The system gives clear yes/no answers at the point of use.

That combination is what makes it useful in real organizations: simple to operate, harder to abuse.
