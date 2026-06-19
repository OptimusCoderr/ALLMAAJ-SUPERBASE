import bcrypt from 'bcryptjs';
import sql from '../db/client.js';

export async function seedAdmin() {
  try {
    const email    = process.env.ADMIN_EMAIL    || 'admin@allmaaj.com';
    const password = process.env.ADMIN_PASSWORD || 'Admin1234';
    const fullName = process.env.ADMIN_NAME     || 'System Admin';

    const [existing] = await sql`
      SELECT id FROM users WHERE email = ${email.toLowerCase()} LIMIT 1
    `;

    if (existing) {
      console.log(`[SEED] Admin already exists: ${email}`);
      return;
    }

    const rounds = parseInt(process.env.BCRYPT_ROUNDS || '12');
    const hash   = await bcrypt.hash(password, rounds);

    await sql`
      INSERT INTO users (email, password, full_name, role, is_verified, is_active)
      VALUES (
        ${email.toLowerCase()},
        ${hash},
        ${fullName},
        'admin',
        true,
        true
      )
    `;

    console.log(`[SEED] ✅ Admin created: ${email}`);
  } catch (err: any) {
    console.error('[SEED] ❌ Failed to seed admin:', err.message);
  }
}

// Allow running directly: npm run create-admin
if (process.argv[1]?.includes('seed')) {
  const email    = process.argv[2];
  const password = process.argv[3];
  const fullName = process.argv[4];

  if (email)    process.env.ADMIN_EMAIL    = email;
  if (password) process.env.ADMIN_PASSWORD = password;
  if (fullName) process.env.ADMIN_NAME     = fullName;

  seedAdmin().finally(() => sql.end());
}