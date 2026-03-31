// backend/controllers/statsController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.getCreatorStats = async (req, res) => {
  try {
    const userId = req.user.userId;

    // ==========================================
    // 💰 1. CÁLCULOS FINANCIEROS Y TOP FANS
    // ==========================================
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Desde las 00:00 de hoy
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const incomes = await prisma.transaction.findMany({
      where: { 
        receiverId: userId, // Todo el dinero que este creador RECIBIÓ
        status: 'COMPLETED' 
      },
      include: {
        sender: { select: { id: true, username: true } }
      }
    });

    let dailyIncome = 0;
    let monthlyIncome = 0;
    const whalesMap = {};

    incomes.forEach(tx => {
      const txDate = new Date(tx.createdAt);
      const amount = parseFloat(tx.amount || tx.netAmount || 0);

      // Sumar al día o al mes
      if (txDate >= today) dailyIncome += amount;
      if (txDate >= startOfMonth) monthlyIncome += amount;

      // Ranking de Top Fans
      if (tx.sender) {
        if (!whalesMap[tx.sender.id]) {
          whalesMap[tx.sender.id] = {
            id: tx.sender.id,
            username: tx.sender.username,
            avatar: tx.sender.username.charAt(0).toUpperCase(), // Letra inicial como Avatar
            spent: 0
          };
        }
        whalesMap[tx.sender.id].spent += amount;
      }
    });

    const topFans = Object.values(whalesMap)
      .sort((a, b) => b.spent - a.spent)
      .slice(0, 3); // Solo el Top 3

    // ==========================================
    // ❤️ 2. CÁLCULOS SOCIALES (Tu código optimizado)
    // ==========================================
    const uniqueActiveSubscribers = await prisma.subscription.findMany({
      where: { creatorId: userId, status: 'ACTIVE' },
      distinct: ['userId'], 
      select: { userId: true } 
    });
    const activeSubscribers = uniqueActiveSubscribers.length;

    const posts = await prisma.post.findMany({
      where: { userId: userId },
      include: { _count: { select: { likes: true, comments: true } } }
    });

    const totalPosts = posts.length;
    const totalLikes = posts.reduce((acc, post) => acc + post._count.likes, 0);
    const totalComments = posts.reduce((acc, post) => acc + post._count.comments, 0);

    const stories = await prisma.story.findMany({
      where: { creatorId: userId },
      select: { id: true }
    });
    const storyIds = stories.map(s => s.id);
    const totalStoryViews = await prisma.storyView.count({
      where: { storyId: { in: storyIds } }
    });

    // ==========================================
    // 🚀 3. ENVÍO DEL PAQUETE PERFECTO AL FRONTEND
    // ==========================================
    res.status(200).json({
      financialStats: {
        dailyIncome: dailyIncome,
        monthlyIncome: monthlyIncome,
        conversionRate: "12%", // Simulado por ahora
        churnRate: "1.5%"      // Simulado por ahora
      },
      socialStats: {
        activeVIPs: activeSubscribers,
        totalLikes: totalLikes,
        storyViews: totalStoryViews,
        comments: totalComments,
        posts: totalPosts
      },
      topFans: topFans
    });

  } catch (error) {
    console.error('Error al obtener estadísticas:', error);
    res.status(500).json({ error: 'Error interno al cargar las estadísticas.' });
  }
};