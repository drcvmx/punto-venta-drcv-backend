import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { Producto } from './entities/producto.entity';
import { Variante } from './entities/variante.entity';
import { CreateProductoDto } from './dto/create-producto.dto';
import { UpdateProductoDto } from './dto/update-producto.dto';
import { RegistroRapidoDto } from './dto/registro-rapido.dto';
import { ProductRequest, RequestStatus, RequestType } from './entities/product-request.entity';
import { GlobalProduct } from './entities/global-product.entity';

import { ProductAudit } from './entities/product-audit.entity';

@Injectable()
export class CatalogoService {
    constructor(
        @InjectRepository(Producto)
        private productoRepo: Repository<Producto>,
        @InjectRepository(Variante)
        private varianteRepo: Repository<Variante>,
        @InjectRepository(ProductRequest)
        private requestRepo: Repository<ProductRequest>,
        @InjectRepository(GlobalProduct)
        private globalRepo: Repository<GlobalProduct>,
        @InjectRepository(ProductAudit)
        private auditRepo: Repository<ProductAudit>,
    ) { }

    private async logAudit(tenantId: string, userId: string, productId: string, action: 'CREATE' | 'UPDATE' | 'DELETE', changes: any) {
        const audit = this.auditRepo.create({
            tenantId,
            userId,
            productId,
            action,
            changes
        });
        await this.auditRepo.save(audit);
    }

    async search(tenantId: string, query: string) {
        return this.productoRepo.find({
            where: [
                { tenantId, nombre: ILike(`%${query}%`) },
                { tenantId, marca: ILike(`%${query}%`) },
                { tenantId, categoria: ILike(`%${query}%`) },
                { tenantId, codigoBarras: ILike(`%${query}%`) }, // Búsqueda parcial por si acaso
            ],
            relations: ['variantes', 'variantes.inventario'],
            take: 10,
        });
    }

    async getAllProducts(tenantId: string) {
        return this.productoRepo.find({
            where: { tenantId },
            relations: ['variantes', 'variantes.inventario'],
            order: { nombre: 'ASC' },
        });
    }

    async createProductoConVariantes(tenantId: string, createProductoDto: CreateProductoDto, userId?: string) {
        const producto = this.productoRepo.create({
            tenantId,
            nombre: createProductoDto.nombre,
            descripcion: createProductoDto.descripcion,
            imagenUrl: createProductoDto.imagenUrl,
            marca: createProductoDto.marca,
            categoria: createProductoDto.categoria,
            proveedor: createProductoDto.proveedor,
        });

        const savedProducto = await this.productoRepo.save(producto);

        const variantes = createProductoDto.variantes.map(varianteDto => {
            const varianteData: Partial<Variante> = {
                tenantId,
                productoId: savedProducto.id,
                nombreVariante: varianteDto.nombreVariante,
                precio: varianteDto.precio,
                costo: varianteDto.costo,
                unidadMedida: varianteDto.unidadMedida,
                trackStock: varianteDto.trackStock ?? true,
            };

            if (varianteDto.codigoBarras) varianteData.codigoBarras = varianteDto.codigoBarras;
            if (varianteDto.codigoQr) varianteData.codigoQr = varianteDto.codigoQr;
            if (varianteDto.tipoCodigo) varianteData.tipoCodigo = varianteDto.tipoCodigo;

            return this.varianteRepo.create(varianteData);
        });

        const savedVariantes = await this.varianteRepo.save(variantes);

        if (userId) {
            await this.logAudit(tenantId, userId, savedProducto.id, 'CREATE', {
                producto: savedProducto,
                variantes: savedVariantes
            });
        }

        return {
            ...savedProducto,
            variantes: savedVariantes,
        };
    }

    async updateProducto(id: string, tenantId: string, updateDto: UpdateProductoDto, userId: string) {
        const producto = await this.productoRepo.findOne({
            where: { id, tenantId },
            relations: ['variantes'],
        });

        if (!producto) {
            throw new NotFoundException('Producto no encontrado');
        }

        const oldData = JSON.parse(JSON.stringify(producto));

        // Actualizar campos del producto
        if (updateDto.nombre) producto.nombre = updateDto.nombre;
        if (updateDto.descripcion !== undefined) producto.descripcion = updateDto.descripcion;
        if (updateDto.imagenUrl !== undefined) producto.imagenUrl = updateDto.imagenUrl;
        if (updateDto.marca !== undefined) producto.marca = updateDto.marca;
        if (updateDto.categoria !== undefined) producto.categoria = updateDto.categoria;
        if (updateDto.proveedor !== undefined) producto.proveedor = updateDto.proveedor;

        await this.productoRepo.save(producto);

        // Actualizar variante principal (asumimos la primera por ahora para edición rápida)
        if (producto.variantes && producto.variantes.length > 0) {
            const variante = producto.variantes[0];
            let varianteUpdated = false;

            if (updateDto.precio !== undefined) {
                variante.precio = updateDto.precio;
                varianteUpdated = true;
            }
            if (updateDto.costo !== undefined) {
                variante.costo = updateDto.costo;
                varianteUpdated = true;
            }
            if (updateDto.codigoBarras !== undefined) {
                variante.codigoBarras = updateDto.codigoBarras;
                varianteUpdated = true;
            }

            if (varianteUpdated) {
                await this.varianteRepo.save(variante);
            }
        }

        const newData = await this.productoRepo.findOne({
            where: { id, tenantId },
            relations: ['variantes'],
        });

        await this.logAudit(tenantId, userId, id, 'UPDATE', {
            before: oldData,
            after: newData,
            changes: updateDto
        });

        return newData;
    }

    async deleteProducto(id: string, tenantId: string, userId: string) {
        const producto = await this.productoRepo.findOne({
            where: { id, tenantId },
        });

        if (!producto) {
            throw new Error('Product not found or does not belong to this tenant');
        }

        await this.varianteRepo.delete({ productoId: id, tenantId });
        await this.productoRepo.delete({ id, tenantId });

        await this.logAudit(tenantId, userId, id, 'DELETE', {
            deletedProduct: producto
        });

        return { message: 'Product deleted successfully' };
    }

    async buscarPorCodigo(tenantId: string, codigo: string) {
        const variantes = await this.varianteRepo.find({
            where: [
                { tenantId, codigoBarras: codigo },
                { tenantId, codigoQr: codigo },
            ],
            relations: ['producto'],
        });

        if (variantes.length > 0) {
            const productoId = variantes[0].producto.id;
            return this.productoRepo.findOne({
                where: { id: productoId, tenantId },
                relations: ['variantes'],
            });
        }

        // Si no se encuentra localmente, buscar en el catálogo global
        const globalProduct = await this.globalRepo.findOne({
            where: { codigoBarras: codigo }
        });

        if (globalProduct) {
            return {
                isGlobal: true,
                nombre: globalProduct.nombre,
                descripcion: globalProduct.descripcion,
                imagenUrl: globalProduct.imagenUrl,
                marca: globalProduct.marca,
                categoria: globalProduct.categoria,
                codigoBarras: globalProduct.codigoBarras,
                // No retornamos ID ni variantes porque aún no existe en el tenant
            };
        }

        return null;
    }

    async registroRapido(tenantId: string, dto: RegistroRapidoDto) {
        const existente: any = await this.buscarPorCodigo(tenantId, dto.codigoEscaneado);

        // Solo lanzar error si existe Y NO es un resultado del catálogo global
        // Si es global (isGlobal: true), permitimos el registro para "importarlo" al tenant
        if (existente && !existente.isGlobal) {
            throw new Error('El código ya está registrado en este negocio');
        }

        const producto = this.productoRepo.create({
            tenantId,
            nombre: dto.nombre,
            descripcion: dto.descripcion,
            marca: dto.marca,
            categoria: dto.categoria,
            proveedor: dto.proveedor,
            imagenUrl: dto.imagenUrl,
        });

        const savedProducto = await this.productoRepo.save(producto);

        const varianteData: Partial<Variante> = {
            tenantId,
            productoId: savedProducto.id,
            nombreVariante: dto.nombreVariante || 'Presentación Única',
            precio: dto.precio,
            costo: dto.costo,
            unidadMedida: dto.unidadMedida,
            trackStock: true,
        };

        if (dto.tipoCodigo === 'BARRAS') {
            varianteData.codigoBarras = dto.codigoEscaneado;
            varianteData.tipoCodigo = 'BARRAS';
        } else if (dto.tipoCodigo === 'QR') {
            varianteData.codigoQr = dto.codigoEscaneado;
            varianteData.tipoCodigo = 'QR';
        }

        const variante = this.varianteRepo.create(varianteData);
        const savedVariante = await this.varianteRepo.save(variante);

        return {
            producto: savedProducto,
            variante: savedVariante
        };
    }

    /**
     * Buscar producto global por código de barras (exacto)
     */
    async findGlobalByBarcode(barcode: string) {
        const cleanBarcode = barcode.trim();
        return this.globalRepo.findOne({
            where: { codigoBarras: cleanBarcode }
        });
    }

    /**
     * Buscar productos globales por texto (nombre, marca, categoría, código)
     */
    async searchGlobalProducts(query: string, businessType?: string) {
        const whereConditions: any[] = [
            { nombre: ILike(`%${query}%`) },
            { marca: ILike(`%${query}%`) },
            { categoria: ILike(`%${query}%`) },
            { codigoBarras: ILike(`%${query}%`) },
        ];

        let where = whereConditions;
        if (businessType) {
            where = whereConditions.map(cond => ({ ...cond, businessType }));
        }

        return this.globalRepo.find({
            where,
            take: 20,
            order: { nombre: 'ASC' }
        });
    }

    /**
     * Obtener todos los productos globales (limitado)
     */
    async findAllGlobalProducts(businessType?: string) {
        const where: any = {};
        if (businessType) {
            where.businessType = businessType;
        }
        return this.globalRepo.find({
            where,
            take: 50,
            order: { nombre: 'ASC' }
        });
    }

    /**
     * Obtener producto global por ID
     */
    async findGlobalById(id: string) {
        return this.globalRepo.findOne({ where: { id } });
    }

    async createProductFromGlobal(
        tenantId: string,
        globalProductId: string,
        precioBase: number,
        costo?: number,
        unidadMedida?: string,
        nombreVariante?: string
    ) {
        const globalProduct = await this.findGlobalById(globalProductId);

        if (!globalProduct) {
            throw new NotFoundException('Producto no encontrado en catálogo global');
        }

        // Crear producto local con datos del global
        const producto = this.productoRepo.create({
            tenantId,
            nombre: globalProduct.nombre,
            descripcion: globalProduct.descripcion,
            marca: globalProduct.marca,
            categoria: globalProduct.categoria,
            imagenUrl: globalProduct.imagenUrl,
            codigoBarras: globalProduct.codigoBarras,
            globalProductId: globalProduct.id,
        });

        const savedProducto = await this.productoRepo.save(producto);

        // Crear variante con precio especificado
        const variante = this.varianteRepo.create({
            tenantId,
            productoId: savedProducto.id,
            nombreVariante: nombreVariante || 'Estándar',
            precio: precioBase,
            costo: costo,
            unidadMedida: unidadMedida || 'PZA',
            trackStock: true,
            codigoBarras: globalProduct.codigoBarras,
        });

        const savedVariante = await this.varianteRepo.save(variante);

        return {
            ...savedProducto,
            variantes: [savedVariante],
        };
    }

    /**
     * Búsqueda simple en catálogo global (legacy)
     */
    async searchGlobal(query: string) {
        return this.globalRepo.find({
            where: [
                { nombre: ILike(`%${query}%`) },
                { codigoBarras: query }
            ],
            take: 5
        });
    }

    async createRequest(tenantId: string, userId: string, type: RequestType, payload: any) {
        const request = this.requestRepo.create({
            tenantId,
            userId,
            type,
            payload,
            status: RequestStatus.PENDING
        });
        return this.requestRepo.save(request);
    }

    async getRequests(tenantId: string) {
        return this.requestRepo.find({
            where: { tenantId, status: RequestStatus.PENDING },
            order: { createdAt: 'DESC' }
        });
    }

    /**
     * Get variant with product and inventario for order validation
     */
    async getVariantForOrder(variantId: string) {
        const variant = await this.varianteRepo.findOne({
            where: { id: variantId },
            relations: ['producto', 'inventario']
        });

        if (!variant) {
            throw new NotFoundException(`Variante ${variantId} no encontrada`);
        }

        return variant;
    }

    async approveRequest(tenantId: string, requestId: string, adminId: string) {
        const request = await this.requestRepo.findOne({ where: { id: requestId, tenantId } });
        if (!request) throw new NotFoundException('Solicitud no encontrada');

        if (request.type === RequestType.NEW_PRODUCT) {
            await this.createProductoConVariantes(tenantId, request.payload);
        } else if (request.type === RequestType.PRICE_CHANGE) {
            // TODO: Implement price update logic
        }

        request.status = RequestStatus.APPROVED;
        request.adminNotes = `Aprobado por ${adminId}`;
        return this.requestRepo.save(request);
    }

    async validateStock(items: any[]) {
        for (const item of items) {
            const variant = await this.varianteRepo.findOne({
                where: { id: item.variantId },
                relations: ['inventario', 'producto']
            });

            if (variant && variant.trackStock && variant.inventario && variant.inventario.length > 0) {
                const totalStock = variant.inventario.reduce((sum, inv) => sum + inv.cantidad, 0);
                if (totalStock < item.quantity) {
                    throw new Error(`Stock insuficiente para ${variant.producto.nombre}. Disponible: ${totalStock}, Solicitado: ${item.quantity}`);
                }
            }
        }
    }

    async deductStock(items: any[]) {
        for (const item of items) {
            const variant = await this.varianteRepo.findOne({
                where: { id: item.variantId },
                relations: ['inventario']
            });

            if (variant && variant.trackStock && variant.inventario && variant.inventario.length > 0) {
                // Descontar del primer registro de inventario (FIFO simple por ahora)
                // TODO: Mejorar lógica para múltiples almacenes o lotes
                const inventario = variant.inventario[0];
                inventario.cantidad -= item.quantity;

                // Evitar negativos si se desea, o permitirlo
                if (inventario.cantidad < 0) inventario.cantidad = 0;

                // Guardar inventario actualizado (usando query builder o repo del inventario si estuviera inyectado, 
                // pero como es relación cascade o update directo...)
                // Necesitamos el repo de Inventario o guardar la variante si cascade funciona.
                // Como no tengo InventarioRepo inyectado aquí, voy a asumir que TypeORM maneja el cascade update 
                // si guardo la variante, PERO Inventario suele ser una entidad separada.
                // Mejor inyectar InventarioRepo si es posible, o usar query runner.
                // Por simplicidad y seguridad, usaré query directo para actualizar.

                await this.varianteRepo.manager.getRepository('Inventario').save(inventario);
            }
        }
    }

    async getLowStockProducts(tenantId: string) {
        return this.varianteRepo.createQueryBuilder('variante')
            .select([
                'producto.nombre AS "productName"',
                'variante.nombreVariante AS "variantName"',
                'SUM(inventario.cantidad) AS "stock"'
            ])
            .innerJoin('variante.producto', 'producto')
            .innerJoin('variante.inventario', 'inventario')
            .where('variante.tenantId = :tenantId', { tenantId })
            .andWhere('variante.trackStock = :trackStock', { trackStock: true })
            .groupBy('producto.nombre, variante.nombreVariante')
            .having('SUM(inventario.cantidad) < :threshold', { threshold: 5 })
            .getRawMany();
    }
}
