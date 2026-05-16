import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

export interface MonthlyMetric {
  month: string;
  forecastUnits: number;
  shipmentHistoryUnits: number;
  forecastHistoryUnits: number;
}

export interface ForecastItem {
  itemCode: string;
  brand: string;
  category: string;
  gender: string;
  type: string;
  size: string;
  description: string;
  retailPrice: number;
  personalities: string;
  color: string;
  scent: string;
  metadata: Record<string, string | number>;
  itemSheetValues: Record<string, string | number>;
  forecastSheetValues: Record<string, number>;
  hasForecastRecord: boolean;
  forecastTotal: number;
  shipmentHistoryTotal: number;
  forecastHistoryTotal: number;
  monthlyMetrics: MonthlyMetric[];
}

export interface ItemSheetColumn {
  header: string;
  sourceHeader: string;
  field: string;
  dataType: 'string' | 'number';
}

export interface WorkbookResponse {
  id: string;
  sourceFileName: string;
  forecastStartMonth: string;
  uploadedAt: string;
  itemSheetColumns: ItemSheetColumn[];
  summary: {
    itemCount: number;
    forecastMonthCount: number;
    forecastMonths: string[];
    forecastColumns?: string[];
    sheetNames: string[];
  };
  items: ForecastItem[];
}

export interface AiJob {
  id: string;
  workbookId: string;
  status: 'pending' | 'running' | 'complete' | 'failed';
  progress: number;
  totalTasks: number;
  completedTasks: number;
  createdAt: string;
  updatedAt: string;
  errorMessage?: string;
}

export interface AiFinding {
  item: string;
  monthYear: string;
  considerations: FindingEntry[];
  recommendations: FindingEntry[];
}

export interface FindingEntry {
  description: string;
  impact: number;
}

export interface AiUserContext {
  forecastingMethod: string;
  knownAssumptions: string;
  knownPromotionsOrConstraints: string;
  blindSpots: string;
  regionMarketNotes: string;
}

@Injectable({ providedIn: 'root' })
export class ForecastApiService {
  private readonly baseUrlexpress = 'http://localhost:3100/api';
  // private readonly baseUrl = 'https://absapi.absolution1.com/api';
  private readonly baseUrl = 'http://localhost:1977/api';

  constructor(private readonly http: HttpClient) {}

  uploadWorkbook(file: File): Observable<WorkbookResponse> {
    const formData = new FormData();
    formData.append('file', file);

    return this.http.post<WorkbookResponse>(`${this.baseUrlexpress}/workbooks`, formData);
  }

  getItemMetrics(workbookId: string, itemCode: string): Observable<MonthlyMetric[]> {
    return this.http.get<MonthlyMetric[]>(
      `${this.baseUrlexpress}/workbooks/${workbookId}/items/${encodeURIComponent(itemCode)}/metrics`
    );
  }

  startAiJob(
    workbookId: string,
    itemCodes: string[],
    userContext: AiUserContext
  ): Observable<AiJob> {
    console.log({workbookId, itemCodes, userContext})
        // return this.http.post<AiJob>(`${this.baseUrl}/workbooks/${workbookId}/ai-jobs`, {
    return this.http.post<AiJob>(`${this.baseUrlexpress}/workbooks/${workbookId}/ai-jobs`, {
      scope: { itemCodes },
      userContext
    });
  }

  getAiJob(jobId: string): Observable<AiJob> {
    // return this.http.get<AiJob>(`${this.baseUrl}/ai-jobs/${jobId}`);
    return this.http.get<AiJob>(`${this.baseUrlexpress}/ai-jobs/${jobId}`);
  }

  getAiFindings(jobId: string): Observable<AiFinding[]> {
    // return this.http.get<AiFinding[]>(`${this.baseUrl}/ai-jobs/${jobId}/findings`);
    return this.http.get<AiFinding[]>(`${this.baseUrlexpress}/ai-jobs/${jobId}/findings`);    
  }
}
