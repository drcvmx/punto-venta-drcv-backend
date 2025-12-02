import { Injectable, Logger } from '@nestjs/common';
import { Client, LocalAuth, MessageMedia } from 'whatsapp-web.js';
import * as qrcode from 'qrcode-terminal';
import { TicketGeneratorService } from './ticket-generator.service';

@Injectable()
export class WhatsappService {
  private client: Client;
  private readonly logger = new Logger(WhatsappService.name);

  constructor(private readonly ticketGenerator: TicketGeneratorService) {
    // Build puppeteer config conditionally
    const puppeteerConfig: any = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ],
    };

    // Only set executablePath if explicitly provided via env variable
    // This allows dev environments to use Puppeteer's bundled Chrome
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      puppeteerConfig.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    this.client = new Client({
      authStrategy: new LocalAuth({ clientId: 'bot-ventas' }),
      puppeteer: puppeteerConfig,
      // FIX: Lock WhatsApp Web version to a compatible one to avoid 'getChat' undefined errors
      webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
      },
      authTimeoutMs: 60000, // Wait 60s for auth
    });

    this.client.on('qr', (qr: string) => {
      this.logger.warn('⚠️ ESCANEA EL CÓDIGO QR EN LA TERMINAL ⚠️');
      qrcode.generate(qr, { small: true });
    });

    this.client.on('ready', () => {
      this.logger.log('✅ WhatsApp está conectado y listo para enviar tickets!');
    });

    this.client.on('auth_failure', (msg: string) => {
      this.logger.error('❌ Fallo de autenticación', msg);
    });

    this.client.initialize();
  }

  async enviarMensaje(numero: string, mensaje: string): Promise<boolean> {
    try {
      const chatId = await this.resolveChatId(numero);
      if (!chatId) return false;

      await this.client.sendMessage(chatId, mensaje);
      this.logger.log(`Mensaje enviado a ${numero}`);
      return true;
    } catch (error) {
      this.logger.error(`Error enviando mensaje a ${numero}`, error);
      return false;
    }
  }

  async enviarTicket(numero: string, order: any, storeName: string): Promise<boolean> {
    try {
      const chatId = await this.resolveChatId(numero);
      if (!chatId) return false;

      const imageBuffer = await this.ticketGenerator.generateTicketImage(order, storeName);
      const media = new MessageMedia('image/png', imageBuffer.toString('base64'), 'ticket.png');

      const caption = `🧾 *Ticket de Compra - ${storeName}*\n\nHola ${order.customerName || 'Cliente'}, gracias por tu compra.\n🆔 Orden: *${order.collectionCode}*\n\nPresenta la imagen adjunta en caja para recoger tu pedido.`;

      await this.client.sendMessage(chatId, media, { caption });
      this.logger.log(`Ticket visual enviado a ${numero}`);
      return true;
    } catch (error) {
      this.logger.error(`Error enviando ticket visual a ${numero}`, error);
      return false;
    }
  }

  private async resolveChatId(numero: string): Promise<string | null> {
    // Limpiar el número de caracteres no numéricos
    const numeroLimpio = numero.replace(/\D/g, '');

    // Intentar obtener el ID formateado correctamente desde WhatsApp
    // Probamos primero con el código de país 52 (México) si son 10 dígitos
    let candidateNumber = numeroLimpio;
    if (candidateNumber.length === 10) {
      candidateNumber = `52${candidateNumber}`;
    }

    try {
      // getNumberId devuelve el ID serializado correcto (incluyendo @c.us y correcciones de 521)
      const contact = await this.client.getNumberId(candidateNumber);

      if (!contact) {
        this.logger.warn(`El número ${numero} (probado como ${candidateNumber}) no está registrado en WhatsApp.`);
        // Fallback: Intentar construir el ID manualmente si getNumberId falla o no encuentra
        // Para México, a veces se requiere '521' en lugar de '52' para cuentas personales
        return `${candidateNumber}@c.us`;
      }

      return contact._serialized;
    } catch (error) {
      this.logger.warn(`Error al verificar número con WhatsApp (${error.message}). Usando fallback manual.`);
      // Fallback manual ante error de Puppeteer/WidFactory
      // Intentamos construir el ID estándar
      return `${candidateNumber}@c.us`;
    }
  }
}
