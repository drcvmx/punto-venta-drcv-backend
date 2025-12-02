import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from './entities/tenant.entity';

@Injectable()
export class TenantsService {
    constructor(
        @InjectRepository(Tenant)
        private tenantRepo: Repository<Tenant>,
    ) { }

    /**
     * Obtener todos los tenants ordenados por nombre
     */
    async findAll(): Promise<Tenant[]> {
        return this.tenantRepo.find({
            order: { nombre: 'ASC' },
            relations: ['owner'],
        });
    }

    /**
     * Buscar tenant por ID
     */
    async findById(id: string): Promise<Tenant> {
        const tenant = await this.tenantRepo.findOne({
            where: { id },
            relations: ['owner'],
        });

        if (!tenant) {
            throw new NotFoundException(`Tenant con ID ${id} no encontrado`);
        }

        return tenant;
    }

    /**
     * Buscar tenant por nombre (case-insensitive)
     */
    async findByName(nombre: string): Promise<Tenant | null> {
        return this.tenantRepo
            .createQueryBuilder('tenant')
            .where('LOWER(tenant.nombre) = LOWER(:nombre)', { nombre })
            .leftJoinAndSelect('tenant.owner', 'owner')
            .getOne();
    }

    /**
     * Mapeo de dominios a nombres de tenants
     */
    private readonly domainMap: Record<string, string> = {
        'localhost': 'Lala',
        'localhost:5173': 'Lala',
        'dev.sozu.com': 'Sozu',
        'sozu.com': 'Sozu',
        // Local environments
        'abarrotes.local': 'Tienda Don Jose',
        'ferreteria.local': 'Ferretería El Tornillo',
        'restaurante.local': 'Restaurante El Sazón',
        'miselania.local': 'Miselania Maria',
        'api-industria.local': 'API PARA LA INDUSTRIA',
        // Production environments (LOWERCASE KEYS)
        'donjose.store.drcv.site': 'Tienda Don Jose',
        'eltornillo.store.drcv.site': 'Ferretería El Tornillo',
        'elsazon.store.drcv.site': 'Restaurante El Sazón',
        'miselaniamaria.store.drcv.site': 'Miselania Maria',
        'apidelaindustria.store.drcv.site': 'API PARA LA INDUSTRIA',
    };

    /**
     * Buscar tenant por dominio
     */
    async findByDomain(domain: string): Promise<Tenant> {
        // Limpiar puerto y convertir a minúsculas
        const cleanDomain = domain.split(':')[0].toLowerCase();

        // Buscar coincidencia exacta (con puerto) o solo dominio (sin puerto)
        const tenantName = this.domainMap[domain.toLowerCase()] || this.domainMap[cleanDomain] || this.domainMap['localhost'];

        if (!tenantName) {
            throw new NotFoundException(`Tenant no encontrado para dominio: ${domain}`);
        }

        const tenant = await this.findByName(tenantName);

        if (!tenant) {
            throw new NotFoundException(`Tenant "${tenantName}" no encontrado en base de datos`);
        }

        return tenant;
    }
}
