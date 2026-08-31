---
name: Console identity verification
description: Provider-access constraints and the trust model for Xbox and PlayStation identity ownership.
---

Xbox and PlayStation consumer profile pages must not be scraped by the server to verify account ownership. Use short-lived profile codes plus an auditable commissioner attestation unless approved provider partner access is obtained.

**Why:** Xbox profile pages are login-gated for server clients, and neither Xbox nor PlayStation offers this app a generally available ownership API. Generic Microsoft OAuth does not establish an Xbox gamertag, while PSN APIs require Sony partner access.

**How to apply:** Keep provider URLs server-constructed and use them only as review links. A separate commissioner must inspect the official profile in their own authenticated browser; record the reviewer and retain old evidence under its original verification method.