import sql from '../db/client.js';

type NotificationType =
  | 'stock_request_pending' | 'stock_request_approved' | 'stock_request_rejected'
  | 'daily_report_pending'  | 'daily_report_approved'  | 'daily_report_rejected';

interface NotifyOptions {
  type: NotificationType;
  title: string;
  message?: string | null;
  link?: string | null;
}

// Fire-and-forget helpers — a notification failure should never break the
// primary action (stock request, report submission, etc.), so callers should
// await these but the functions themselves swallow their own errors.

export async function notifyAdmins({ type, title, message, link }: NotifyOptions): Promise<void> {
  try {
    await sql`
      INSERT INTO notifications (user_id, type, title, message, link)
      SELECT id, ${type}::notification_type, ${title}, ${message ?? null}, ${link ?? null}
      FROM users WHERE role = 'admin' AND is_active = true
    `;
  } catch (err) {
    console.error('[notifyAdmins]', err);
  }
}

export async function notifyUser(userId: string, { type, title, message, link }: NotifyOptions): Promise<void> {
  try {
    await sql`
      INSERT INTO notifications (user_id, type, title, message, link)
      VALUES (${userId}, ${type}::notification_type, ${title}, ${message ?? null}, ${link ?? null})
    `;
  } catch (err) {
    console.error('[notifyUser]', err);
  }
}
