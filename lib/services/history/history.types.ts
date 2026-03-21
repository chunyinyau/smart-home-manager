export interface HistoryRecord {
  id: string;
  uid: string;
  eventType: string;
  eventSource: string;
  message: string;
  targetApplianceId?: string;
  createdAt: string;
}
