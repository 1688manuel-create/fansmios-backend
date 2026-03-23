// backend/controllers/adminPayoutController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ==========================================
// 1. VER TODAS LAS SOLICITUDES DE RETIRO (Panel Antifraude)
// ==========================================
exports.getPendingWithdrawals = async (req, res) => {
  try {
    const withdrawals = await prisma.withdrawal.findMany({
      where: { 
        status: { in: ['PENDING', 'PROCESSING'] } 
      },
      include: {
        creator: { 
          select: { 
            username: true, 
            email: true,
            wallet: { 
              select: { 
                balance: true, 
                pendingBalance: true 
              } 
            }
          } 
        }
      },
      orderBy: { createdAt: 'asc' } 
    });

    res.status(200).json({ withdrawals });
  } catch (error) {
    console.error("❌ Error al obtener retiros pendientes:", error);
    res.status(500).json({ error: "Error interno del servidor." });
  }
};

// ==========================================
// ✅ 2. APROBAR RETIRO (Validación Manual de PayRam)
// ==========================================
exports.approveWithdrawal = async (req, res) => {
  try {
    // 🛡️ BLINDAJE: Aceptamos el ID tanto de params como del body (Compatible con Modo Dios)
    const withdrawalId = req.params.withdrawalId || req.body.withdrawalId || req.body.id;
    const txHash = req.body.txHash || 'PAGO_MANUAL_ADMIN'; // Hash opcional para agilidad
    const adminNotes = req.body.adminNotes || req.body.reason || 'Pago verificado y enviado vía PayRam (Manual).';

    if (!withdrawalId) {
      return res.status(400).json({ error: 'ID de retiro no proporcionado.' });
    }

    const withdrawal = await prisma.withdrawal.findUnique({ 
      where: { id: withdrawalId },
      include: { creator: true } 
    });

    if (!withdrawal || withdrawal.status !== 'PENDING') {
      return res.status(400).json({ error: 'El retiro no existe o ya fue procesado.' });
    }

    // 🔒 Transacción ACID PayRam: Actualizamos todo en bloque
    await prisma.$transaction(async (tx) => {
      
      // A. Marcamos el retiro como PAGADO
      await tx.withdrawal.update({
        where: { id: withdrawalId },
        data: { 
          status: 'PAID', 
          txHash: txHash, 
          adminNotes: adminNotes 
        }
      });

      // B. Generamos el recibo inmutable en el historial de transacciones
      await tx.transaction.create({
        data: {
          senderId: req.user.userId, // Tú (Admin) como origen
          receiverId: withdrawal.creatorId,
          type: 'PAYOUT',
          status: 'COMPLETED',
          amount: withdrawal.amount,
          platformFee: 0, 
          netAmount: withdrawal.amount,
          payAddress: txHash // Guardamos el hash como prueba de pago
        }
      });
      
      // C. Notificación de éxito al Creador
      await tx.notification.create({
        data: {
          userId: withdrawal.creatorId,
          type: 'payout_approved',
          content: `✅ ¡Pago enviado! Tu retiro de $${withdrawal.amount} USD ha sido procesado.`,
          link: '/dashboard/wallet'
        }
      });
    });

    res.status(200).json({ message: 'Retiro marcado como pagado exitosamente. 💸' });

  } catch (error) {
    console.error("❌ Error al aprobar retiro en PayRam:", error);
    res.status(500).json({ error: "No se pudo procesar la aprobación del retiro." });
  }
};

// ==========================================
// 🛡️ 3. RECHAZAR RETIRO (Devolución de fondos)
// ==========================================
exports.rejectWithdrawal = async (req, res) => {
  try {
    // 🛡️ BLINDAJE: Aceptamos el ID tanto de params como del body
    const withdrawalId = req.params.withdrawalId || req.body.withdrawalId || req.body.id;
    const adminNotes = req.body.adminNotes || req.body.reason || 'Retiro rechazado por el administrador.';

    if (!withdrawalId) {
      return res.status(400).json({ error: 'ID de retiro no proporcionado.' });
    }

    const withdrawal = await prisma.withdrawal.findUnique({ 
      where: { id: withdrawalId } 
    });

    if (!withdrawal || withdrawal.status !== 'PENDING') {
      return res.status(400).json({ error: 'El retiro no existe o ya fue procesado.' });
    }

    await prisma.$transaction(async (tx) => {
      // 1. Cambiamos estado a RECHAZADO
      await tx.withdrawal.update({
        where: { id: withdrawalId },
        data: { status: 'REJECTED', adminNotes }
      });

      // 2. PayRam devuelve el dinero a la billetera (balance) del creador
      await tx.wallet.update({
        where: { userId: withdrawal.creatorId },
        data: { balance: { increment: withdrawal.amount } }
      });

      // 3. Notificamos el rechazo
      await tx.notification.create({
        data: {
          userId: withdrawal.creatorId,
          type: 'payout_rejected',
          content: `❌ Retiro rechazado ($${withdrawal.amount}). Motivo: ${adminNotes}`,
          link: '/dashboard/wallet'
        }
      });
    });

    res.status(200).json({ message: 'Retiro rechazado. El saldo volvió a la billetera del creador. 🛡️' });

  } catch (error) {
    console.error("❌ Error al rechazar retiro:", error);
    res.status(500).json({ error: "Error interno al procesar el rechazo." });
  }
};