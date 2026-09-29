import { create } from 'zustand';

export interface LogEntry {
  id: string;
  timestamp: Date;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  source: 'SYSTEM' | 'DRON' | 'DOWÓDCA';
}

interface LogStore {
  logs: LogEntry[];
  addLog: (message: string, type?: LogEntry['type'], source?: LogEntry['source']) => void;
  clearLogs: () => void;
}

export const useLogStore = create<LogStore>((set) => ({
  logs: [
    {
      id: 'init-1',
      timestamp: new Date(),
      message: 'System Antigravity Command & Control v2.0 gotowy do pracy.',
      type: 'info',
      source: 'SYSTEM'
    }
  ],
  
  addLog: (message, type = 'info', source = 'SYSTEM') => {
    set((state) => {
      const newLog: LogEntry = {
        id: Math.random().toString(36).substring(7),
        timestamp: new Date(),
        message,
        type,
        source
      };
      // Przechowujemy tylko ostatnie 50 logów by nie zaśmiecać pamięci
      return { logs: [newLog, ...state.logs].slice(0, 50) };
    });
  },
  
  clearLogs: () => set({ logs: [] })
}));
