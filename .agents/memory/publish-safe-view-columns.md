---
name: Publish-safe view columns
description: How to model columns referenced by views so Replit Publish can migrate production safely.
---

Keep platform vocabulary columns referenced by public or DQ views as normalized text rather than PostgreSQL enums.

**Why:** Replit Publish computes a development-to-production schema diff but does not automatically drop existing production views before altering the type of a column they reference. PostgreSQL rejects that type change during disposable-fork validation.

**How to apply:** Prefer stable text columns with application validation for view-backed vocabularies. If development already uses enums, use a normal development migration that backs up and recreates dependent views while converting the columns to text, then verify the Publish diff contains no blocked type alterations.