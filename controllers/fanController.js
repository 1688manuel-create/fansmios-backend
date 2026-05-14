// backend/controllers/fanController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ==========================================
// 1. OBTENER MIS SUSCRIPCIONES (Como Fan)
// ==========================================
exports.getMySubscriptions = async (req, res) => {
  try {
    const fanId = req.user.userId;

    // Buscamos TODAS las suscripciones (Activas, Vencidas, Canceladas)
    const subscriptions = await prisma.subscription.findMany({
      where: { 
        fanId: fanId
        // 🔥 ELIMINAMOS status: 'ACTIVE'
      },
      include: {
        creator: {
          select: { 
            username: true, 
            creatorProfile: { select: { monthlyPrice: true, profileImage: true } }
          }
        }
      },
      orderBy: { startDate: 'desc' }
    });

    res.status(200).json({ subscriptions });
  } catch (error) {
    console.error('Error al obtener suscripciones:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};