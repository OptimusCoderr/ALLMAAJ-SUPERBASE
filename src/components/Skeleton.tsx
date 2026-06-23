// Base pulsing block
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`bg-slate-200 animate-pulse rounded-lg ${className}`} />;
}

// Single stat card skeleton (number + label)
export function SkeletonStatCard() {
  return (
    <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 space-y-3">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-7 w-32" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}

// Row skeleton for list/table pages
export function SkeletonRow({ cols = 4 }: { cols?: number }) {
  const widths = ['w-1/3', 'w-1/4', 'w-1/5', 'w-1/6'];
  return (
    <div className="flex items-center gap-4 p-4 bg-white rounded-xl border border-slate-100">
      <Skeleton className="w-10 h-10 rounded-full shrink-0" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="h-3 w-1/3" />
      </div>
      {Array.from({ length: cols - 2 }).map((_, i) => (
        <Skeleton key={i} className={`h-4 shrink-0 ${widths[i % widths.length]}`} />
      ))}
    </div>
  );
}

// Card skeleton for debtor/sale-style cards
export function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 space-y-3">
      <div className="flex items-start gap-3">
        <Skeleton className="w-10 h-10 rounded-full shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-3 w-3/5" />
        </div>
        <div className="space-y-2 items-end flex flex-col">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-6 w-16 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

// Dashboard full-page skeleton
export function SkeletonDashboard() {
  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="h-9 w-24 rounded-xl" />
      </div>

      {/* Stat cards grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => <SkeletonStatCard key={i} />)}
      </div>

      {/* Secondary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => <SkeletonStatCard key={i} />)}
      </div>
    </div>
  );
}

// Generic list page skeleton (header + filters + rows)
export function SkeletonListPage({ rows = 5 }: { rows?: number }) {
  return (
    <div className="p-4 sm:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-56" />
        </div>
        <Skeleton className="h-9 w-28 rounded-xl" />
      </div>

      {/* Filters bar */}
      <div className="flex gap-3">
        <Skeleton className="h-10 flex-1 max-w-xs rounded-xl" />
        <Skeleton className="h-10 w-32 rounded-xl" />
        <Skeleton className="h-10 w-24 rounded-xl" />
      </div>

      {/* Rows */}
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => <SkeletonRow key={i} />)}
      </div>
    </div>
  );
}
