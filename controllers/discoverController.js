// backend/controllers/discoverController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.getCreators = async (req, res) => {
  try {
    const { search, category, limit = 20 } = req.query;

    let whereClause = { role: 'CREATOR', status: 'ACTIVE' };

    if (search) {
      whereClause.OR = [
        { username: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } }
      ];
    }

    if (category && category !== 'All') {
      whereClause.creatorProfile = { is: { category: category } };
    }

    const creators = await prisma.user.findMany({
      where: whereClause,
      take: parseInt(limit),
      select: {
        id: true, username: true, name: true,
        creatorProfile: {
          select: { profileImage: true, coverImage: true, bio: true, category: true, monthlyPrice: true }
        },
        _count: { select: { followers: true } },
        // 🔥 RADAR VIP
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

    // 🏆 ORDENAMIENTO SUPREMO: Primero los de mayor peso VIP, y si hay empate, los que tengan más seguidores.
    formattedCreators.sort((a, b) => {
      if (b.weight !== a.weight) return b.weight - a.weight;
      return b._count.followers - a._count.followers; 
    });

    res.status(200).json({ creators: formattedCreators });

  } catch (error) {
    res.status(500).json({ error: "Error al buscar creadores." });
  }
};