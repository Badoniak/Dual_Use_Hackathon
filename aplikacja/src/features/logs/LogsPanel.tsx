import { ScrollText, Trash2 } from 'lucide-react';
import { useLogStore } from '../../store/useLogStore';

const typeColor: Record<string, string> = {
  info: 'text-muted-foreground',
  success: 'text-green-500',
  warning: 'text-orange-500',
  error: 'text-red-500',
};

export function LogsPanel() {
  const { logs, clearLogs } = useLogStore();

  return (
    <div className="flex flex-col h-full bg-card/50 text-foreground">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/40 shrink-0">
        <div className="flex items-center gap-2">
          <ScrollText className="h-4 w-4 text-primary" />
          <h3 className="font-medium text-sm">Dziennik zdarzeń</h3>
        </div>
        <button
          onClick={clearLogs}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          <Trash2 className="h-3 w-3" />
          Wyczyść
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-1 font-mono text-xs">
        {logs.length === 0 && (
          <p className="text-muted-foreground text-center mt-4">Brak wpisów.</p>
        )}
        {logs.map((log) => (
          <div key={log.id} className="flex items-start gap-2">
            <span className="text-muted-foreground shrink-0">
              {log.timestamp.toLocaleTimeString()}
            </span>
            <span className="font-bold shrink-0 w-20">[{log.source}]</span>
            <span className={typeColor[log.type]}>{log.message}</span>
            {log.confidence !== undefined && (
              <span className="text-orange-500 shrink-0">({log.confidence}%)</span>
            )}
            {log.imageUrl && (
              <img src={log.imageUrl} alt="Anomalia" className="h-10 rounded border border-border/40 ml-auto" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
