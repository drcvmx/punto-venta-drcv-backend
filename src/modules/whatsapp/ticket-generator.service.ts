import { Injectable, Logger } from '@nestjs/common';
import * as puppeteer from 'puppeteer';

@Injectable()
export class TicketGeneratorService {
    private readonly logger = new Logger(TicketGeneratorService.name);

    async generateTicketImage(order: any, storeName: string): Promise<Buffer> {
        try {
            const browser = await puppeteer.launch({
                headless: true,
                // Forzamos la ruta donde sabemos que se instaló Chrome
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/home/opc/.cache/puppeteer/chrome/linux-142.0.7444.175/chrome-linux64/chrome',
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
            const page = await browser.newPage();

            // Simple HTML Template for the Ticket
            const htmlContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"></script>
                <style>
                    body { font-family: 'Courier New', Courier, monospace; width: 300px; padding: 20px; background: #fff; }
                    .header { text-align: center; margin-bottom: 20px; }
                    .store-name { font-size: 18px; font-weight: bold; }
                    .divider { border-top: 1px dashed #000; margin: 10px 0; }
                    .item { display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 14px; }
                    .total { display: flex; justify-content: space-between; font-weight: bold; font-size: 16px; margin-top: 10px; }
                    .footer { text-align: center; margin-top: 20px; font-size: 12px; }
                    .barcode-container { text-align: center; margin: 15px 0; }
                </style>
            </head>
            <body>
                <div class="header">
                    <div class="store-name">${storeName}</div>
                    <div>Ticket de Compra</div>
                </div>
                
                <div class="divider"></div>
                
                ${order.items.map((item: any) => `
                    <div class="item">
                        <span>${item.quantity}x ${item.productName || item.name || 'Producto'}</span>
                        <span>$${(item.price * item.quantity).toFixed(2)}</span>
                    </div>
                `).join('')}
                
                <div class="divider"></div>
                
                <div class="total">
                    <span>TOTAL</span>
                    <span>$${parseFloat(order.amount || order.totalAmount).toFixed(2)}</span>
                </div>

                <div class="barcode-container">
                    <svg id="barcode"></svg>
                </div>

                <div class="footer">
                    <p>Presenta este código en caja para recoger tu pedido.</p>
                    <p>¡Gracias por tu compra!</p>
                </div>

                <script>
                    JsBarcode("#barcode", "${order.collectionCode || order.id.slice(0, 12)}", {
                        format: "CODE128",
                        width: 2,
                        height: 50,
                        displayValue: true
                    });
                </script>
            </body>
            </html>
            `;

            await page.setContent(htmlContent);

            // Resize viewport to fit content
            const bodyHandle = await page.$('body');
            if (bodyHandle) {
                const { height } = await bodyHandle.boundingBox() || { height: 500 };
                await bodyHandle.dispose();
                await page.setViewport({ width: 340, height: Math.ceil(height) + 40 });
            }

            const screenshotBuffer = await page.screenshot({ type: 'png' });

            await browser.close();

            // Puppeteer returns Buffer | string, we cast to Buffer
            return Buffer.from(screenshotBuffer);
        } catch (error) {
            this.logger.error('Error generating ticket image', error);
            throw error;
        }
    }
}
