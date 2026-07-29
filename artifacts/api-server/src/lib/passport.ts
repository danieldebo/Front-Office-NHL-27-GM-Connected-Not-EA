/**
 * Passport configuration — four strategies:
 *   local       email + bcrypt password
 *   google      Google OAuth 2.0
 *   microsoft   Microsoft OAuth 2.0 (Xbox / MS account)
 *   discord     Discord OAuth 2.0
 *
 * Serialize/deserialize stores only the internal user UUID in the session.
 *
 * upsertOAuthUser runs inside a DB transaction.  Concurrent first-login
 * callbacks for the same (provider, providerAccountId) are resolved
 * deterministically through two atomic upserts:
 *
 *   User row   — INSERT … ON CONFLICT (email) DO NOTHING RETURNING id
 *                If RETURNING is empty the row pre-existed; a follow-up
 *                SELECT retrieves it.  RETURNING row count tells us whether
 *                *this* transaction created the row (safe proxy for "is new").
 *
 *   Account link — INSERT … ON CONFLICT (provider, pid) DO UPDATE (no-op)
 *                  RETURNING user_id
 *                  The no-op UPDATE forces RETURNING to work on conflict,
 *                  yielding the winning user_id regardless of which request
 *                  wins the insert race.
 *
 * No user rows are ever deleted.  If a request loses the account-link race
 * after creating a fresh user row, that row stays in the DB with its email
 * present.  It can be claimed later via a different provider using the same
 * email address.  It cannot be logged into (no auth_accounts row points to
 * it), so it is harmless.
 *
 * provisionAppUser is called AFTER the transaction commits so that a
 * rollback cannot leave a dangling app_user referencing a non-existent user.
 */
import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as MicrosoftStrategy } from 'passport-microsoft';
import { Strategy as DiscordStrategy } from 'passport-discord';
import bcrypt from 'bcryptjs';
import { and, eq, sql } from 'drizzle-orm';
import { db, pool, usersTable, authAccountsTable } from '@workspace/db';
import type { User } from '@workspace/db';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_URL =
  process.env.CALLBACK_BASE_URL ??
  (process.env.REPLIT_DOMAINS
    ? `https://${process.env.REPLIT_DOMAINS}`
    : 'http://localhost:8080');

/**
 * Provisions (or refreshes) the legacy app_user row that domain-layer queries
 * rely on.  Must be called AFTER the transaction commits.
 */
export async function provisionAppUser(user: User): Promise<void> {
  const displayName =
    [user.firstName, user.lastName].filter(Boolean).join(' ') ||
    user.email?.split('@')[0] ||
    'GM';
  const email = user.email ?? `${user.id}@noreply.frontoffice`;
  await pool.query(
    `INSERT INTO app_user (replit_id, display_name, email, external_ids)
     VALUES ($1, $2, $3, '{}'::jsonb)
     ON CONFLICT (replit_id) DO UPDATE
       SET display_name = EXCLUDED.display_name`,
    [user.id, displayName, email],
  );
}

type OAuthProvider = 'google' | 'microsoft' | 'discord';

/**
 * Race-safe OAuth upsert — see module-level docblock for the full algorithm.
 *
 * Key invariant: the returned User always matches the user_id stored in
 * auth_accounts for (provider, providerAccountId), regardless of concurrent
 * first-login races.
 */
async function upsertOAuthUser(opts: {
  provider: OAuthProvider;
  providerAccountId: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  profileImageUrl?: string | null;
}): Promise<User> {
  const { provider, providerAccountId, email, firstName, lastName, profileImageUrl } = opts;

  let needsProvision = false;

  const user = await db.transaction(async (tx) => {
    // ── Step 1: fast path ─────────────────────────────────────────────────
    // After the very first successful login the auth_accounts row exists and
    // we can resolve in two SELECT queries without any writes.
    const [existingAccount] = await tx
      .select({ userId: authAccountsTable.userId })
      .from(authAccountsTable)
      .where(
        and(
          eq(authAccountsTable.provider, provider),
          eq(authAccountsTable.providerAccountId, providerAccountId),
        ),
      );

    if (existingAccount) {
      const [u] = await tx
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, existingAccount.userId));
      if (u) return u;
    }

    // ── Step 2: get-or-create user row ────────────────────────────────────
    //
    // With email:
    //   INSERT … ON CONFLICT (email) DO NOTHING RETURNING id
    //   • Conflict → RETURNING is empty → row pre-existed → separate SELECT
    //   • No conflict → RETURNING has 1 row → we just created it
    //   Row count (not system columns) is the reliable "is new" signal.
    //
    // Without email:
    //   Plain INSERT (no merge target); always creates a new row.
    //
    // In either branch `createdByUs` tracks whether THIS transaction made
    // the row.  It is used later to decide whether to call provisionAppUser.
    let userId: string;
    let createdByUs: boolean;

    if (email) {
      const insertResult = await tx.execute(
        sql`INSERT INTO users (email, first_name, last_name, profile_image_url)
            VALUES (
              ${email},
              ${firstName ?? null},
              ${lastName ?? null},
              ${profileImageUrl ?? null}
            )
            ON CONFLICT (email) DO NOTHING
            RETURNING id`,
      );

      if (insertResult.rows.length > 0) {
        // We inserted the row in this transaction.
        userId = (insertResult.rows[0] as { id: string }).id;
        createdByUs = true;
      } else {
        // Row already existed before this transaction — safe to read it.
        const [existing] = await tx
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(eq(usersTable.email, email));
        userId = existing.id;
        createdByUs = false; // pre-existing; already has app_user
      }
    } else {
      const [created] = await tx
        .insert(usersTable)
        .values({
          firstName: firstName ?? null,
          lastName: lastName ?? null,
          profileImageUrl: profileImageUrl ?? null,
        })
        .returning({ id: usersTable.id });
      userId = created.id;
      createdByUs = true;
    }

    // ── Step 3: atomically claim the OAuth account slot ───────────────────
    //
    // ON CONFLICT (provider, provider_account_id) DO UPDATE (no-op) forces
    // PostgreSQL to treat it as a row-level "update" so RETURNING always
    // yields exactly one row — the winner's user_id.
    //
    // Race outcomes:
    //   We win  → linkedUserId === userId  (our insert succeeded)
    //   We lose → linkedUserId !== userId  (concurrent winner's userId returned)
    const { rows: linkRows } = await tx.execute(
      sql`INSERT INTO auth_accounts (user_id, provider, provider_account_id)
          VALUES (${userId}, ${provider}, ${providerAccountId})
          ON CONFLICT (provider, provider_account_id) DO UPDATE
            SET provider = EXCLUDED.provider
          RETURNING user_id`,
    );
    const linkedUserId = (linkRows[0] as { user_id: string }).user_id;

    // ── Step 4: decide provisioning ───────────────────────────────────────
    //
    // Provision app_user only when:
    //   • We created the user row (createdByUs = true), AND
    //   • We also won the auth_accounts race (linkedUserId === userId).
    //
    // If we lost the race: the winning request will call provisionAppUser
    // for its own user (which may or may not be the same as ours).  Our
    // candidate row (if we created it) has no auth link and no app_user.
    // It stays in the DB with its email intact; the same address can be
    // claimed through any other provider using the merge-by-email path.
    needsProvision = createdByUs && linkedUserId === userId;

    // ── Step 5: load and return the authoritative user ────────────────────
    const [finalUser] = await tx
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, linkedUserId));

    return finalUser;
  });

  // provisionAppUser uses pool.query (outside the transaction connection).
  // Calling it here guarantees we only write app_user if the txn committed.
  if (needsProvision) {
    await provisionAppUser(user);
  }

  return user;
}

// ---------------------------------------------------------------------------
// Serialize / Deserialize
// ---------------------------------------------------------------------------

passport.serializeUser((user: Express.User, done) => {
  done(null, (user as User).id);
});

passport.deserializeUser(async (id: string, done) => {
  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, id));
    done(null, user ?? false);
  } catch (err) {
    done(err);
  }
});

// ---------------------------------------------------------------------------
// Local strategy
// ---------------------------------------------------------------------------

passport.use(
  new LocalStrategy(
    { usernameField: 'email', passwordField: 'password' },
    async (email, password, done) => {
      try {
        const [user] = await db
          .select()
          .from(usersTable)
          .where(eq(usersTable.email, email));

        if (!user) {
          return done(null, false, { message: 'Invalid email or password' });
        }

        const [account] = await db
          .select()
          .from(authAccountsTable)
          .where(
            and(
              eq(authAccountsTable.userId, user.id),
              eq(authAccountsTable.provider, 'local'),
            ),
          );

        if (!account?.passwordHash) {
          return done(null, false, { message: 'Invalid email or password' });
        }

        const ok = await bcrypt.compare(password, account.passwordHash);
        if (!ok) {
          return done(null, false, { message: 'Invalid email or password' });
        }

        return done(null, user);
      } catch (err) {
        return done(err);
      }
    },
  ),
);

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: `${BASE_URL}/api/auth/google/callback`,
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const user = await upsertOAuthUser({
            provider: 'google',
            providerAccountId: profile.id,
            email: profile.emails?.[0]?.value ?? null,
            firstName:
              profile.name?.givenName ??
              profile.displayName?.split(' ')[0] ??
              null,
            lastName: profile.name?.familyName ?? null,
            profileImageUrl: profile.photos?.[0]?.value ?? null,
          });
          done(null, user);
        } catch (err) {
          done(err as Error);
        }
      },
    ),
  );
}

// ---------------------------------------------------------------------------
// Microsoft
// ---------------------------------------------------------------------------

if (process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET) {
  passport.use(
    new MicrosoftStrategy(
      {
        clientID: process.env.MICROSOFT_CLIENT_ID,
        clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
        callbackURL: `${BASE_URL}/api/auth/microsoft/callback`,
        scope: ['user.read'],
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email =
            profile.emails?.[0]?.value ??
            profile._json?.mail ??
            profile._json?.userPrincipalName ??
            null;
          const user = await upsertOAuthUser({
            provider: 'microsoft',
            providerAccountId: profile.id,
            email,
            firstName:
              profile.name?.givenName ?? profile._json?.givenName ?? null,
            lastName:
              profile.name?.familyName ?? profile._json?.surname ?? null,
            profileImageUrl: profile.photos?.[0]?.value ?? null,
          });
          done(null, user);
        } catch (err) {
          done(err as Error);
        }
      },
    ),
  );
}

// ---------------------------------------------------------------------------
// Discord
// ---------------------------------------------------------------------------

if (process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET) {
  passport.use(
    new DiscordStrategy(
      {
        clientID: process.env.DISCORD_CLIENT_ID,
        clientSecret: process.env.DISCORD_CLIENT_SECRET,
        callbackURL: `${BASE_URL}/api/auth/discord/callback`,
        scope: ['identify', 'email'],
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const avatarUrl = profile.avatar
            ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png`
            : null;
          const user = await upsertOAuthUser({
            provider: 'discord',
            providerAccountId: profile.id,
            email: profile.email ?? null,
            firstName: profile.global_name ?? profile.username ?? null,
            lastName: null,
            profileImageUrl: avatarUrl,
          });
          done(null, user);
        } catch (err) {
          done(err as Error);
        }
      },
    ),
  );
}

export { passport };
