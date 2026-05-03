// backend/controllers/adminController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// 🔥 NUEVAS IMPORTACIONES: PDF Y RESEND
const PDFDocument = require('pdfkit');
const { Resend } = require('resend');
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
    doc.fontSize(12).font('Helvetica').fillColor('#000000').text('Comprobante de Liquidación (Payout Receipt)', { align: 'center' });
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
    doc.font('Helvetica-Bold').text('Fecha de Aprobación: ', { continued: true }).font('Helvetica').text(new Date().toLocaleString());
    doc.font('Helvetica-Bold').text('Estado: ', { continued: true }).font('Helvetica').text('COMPLETADO Y PAGADO');
    doc.font('Helvetica-Bold').text('Monto Pagado: ', { continued: true }).fillColor('#22c55e').text(`$${withdrawal.amount.toFixed(2)} USD`).fillColor('#000000');
    
    if (withdrawal.cryptoAddress) {
      doc.font('Helvetica-Bold').text('Billetera: ', { continued: true }).font('Helvetica').text(withdrawal.cryptoAddress);
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
// 1. BANEAR O SUSPENDER USUARIOS
// ==========================================
exports.changeUserStatus = async (req, res) => {
  try {
    const targetId = req.body.targetUserId || req.body.userId || req.body.id;
    const statusToApply = req.body.newStatus || req.body.status;
    const notes = req.body.adminNotes || req.body.reason;

    if (!targetId || !statusToApply) {
      return res.status(400).json({ error: 'Faltan datos obligatorios (userId o status).' });
    }

    const validStatuses = ['ACTIVE', 'SUSPENDED', 'BANNED', 'SHADOWBANNED'];
    if (!validStatuses.includes(statusToApply)) {
      return res.status(400).json({ error: 'Estado inválido. Usa: ACTIVE, SUSPENDED, BANNED o SHADOWBANNED.' });
    }

    const updatedUser = await prisma.user.update({
      where: { id: targetId },
      data: { status: statusToApply, adminNotes: notes || null }
    });

    res.status(200).json({ 
      message: `El estado del usuario ahora es: ${statusToApply} 🥷`, 
      user: { email: updatedUser.email, status: updatedUser.status } 
    });
  } catch (error) {
    console.error('Error al cambiar estado del usuario:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ==========================================
// 2. AJUSTAR LAS COMISIONES DE LA PLATAFORMA (🔥 CORREGIDO)
// ==========================================
exports.updatePlatformFee = async (req, res) => {
  try {
    // 1. Atrapamos las 6 variables exactas que manda tu Frontend
    const { 
      feeSubscription, 
      feePPV, 
      feeTips, 
      feeLive, 
      feeWithdrawalStd, 
      feeWithdrawalExp 
    } = req.body; 

    // 2. Las guardamos en las columnas correspondientes en la Base de Datos
    const settings = await prisma.platformSetting.upsert({
      where: { id: 'global_settings' },
      update: { 
        feeSubscription: feeSubscription !== undefined ? Number(feeSubscription) : undefined,
        feePPV: feePPV !== undefined ? Number(feePPV) : undefined,
        feeTips: feeTips !== undefined ? Number(feeTips) : undefined,
        feeLive: feeLive !== undefined ? Number(feeLive) : undefined,
        feeWithdrawalStd: feeWithdrawalStd !== undefined ? Number(feeWithdrawalStd) : undefined,
        feeWithdrawalExp: feeWithdrawalExp !== undefined ? Number(feeWithdrawalExp) : undefined,
      },
      create: { 
        id: 'global_settings', 
        feeSubscription: Number(feeSubscription) || 20,
        feePPV: Number(feePPV) || 20,
        feeTips: Number(feeTips) || 20,
        feeLive: Number(feeLive) || 30,
        feeWithdrawalStd: Number(feeWithdrawalStd) || 2,
        feeWithdrawalExp: Number(feeWithdrawalExp) || 5,
      }
    });

    res.status(200).json({ message: 'Comisiones de la plataforma actualizadas 💰', settings });
  } catch (error) {
    console.error('Error al actualizar comisiones:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ==========================================
// 3. VER REPORTES (Moderar contenido)
// ==========================================
exports.getReports = async (req, res) => {
  try {
    const reports = await prisma.report.findMany({
      where: { status: 'PENDING' },
      include: {
        reporter: { select: { email: true, username: true } },
        reportedUser: { select: { email: true, username: true } }
      }
    });

    res.status(200).json({ message: 'Reportes pendientes 📋', total: reports.length, reports });
  } catch (error) {
    console.error('Error al obtener reportes:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ==========================================
// 3.5. RESOLVER O CERRAR REPORTES (Moderar contenido)
// ==========================================
exports.resolveReport = async (req, res) => {
  try {
    const reportId = req.body.reportId || req.body.id;
    const newStatus = req.body.newStatus || req.body.status;
    const adminMessage = req.body.adminMessage || req.body.message || ''; 

    if (newStatus !== 'RESOLVED' && newStatus !== 'DISMISSED') {
      return res.status(400).json({ error: 'Estado inválido. Usa RESOLVED o DISMISSED.' });
    }

    const report = await prisma.report.findUnique({
      where: { id: reportId },
      include: { reporter: true }
    });

    if (!report) return res.status(404).json({ error: 'Reporte no encontrado.' });

    await prisma.report.update({
      where: { id: reportId },
      data: { status: newStatus }
    });

    const reasonText = report.reason || 'Reporte de moderación';
    const tituloReporte = reasonText.split(' | '); 
    const estadoTexto = newStatus === 'RESOLVED' ? 'Resuelto ✅' : 'Descartado ❌';
    let mensajeNotificacion = `Tu reporte sobre "${tituloReporte}" ha sido ${estadoTexto}.`;
    
    if (adminMessage && adminMessage.trim() !== '') {
      mensajeNotificacion += ` Mensaje del Admin: "${adminMessage}"`;
    }

    const newNotif = await prisma.notification.create({
      data: {
        userId: report.reporterId,
        type: 'system', 
        content: mensajeNotificacion,
        link: '/dashboard/notifications' 
      }
    });

    const io = req.app.get('io');
    if (io) {
      io.to(report.reporterId).emit('new_notification', newNotif);
    }

    res.status(200).json({ message: 'Reporte actualizado y usuario notificado exitosamente 🧹' });
  } catch (error) {
    console.error('Error al resolver reporte:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ==========================================
// 4. APROBAR O RECHAZAR RETIROS DE CREADORES
// ==========================================
exports.handleWithdrawal = async (req, res) => {
  try {
    const wId = req.body.withdrawalId || req.body.id; 
    const statusToApply = req.body.newStatus || req.body.status;
    const notes = req.body.adminNotes || req.body.reason || '';

    if (!wId || !statusToApply) {
      return res.status(400).json({ error: 'Faltan datos obligatorios (id del retiro o status).' });
    }

    const validStatuses = ['PENDING', 'APPROVED', 'REJECTED', 'PAID'];
    if (!validStatuses.includes(statusToApply)) return res.status(400).json({ error: 'Estado de retiro inválido.' });

    const withdrawal = await prisma.withdrawal.findUnique({ 
      where: { id: wId },
      include: { creator: true } 
    });
    
    if (!withdrawal) return res.status(404).json({ error: 'Retiro no encontrado.' });
    
    if (withdrawal.status !== 'PENDING' && withdrawal.status !== 'APPROVED') {
      return res.status(400).json({ error: 'Este retiro ya fue procesado previamente.' });
    }

    const creatorId = withdrawal.creatorId || withdrawal.userId;

    await prisma.$transaction(async (tx) => {
      await tx.withdrawal.update({
        where: { id: wId },
        data: { status: statusToApply, adminNotes: notes || null }
      });

      if (statusToApply === 'REJECTED') {
        await tx.wallet.update({
          where: { userId: creatorId },
          data: { balance: { increment: withdrawal.amount } }
        });
      }
    });

    if ((statusToApply === 'APPROVED' || statusToApply === 'PAID') && withdrawal.creator?.email) {
      try {
        const pdfBuffer = await createPdfBuffer(withdrawal);
        
        await resend.emails.send({
          from: 'Fansmio Finanzas <pagos@fansmio.com>', 
          to: [withdrawal.creator.email],
          subject: "✅ ¡Tu retiro de Fansmio ha sido procesado!",
          html: `
            <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
              <h2 style="color: #22c55e;">¡Hola @${withdrawal.creator.username || 'Creador'}!</h2>
              <p>Te informamos que tu solicitud de retiro por la cantidad de <strong>$${withdrawal.amount.toFixed(2)} USD</strong> ha sido procesada con éxito.</p>
              <p>Los fondos han sido gestionados para ser enviados a tu billetera Cripto.</p>
              <p>Adjunto a este correo encontrarás el comprobante de liquidación oficial en formato PDF para tus registros financieros o fiscales.</p>
              <br>
              <p>Sigue creando. Sigue facturando.</p>
              <p><strong>El Equipo de Fansmio</strong></p>
            </div>
          `,
          attachments: [
            {
              filename: `Fansmio_Recibo_${withdrawal.id.substring(0,8)}.pdf`,
              content: pdfBuffer,
            }
          ]
        });
      } catch (emailError) {
        console.error("⚠️ Error enviando el correo con Resend:", emailError);
      }
    }

    res.status(200).json({ message: `Retiro actualizado a: ${statusToApply} 💸` });
  } catch (error) {
    console.error('Error al manejar retiro:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ==========================================
// 5. VER ESTADÍSTICAS GLOBALES (🔥 CORREGIDO)
// ==========================================
exports.getGlobalStats = async (req, res) => {
  try {
    const totalFans = await prisma.user.count({ where: { role: 'FAN' } });
    const totalCreators = await prisma.user.count({ where: { role: 'CREATOR' } });
    const totalPosts = await prisma.post.count();
    
    // Obtenemos TODAS las comisiones configuradas
    const settings = await prisma.platformSetting.findUnique({ where: { id: 'global_settings' } });

    res.status(200).json({
      message: 'Estadísticas Globales del Negocio 📊',
      stats: {
        totalFans,
        totalCreators,
        totalPosts,
        settings: settings || null // Devolvemos el paquete de settings completo para que el frontend lo lea
      }
    });
  } catch (error) {
    console.error('Error al obtener estadísticas:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ==========================================
// 6. OBTENER LISTA DE TODOS LOS USUARIOS (Para Banear)
// ==========================================
exports.getAllUsers = async (req, res) => {
  try {
    const adminId = req.user.userId;
    const users = await prisma.user.findMany({
      where: { id: { not: adminId } },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        status: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' }
    });

    res.status(200).json({ users });
  } catch (error) {
    console.error('Error al obtener usuarios:', error);
    res.status(500).json({ error: 'Error interno' });
  }
};

// ==========================================
// 7. OBTENER LISTA DE RETIROS PENDIENTES (Para pagar)
// ==========================================
exports.getAllWithdrawals = async (req, res) => {
  try {
    const withdrawals = await prisma.withdrawal.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        creator: { select: { email: true, username: true } }
      }
    });

    res.status(200).json({ withdrawals });
  } catch (error) {
    console.error('Error al obtener retiros:', error);
    res.status(500).json({ error: 'Error interno' });
  }
};

// ==========================================
// 8. LA BÓVEDA DEL COMANDANTE (Retirar Ganancias de FansMio)
// ==========================================
exports.getPlatformVaultBalance = async (req, res) => {
  try {
    const totalFeesAggr = await prisma.transaction.aggregate({
      where: { status: { in: ['COMPLETED', 'PENDING'] } },
      _sum: { platformFee: true }
    });
    const ingresosBrutos = totalFeesAggr._sum.platformFee || 0;

    const totalWithdrawnAggr = await prisma.platformWithdrawal.aggregate({
      _sum: { amount: true }
    });
    const totalRetirado = totalWithdrawnAggr._sum.amount || 0;

    const saldoDisponible = ingresosBrutos - totalRetirado;

    res.status(200).json({
      message: 'Estado de la Bóveda Central 🏦',
      ingresosBrutos,
      totalRetirado,
      saldoDisponible
    });
  } catch (error) {
    console.error('Error al leer la bóveda:', error);
    res.status(500).json({ error: 'Error interno al calcular ganancias.' });
  }
};

exports.withdrawPlatformProfit = async (req, res) => {
  try {
    const adminId = req.user.userId;
    const { amount, cryptoAddress, notes } = req.body;
    
    const withdrawalAmount = parseFloat(amount);

    if (!withdrawalAmount || withdrawalAmount <= 0) {
      return res.status(400).json({ error: 'Monto inválido.' });
    }

    const totalFeesAggr = await prisma.transaction.aggregate({
      where: { status: { in: ['COMPLETED', 'PENDING'] } },
      _sum: { platformFee: true }
    });
    const ingresosBrutos = totalFeesAggr._sum.platformFee || 0;

    const totalWithdrawnAggr = await prisma.platformWithdrawal.aggregate({
      _sum: { amount: true }
    });
    const totalRetirado = totalWithdrawnAggr._sum.amount || 0;

    const saldoDisponible = ingresosBrutos - totalRetirado;

    if (withdrawalAmount > saldoDisponible) {
      return res.status(400).json({ 
        error: `Fondos insuficientes. Solo tienes $${saldoDisponible.toFixed(2)} disponibles para retirar.` 
      });
    }

    const platformWithdrawal = await prisma.platformWithdrawal.create({
      data: {
        adminId: adminId,
        amount: withdrawalAmount,
        cryptoAddress: cryptoAddress || 'BINANCE_COLD_WALLET',
        notes: notes || 'Retiro de ganancias de la plataforma.'
      }
    });

    res.status(201).json({ 
      message: `¡Retiro exitoso! Has extraído $${withdrawalAmount} de la bóveda de FansMio. 💸`, 
      platformWithdrawal 
    });

  } catch (error) {
    console.error('Error al retirar ganancias:', error);
    res.status(500).json({ error: 'Error interno al procesar el retiro de la plataforma.' });
  }
};

// ==========================================
// 9. EXTRA: OBTENER SOLO LAS COMISIONES
// ==========================================
exports.getPlatformSettings = async (req, res) => {
  try {
    const settings = await prisma.platformSetting.findUnique({ where: { id: 'global_settings' } });
    res.status(200).json(settings || {});
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener comisiones' });
  }
};