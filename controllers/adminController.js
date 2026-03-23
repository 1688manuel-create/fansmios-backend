// backend/controllers/adminController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ==========================================
// 1. BANEAR O SUSPENDER USUARIOS
// ==========================================
exports.changeUserStatus = async (req, res) => {
  try {
    // 🔥 BLINDAJE: Aceptamos ambos formatos de variables (del Frontend o Postman)
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
// 2. AJUSTAR LA COMISIÓN DE LA PLATAFORMA
// ==========================================
exports.updatePlatformFee = async (req, res) => {
  try {
    const { newFeePercent } = req.body; 

    if (newFeePercent < 0 || newFeePercent > 100) {
      return res.status(400).json({ error: 'La comisión debe estar entre 0 y 100.' });
    }

    const settings = await prisma.platformSetting.upsert({
      where: { id: 'global_settings' },
      update: { platformFeePercent: newFeePercent },
      create: { id: 'global_settings', platformFeePercent: newFeePercent }
    });

    res.status(200).json({ message: 'Comisión de la plataforma actualizada 💰', settings });
  } catch (error) {
    console.error('Error al actualizar comisión:', error);
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
        // 🔥 EL FIX: Ahora pedimos explícitamente el username además del email
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

    // Prevención de crash si el reason viene vacío
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
    // 🔥 BLINDAJE: Aceptamos ambos formatos de variables
    const wId = req.body.withdrawalId || req.body.id; 
    const statusToApply = req.body.newStatus || req.body.status;
    const notes = req.body.adminNotes || req.body.reason || '';

    if (!wId || !statusToApply) {
      return res.status(400).json({ error: 'Faltan datos obligatorios (id del retiro o status).' });
    }

    const validStatuses = ['PENDING', 'APPROVED', 'REJECTED', 'PAID'];
    if (!validStatuses.includes(statusToApply)) return res.status(400).json({ error: 'Estado de retiro inválido.' });

    const withdrawal = await prisma.withdrawal.findUnique({ where: { id: wId } });
    if (!withdrawal) return res.status(404).json({ error: 'Retiro no encontrado.' });
    
    if (withdrawal.status !== 'PENDING' && withdrawal.status !== 'APPROVED') {
      return res.status(400).json({ error: 'Este retiro ya fue procesado previamente.' });
    }

    // Determinamos el ID del creador sin importar cómo esté en la tabla
    const creatorId = withdrawal.creatorId || withdrawal.userId;

    await prisma.$transaction(async (tx) => {
      // 1. Actualizamos el estado del retiro
      await tx.withdrawal.update({
        where: { id: wId },
        data: { status: statusToApply, adminNotes: notes || null }
      });

      // 2. Si rechazamos, DEVOLVEMOS el dinero a la billetera del creador
      if (statusToApply === 'REJECTED') {
        await tx.wallet.update({
          where: { userId: creatorId },
          data: { balance: { increment: withdrawal.amount } }
        });
      }
    });

    res.status(200).json({ message: `Retiro actualizado a: ${statusToApply} 💸` });
  } catch (error) {
    console.error('Error al manejar retiro:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ==========================================
// 5. VER ESTADÍSTICAS GLOBALES
// ==========================================
exports.getGlobalStats = async (req, res) => {
  try {
    const totalFans = await prisma.user.count({ where: { role: 'FAN' } });
    const totalCreators = await prisma.user.count({ where: { role: 'CREATOR' } });
    const totalPosts = await prisma.post.count();
    
    const settings = await prisma.platformSetting.findUnique({ where: { id: 'global_settings' } });

    res.status(200).json({
      message: 'Estadísticas Globales del Negocio 📊',
      stats: {
        totalFans,
        totalCreators,
        totalPosts,
        currentPlatformFee: settings ? `${settings.platformFeePercent}%` : 'No configurada (Por defecto 20%)'
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