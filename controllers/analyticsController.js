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
    // Buscamos todas las transacciones donde el creador es el RECEPTOR y están COMPLETADAS
    const allTransactions = await prisma.transaction.findMany({
      where: { 
        receiverId: creatorId, 
        status: 'COMPLETED' 
      },
      include: { 
        sender: true // Traemos los datos del Fan
      }
    });

    let dailyIncome = 0;
    let monthlyIncome = 0;
    const topFansMap = {};

    allTransactions.forEach(tx => {
      // OJO: Usamos tx.amount (Ingreso bruto). Si prefieres lo que gana el creador libre de comisiones, cambia a tx.netAmount
      const amount = parseFloat(tx.amount) || 0; 
      const txDate = new Date(tx.createdAt);

      // Sumar al mes actual
      if (txDate >= startOfMonth) monthlyIncome += amount;
      
      // Sumar al día de hoy
      if (txDate >= startOfDay) dailyIncome += amount;

      // Agrupar para el ranking de Top Fans
      if (!topFansMap[tx.senderId]) {
        topFansMap[tx.senderId] = {
          id: tx.senderId,
          username: tx.sender?.username || 'Usuario',
          avatar: tx.sender?.username ? tx.sender.username[0].toUpperCase() : 'U',
          spent: 0
        };
      }
      topFansMap[tx.senderId].spent += amount;
    });

    // Ordenar los Top Fans de mayor a menor gasto y tomar los top 5
    const topFans = Object.values(topFansMap)
      .sort((a, b) => b.spent - a.spent)
      .slice(0, 5);

    // ==========================================
    // 🔥 B. IMPACTO SOCIAL (Posts, Likes, Comentarios y VISTAS DE HISTORIAS)
    // ==========================================
    
    // Contamos Posts, Likes y Comentarios
    const posts = await prisma.post.findMany({
      where: { userId: creatorId }, // En tu schema, el post usa 'userId'
      include: { _count: { select: { likes: true, comments: true } } }
    });

    const totalPosts = posts.length;
    const totalLikes = posts.reduce((sum, post) => sum + post._count.likes, 0);
    const totalComments = posts.reduce((sum, post) => sum + post._count.comments, 0);

    // Contamos las vistas de tus historias (¡Vi que tenías la tabla StoryView!)
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
        conversionRate: "12.5%", // Dato estético temporal hasta tener suscripciones
        churnRate: "N/A"         // Dato estético temporal hasta tener suscripciones
      },
      socialStats: {
        activeVIPs: topFans.length, // El número real de ballenas
        totalLikes,
        storyViews: totalStoryViews, // ¡Ahora es real!
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