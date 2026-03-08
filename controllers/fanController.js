// backend/controllers/fanController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ==========================================
// 1. OBTENER MIS SUSCRIPCIONES ACTIVAS (Como Fan)
// ==========================================
exports.getMySubscriptions = async (req, res) => {
  try {
    const fanId = req.user.userId;

    // Buscamos todas las suscripciones donde este usuario sea el Fan
    const subscriptions = await prisma.subscription.findMany({
      where: { 
        fanId: fanId,
        status: 'ACTIVE' // Solo las que están vigentes
      },
      include: {
        creator: {
          select: { 
            username: true, 
            creatorProfile: { select: { monthlyPrice: true } }
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