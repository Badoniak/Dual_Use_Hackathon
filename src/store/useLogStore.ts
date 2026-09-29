import { create } from 'zustand';

export interface LogEntry {
  id: string;
  timestamp: Date;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  source: 'SYSTEM' | 'DRON' | 'DOWÓDCA';
  imageUrl?: string;
  confidence?: number;
}

interface LogStore {
  logs: LogEntry[];
  addLog: (message: string, type?: LogEntry['type'], source?: LogEntry['source']) => void;
  addAnomaly: (message: string, imageUrl: string, confidence: number) => void;
  clearLogs: () => void;
}

export const useLogStore = create<LogStore>((set) => ({
  logs: [
    {
      id: 'init-1',
      timestamp: new Date(),
      message: 'Stacja naziemna SKYSAR gotowa. Wyznacz obszar działań i wyślij zwiadowcę.',
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
      // dziennik misji: ostatnie 300 wpisów
      return { logs: [newLog, ...state.logs].slice(0, 300) };
    });
  },

  addAnomaly: (message, imageUrl, confidence) => {
    set((state) => {
      const newLog: LogEntry = {
        id: Math.random().toString(36).substring(7),
        timestamp: new Date(),
        message,
        type: 'warning',
        source: 'DRON',
        imageUrl,
        confidence
      };
      return { logs: [newLog, ...state.logs].slice(0, 300) };
    });
  },
  
  clearLogs: () => set({ logs: [] })
}));
