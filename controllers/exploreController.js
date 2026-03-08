// backend/controllers/exploreController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.getSuggestedCreators = async (req, res) => {
  try {
    const creators = await prisma.user.findMany({
      where: { role: 'CREATOR', status: 'ACTIVE' },
      take: 20, // Traemos 20 para filtrarlos bien
      orderBy: { createdAt: 'desc' }, 
      include: { 
        creatorProfile: true,
        // 🔥 RADAR VIP
        promotions: {
          where: { active: true, expiresAt: { gt: new Date() } },
          select: { package: true }
        }
      }
    });

    // Inyectamos el Algoritmo
    const formattedCreators = creators.map(c => {
      const promo = c.promotions?.length > 0 ? c.promotions[0].package : null;
      let weight = 0;
      if (promo === 'GOD') weight = 3;
      if (promo === 'PRO') weight = 2;
      if (promo === 'BASIC') weight = 1;
      
      return { ...c, isPromoted: !!promo, promoTier: promo, weight };
    });

    // Los VIP siempre salen primero
    formattedCreators.sort((a, b) => b.weight - a.weight);

    // Devolvemos solo los mejores 10
    res.status(200).json({ creators: formattedCreators.slice(0, 10) });
  } catch (error) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

exports.searchCreators = async (req, res) => {
  try {
    const { q } = req.query; 
    if (!q) return res.status(200).json({ creators: [] });

    const creators = await prisma.user.findMany({
      where: {
        role: 'CREATOR', status: 'ACTIVE',
        username: { contains: q, mode: 'insensitive' }
      },
      take: 20,
      include: { 
        creatorProfile: true,
        promotions: {
          where: { active: true, expiresAt: { gt: new Date() } },
          select: { package: true }
        }
      }
    });

    const formattedCreators = creators.map(c => {
      const promo = c.promotions?.length > 0 ? c.promotions[0].package : null;
      let weight = 0;
      if (promo === 'GOD') weight = 3;
      if (promo === 'PRO') weight = 2;
      if (promo === 'BASIC') weight = 1;
      return { ...c, isPromoted: !!promo, promoTier: promo, weight };
    });

    formattedCreators.sort((a, b) => b.weight - a.weight);

    res.status(200).json({ creators: formattedCreators });
  } catch (error) {
    res.status(500).json({ error: 'Error interno al buscar' });
  }
};