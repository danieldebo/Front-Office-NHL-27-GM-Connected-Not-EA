---
name: Notification delivery invariants
description: Reliability rules for extending the shared notification dispatcher with new events or channels.
---

Publish notification domain events in the same database transaction as the business state change. Delivery workers must claim outbound work durably with expiring leases, perform network calls after releasing database transactions, and finalize only if they still own the claim. Poison fan-out events need bounded retries and an observable dead-letter state.

**Why:** Concurrent result updates must not emit false notifications, slow providers must not consume database connections or locks, expired workers must be recoverable, and one malformed event must not block every later event.

**How to apply:** Any new result, scheduling, announcement, or delivery-channel work should publish through the shared outbox and preserve claim ownership, timeout, retry, and dead-letter behavior rather than adding route-specific sends.