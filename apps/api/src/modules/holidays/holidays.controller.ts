import { Controller, Get, Query } from "@nestjs/common";
import { UpcomingHolidaysQueryDto } from "./dto/upcoming-holidays.dto";
import { HolidaysService } from "./holidays.service";

// No @RequirePermission — a company's holiday calendar is shared
// reference data every employee needs (leave planning, dashboard
// widget), same reasoning as LeaveTypesController's GET / being open to
// any authenticated company user. Authentication (AuthGuard) and tenant
// scoping (TenantScopeInterceptor) still apply — this is not @Public().
@Controller("holidays")
export class HolidaysController {
  constructor(private readonly holidaysService: HolidaysService) {}

  @Get("upcoming")
  upcoming(@Query() query: UpcomingHolidaysQueryDto) {
    return this.holidaysService.upcoming(query.limit);
  }
}
