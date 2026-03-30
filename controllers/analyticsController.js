// backend/controllers/analyticsController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.getCreatorDashboard = async (req, res) => {
  try {
    // 1. Identificamos al creador
    const creatorId = req.user.userId;

    // 2. Fechas para los filtros (Hoy y Este Mes)
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    // ==========================================
    // 💰 A. CÁLCULO DE INGRESOS (Usando tu modelo Transaction)
    // ==========================================
    const allTransactions = await prisma.transaction.findMany({
      where: { 
        receiverId: creatorId, 
        status: 'COMPLETED' 
      },
      include: { 
        sender: true 
      }
    });

    let dailyIncome = 0;
    let monthlyIncome = 0;
    const topFansMap = {};

    allTransactions.forEach(tx => {
      const amount = parseFloat(tx.amount) || 0; 
      const txDate = new Date(tx.createdAt);

      if (txDate >= startOfMonth) monthlyIncome += amount;
      if (txDate >= startOfDay) dailyIncome += amount;

      // Filtro para que los Admin no ensucien el ranking de "Ballenas"
      if (tx.sender && tx.sender.role !== 'ADMIN') {
        if (!topFansMap[tx.senderId]) {
          topFansMap[tx.senderId] = {
            id: tx.senderId,
            username: tx.sender.username || 'Usuario',
            avatar: tx.sender.username ? tx.sender.username.toUpperCase() : 'U',
            spent: 0
          };
        }
        topFansMap[tx.senderId].spent += amount;
      }
    });

    const topFans = Object.values(topFansMap)
      .sort((a, b) => b.spent - a.spent)
      .slice(0, 5);

    // ==========================================
    // 🔥 B. IMPACTO SOCIAL (Posts, Likes, Comentarios, VISTAS y FANS)
    // ==========================================
    
    // 🛡️ CORRECCIÓN PRISMA: Cambiamos 'userId' por 'fanId' según tu Schema
    const uniqueActiveSubscribers = await prisma.subscription.findMany({
      where: { 
        creatorId: creatorId, 
        status: 'ACTIVE' 
      },
      distinct: ['fanId'], // 👈 AQUÍ: fanId es el nombre correcto
      select: { fanId: true }   // 👈 AQUÍ: fanId es el nombre correcto
    });
    const realActiveFansCount = uniqueActiveSubscribers.length;

    // Contamos Posts, Likes y Comentarios
    const posts = await prisma.post.findMany({
      where: { userId: creatorId }, 
      include: { _count: { select: { likes: true, comments: true } } }
    });

    const totalPosts = posts.length;
    const totalLikes = posts.reduce((sum, post) => sum + post._count.likes, 0);
    const totalComments = posts.reduce((sum, post) => sum + post._count.comments, 0);

    // Contamos las vistas de las historias
    const stories = await prisma.story.findMany({
      where: { creatorId: creatorId },
      include: { _count: { select: { views: true } } }
    });
    const totalStoryViews = stories.reduce((sum, story) => sum + story._count.views, 0);

    // ==========================================
    // 📦 C. RESPUESTA FINAL AL FRONTEND
    // ==========================================
    res.status(200).json({
      financialStats: {
        dailyIncome,
        monthlyIncome,
        conversionRate: "12.5%", 
        churnRate: "N/A"
      },
      socialStats: {
        activeVIPs: realActiveFansCount, 
        totalLikes,
        storyViews: totalStoryViews, 
        comments: totalComments,
        posts: totalPosts
      },
      topFans
    });

  } catch (error) {
    console.error("Error en Analytics:", error);
    res.status(500).json({ error: "Error calculando estadísticas." });
  }
};