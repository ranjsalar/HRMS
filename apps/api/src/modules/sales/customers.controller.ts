import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import type { PermissionScope } from "@prisma/client";
import { ClientIp } from "../../common/decorators/client-ip.decorator";
import { CurrentPermissionScope } from "../../common/decorators/current-permission-scope.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequirePermission } from "../../common/decorators/require-permission.decorator";
import type { AccessTokenPayload } from "../auth/token.service";
import { CustomersService } from "./customers.service";
import { CreateCustomerDto, UpdateCustomerDto } from "./dto/customer.dto";
import { CreateCustomerContactDto, UpdateCustomerContactDto } from "./dto/customer-contact.dto";

@Controller("customers")
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  // Reads take no scope argument at all — company-wide by confirmed
  // design (Sales-CRM-Module-Plan.md §3). RbacGuard has already rejected
  // anyone without a sales:view grant, and `employee` has no such grant
  // by default. See CustomersService's class comment.
  @RequirePermission("sales", "view")
  @Get()
  list() {
    return this.customers.findMany();
  }

  @RequirePermission("sales", "view")
  @Get(":id")
  async findOne(@Param("id") id: string) {
    const customer = await this.customers.findOne(id);
    if (!customer) {
      throw new NotFoundException("Customer not found");
    }
    return customer;
  }

  @RequirePermission("sales", "create")
  @Post()
  create(
    @CurrentUser() user: AccessTokenPayload,
    @CurrentPermissionScope() scope: PermissionScope,
    @Body() dto: CreateCustomerDto,
    @ClientIp() ipAddress: string,
  ) {
    if (!user.companyId) {
      throw new NotFoundException("This endpoint requires a company-scoped session");
    }
    return this.customers.create(user.companyId, dto, user.sub, scope, {
      userId: user.sub,
      ipAddress,
    });
  }

  @RequirePermission("sales", "edit")
  @Patch(":id")
  async update(
    @CurrentUser() user: AccessTokenPayload,
    @CurrentPermissionScope() scope: PermissionScope,
    @Param("id") id: string,
    @Body() dto: UpdateCustomerDto,
    @ClientIp() ipAddress: string,
  ) {
    const customer = await this.customers.update(id, dto, user.sub, scope, {
      userId: user.sub,
      ipAddress,
    });
    if (!customer) {
      throw new NotFoundException("Customer not found");
    }
    return customer;
  }

  // Hard delete, but guarded — returns a clean 409 (not a raw 500 from
  // the ON DELETE RESTRICT foreign keys) when the customer still has
  // deals, sales orders, or contacts. See CustomersService.remove().
  @RequirePermission("sales", "delete")
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: AccessTokenPayload,
    @CurrentPermissionScope() scope: PermissionScope,
    @Param("id") id: string,
    @ClientIp() ipAddress: string,
  ) {
    const removed = await this.customers.remove(id, user.sub, scope, {
      userId: user.sub,
      ipAddress,
    });
    if (!removed) {
      throw new NotFoundException("Customer not found");
    }
  }

  @RequirePermission("sales", "edit")
  @Post(":id/contacts")
  addContact(
    @CurrentUser() user: AccessTokenPayload,
    @CurrentPermissionScope() scope: PermissionScope,
    @Param("id") id: string,
    @Body() dto: CreateCustomerContactDto,
    @ClientIp() ipAddress: string,
  ) {
    return this.customers.addContact(id, dto, user.sub, scope, {
      userId: user.sub,
      ipAddress,
    });
  }

  @RequirePermission("sales", "edit")
  @Patch(":id/contacts/:contactId")
  async updateContact(
    @CurrentUser() user: AccessTokenPayload,
    @CurrentPermissionScope() scope: PermissionScope,
    @Param("id") id: string,
    @Param("contactId") contactId: string,
    @Body() dto: UpdateCustomerContactDto,
    @ClientIp() ipAddress: string,
  ) {
    const contact = await this.customers.updateContact(id, contactId, dto, user.sub, scope, {
      userId: user.sub,
      ipAddress,
    });
    if (!contact) {
      throw new NotFoundException("Contact not found");
    }
    return contact;
  }

  @RequirePermission("sales", "edit")
  @Delete(":id/contacts/:contactId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeContact(
    @CurrentUser() user: AccessTokenPayload,
    @CurrentPermissionScope() scope: PermissionScope,
    @Param("id") id: string,
    @Param("contactId") contactId: string,
    @ClientIp() ipAddress: string,
  ) {
    const removed = await this.customers.removeContact(id, contactId, user.sub, scope, {
      userId: user.sub,
      ipAddress,
    });
    if (!removed) {
      throw new NotFoundException("Contact not found");
    }
  }
}
