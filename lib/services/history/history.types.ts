export interface HistoryRecord {
  log_id: number;
  user_id: string;
  message: string;
  occurred_at: string;
}

export interface HistoryLogEvent {
  user_id: string;
  message: string;
  occurred_at?: string;
}

export interface HistoryQueueAck {
  accepted: true;
  queued_at: string;
  fallback?: boolean;
}
