import { Router, Request, Response } from 'express';
import sql from '../db/client.js';
import { authMiddleware } from '../middleware/auth.js';
import { sendResponse, sendError } from '../utils/apiResponse.js';

const router = Router();
router.use(authMiddleware);

const toNotification = (n: any) => ({
  id: n.id, type: n.type, title: n.title, message: n.message,
  link: n.link, isRead: n.is_read, createdAt: n.created_at,
});

// GET /api/notifications — most recent 50 for the current user
router.get('/', async (req: Request, res: Response) => {
  try {
    const rows = await sql`
      SELECT * FROM notifications
      WHERE user_id = ${req.user!.id}
      ORDER BY created_at DESC
      LIMIT 50
    `;
    return sendResponse(res, 200, 'Notifications fetched', rows.map(toNotification));
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

router.patch('/:id/read', async (req: Request, res: Response) => {
  try {
    const [updated] = await sql`
      UPDATE notifications SET is_read = true
      WHERE id = ${req.params.id} AND user_id = ${req.user!.id}
      RETURNING *
    `;
    if (!updated) return sendError(res, 404, 'Notification not found');
    return sendResponse(res, 200, 'Marked as read', toNotification(updated));
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

router.patch('/read-all', async (req: Request, res: Response) => {
  try {
    await sql`UPDATE notifications SET is_read = true WHERE user_id = ${req.user!.id} AND is_read = false`;
    return sendResponse(res, 200, 'All notifications marked as read');
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

// DELETE /api/notifications — clears every notification for the current user
router.delete('/', async (req: Request, res: Response) => {
  try {
    await sql`DELETE FROM notifications WHERE user_id = ${req.user!.id}`;
    return sendResponse(res, 200, 'Notifications cleared');
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

export default router;
