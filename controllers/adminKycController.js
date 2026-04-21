const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ==========================================
// 1. OBTENER EL HISTORIAL FORENSE (NIVEL DIOS - ESCALABLE)
// ==========================================
exports.getPendingKyc = async (req, res) => {
  try {
    // 1. Recibimos las órdenes del radar (Frontend)
    const { status = 'PENDING', search = '', page = 1, limit = 10 } = req.query;
    
    // 2. Matemáticas de Paginación (Skip y Take)
    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    // 3. Armamos la trampa (Filtros de base de datos)
    const whereClause = {
      kycStatus: status,
    };

    // Si el CEO está buscando a alguien, buscamos por username o email ignorando mayúsculas
    if (search) {
      whereClause.user = {
        OR: [
          { username: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } }
        ]
      };
    }

    // 4. Ejecutamos 4 consultas al mismo tiempo de forma paralela (Súper rápido)
    const [profiles, totalFiltered, pendingCount, approvedCount, rejectedCount] = await Promise.all([
      prisma.creatorProfile.findMany({
        where: whereClause,
        include: {
          user: { select: { username: true, email: true, name: true, createdAt: true } }
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take,
      }),
      prisma.creatorProfile.count({ where: whereClause }),
      prisma.creatorProfile.count({ where: { kycStatus: 'PENDING' } }),
      prisma.creatorProfile.count({ where: { kycStatus: 'APPROVED' } }),
      prisma.creatorProfile.count({ where: { kycStatus: 'REJECTED' } })
    ]);

    // 5. Devolvemos la artillería completa
    res.status(200).json({ 
      profiles, 
      pagination: {
        total: totalFiltered,
        totalPages: Math.ceil(totalFiltered / take),
        currentPage: Number(page),
        limit: take
      },
      counts: {
        PENDING: pendingCount,
        APPROVED: approvedCount,
        REJECTED: rejectedCount
      }
    });
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
      // 1. Aprobamos los papeles en la Bóveda Legal
      await tx.creatorProfile.update({
        where: { id: profileId },
        data: { kycStatus: 'APPROVED', kycRejectionReason: null } // Limpiamos la razón si antes fue rechazado
      });

      // 🔥 2. EL ASCENSO AUTOMÁTICO: Cambiamos su rol a CREADOR
      await tx.user.update({
        where: { id: profile.userId },
        data: { role: 'CREATOR' } // Esto es lo que desbloquea su panel de control completo
      });

      // 3. Disparamos la notificación de éxito
      await tx.notification.create({
        data: {
          userId: profile.userId,
          type: 'kyc_approved',
          content: `✅ ¡Felicidades! Tu Identidad Oficial ha sido verificada. Ya puedes monetizar.`,
          link: '/dashboard/wallet'
        }
      });
    });

    res.status(200).json({ message: 'Identidad aprobada y usuario ascendido a Creador con éxito.' });
  } catch (error) {
    console.error("Error al procesar la aprobación:", error);
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