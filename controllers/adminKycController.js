// backend/controllers/adminKycController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ==========================================
// 1. OBTENER LA LISTA DE SOSPECHOSOS (Pendientes)
// ==========================================
exports.getPendingKyc = async (req, res) => {
  try {
    const pendingProfiles = await prisma.creatorProfile.findMany({
      where: { kycStatus: 'PENDING' },
      include: {
        user: { select: { username: true, email: true, name: true, createdAt: true } }
      },
      orderBy: { updatedAt: 'asc' } // Los más antiguos primero
    });

    res.status(200).json({ profiles: pendingProfiles });
  } catch (error) {
    console.error("Error al obtener KYC pendientes:", error);
    res.status(500).json({ error: "Error interno del servidor." });
  }
};

// ==========================================
// ✅ 2. APROBAR IDENTIDAD (El Veredicto Positivo)
// ==========================================
exports.approveKyc = async (req, res) => {
  try {
    // 🔥 BLINDAJE: Aceptamos el ID tanto de params como del body (Modo Dios compatible)
    const profileId = req.params.profileId || req.body.profileId || req.body.id;

    if (!profileId) {
      return res.status(400).json({ error: 'ID de expediente no proporcionado.' });
    }

    const profile = await prisma.creatorProfile.findUnique({ where: { id: profileId } });
    if (!profile || profile.kycStatus !== 'PENDING') {
      return res.status(400).json({ error: 'El expediente no existe o ya fue procesado.' });
    }

    // 🔒 Transacción: Aprobamos y notificamos
    await prisma.$transaction(async (tx) => {
      await tx.creatorProfile.update({
        where: { id: profileId },
        data: { kycStatus: 'APPROVED', kycRejectionReason: null }
      });

      await tx.notification.create({
        data: {
          userId: profile.userId,
          type: 'kyc_approved',
          content: `✅ ¡Felicidades! Tu Identidad Oficial ha sido verificada. Ya puedes realizar retiros.`,
          link: '/dashboard/wallet' // Funciona perfecto en fansmio.com
        }
      });
    });

    res.status(200).json({ message: 'Identidad aprobada con éxito. El creador ya puede cobrar. 💸' });
  } catch (error) {
    console.error("Error al aprobar KYC:", error);
    res.status(500).json({ error: "Error al procesar la aprobación." });
  }
};

// ==========================================
// ❌ 3. RECHAZAR IDENTIDAD (El Martillazo)
// ==========================================
exports.rejectKyc = async (req, res) => {
  try {
    // 🔥 BLINDAJE: Aceptamos ID y Razón de múltiples fuentes
    const profileId = req.params.profileId || req.body.profileId || req.body.id;
    const rejectionReason = req.body.reason || req.body.adminNotes || req.body.message;

    if (!profileId) {
      return res.status(400).json({ error: 'ID de expediente no proporcionado.' });
    }

    if (!rejectionReason) {
      return res.status(400).json({ error: 'Debes proporcionar una razón clara para el rechazo.' });
    }

    const profile = await prisma.creatorProfile.findUnique({ where: { id: profileId } });
    if (!profile || profile.kycStatus !== 'PENDING') {
      return res.status(400).json({ error: 'El expediente no existe o ya fue procesado.' });
    }

    // 🔒 Transacción: Rechazamos y notificamos
    await prisma.$transaction(async (tx) => {
      await tx.creatorProfile.update({
        where: { id: profileId },
        data: { 
          kycStatus: 'REJECTED', 
          kycRejectionReason: rejectionReason
        }
      });

      await tx.notification.create({
        data: {
          userId: profile.userId,
          type: 'kyc_rejected',
          content: `❌ Tu verificación de identidad falló. Razón: ${rejectionReason}. Por favor, vuelve a intentarlo.`,
          link: '/dashboard/kyc' // Funciona perfecto en fansmio.com
        }
      });
    });

    res.status(200).json({ message: 'Expediente rechazado. El usuario ha sido notificado. 🛡️' });
  } catch (error) {
    console.error("Error al rechazar KYC:", error);
    res.status(500).json({ error: "Error interno al rechazar el KYC." });
  }
};