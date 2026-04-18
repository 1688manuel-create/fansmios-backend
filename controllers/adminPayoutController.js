// backend/controllers/adminPayoutController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.getPendingWithdrawals = async (req, res) => {
  try {
    const withdrawals = await prisma.withdrawal.findMany({
      where: { status: { in: ['PENDING', 'PROCESSING'] } },
      include: {
        creator: { 
          select: { 
            username: true, email: true,
            wallet: { select: { balance: true, pendingBalance: true } }
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

exports.approveWithdrawal = async (req, res) => {
  try {
    const withdrawalId = req.params.withdrawalId || req.body.withdrawalId || req.body.id;
    const txHash = req.body.txHash || 'PAGO_MANUAL_ADMIN'; 
    const adminNotes = req.body.adminNotes || req.body.reason || 'Pago verificado y enviado vía Covra Pay (Manual).';

    if (!withdrawalId) return res.status(400).json({ error: 'ID de retiro no proporcionado.' });

    const withdrawal = await prisma.withdrawal.findUnique({ 
      where: { id: withdrawalId }, include: { creator: true } 
    });

    if (!withdrawal || withdrawal.status !== 'PENDING') {
      return res.status(400).json({ error: 'El retiro no existe o ya fue procesado.' });
    }

    await prisma.$transaction(async (tx) => {
      // 1. Marcar el retiro como pagado
      await tx.withdrawal.update({
        where: { id: withdrawalId },
        data: { status: 'PAID', txHash: txHash, adminNotes: adminNotes }
      });

      // 2. Restar la deuda de la cuarentena (pendingBalance)
      await tx.wallet.update({
        where: { userId: withdrawal.creatorId },
        data: { pendingBalance: { decrement: withdrawal.amount } } 
      });

      // 3. 🎯 FIX VITAL: En vez de crear una transacción nueva, BUSCAMOS la original y la cerramos.
      // Buscamos la transacción PENDING más reciente de tipo PAYOUT de este creador
      const pendingTransaction = await tx.transaction.findFirst({
        where: {
          senderId: withdrawal.creatorId,
          type: 'PAYOUT',
          status: 'PENDING',
          amount: -withdrawal.amount // Debe coincidir con el monto solicitado
        },
        orderBy: { createdAt: 'desc' }
      });

      if (pendingTransaction) {
        // Si la encontramos, simplemente la marcamos como COMPLETED
        await tx.transaction.update({
          where: { id: pendingTransaction.id },
          data: { status: 'COMPLETED', payAddress: txHash }
        });
      } else {
        // ⚠️ Fallback de seguridad extrema: Si por alguna razón histórica no existe la original,
        // creamos una nueva (para que no se rompa el sistema de usuarios viejos).
        await tx.transaction.create({
          data: {
            senderId: req.user.userId, // El admin dispara
            receiverId: withdrawal.creatorId,
            type: 'PAYOUT', 
            status: 'COMPLETED',
            amount: -withdrawal.amount, // En negativo para que el dashboard no lo sume a las ganancias
            platformFee: 0, // Fallback asume 0 para no alterar matematicas viejas
            netAmount: -withdrawal.amount, 
            payAddress: txHash 
          }
        });
      }
      
      // 4. Notificar al creador
      await tx.notification.create({
        data: {
          userId: withdrawal.creatorId, type: 'payout_approved',
          content: `✅ ¡Pago enviado! Tu retiro de $${withdrawal.amount} USD ha sido procesado.`,
          link: '/dashboard/wallet'
        }
      });
    });

    res.status(200).json({ message: 'Retiro marcado como pagado exitosamente. 💸' });

  } catch (error) {
    console.error("Error al aprobar retiro:", error);
    res.status(500).json({ error: "No se pudo procesar la aprobación del retiro." });
  }
};

exports.rejectWithdrawal = async (req, res) => {
  try {
    const withdrawalId = req.params.withdrawalId || req.body.withdrawalId || req.body.id;
    const adminNotes = req.body.adminNotes || req.body.reason || 'Retiro rechazado por el administrador.';

    if (!withdrawalId) return res.status(400).json({ error: 'ID de retiro no proporcionado.' });

    const withdrawal = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });

    if (!withdrawal || withdrawal.status !== 'PENDING') {
      return res.status(400).json({ error: 'El retiro no existe o ya fue procesado.' });
    }

    await prisma.$transaction(async (tx) => {
      // 1. Marcar el retiro como rechazado
      await tx.withdrawal.update({
        where: { id: withdrawalId },
        data: { status: 'REJECTED', adminNotes }
      });

      // 2. Devolver el dinero al creador (De cuarentena a disponible)
      await tx.wallet.update({
        where: { userId: withdrawal.creatorId },
        data: { 
          balance: { increment: withdrawal.amount },
          pendingBalance: { decrement: withdrawal.amount } 
        }
      });

      // 3. 🎯 FIX VITAL: Si se rechaza, buscar la transacción PENDING y cancelarla (FAILED/REJECTED)
      const pendingTransaction = await tx.transaction.findFirst({
        where: {
          senderId: withdrawal.creatorId,
          type: 'PAYOUT',
          status: 'PENDING',
          amount: -withdrawal.amount
        },
        orderBy: { createdAt: 'desc' }
      });

      if (pendingTransaction) {
        await tx.transaction.update({
          where: { id: pendingTransaction.id },
          data: { status: 'FAILED' } // Marcada como fallida para que no sume ni reste
        });
      }

      // 4. Notificar al creador
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