/**
 * Migrates users from Clerk dev instance → prod instance.
 * Outputs a mapping of old dev user IDs → new prod user IDs.
 * Run: node scripts/migrate-clerk-users.mjs
 */

import { readFileSync, writeFileSync } from "fs";

const PROD_SECRET_KEY = process.env.CLERK_PROD_KEY;
if (!PROD_SECRET_KEY) {
  console.error("Missing CLERK_PROD_KEY env var");
  process.exit(1);
}

const users = JSON.parse(readFileSync("users_export.json", "utf8"));
console.log(`Migrating ${users.length} users to production...`);

const idMapping = []; // [{ devId, prodId, email }]

for (const user of users) {
  try {
    // Check if user already exists in prod (by email)
    const checkRes = await fetch(
      `https://api.clerk.com/v1/users?email_address=${encodeURIComponent(user.email)}&limit=1`,
      { headers: { Authorization: `Bearer ${PROD_SECRET_KEY}` } }
    );
    const existing = await checkRes.json();

    if (existing.length > 0) {
      console.log(`✓ Already exists: ${user.email} → ${existing[0].id}`);
      idMapping.push({ devId: user.id, prodId: existing[0].id, email: user.email });
      continue;
    }

    // Create user in prod
    const body = {
      email_address: [user.email],
      first_name: user.first_name || "",
      last_name: user.last_name || "",
      // Preserve metadata
      ...(user.public_metadata && Object.keys(user.public_metadata).length > 0
        ? { public_metadata: user.public_metadata }
        : {}),
      ...(user.private_metadata && Object.keys(user.private_metadata).length > 0
        ? { private_metadata: user.private_metadata }
        : {}),
      // Store dev ID in external_id so we can track the mapping
      external_id: user.id,
      // Skip password — users will use "Forgot password" or OAuth on first login
      skip_password_requirement: true,
      skip_password_checks: true,
    };

    const createRes = await fetch("https://api.clerk.com/v1/users", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PROD_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const created = await createRes.json();

    if (created.id) {
      console.log(`✓ Created: ${user.email} → ${created.id}`);
      idMapping.push({ devId: user.id, prodId: created.id, email: user.email });
    } else {
      console.error(`✗ Failed: ${user.email}`, JSON.stringify(created));
      idMapping.push({ devId: user.id, prodId: null, email: user.email, error: created });
    }

    // Small delay to avoid rate limiting
    await new Promise((r) => setTimeout(r, 300));
  } catch (err) {
    console.error(`✗ Error for ${user.email}:`, err.message);
  }
}

writeFileSync("id-mapping.json", JSON.stringify(idMapping, null, 2));
console.log("\nDone! ID mapping saved to id-mapping.json");
console.log("\nMapping:");
idMapping.forEach(({ devId, prodId, email }) => {
  console.log(`  ${email}: ${devId} → ${prodId ?? "FAILED"}`);
});
