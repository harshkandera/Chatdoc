/**
 * After all users have signed in to production with Google:
 *
 * 1. Fetch prod users from Clerk (new prod IDs)
 * 2. Match them to dev users by email
 * 3. Update DB: User.id, Workspace.userId, Chat.userId
 *
 * Run:
 *   export CLERK_DEV_KEY="sk_test_..."
 *   export CLERK_PROD_KEY="sk_live_..."
 *   export DATABASE_URL="postgresql://..."
 *   node scripts/migrate-db-user-ids.mjs
 */

import { readFileSync } from "fs";

const DEV_KEY = process.env.CLERK_DEV_KEY;
const PROD_KEY = process.env.CLERK_PROD_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

if (!DEV_KEY || !PROD_KEY || !DATABASE_URL) {
  console.error("Missing env vars: CLERK_DEV_KEY, CLERK_PROD_KEY, DATABASE_URL");
  process.exit(1);
}

// Fetch users from Clerk instance
async function fetchClerkUsers(secretKey) {
  const res = await fetch("https://api.clerk.com/v1/users?limit=100&offset=0", {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  return await res.json();
}

// Run raw SQL via postgres (using pg)
const { default: pg } = await import("pg");
const pool = new pg.Pool({ connectionString: DATABASE_URL });

async function query(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows;
}

console.log("Fetching dev users from Clerk...");
const devUsers = await fetchClerkUsers(DEV_KEY);

console.log("Fetching prod users from Clerk...");
const prodUsers = await fetchClerkUsers(PROD_KEY);

// Build email → prod user ID map
const prodByEmail = new Map();
for (const u of prodUsers) {
  const email = u.email_addresses?.[0]?.email_address;
  if (email) prodByEmail.set(email.toLowerCase(), u.id);
}

// Build migration plan: devId → prodId matched by email
const migrations = [];
for (const u of devUsers) {
  const email = u.email_addresses?.[0]?.email_address?.toLowerCase();
  const prodId = prodByEmail.get(email);
  if (prodId && prodId !== u.id) {
    migrations.push({ devId: u.id, prodId, email });
  } else if (!prodId) {
    console.warn(`⚠ No prod user found for ${email} — they haven't signed in to prod yet`);
  }
}

console.log(`\nFound ${migrations.length} users to migrate:\n`);
migrations.forEach(({ email, devId, prodId }) => {
  console.log(`  ${email}`);
  console.log(`    dev:  ${devId}`);
  console.log(`    prod: ${prodId}`);
});

if (migrations.length === 0) {
  console.log("Nothing to migrate.");
  await pool.end();
  process.exit(0);
}

console.log("\nStarting DB migration...\n");

for (const { devId, prodId, email } of migrations) {
  try {
    // Check if dev user exists in DB
    const existing = await query(`SELECT id FROM "User" WHERE id = $1`, [devId]);
    if (existing.length === 0) {
      console.log(`⚠ Skipping ${email} — dev user not in DB`);
      continue;
    }

    // Check if prod user already exists in DB (signed in to prod already)
    const prodExists = await query(`SELECT id FROM "User" WHERE id = $1`, [prodId]);

    if (prodExists.length > 0) {
      // Prod user already in DB — reassign workspaces/chats from dev to prod, then delete dev
      console.log(`↔ Reassigning data from ${devId} → ${prodId} (${email})`);

      await query(`UPDATE "Workspace" SET "userId" = $1 WHERE "userId" = $2`, [prodId, devId]);
      await query(`UPDATE "Chat" SET "userId" = $1 WHERE "userId" = $2`, [prodId, devId]);
      await query(`DELETE FROM "User" WHERE id = $1`, [devId]);
    } else {
      // Prod user not in DB yet — update User.id first (FK source), then child tables
      console.log(`✎ Updating user ID ${devId} → ${prodId} (${email})`);

      await query(`UPDATE "User" SET id = $1 WHERE id = $2`, [prodId, devId]);
      await query(`UPDATE "Workspace" SET "userId" = $1 WHERE "userId" = $2`, [prodId, devId]);
      await query(`UPDATE "Chat" SET "userId" = $1 WHERE "userId" = $2`, [prodId, devId]);
    }

    console.log(`✓ Done: ${email}`);
  } catch (err) {
    console.error(`✗ Error for ${email}:`, err.message);
  }
}

await pool.end();
console.log("\nMigration complete!");
