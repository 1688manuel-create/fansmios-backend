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
      await tx.withdrawal.update({
        where: { id: withdrawalId },
        data: { status: 'PAID', txHash: txHash, adminNotes: adminNotes }
      });

      // 🔥 FIX VITAL: Borramos la deuda retenida
      await tx.wallet.update({
        where: { userId: withdrawal.creatorId },
        data: { pendingBalance: { decrement: withdrawal.amount } } 
      });

      await tx.transaction.create({
        data: {
          senderId: req.user.userId,
          receiverId: withdrawal.creatorId,
          type: 'PAYOUT', status: 'COMPLETED',
          amount: withdrawal.amount, platformFee: 0, 
          netAmount: withdrawal.amount, payAddress: txHash 
        }
      });
      
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
      await tx.withdrawal.update({
        where: { id: withdrawalId },
        data: { status: 'REJECTED', adminNotes }
      });

      // 🔥 FIX VITAL: Sacar de retenido y devolver a disponible
      await tx.wallet.update({
        where: { userId: withdrawal.creatorId },
        data: { 
          balance: { increment: withdrawal.amount },
          pendingBalance: { decrement: withdrawal.amount } 
        }
      });

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
    res.status(500).json({ error: "Error interno al procesar el rechazo." });
  }
};