import { Router, Request, Response } from 'express';
import sql from '../db/client.js';
import type { WarehouseSaleRow, WarehouseSaleItemRow } from '../db/types.js';
import { num } from '../db/types.js';
import { authMiddleware, managerOrAdmin } from '../middleware/auth.js';
import { sendResponse, sendError } from '../utils/apiResponse.js';

const router = Router();
router.use(authMiddleware);
router.use(managerOrAdmin);

// ── Mapper ────────────────────────────────────────────────────────────────────

const toSale = (
  r: WarehouseSaleRow & {
    warehouse_name?: string | null;
    created_by_name?: string | null;
    items?: (WarehouseSaleItemRow & { source_warehouse_name?: string | null; source_branch_name?: string | null })[];
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
  discountedTotal: r.discounted_total != null ? num(r.discounted_total) : null,
  docType:         r.doc_type,
  notes:           r.notes,
  saleDate:        r.sale_date,
  createdAt:       r.created_at,
  updatedAt:       r.updated_at,
  items: (r.items ?? []).map(i => ({
    id:                i.id,
    saleId:            i.sale_id,
    productId:         i.product_id,
    productName:       i.product_name,
    quantity:          num(i.quantity),
    unitPrice:         num(i.unit_price),
    subtotal:          num(i.subtotal),
    unit:              i.unit,
    sourceWarehouseId: i.source_warehouse_id,
    sourceWarehouseName: (i as any).source_warehouse_name ?? null,
    sourceBranchId:    i.source_branch_id,
    sourceBranchName:  (i as any).source_branch_name ?? null,
    isExternal:        i.is_external,
    externalSource:    i.external_source,
  })),
});

// ── GET /api/warehouse-sales ──────────────────────────────────────────────────

router.get('/', async (req: Request, res: Response) => {
  try {
    const { warehouseId, startDate, endDate, limit = '100' } = req.query as Record<string, string>;

    const sales = await sql<(WarehouseSaleRow & { warehouse_name: string | null; created_by_name: string })[]>`
      SELECT ws.*, w.name AS warehouse_name, u.full_name AS created_by_name
      FROM   warehouse_sales ws
      LEFT JOIN warehouses w ON w.id = ws.warehouse_id
      JOIN  users u           ON u.id = ws.created_by
      WHERE
        (${warehouseId ?? null}::uuid IS NULL OR ws.warehouse_id = ${warehouseId ?? null}::uuid
          OR EXISTS (
            SELECT 1 FROM warehouse_sale_items wsi
            WHERE wsi.sale_id = ws.id AND wsi.source_warehouse_id = ${warehouseId ?? null}::uuid
          ))
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
    const [sale] = await sql<(WarehouseSaleRow & { warehouse_name: string | null; created_by_name: string })[]>`
      SELECT ws.*, w.name AS warehouse_name, u.full_name AS created_by_name
      FROM   warehouse_sales ws
      LEFT JOIN warehouses w ON w.id = ws.warehouse_id
      JOIN  users u           ON u.id = ws.created_by
      WHERE  ws.id = ${req.params.id}
    `;
    if (!sale) return sendError(res, 404, 'Sale not found');

    const items = await sql<(WarehouseSaleItemRow & { source_warehouse_name?: string | null; source_branch_name?: string | null })[]>`
      SELECT wsi.*, w.name AS source_warehouse_name, b.name AS source_branch_name
      FROM   warehouse_sale_items wsi
      LEFT JOIN warehouses w ON w.id = wsi.source_warehouse_id
      LEFT JOIN branches   b ON b.id = wsi.source_branch_id
      WHERE  wsi.sale_id = ${req.params.id}
      ORDER  BY wsi.id
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
      warehouseId,       // primary/issuing warehouse (nullable)
      customerName, customerPhone, customerAddress,
      paymentMethod = 'cash', amountPaid = 0,
      docType = 'invoice', notes, saleDate, items, discountedTotal,
    } = req.body;

    if (!customerName?.trim())
      return sendError(res, 400, 'customerName is required');
    if (!Array.isArray(items) || items.length === 0)
      return sendError(res, 400, 'At least one item is required');
    if (!['cash','pos','transfer','credit'].includes(paymentMethod))
      return sendError(res, 400, 'Invalid payment method');
    if (!['invoice','waybill'].includes(docType))
      return sendError(res, 400, 'Invalid doc type');

    const total = items.reduce((s: number, i: any) => s + Number(i.subtotal ?? 0), 0);
    if (total <= 0) return sendError(res, 400, 'Total must be positive');

    const result = await sql.begin(async tx => {
      // Validate and deduct stock per item
      for (const item of items) {
        if (item.isExternal || !item.productId) continue;

        if (item.sourceBranchId) {
          // Validate branch stock
          const [stock] = await tx<{ quantity: string }[]>`
            SELECT quantity FROM branch_stock
            WHERE branch_id = ${item.sourceBranchId} AND product_id = ${item.productId}
          `;
          if (!stock)
            throw new Error(`"${item.productName}" not found in the selected branch`);
          if (num(stock.quantity) < Number(item.quantity))
            throw new Error(`Insufficient stock for "${item.productName}" in branch (available: ${num(stock.quantity)}, requested: ${item.quantity})`);
        } else {
          const srcWh = item.sourceWarehouseId ?? warehouseId;
          if (!srcWh) throw new Error(`Item "${item.productName}" has no source warehouse or branch`);

          const [stock] = await tx<{ quantity: string }[]>`
            SELECT quantity FROM warehouse_stock
            WHERE warehouse_id = ${srcWh} AND product_id = ${item.productId}
          `;
          if (!stock)
            throw new Error(`"${item.productName}" not found in the selected warehouse`);
          if (num(stock.quantity) < Number(item.quantity))
            throw new Error(`Insufficient stock for "${item.productName}" (available: ${num(stock.quantity)}, requested: ${item.quantity})`);
        }
      }

      const discTotal = discountedTotal != null && Number(discountedTotal) > 0 ? Number(discountedTotal) : null;

      // Create the sale
      const [sale] = await tx<WarehouseSaleRow[]>`
        INSERT INTO warehouse_sales (
          warehouse_id, created_by, customer_name, customer_phone,
          customer_address, payment_method, total_amount, amount_paid,
          discounted_total, doc_type, notes, sale_date
        ) VALUES (
          ${warehouseId ?? null},
          ${req.userId!},
          ${customerName.trim()},
          ${customerPhone ?? null},
          ${customerAddress ?? null},
          ${paymentMethod},
          ${total},
          ${Number(amountPaid)},
          ${discTotal},
          ${docType},
          ${notes ?? null},
          ${saleDate ?? sql`CURRENT_DATE`}
        )
        RETURNING *
      `;

      const insertedItems: WarehouseSaleItemRow[] = [];
      for (const item of items) {
        const srcWh = item.sourceBranchId ? null : (item.sourceWarehouseId ?? warehouseId ?? null);
        const srcBr = item.sourceBranchId ?? null;

        const [inserted] = await tx<WarehouseSaleItemRow[]>`
          INSERT INTO warehouse_sale_items
            (sale_id, product_id, product_name, quantity, unit_price, subtotal, unit,
             source_warehouse_id, source_branch_id, is_external, external_source)
          VALUES (
            ${sale.id},
            ${item.productId ?? null},
            ${item.productName},
            ${Number(item.quantity)},
            ${Number(item.unitPrice)},
            ${Number(item.subtotal)},
            ${item.unit ?? 'pcs'},
            ${!item.isExternal && !srcBr ? srcWh : null},
            ${!item.isExternal && srcBr ? srcBr : null},
            ${item.isExternal ?? false},
            ${item.externalSource ?? null}
          )
          RETURNING *
        `;
        insertedItems.push(inserted);

        if (!item.isExternal && item.productId) {
          if (srcBr) {
            await tx`
              UPDATE branch_stock
              SET quantity   = quantity - ${Number(item.quantity)},
                  updated_at = now()
              WHERE branch_id = ${srcBr} AND product_id = ${item.productId}
            `;
          } else if (srcWh) {
            await tx`
              UPDATE warehouse_stock
              SET quantity   = quantity - ${Number(item.quantity)},
                  updated_at = now()
              WHERE warehouse_id = ${srcWh} AND product_id = ${item.productId}
            `;
          }
        }
      }

      return { ...sale, items: insertedItems };
    });

    // Re-fetch with names
    const [full] = await sql<(WarehouseSaleRow & { warehouse_name: string | null; created_by_name: string })[]>`
      SELECT ws.*, w.name AS warehouse_name, u.full_name AS created_by_name
      FROM   warehouse_sales ws
      LEFT JOIN warehouses w ON w.id = ws.warehouse_id
      JOIN  users u           ON u.id = ws.created_by
      WHERE  ws.id = ${result.id}
    `;
    const itemRows = await sql<WarehouseSaleItemRow[]>`
      SELECT * FROM warehouse_sale_items WHERE sale_id = ${result.id} ORDER BY id
    `;

    return sendResponse(res, 201, 'Sale recorded', toSale({ ...full, items: itemRows }));
  } catch (err: any) {
    console.error('[POST /warehouse-sales]', err);
    if (err.message?.includes('Insufficient stock') || err.message?.includes('not found in'))
      return sendError(res, 409, err.message);
    return sendError(res, 500, 'Server error', err);
  }
});

// ── PUT /api/warehouse-sales/:id ─────────────────────────────────────────────

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const {
      warehouseId, customerName, customerPhone, customerAddress,
      paymentMethod = 'cash', amountPaid = 0,
      docType = 'invoice', notes, saleDate, items, discountedTotal,
    } = req.body;

    if (!customerName?.trim())
      return sendError(res, 400, 'customerName is required');
    if (!Array.isArray(items) || items.length === 0)
      return sendError(res, 400, 'At least one item is required');
    if (!['cash','pos','transfer','credit'].includes(paymentMethod))
      return sendError(res, 400, 'Invalid payment method');
    if (!['invoice','waybill'].includes(docType))
      return sendError(res, 400, 'Invalid doc type');

    const total = items.reduce((s: number, i: any) => s + Number(i.subtotal ?? 0), 0);
    if (total <= 0) return sendError(res, 400, 'Total must be positive');

    await sql.begin(async tx => {
      // Restore stock from existing items before replacing them
      const oldItems = await tx<WarehouseSaleItemRow[]>`
        SELECT * FROM warehouse_sale_items WHERE sale_id = ${req.params.id}
      `;
      for (const item of oldItems) {
        if (!item.is_external && item.product_id) {
          if (item.source_branch_id) {
            await tx`
              UPDATE branch_stock
              SET quantity   = quantity + ${num(item.quantity)},
                  updated_at = now()
              WHERE branch_id = ${item.source_branch_id}
                AND product_id = ${item.product_id}
            `;
          } else if (item.source_warehouse_id) {
            await tx`
              UPDATE warehouse_stock
              SET quantity   = quantity + ${num(item.quantity)},
                  updated_at = now()
              WHERE warehouse_id = ${item.source_warehouse_id}
                AND product_id   = ${item.product_id}
            `;
          }
        }
      }

      await tx`DELETE FROM warehouse_sale_items WHERE sale_id = ${req.params.id}`;

      // Validate new stock
      for (const item of items) {
        if (item.isExternal || !item.productId) continue;
        if (item.sourceBranchId) {
          const [stock] = await tx<{ quantity: string }[]>`
            SELECT quantity FROM branch_stock
            WHERE branch_id = ${item.sourceBranchId} AND product_id = ${item.productId}
          `;
          if (!stock)
            throw new Error(`"${item.productName}" not found in the selected branch`);
          if (num(stock.quantity) < Number(item.quantity))
            throw new Error(`Insufficient stock for "${item.productName}" in branch (available: ${num(stock.quantity)}, requested: ${item.quantity})`);
        } else {
          const srcWh = item.sourceWarehouseId ?? warehouseId;
          if (!srcWh) throw new Error(`Item "${item.productName}" has no source warehouse or branch`);
          const [stock] = await tx<{ quantity: string }[]>`
            SELECT quantity FROM warehouse_stock
            WHERE warehouse_id = ${srcWh} AND product_id = ${item.productId}
          `;
          if (!stock)
            throw new Error(`"${item.productName}" not found in the selected warehouse`);
          if (num(stock.quantity) < Number(item.quantity))
            throw new Error(`Insufficient stock for "${item.productName}" (available: ${num(stock.quantity)}, requested: ${item.quantity})`);
        }
      }

      const discTotal = discountedTotal != null && Number(discountedTotal) > 0 ? Number(discountedTotal) : null;

      // Update sale header
      await tx`
        UPDATE warehouse_sales SET
          warehouse_id     = ${warehouseId ?? null},
          customer_name    = ${customerName.trim()},
          customer_phone   = ${customerPhone ?? null},
          customer_address = ${customerAddress ?? null},
          payment_method   = ${paymentMethod},
          total_amount     = ${total},
          amount_paid      = ${Number(amountPaid)},
          discounted_total = ${discTotal},
          doc_type         = ${docType},
          notes            = ${notes ?? null},
          sale_date        = ${saleDate ?? sql`CURRENT_DATE`},
          updated_at       = now()
        WHERE id = ${req.params.id}
      `;

      // Insert new items and deduct stock
      for (const item of items) {
        const srcWh = item.sourceBranchId ? null : (item.sourceWarehouseId ?? warehouseId ?? null);
        const srcBr = item.sourceBranchId ?? null;
        await tx`
          INSERT INTO warehouse_sale_items
            (sale_id, product_id, product_name, quantity, unit_price, subtotal, unit,
             source_warehouse_id, source_branch_id, is_external, external_source)
          VALUES (
            ${req.params.id},
            ${item.productId ?? null},
            ${item.productName},
            ${Number(item.quantity)},
            ${Number(item.unitPrice)},
            ${Number(item.subtotal)},
            ${item.unit ?? 'pcs'},
            ${!item.isExternal && !srcBr ? srcWh : null},
            ${!item.isExternal && srcBr ? srcBr : null},
            ${item.isExternal ?? false},
            ${item.externalSource ?? null}
          )
        `;
        if (!item.isExternal && item.productId) {
          if (srcBr) {
            await tx`
              UPDATE branch_stock
              SET quantity   = quantity - ${Number(item.quantity)},
                  updated_at = now()
              WHERE branch_id = ${srcBr} AND product_id = ${item.productId}
            `;
          } else if (srcWh) {
            await tx`
              UPDATE warehouse_stock
              SET quantity   = quantity - ${Number(item.quantity)},
                  updated_at = now()
              WHERE warehouse_id = ${srcWh} AND product_id = ${item.productId}
            `;
          }
        }
      }
    });

    const [full] = await sql<(WarehouseSaleRow & { warehouse_name: string | null; created_by_name: string })[]>`
      SELECT ws.*, w.name AS warehouse_name, u.full_name AS created_by_name
      FROM   warehouse_sales ws
      LEFT JOIN warehouses w ON w.id = ws.warehouse_id
      JOIN  users u           ON u.id = ws.created_by
      WHERE  ws.id = ${req.params.id}
    `;
    if (!full) return sendError(res, 404, 'Sale not found');

    const itemRows = await sql<WarehouseSaleItemRow[]>`
      SELECT * FROM warehouse_sale_items WHERE sale_id = ${req.params.id} ORDER BY id
    `;

    return sendResponse(res, 200, 'Sale updated', toSale({ ...full, items: itemRows }));
  } catch (err: any) {
    console.error('[PUT /warehouse-sales/:id]', err);
    if (err.message?.includes('Insufficient stock') || err.message?.includes('not found in'))
      return sendError(res, 409, err.message);
    return sendError(res, 500, 'Server error', err);
  }
});

// ── DELETE /api/warehouse-sales/:id ──────────────────────────────────────────

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await sql.begin(async tx => {
      const items = await tx<WarehouseSaleItemRow[]>`
        SELECT * FROM warehouse_sale_items WHERE sale_id = ${req.params.id}
      `;
      for (const item of items) {
        if (!item.is_external && item.product_id) {
          if (item.source_branch_id) {
            await tx`
              UPDATE branch_stock
              SET quantity   = quantity + ${num(item.quantity)},
                  updated_at = now()
              WHERE branch_id = ${item.source_branch_id}
                AND product_id = ${item.product_id}
            `;
          } else if (item.source_warehouse_id) {
            await tx`
              UPDATE warehouse_stock
              SET quantity   = quantity + ${num(item.quantity)},
                  updated_at = now()
              WHERE warehouse_id = ${item.source_warehouse_id}
                AND product_id   = ${item.product_id}
            `;
          }
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