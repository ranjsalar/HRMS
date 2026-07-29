import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { PAYROLL_PDF_QUEUE_NAME, type PayslipPdfJobData } from "./payroll.queue";

/**
 * Owns the BullMQ Queue (producer side) and its own Redis connection —
 * wrapped in a class with OnModuleDestroy, rather than a bare factory
 * provider, specifically so the connection actually closes on app
 * shutdown instead of leaking. That matters in practice, not just in
 * theory: e2e tests build a fresh Nest app per spec file and call
 * app.close() in afterAll — a leaked ioredis connection shows up as a
 * Jest "open handle" warning / hung test run.
 */
@Injectable()
export class PayrollQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(PayrollQueueService.name);
  readonly queue: Queue<PayslipPdfJobData>;
  private readonly connection: IORedis;

  constructor(config: ConfigService) {
    this.connection = new IORedis(config.getOrThrow<string>("REDIS_URL"), {
      maxRetriesPerRequest: null, // required by BullMQ
    });
    // See PayrollWorkerService's identical handler for why this is
    // required, not optional — an unlistened "error" event crashes the
    // whole process. See DECISIONS.md.
    this.connection.on("error", (error) => {
      this.logger.error(`Payroll queue Redis connection error: ${error.message}`, error.stack);
    });
    this.queue = new Queue<PayslipPdfJobData>(PAYROLL_PDF_QUEUE_NAME, {
      connection: this.connection,
    });
    this.queue.on("error", (error) => {
      this.logger.error(`Payroll queue error: ${error.message}`, error.stack);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    await this.connection.quit();
  }
}
