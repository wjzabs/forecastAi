import { CommonModule } from '@angular/common';
import { Component, OnDestroy, ViewChild, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IgxButtonModule,
  IgxCardModule,
  IgxDialogComponent,
  IgxDialogModule,
  IgxGridModule,
  IgxInputGroupModule,
  IgxProgressBarModule
} from 'igniteui-angular';
import { IgxCategoryChartModule } from 'igniteui-angular-charts';
import {
  AiFinding,
  AiJob,
  AiUserContext,
  ForecastApiService,
  ForecastItem,
  MonthlyMetric,
  WorkbookResponse
} from './forecast-api.service';

@Component({
  selector: 'app-root',
  imports: [
    CommonModule,
    FormsModule,
    IgxButtonModule,
    IgxCardModule,
    IgxCategoryChartModule,
    IgxDialogModule,
    IgxGridModule,
    IgxInputGroupModule,
    IgxProgressBarModule
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnDestroy {
  @ViewChild('aiDialog', { static: false }) aiDialog?: IgxDialogComponent;

  protected readonly workbook = signal<WorkbookResponse | null>(null);
  protected readonly selectedItem = signal<ForecastItem | null>(null);
  protected readonly selectedMetrics = signal<MonthlyMetric[]>([]);
  protected readonly aiJob = signal<AiJob | null>(null);
  protected readonly findings = signal<AiFinding[]>([]);
  protected readonly isUploading = signal(false);
  protected readonly isStartingAi = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly userContext: AiUserContext = {
    forecastingMethod: '',
    knownAssumptions: '',
    knownPromotionsOrConstraints: '',
    blindSpots: '',
    regionMarketNotes: ''
  };

  private pollHandle?: number;

  protected readonly chartData = computed(() =>
    this.selectedMetrics().map((metric) => ({
      month: this.formatMonth(metric.month),
      Forecast: metric.forecastUnits,
      Shipments: metric.shipmentHistoryUnits,
      'Forecast History': metric.forecastHistoryUnits
    }))
  );

  protected readonly selectedFindings = computed(() => {
    const item = this.selectedItem();

    if (!item) {
      return [];
    }

    return this.findings().filter((finding) => finding.item === item.itemCode);
  });

  constructor(private readonly api: ForecastApiService) {}

  ngOnDestroy(): void {
    this.stopPolling();
  }

  protected uploadWorkbook(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    this.isUploading.set(true);
    this.errorMessage.set('');
    this.workbook.set(null);
    this.selectedItem.set(null);
    this.selectedMetrics.set([]);
    this.findings.set([]);
    this.aiJob.set(null);

    this.api.uploadWorkbook(file).subscribe({
      next: (workbook) => {
        this.workbook.set(workbook);
        this.isUploading.set(false);

        if (workbook.items.length > 0) {
          this.selectItem(workbook.items[0]);
        }
      },
      error: (error) => {
        this.errorMessage.set(error?.error?.message ?? 'Workbook upload failed.');
        this.isUploading.set(false);
      }
    });
  }

  protected selectItem(item: ForecastItem): void {
    const workbook = this.workbook();

    this.selectedItem.set(item);
    this.selectedMetrics.set(item.monthlyMetrics);

    if (!workbook) {
      return;
    }

    this.api.getItemMetrics(workbook.id, item.itemCode).subscribe({
      next: (metrics) => this.selectedMetrics.set(metrics),
      error: () => this.errorMessage.set('Unable to load item metrics.')
    });
  }

  protected openAiDialog(): void {
    this.errorMessage.set('');
    this.aiDialog?.open();
  }

  protected startAiJob(): void {
    const workbook = this.workbook();
    const item = this.selectedItem();

    if (!workbook || !item) {
      return;
    }

    this.isStartingAi.set(true);
    this.errorMessage.set('');
    this.findings.set([]);
    this.aiDialog?.close();

    this.api.startAiJob(workbook.id, [item.itemCode], this.userContext).subscribe({
      next: (job) => {
        this.aiJob.set(job);
        this.isStartingAi.set(false);
        this.pollJob(job.id);
      },
      error: () => {
        this.errorMessage.set('Unable to start AI-assisted forecasting.');
        this.isStartingAi.set(false);
      }
    });
  }

  protected formatMonth(value: string): string {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC'
    }).format(date);
  }

  protected trackFinding(_index: number, finding: AiFinding): string {
    return `${finding.item}-${finding.monthYear}`;
  }

  private pollJob(jobId: string): void {
    this.stopPolling();

    this.pollHandle = window.setInterval(() => {
      this.api.getAiJob(jobId).subscribe({
        next: (job) => {
          this.aiJob.set(job);

          if (job.status === 'complete' || job.status === 'failed') {
            this.stopPolling();
            this.loadFindings(jobId);
          }
        },
        error: () => {
          this.stopPolling();
          this.errorMessage.set('Unable to poll AI job status.');
        }
      });
    }, 700);
  }

  private loadFindings(jobId: string): void {
    this.api.getAiFindings(jobId).subscribe({
      next: (findings) => this.findings.set(findings),
      error: () => this.errorMessage.set('Unable to load AI findings.')
    });
  }

  private stopPolling(): void {
    if (this.pollHandle) {
      window.clearInterval(this.pollHandle);
      this.pollHandle = undefined;
    }
  }
}
