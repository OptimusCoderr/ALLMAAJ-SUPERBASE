import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  limit: number;
  onPageChange: (page: number) => void;
  onLimitChange?: (limit: number) => void;
  limitOptions?: number[];
}

export default function Pagination({
  page,
  totalPages,
  total,
  limit,
  onPageChange,
  onLimitChange,
  limitOptions = [10, 25, 50, 100],
}: PaginationProps) {
  if (total === 0) return null;

  const from = (page - 1) * limit + 1;
  const to   = Math.min(page * limit, total);

  const pages: (number | '...')[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3)           pages.push('...');
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
    if (page < totalPages - 2) pages.push('...');
    pages.push(totalPages);
  }

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-1 py-3">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <span>
          Showing <span className="font-medium text-slate-700">{from}–{to}</span> of{' '}
          <span className="font-medium text-slate-700">{total}</span>
        </span>
        {onLimitChange && (
          <select
            value={limit}
            onChange={e => { onLimitChange(Number(e.target.value)); onPageChange(1); }}
            className="ml-2 border border-slate-200 rounded-lg px-2 py-1 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
          >
            {limitOptions.map(l => <option key={l} value={l}>{l} / page</option>)}
          </select>
        )}
      </div>

      <div className="flex items-center gap-1">
        <PageBtn onClick={() => onPageChange(1)} disabled={page === 1} title="First page">
          <ChevronsLeft className="w-4 h-4" />
        </PageBtn>
        <PageBtn onClick={() => onPageChange(page - 1)} disabled={page === 1} title="Previous page">
          <ChevronLeft className="w-4 h-4" />
        </PageBtn>

        {pages.map((p, i) =>
          p === '...' ? (
            <span key={`dots-${i}`} className="px-2 text-slate-400 select-none">…</span>
          ) : (
            <button
              key={p}
              onClick={() => onPageChange(p as number)}
              className={`min-w-[32px] h-8 px-2 rounded-lg text-sm font-medium transition-colors ${
                p === page
                  ? 'bg-amber-500 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {p}
            </button>
          )
        )}

        <PageBtn onClick={() => onPageChange(page + 1)} disabled={page === totalPages} title="Next page">
          <ChevronRight className="w-4 h-4" />
        </PageBtn>
        <PageBtn onClick={() => onPageChange(totalPages)} disabled={page === totalPages} title="Last page">
          <ChevronsRight className="w-4 h-4" />
        </PageBtn>
      </div>
    </div>
  );
}

function PageBtn({ children, onClick, disabled, title }: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
    >
      {children}
    </button>
  );
}