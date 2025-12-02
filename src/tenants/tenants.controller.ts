import { Controller, Get, Query } from '@nestjs/common';
import { TenantsService } from './tenants.service';

@Controller('tenants')
export class TenantsController {
    constructor(private readonly tenantsService: TenantsService) { }

    @Get('by-domain')
    async findByDomain(@Query('domain') domain: string) {
        return this.tenantsService.findByDomain(domain);
    }
}
