import type { CloudSource } from '../../store/useMissionStore';

const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} mln` : `${Math.round(n / 1000)} tys.`);

/** Wybór czujnika chmury punktów: lidar, kamera głębi RGB-D albo oba naraz. */
export function SourceToggle({ value, onChange, disabled, counts, testId }: {
  value: CloudSource;
  onChange: (v: CloudSource) => void;
  disabled?: boolean;
  counts: { lidar: number; rgbd: number } | null;
  testId?: string;
}) {
  const opts: { v: CloudSource; label: string; n?: number }[] = [
    { v: 'both', label: 'Lidar + RGB-D', n: counts ? counts.lidar + counts.rgbd : undefined },
    { v: 'lidar', label: 'Lidar', n: counts?.lidar },
    { v: 'rgbd', label: 'RGB-D', n: counts?.rgbd },
  ];
  return (
    <div className="flex bg-muted/50 rounded overflow-hidden text-xs" data-testid={testId}>
      {opts.map(o => (
        <button
          key={o.v}
          disabled={disabled}
          onClick={() => onChange(o.v)}
          title={o.n !== undefined ? `${o.n.toLocaleString('pl-PL')} punktów` : undefined}
          className={`flex-1 py-1 leading-tight disabled:opacity-40 ${value === o.v ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
          data-testid={testId ? `${testId}-${o.v}` : undefined}
        >
          {o.label}
          {o.n !== undefined && <span className="block text-[9px] opacity-70">{fmt(o.n)}</span>}
        </button>
      ))}
    </div>
  );
}
