// backend/controllers/adminPayoutController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const axios = require('axios'); // 🔥 MOTOR DE PAGOS AUTOMÁTICOS
const PDFDocument = require('pdfkit'); // 🔥 GENERADOR DE PDF
const { Resend } = require('resend'); // 🔥 MOTOR DE CORREOS
const resend = new Resend(process.env.RESEND_API_KEY);

// ==========================================
// 📩 UTILIDAD: FABRICAR PDF EN MEMORIA (RAM)
// ==========================================
const createPdfBuffer = (withdrawal) => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    let buffers = [];
    
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    // --- DIBUJAR EL PDF ---
    doc.fontSize(22).font('Helvetica-Bold').fillColor('#22c55e').text('FANSMIO', { align: 'center' });
    doc.fontSize(12).font('Helvetica').fillColor('#000000').text('Comprobante de Liquidación Cripto', { align: 'center' });
    doc.moveDown(2);

    doc.fontSize(10).font('Helvetica-Bold').text('Detalles del Emisor:');
    doc.font('Helvetica').text('Fansmio Inc.');
    doc.text('https://fansmio.com');
    doc.moveDown();

    doc.font('Helvetica-Bold').text('Detalles del Beneficiario:');
    doc.font('Helvetica').text(`Usuario: @${withdrawal.creator?.username || 'Creador'}`);
    doc.text(`ID: ${withdrawal.creatorId || withdrawal.userId}`);
    doc.moveDown();

    doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#cccccc').stroke();
    doc.moveDown();

    doc.fontSize(14).font('Helvetica-Bold').text('Detalles de la Transacción', { align: 'center' });
    doc.moveDown();

    doc.fontSize(10).font('Helvetica-Bold').text('ID de Transacción: ', { continued: true }).font('Helvetica').text(withdrawal.id);
    doc.font('Helvetica-Bold').text('Hash de Red (TxHash): ', { continued: true }).font('Helvetica').text(withdrawal.txHash || 'Pendiente');
    doc.font('Helvetica-Bold').text('Fecha de Aprobación: ', { continued: true }).font('Helvetica').text(new Date().toLocaleString());
    doc.font('Helvetica-Bold').text('Estado: ', { continued: true }).font('Helvetica').text('COMPLETADO Y PAGADO');
    doc.font('Helvetica-Bold').text('Monto Pagado: ', { continued: true }).fillColor('#22c55e').text(`$${withdrawal.amount.toFixed(2)} USD`).fillColor('#000000');
    
    if (withdrawal.cryptoAddress) {
      doc.font('Helvetica-Bold').text('Billetera de Destino: ', { continued: true }).font('Helvetica').text(withdrawal.cryptoAddress);
    }

    doc.moveDown(2);
    doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#cccccc').stroke();
    doc.moveDown(2);

    doc.fontSize(9).font('Helvetica-Oblique').fillColor('gray')
       .text('Comprobante digital generado automáticamente. Fansmio no se hace responsable por direcciones de billetera incorrectas provistas por el usuario.', { align: 'center' });

    doc.end();
  });
};

// ==========================================
// 1. OBTENER RETIROS PENDIENTES
// ==========================================
exports.getPendingWithdrawals = async (req, res) => {
  try {
    const withdrawals = await prisma.withdrawal.findMany({
      where: { status: { in: ['PENDING', 'PROCESSING'] } },
      include: {
        creator: { 
          select: { 
            username: true, email: true,
            wallet: { select: { balance: true, pendingBalance: true, cryptoAddress: true } }
          } 
        }
      },
      orderBy: { createdAt: 'asc' } 
    });
    res.status(200).json({ withdrawals });
  } catch (error) {
    res.status(500).json({ error: "Error interno del servidor." });
  }
};

// ==========================================
// 🚀 2. APROBAR Y DISPARAR PAGO AUTOMÁTICO
// ==========================================
exports.approveWithdrawal = async (req, res) => {
  try {
    const withdrawalId = req.params.withdrawalId || req.body.withdrawalId || req.body.id;
    if (!withdrawalId) return res.status(400).json({ error: 'ID de retiro no proporcionado.' });

    const withdrawal = await prisma.withdrawal.findUnique({ 
      where: { id: withdrawalId }, include: { creator: true } 
    });

    if (!withdrawal || (withdrawal.status !== 'PENDING' && withdrawal.status !== 'PROCESSING')) {
      return res.status(400).json({ error: 'El retiro no existe o ya fue procesado.' });
    }

    // 🌐 1. CONEXIÓN A TU INSTANCIA PRIVADA (COVRA PAY EN RED BASE)
    // ==============================================================
    let txHashGenerado = '';
    
    try {
      // Usamos tu BASE_URL (https://covrapay.com:8443) desde el entorno
      const apiResponse = await axios.post(`${process.env.PAYRAM_BASE_URL}/api/payouts`, {
        amount: withdrawal.amount,
        address: withdrawal.cryptoAddress || withdrawal.creator?.wallet?.cryptoAddress,
        currency: 'USDC',  // 🎯 Ajustado a tu configuración en Base
        network: 'Base'    // 🎯 Ajustado a tu red activa
      }, {
        headers: { 
          'Authorization': `Bearer ${process.env.PAYMENT_GATEWAY_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });
      
      // Capturamos el Hash real de la red Base
      txHashGenerado = apiResponse.data.transactionHash || apiResponse.data.id;
    } catch (gatewayError) {
      // Log detallado para ver el pecado exacto en la terminal de Coolify
      console.error("🚨 Error en pasarela Covra (Base):", gatewayError.response?.data || gatewayError.message);
      
      return res.status(502).json({ 
        error: "La pasarela rechazó la transacción.",
        details: gatewayError.response?.data?.message || "Verifica fondos en la red Base."
      });
    }
    // ==============================================================
    // 💾 2. ACTUALIZACIÓN EN BASE DE DATOS (ATÓMICA)
    await prisma.$transaction(async (tx) => {
      // Marcar el retiro como pagado con el Hash real
      await tx.withdrawal.update({
        where: { id: withdrawalId },
        data: { status: 'PAID', txHash: txHashGenerado, adminNotes: 'Pago Automático vía API completado.' }
      });

      // Restar la deuda de la cuarentena (pendingBalance)
      await tx.wallet.update({
        where: { userId: withdrawal.creatorId },
        data: { pendingBalance: { decrement: withdrawal.amount } } 
      });

      // Cerrar la transacción PENDING original
      const pendingTransaction = await tx.transaction.findFirst({
        where: { senderId: withdrawal.creatorId, type: 'PAYOUT', status: 'PENDING', amount: -withdrawal.amount },
        orderBy: { createdAt: 'desc' }
      });

      if (pendingTransaction) {
        await tx.transaction.update({
          where: { id: pendingTransaction.id },
          data: { status: 'COMPLETED', payAddress: txHashGenerado }
        });
      }

      // Notificar In-App al creador
      await tx.notification.create({
        data: {
          userId: withdrawal.creatorId, type: 'payout_approved',
          content: `✅ ¡Pago enviado! Tu retiro de $${withdrawal.amount} USD ha sido depositado en tu billetera.`,
          link: '/dashboard/wallet'
        }
      });
    });

    // 📧 3. GENERAR PDF Y ENVIAR POR EMAIL AL CREADOR
    if (withdrawal.creator?.email) {
      try {
        const withdrawalActualizado = { ...withdrawal, txHash: txHashGenerado };
        const pdfBuffer = await createPdfBuffer(withdrawalActualizado);
        
        await resend.emails.send({
          from: 'Fansmio Finanzas <pagos@fansmio.com>', 
          to: [withdrawal.creator.email],
          subject: "✅ ¡Tu dinero va en camino! Recibo de Retiro",
          html: `
            <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
              <h2 style="color: #22c55e;">¡Hola @${withdrawal.creator.username || 'Creador'}!</h2>
              <p>Tu retiro de <strong>$${withdrawal.amount.toFixed(2)} USD</strong> ha sido enviado con éxito a tu billetera a través de nuestra pasarela automatizada.</p>
              <p><strong>Hash de Transacción:</strong> ${txHashGenerado}</p>
              <p>Adjunto encontrarás tu comprobante digital en formato PDF.</p>
              <br>
              <p>Sigue creando. Sigue facturando.</p>
              <p><strong>El Equipo de Fansmio</strong></p>
            </div>
          `,
          attachments: [{ filename: `Fansmio_Recibo_${withdrawal.id.substring(0,8)}.pdf`, content: pdfBuffer }]
        });
      } catch (emailError) {
        console.error("⚠️ Error enviando el correo con Resend:", emailError);
      }
    }

    res.status(200).json({ message: 'Retiro procesado, pagado y notificado exitosamente. 💸' });

  } catch (error) {
    console.error("Error al aprobar retiro:", error);
    res.status(500).json({ error: "Fallo crítico al procesar el retiro." });
  }
};

// ==========================================
// 3. RECHAZAR RETIRO (Devolver fondos)
// ==========================================
exports.rejectWithdrawal = async (req, res) => {
  try {
    const withdrawalId = req.params.withdrawalId || req.body.withdrawalId || req.body.id;
    const adminNotes = req.body.adminNotes || req.body.reason || 'Retiro rechazado. Datos inválidos o sospecha de fraude.';

    if (!withdrawalId) return res.status(400).json({ error: 'ID de retiro no proporcionado.' });

    const withdrawal = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });

    if (!withdrawal || (withdrawal.status !== 'PENDING' && withdrawal.status !== 'PROCESSING')) {
      return res.status(400).json({ error: 'El retiro no existe o ya fue procesado.' });
    }

    await prisma.$transaction(async (tx) => {
      // 1. Marcar el retiro como rechazado
      await tx.withdrawal.update({
        where: { id: withdrawalId },
        data: { status: 'REJECTED', adminNotes }
      });

      // 2. Devolver el dinero de la cuarentena al saldo disponible
      await tx.wallet.update({
        where: { userId: withdrawal.creatorId },
        data: { 
          balance: { increment: withdrawal.amount },
          pendingBalance: { decrement: withdrawal.amount } 
        }
      });

      // 3. Cancelar la transacción PENDING
      const pendingTransaction = await tx.transaction.findFirst({
        where: { senderId: withdrawal.creatorId, type: 'PAYOUT', status: 'PENDING', amount: -withdrawal.amount },
        orderBy: { createdAt: 'desc' }
      });

      if (pendingTransaction) {
        await tx.transaction.update({
          where: { id: pendingTransaction.id },
          data: { status: 'FAILED' }
        });
      }

      // 4. Notificar al creador In-App
      await tx.notification.create({
        data: {
          userId: withdrawal.creatorId, type: 'payout_rejected',
          content: `❌ Retiro rechazado ($${withdrawal.amount}). Motivo: ${adminNotes}`,
          link: '/dashboard/wallet'
        }
      });
    });

    res.status(200).json({ message: 'Retiro rechazado. El saldo volvió a la billetera del creador. 🛡️' });

  } catch (error) {
    console.error("Error al rechazar retiro:", error);
    res.status(500).json({ error: "Error interno al procesar el rechazo." });
  }
};