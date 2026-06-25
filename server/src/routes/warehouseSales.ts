import { Router, Request, Response } from 'express';
import sql from '../db/client.js';
import type { WarehouseSaleRow, WarehouseSaleItemRow } from '../db/types.js';
import { num } from '../db/types.js';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import { sendResponse, sendError } from '../utils/apiResponse.js';

const router = Router();
router.use(authMiddleware);
router.use(adminOnly);

// ── Mapper ────────────────────────────────────────────────────────────────────

const toSale = (
  r: WarehouseSaleRow & {
    warehouse_name?: string | null;
    created_by_name?: string | null;
    items?: WarehouseSaleItemRow[];
  }
) => ({
  id:              r.id,
  _id:             r.id,
  invoiceNumber:   r.invoice_number,
  warehouseId:     r.warehouse_id,
  warehouseName:   r.warehouse_name ?? null,
  createdBy:       r.created_by,
  createdByName:   r.created_by_name ?? null,
  customerName:    r.customer_name,
  customerPhone:   r.customer_phone,
  customerAddress: r.customer_address,
  paymentMethod:   r.payment_method,
  totalAmount:     num(r.total_amount),
  amountPaid:      num(r.amount_paid),
  balanceDue:      num(r.balance_due),
  docType:         r.doc_type,
  notes:           r.notes,
  saleDate:        r.sale_date,
  createdAt:       r.created_at,
  updatedAt:       r.updated_at,
  items: (r.items ?? []).map(i => ({
    id:          i.id,
    saleId:      i.sale_id,
    productId:   i.product_id,
    productName: i.product_name,
    quantity:    num(i.quantity),
    unitPrice:   num(i.unit_price),
    subtotal:    num(i.subtotal),
    unit:        i.unit,
  })),
});

// ── GET /api/warehouse-sales ──────────────────────────────────────────────────

router.get('/', async (req: Request, res: Response) => {
  try {
    const { warehouseId, startDate, endDate, limit = '100' } = req.query as Record<string, string>;

    const sales = await sql<(WarehouseSaleRow & { warehouse_name: string; created_by_name: string })[]>`
      SELECT ws.*, w.name AS warehouse_name, u.full_name AS created_by_name
      FROM   warehouse_sales ws
      JOIN   warehouses w ON w.id = ws.warehouse_id
      JOIN   users u       ON u.id = ws.created_by
      WHERE
        (${warehouseId ?? null}::uuid IS NULL OR ws.warehouse_id = ${warehouseId ?? null}::uuid)
        AND (${startDate ?? null}::text IS NULL OR ws.sale_date >= ${startDate ?? null}::date)
        AND (${endDate   ?? null}::text IS NULL OR ws.sale_date <= ${endDate   ?? null}::date)
      ORDER BY ws.created_at DESC
      LIMIT ${parseInt(limit)}
    `;
    return sendResponse(res, 200, 'Sales fetched', sales.map(s => toSale(s)));
  } catch (err) {
    console.error('[GET /warehouse-sales]', err);
    return sendError(res, 500, 'Server error', err);
  }
});

// ── GET /api/warehouse-sales/:id ─────────────────────────────────────────────

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const [sale] = await sql<(WarehouseSaleRow & { warehouse_name: string; created_by_name: string })[]>`
      SELECT ws.*, w.name AS warehouse_name, u.full_name AS created_by_name
      FROM   warehouse_sales ws
      JOIN   warehouses w ON w.id = ws.warehouse_id
      JOIN   users u       ON u.id = ws.created_by
      WHERE  ws.id = ${req.params.id}
    `;
    if (!sale) return sendError(res, 404, 'Sale not found');

    const items = await sql<WarehouseSaleItemRow[]>`
      SELECT * FROM warehouse_sale_items WHERE sale_id = ${req.params.id} ORDER BY id
    `;
    return sendResponse(res, 200, 'Sale fetched', toSale({ ...sale, items }));
  } catch (err) {
    return sendError(res, 500, 'Server error', err);
  }
});

// ── POST /api/warehouse-sales ─────────────────────────────────────────────────

router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      warehouseId, customerName, customerPhone, customerAddress,
      paymentMethod = 'cash', amountPaid = 0, docType = 'invoice', notes,
      saleDate, items,
    } = req.body;

    if (!warehouseId)              return sendError(res, 400, 'warehouseId is required');
    if (!customerName?.trim())     return sendError(res, 400, 'customerName is required');
    if (!Array.isArray(items) || items.length === 0) return sendError(res, 400, 'At least one item is required');
    if (!['cash','pos','transfer','credit'].includes(paymentMethod))
      return sendError(res, 400, 'Invalid payment method');
    if (!['invoice','waybill'].includes(docType))
      return sendError(res, 400, 'Invalid doc type');

    const total = items.reduce((s: number, i: any) => s + Number(i.subtotal ?? 0), 0);
    if (total <= 0) return sendError(res, 400, 'Total must be positive');

    // Validate stock levels and deduct in a transaction
    const result = await sql.begin(async tx => {
      // Verify stock exists for each item
      for (const item of items) {
        if (!item.productId) continue;
        const [stock] = await tx<{ quantity: string }[]>`
          SELECT quantity FROM warehouse_stock
          WHERE warehouse_id = ${warehouseId} AND product_id = ${item.productId}
        `;
        if (!stock) throw new Error(`Product "${item.productName}" not found in warehouse stock`);
        if (num(stock.quantity) < Number(item.quantity)) {
          throw new Error(`Insufficient stock for "${item.productName}" (available: ${num(stock.quantity)}, requested: ${item.quantity})`);
        }
      }

      // Create the sale
      const [sale] = await tx<WarehouseSaleRow[]>`
        INSERT INTO warehouse_sales (
          warehouse_id, created_by, customer_name, customer_phone,
          customer_address, payment_method, total_amount, amount_paid,
          doc_type, notes, sale_date
        ) VALUES (
          ${warehouseId}, ${req.userId!},
          ${customerName.trim()}, ${customerPhone ?? null},
          ${customerAddress ?? null}, ${paymentMethod},
          ${total}, ${Number(amountPaid)},
          ${docType}, ${notes ?? null},
          ${saleDate ? saleDate : sql`CURRENT_DATE`}
        )
        RETURNING *
      `;

      // Insert items
      const insertedItems: WarehouseSaleItemRow[] = [];
      for (const item of items) {
        const [inserted] = await tx<WarehouseSaleItemRow[]>`
          INSERT INTO warehouse_sale_items (sale_id, product_id, product_name, quantity, unit_price, subtotal, unit)
          VALUES (
            ${sale.id}, ${item.productId ?? null}, ${item.productName},
            ${Number(item.quantity)}, ${Number(item.unitPrice)},
            ${Number(item.subtotal)}, ${item.unit ?? 'pcs'}
          )
          RETURNING *
        `;
        insertedItems.push(inserted);

        // Deduct stock
        if (item.productId) {
          await tx`
            UPDATE warehouse_stock
            SET quantity   = quantity - ${Number(item.quantity)},
                updated_at = now()
            WHERE warehouse_id = ${warehouseId} AND product_id = ${item.productId}
          `;
        }
      }

      return { ...sale, items: insertedItems };
    });

    // Fetch with warehouse/user names for response
    const [full] = await sql<(WarehouseSaleRow & { warehouse_name: string; created_by_name: string })[]>`
      SELECT ws.*, w.name AS warehouse_name, u.full_name AS created_by_name
      FROM   warehouse_sales ws
      JOIN   warehouses w ON w.id = ws.warehouse_id
      JOIN   users u       ON u.id = ws.created_by
      WHERE  ws.id = ${result.id}
    `;
    const itemRows = await sql<WarehouseSaleItemRow[]>`
      SELECT * FROM warehouse_sale_items WHERE sale_id = ${result.id} ORDER BY id
    `;

    return sendResponse(res, 201, 'Sale recorded', toSale({ ...full, items: itemRows }));
  } catch (err: any) {
    console.error('[POST /warehouse-sales]', err);
    if (err.message?.includes('Insufficient stock') || err.message?.includes('not found in warehouse')) {
      return sendError(res, 409, err.message);
    }
    return sendError(res, 500, 'Server error', err);
  }
});

// ── DELETE /api/warehouse-sales/:id ──────────────────────────────────────────

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await sql.begin(async tx => {
      // Restore stock
      const items = await tx<WarehouseSaleItemRow[]>`
        SELECT wsi.*, ws.warehouse_id FROM warehouse_sale_items wsi
        JOIN warehouse_sales ws ON ws.id = wsi.sale_id
        WHERE wsi.sale_id = ${req.params.id}
      `;
      for (const item of items) {
        if (item.product_id) {
          await tx`
            UPDATE warehouse_stock
            SET quantity   = quantity + ${num(item.quantity)},
                updated_at = now()
            WHERE warehouse_id = ${(item as any).warehouse_id} AND product_id = ${item.product_id}
          `;
        }
      }
      await tx`DELETE FROM warehouse_sales WHERE id = ${req.params.id}`;
    });
    return sendResponse(res, 200, 'Sale deleted and stock restored', { id: req.params.id });
  } catch (err) {
    return sendError(res, 500, 'Server error', err);
  }
});

export default router;
