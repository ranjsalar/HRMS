import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { type Job, Worker } from "bullmq";
import IORedis from "ioredis";
import { PAYROLL_PDF_QUEUE_NAME, type PayslipPdfJobData } from "./payroll.queue";
import { PayrollPdfService } from "./payroll-pdf.service";

/**
 * The consumer side — a BullMQ Worker running IN-PROCESS with the rest of
 * this Nest app (concurrency: 1, so payslip PDF generation for different
 * runs never overlaps). Per the architecture doc's "modular monolith,
 * clean boundaries now, path to splitting into its own service later"
 * framing: this could become a separate deployable worker process without
 * touching PayrollPdfService at all, but doesn't need to yet.
 */
@Injectable()
export class PayrollWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayrollWorkerService.name);
  private worker?: Worker<PayslipPdfJobData>;
  private connection?: IORedis;

  constructor(
    private readonly config: ConfigService,
    private readonly payrollPdfService: PayrollPdfService,
  ) {}

  onModuleInit(): void {
    this.connection = new IORedis(this.config.getOrThrow<string>("REDIS_URL"), {
      maxRetriesPerRequest: null,
    });
    // Node's EventEmitter throws (crashing the whole process) if an
    // "error" event fires with no listener attached — ioredis and BullMQ
    // both emit one on any connection hiccup (a dropped connection during
    // shutdown, a network blip). Found live: a fast-closing e2e test
    // (app.close() moments after app.init(), before this connection had
    // settled) crashed the entire Jest process with an unhandled
    // "Connection is closed" error — a real production risk too, not
    // just a test artifact, since the same crash would happen from any
    // real Redis blip. See DECISIONS.md.
    this.connection.on("error", (error) => {
      this.logger.error(`Payroll worker Redis connection error: ${error.message}`, error.stack);
    });
    this.worker = new Worker<PayslipPdfJobData>(
      PAYROLL_PDF_QUEUE_NAME,
      (job: Job<PayslipPdfJobData>) => this.payrollPdfService.processRun(job.data),
      { connection: this.connection, concurrency: 1 },
    );
    this.worker.on("failed", (job, error) => {
      this.logger.error(`Payslip PDF job ${job?.id ?? "?"} failed: ${error.message}`, error.stack);
    });
    this.worker.on("error", (error) => {
      this.logger.error(`Payroll worker error: ${error.message}`, error.stack);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.connection?.quit();
  }
}
