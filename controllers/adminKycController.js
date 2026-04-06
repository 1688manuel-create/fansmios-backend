const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ==========================================
// 1. OBTENER EL HISTORIAL FORENSE COMPLETO
// ==========================================
exports.getPendingKyc = async (req, res) => {
  try {
    // 🔥 Ahora traemos TODOS los que han intentado el KYC para el historial
    const profiles = await prisma.creatorProfile.findMany({
      where: { 
        kycStatus: { in: ['PENDING', 'APPROVED', 'REJECTED'] } 
      },
      include: {
        user: { select: { username: true, email: true, name: true, createdAt: true } }
      },
      orderBy: { updatedAt: 'desc' } // Los más recientes primero
    });

    res.status(200).json({ profiles });
  } catch (error) {
    console.error("Error al obtener KYC:", error);
    res.status(500).json({ error: "Error interno del servidor." });
  }
};

// ==========================================
// ✅ 2. APROBAR IDENTIDAD (El Veredicto Positivo)
// ==========================================
exports.approveKyc = async (req, res) => {
  try {
    const profileId = req.params.profileId || req.body.profileId || req.body.id;
    if (!profileId) return res.status(400).json({ error: 'ID no proporcionado.' });

    const profile = await prisma.creatorProfile.findUnique({ where: { id: profileId } });
    if (!profile) return res.status(400).json({ error: 'Expediente no existe.' });

    await prisma.$transaction(async (tx) => {
      await tx.creatorProfile.update({
        where: { id: profileId },
        data: { kycStatus: 'APPROVED', kycRejectionReason: null } // Limpiamos la razón si antes fue rechazado
      });

      await tx.notification.create({
        data: {
          userId: profile.userId,
          type: 'kyc_approved',
          content: `✅ ¡Felicidades! Tu Identidad Oficial ha sido verificada.`,
          link: '/dashboard/wallet'
        }
      });
    });

    res.status(200).json({ message: 'Identidad aprobada con éxito.' });
  } catch (error) {
    res.status(500).json({ error: "Error al procesar la aprobación." });
  }
};

// ==========================================
// ❌ 3. RECHAZAR IDENTIDAD (Con Razón Específica)
// ==========================================
exports.rejectKyc = async (req, res) => {
  try {
    const profileId = req.params.profileId || req.body.profileId || req.body.id;
    const rejectionReason = req.body.reason || req.body.adminNotes || req.body.message;

    if (!profileId) return res.status(400).json({ error: 'ID no proporcionado.' });
    if (!rejectionReason) return res.status(400).json({ error: 'Falta la razón del rechazo.' });

    const profile = await prisma.creatorProfile.findUnique({ where: { id: profileId } });
    if (!profile) return res.status(400).json({ error: 'Expediente no existe.' });

    await prisma.$transaction(async (tx) => {
      await tx.creatorProfile.update({
        where: { id: profileId },
        data: { kycStatus: 'REJECTED', kycRejectionReason: rejectionReason }
      });

      await tx.notification.create({
        data: {
          userId: profile.userId,
          type: 'kyc_rejected',
          content: `❌ Verificación fallida. Razón: ${rejectionReason}. Por favor, vuelve a intentarlo.`,
          link: '/dashboard/kyc'
        }
      });
    });

    res.status(200).json({ message: 'Expediente rechazado.' });
  } catch (error) {
    res.status(500).json({ error: "Error al rechazar el KYC." });
  }
};