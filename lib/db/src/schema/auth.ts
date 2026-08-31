import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

// (IMPORTANT) This table is mandatory for session storage, don't drop it.
export const sessionsTable = pgTable(
  'sessions',
  {
    sid: varchar('sid').primaryKey(),
    sess: jsonb('sess').notNull(),
    expire: timestamp('expire').notNull(),
  },
  (table) => [index('IDX_session_expire').on(table.expire)],
);

// (IMPORTANT) Core user identity table. One row per person.
export const usersTable = pgTable('users', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  email: varchar('email').unique(),
  firstName: varchar('first_name'),
  lastName: varchar('last_name'),
  profileImageUrl: varchar('profile_image_url'),
  // PSN gamertag — display only, not an auth mechanism (Sony has no public OAuth)
  psnGamertag: varchar('psn_gamertag'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/**
 * Links an external provider identity (or a local password) to an internal user.
 * provider values: 'google' | 'microsoft' | 'discord' | 'local'
 *
 * For OAuth providers: providerAccountId = the opaque user-id from that provider.
 * For local:          providerAccountId = null; passwordHash = bcrypt hash.
 *
 * Constraints:
 *  - (userId, provider) unique → one account per provider per user
 *  - (provider, providerAccountId) unique (NULLs are distinct in Postgres,
 *    so multiple local rows don't conflict; local uniqueness is enforced above)
 */
export const authAccountsTable = pgTable(
  'auth_accounts',
  {
    id: varchar('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar('user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    // 'google' | 'microsoft' | 'discord' | 'local'
    provider: varchar('provider', { length: 20 }).notNull(),
    // External user-id from the provider; null for local accounts
    providerAccountId: varchar('provider_account_id'),
    // bcrypt hash; only populated for provider = 'local'
    passwordHash: varchar('password_hash'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // One account per provider per user (e.g. one local, one google, …)
    uniqueIndex('auth_accounts_userid_provider_uq').on(
      table.userId,
      table.provider,
    ),
    // Exactly one row per external identity: prevents duplicate OAuth linkage
    // under concurrent first-login races.  NULLs are distinct in Postgres so
    // local accounts (providerAccountId = NULL) don't conflict here; their
    // uniqueness is enforced above by (userId, provider).
    uniqueIndex('auth_accounts_provider_pid_uq').on(
      table.provider,
      table.providerAccountId,
    ),
  ],
);

/**
 * Time-limited tokens for local-account password resets.
 * One active token per user at a time; old tokens are invalidated on first use
 * or when a new one is generated. Tokens expire after 1 hour.
 */
export const passwordResetTokensTable = pgTable(
  'password_reset_tokens',
  {
    id: varchar('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar('user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    // 64-char hex token sent in the reset URL. Stored as-is — short-lived and
    // single-use, so hashing adds no meaningful security benefit here.
    token: varchar('token', { length: 128 }).notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('password_reset_tokens_user_idx').on(table.userId)],
);

export type UpsertUser = typeof usersTable.$inferInsert;
export type User = typeof usersTable.$inferSelect;
export type AuthAccount = typeof authAccountsTable.$inferSelect;
export type InsertAuthAccount = typeof authAccountsTable.$inferInsert;
export type PasswordResetToken = typeof passwordResetTokensTable.$inferSelect;
