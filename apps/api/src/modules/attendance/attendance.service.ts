import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { AttendanceRecord, PermissionScope, Prisma } from "@prisma/client";
import { TenantContextStorage } from "../../database/prisma/tenant-context.storage";
import { isPlausibleCoordinate, isWithinGeofence } from "../../common/geo/geofence";
import { AuditService } from "../audit/audit.service";
import { EmployeesService } from "../employees/employees.service";

export interface RequestActor {
  userId: string;
  ipAddress?: string;
}

export interface GpsCoordinates {
  lat?: number;
  lng?: number;
}

export interface AdminOverrideInput {
  employeeId: string;
  attendanceRecordId?: string;
  clockIn: string;
  clockOut?: string;
  note: string;
}

/**
 * GPS coordinates are trusted input from the client device — plausibility
 * (real lat/lng bounds) is checked, but there is deliberately NO
 * anti-spoofing here (mock-location detection, velocity checks between
 * consecutive punches, etc). That's a known, accepted v1 limitation, not an
 * oversight — see DECISIONS.md. Geofence violations FLAG a record for
 * admin review; they never block the clock-in/out itself, since workers
 * legitimately work off-site.
 */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly tenantContext: TenantContextStorage,
    private readonly employees: EmployeesService,
    private readonly audit: AuditService,
  ) {}

  private tx() {
    const store = this.tenantContext.getStore();
    if (!store) {
      throw new Error("AttendanceService used outside a tenant-scoped request");
    }
    return store.tx;
  }

  /**
   * The ONLY way this service learns which employee a clock-in/out
   * belongs to — resolved from the authenticated session's own Employee
   * row, never from a client-supplied id. This is what makes "an employee
   * cannot clock in as another employee" true structurally, not by
   * convention: there is no parameter anywhere in the clockIn/clockOut
   * signatures a client could use to name a different employee.
   */
  private async ownEmployee(userId: string): Promise<{ id: string; branchId: string | null }> {
    const employee = await this.tx().employee.findUnique({
      where: { userId },
      select: { id: true, branchId: true },
    });
    if (!employee) {
      throw new NotFoundException("No employee record is linked to this account");
    }
    return employee;
  }

  private validateCoords(coords: GpsCoordinates): void {
    if (coords.lat === undefined && coords.lng === undefined) return;
    if (coords.lat === undefined || coords.lng === undefined) {
      throw new BadRequestException("Both lat and lng must be provided together");
    }
    if (!isPlausibleCoordinate(coords.lat, coords.lng)) {
      throw new BadRequestException("Submitted coordinates are not plausible");
    }
  }

  /** null = no geofence configured for this branch (or no coords/branch) — nothing to evaluate, not a failure. */
  private async evaluateGeofence(
    branchId: string | null,
    coords: GpsCoordinates,
  ): Promise<boolean | null> {
    if (coords.lat === undefined || coords.lng === undefined || !branchId) return null;

    const branch = await this.tx().branch.findUnique({
      where: { id: branchId },
      select: { geofenceLat: true, geofenceLng: true, geofenceRadiusMeters: true },
    });
    if (
      !branch ||
      branch.geofenceLat === null ||
      branch.geofenceLng === null ||
      branch.geofenceRadiusMeters === null
    ) {
      return null;
    }

    return isWithinGeofence(
      { lat: coords.lat, lng: coords.lng },
      { lat: branch.geofenceLat, lng: branch.geofenceLng },
      branch.geofenceRadiusMeters,
    );
  }

  async clockIn(
    userId: string,
    companyId: string,
    coords: GpsCoordinates,
    actor: RequestActor,
  ): Promise<AttendanceRecord> {
    this.validateCoords(coords);
    const employee = await this.ownEmployee(userId);

    const openRecord = await this.tx().attendanceRecord.findFirst({
      where: { employeeId: employee.id, clockOut: null },
    });
    if (openRecord) {
      throw new ConflictException("Already clocked in — clock out before clocking in again");
    }

    const withinGeofence = await this.evaluateGeofence(employee.branchId, coords);

    const record = await this.tx().attendanceRecord.create({
      data: {
        companyId,
        employeeId: employee.id,
        clockIn: new Date(),
        clockInLat: coords.lat,
        clockInLng: coords.lng,
        withinGeofence,
        source: "web",
      },
    });

    await this.audit.record({
      userId: actor.userId,
      action: "clock_in",
      entity: "AttendanceRecord",
      entityId: record.id,
      ipAddress: actor.ipAddress,
      metadata: { withinGeofence },
    });

    return record;
  }

  async clockOut(
    userId: string,
    coords: GpsCoordinates,
    actor: RequestActor,
  ): Promise<AttendanceRecord> {
    this.validateCoords(coords);
    const employee = await this.ownEmployee(userId);

    const openRecord = await this.tx().attendanceRecord.findFirst({
      where: { employeeId: employee.id, clockOut: null },
      orderBy: { clockIn: "desc" },
    });
    if (!openRecord) {
      throw new ConflictException("No open clock-in to close");
    }

    const clockOutWithinGeofence = await this.evaluateGeofence(employee.branchId, coords);
    // A record is only clean if NEITHER end was flagged outside; a single
    // flagged end (clock-in or clock-out) is enough to warrant review.
    // Both null (nothing ever evaluated) stays null, not a false "clean."
    const withinGeofence = combineGeofenceResults(
      openRecord.withinGeofence,
      clockOutWithinGeofence,
    );

    const record = await this.tx().attendanceRecord.update({
      where: { id: openRecord.id },
      data: {
        clockOut: new Date(),
        clockOutLat: coords.lat,
        clockOutLng: coords.lng,
        withinGeofence,
      },
    });

    await this.audit.record({
      userId: actor.userId,
      action: "clock_out",
      entity: "AttendanceRecord",
      entityId: record.id,
      ipAddress: actor.ipAddress,
      metadata: { withinGeofence },
    });

    return record;
  }

  /**
   * Manual create-or-correct, RBAC + department-scoped exactly like
   * Employee writes: `employees.isVisible` is the SAME check the Employee
   * module uses to decide "can this caller act on this employee," reused
   * here so a manager's override reach can never exceed their reach over
   * the employee elsewhere in the app. No GPS/geofence evaluation — this
   * is a manual correction, not a device-reported punch.
   */
  async adminOverride(
    callerId: string,
    companyId: string,
    scope: PermissionScope,
    dto: AdminOverrideInput,
    actor: RequestActor,
  ): Promise<AttendanceRecord> {
    const visible = await this.employees.isVisible(dto.employeeId, callerId, scope);
    if (!visible) {
      throw new NotFoundException("Employee not found");
    }

    const clockIn = new Date(dto.clockIn);
    const clockOut = dto.clockOut ? new Date(dto.clockOut) : null;
    if (clockOut && clockOut <= clockIn) {
      throw new BadRequestException("clockOut must be after clockIn");
    }

    let record: AttendanceRecord;
    if (dto.attendanceRecordId) {
      const existing = await this.tx().attendanceRecord.findFirst({
        where: { id: dto.attendanceRecordId, employeeId: dto.employeeId },
      });
      if (!existing) {
        throw new NotFoundException("Attendance record not found");
      }
      record = await this.tx().attendanceRecord.update({
        where: { id: existing.id },
        data: {
          clockIn,
          clockOut,
          source: "admin_override",
          overriddenBy: callerId,
          note: dto.note,
        },
      });
    } else {
      record = await this.tx().attendanceRecord.create({
        data: {
          companyId,
          employeeId: dto.employeeId,
          clockIn,
          clockOut,
          source: "admin_override",
          overriddenBy: callerId,
          note: dto.note,
        },
      });
    }

    await this.audit.record({
      userId: actor.userId,
      action: "admin_override",
      entity: "AttendanceRecord",
      entityId: record.id,
      ipAddress: actor.ipAddress,
      metadata: { employeeId: dto.employeeId, note: dto.note },
    });

    return record;
  }

  async myTimesheet(userId: string, from: string, to: string): Promise<AttendanceRecord[]> {
    const employee = await this.ownEmployee(userId);
    return this.tx().attendanceRecord.findMany({
      where: {
        employeeId: employee.id,
        clockIn: { gte: new Date(from), lte: endOfDayInclusive(to) },
      },
      orderBy: { clockIn: "desc" },
    });
  }

  async teamTimesheet(
    callerId: string,
    scope: PermissionScope,
    from: string,
    to: string,
    employeeId?: string,
  ): Promise<AttendanceRecord[]> {
    if (scope === "self") {
      // Structurally shouldn't happen — the default matrix never grants
      // "self" scope on a route wired to this method — but fail closed
      // rather than silently listing something.
      throw new ForbiddenException("Insufficient scope to view team attendance");
    }

    if (employeeId) {
      const visible = await this.employees.isVisible(employeeId, callerId, scope);
      if (!visible) return [];
      return this.tx().attendanceRecord.findMany({
        where: { employeeId, clockIn: { gte: new Date(from), lte: endOfDayInclusive(to) } },
        orderBy: { clockIn: "desc" },
      });
    }

    const employeeWhere = await this.scopeWhere(callerId, scope);
    if (employeeWhere === null) return [];

    return this.tx().attendanceRecord.findMany({
      where: {
        employee: employeeWhere,
        clockIn: { gte: new Date(from), lte: endOfDayInclusive(to) },
      },
      orderBy: { clockIn: "desc" },
    });
  }

  private async scopeWhere(
    userId: string,
    scope: PermissionScope,
  ): Promise<Prisma.EmployeeWhereInput | null> {
    if (scope === "all") return {};
    const departmentId = await this.employees.managedDepartmentId(userId);
    return departmentId ? { departmentId } : null;
  }
}

function combineGeofenceResults(a: boolean | null, b: boolean | null): boolean | null {
  if (a === null && b === null) return null;
  if (a === false || b === false) return false;
  return true;
}

/** `to` is treated as inclusive through the end of that calendar day (UTC), regardless of any time component supplied. */
function endOfDayInclusive(dateStr: string): Date {
  const d = new Date(dateStr);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}
