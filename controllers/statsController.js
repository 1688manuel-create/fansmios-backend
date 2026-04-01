// backend/controllers/statsController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.getCreatorStats = async (req, res) => {
  try {
    const userId = req.user.userId;

    // ==========================================
    // 📅 0. MÁQUINA DEL TIEMPO (Últimos 7 días)
    // ==========================================
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const chartDataMap = {};
    const diasSemana = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    
    // Rellenamos el mapa con los últimos 7 días en ceros
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateString = d.toISOString().split('T')[0];
      chartDataMap[dateString] = {
        name: diasSemana[d.getDay()],
        ingresos: 0,
        suscriptores: 0
      };
    }

    // ==========================================
    // 💰 1. CÁLCULOS FINANCIEROS, TOP FANS E INGRESOS DIARIOS
    // ==========================================
    const incomes = await prisma.transaction.findMany({
      where: { receiverId: userId, status: 'COMPLETED' },
      include: { sender: { select: { id: true, username: true } } }
    });

    let dailyIncome = 0;
    let monthlyIncome = 0;
    const whalesMap = {};

    incomes.forEach(tx => {
      const txDate = new Date(tx.createdAt);
      const dateString = txDate.toISOString().split('T')[0];
      const amount = parseFloat(tx.amount || tx.netAmount || 0);

      // Sumar al día de hoy o al mes
      if (txDate >= today) dailyIncome += amount;
      if (txDate >= startOfMonth) monthlyIncome += amount;

      // Inyectar a la Gráfica si fue en los últimos 7 días
      if (chartDataMap[dateString]) {
        chartDataMap[dateString].ingresos += amount;
      }

      // Ranking de Top Fans
      if (tx.sender) {
        if (!whalesMap[tx.sender.id]) {
          whalesMap[tx.sender.id] = {
            id: tx.sender.id,
            username: tx.sender.username,
            avatar: tx.sender.username.charAt(0).toUpperCase(),
            spent: 0
          };
        }
        whalesMap[tx.sender.id].spent += amount;
      }
    });

    const topFans = Object.values(whalesMap)
      .sort((a, b) => b.spent - a.spent)
      .slice(0, 3);

    // ==========================================
    // ❤️ 2. CÁLCULOS SOCIALES Y SUSCRIPTORES DIARIOS
    // ==========================================
    const uniqueActiveSubscribers = await prisma.subscription.findMany({
      where: { creatorId: userId, status: 'ACTIVE' },
      distinct: ['fanId'], 
      select: { fanId: true } 
    });
    const activeSubscribers = uniqueActiveSubscribers.length;

    // Buscar suscriptores de los últimos 7 días para la gráfica de barras
    const recentSubs = await prisma.subscription.findMany({
      where: { creatorId: userId, startDate: { gte: sevenDaysAgo } },
      select: { startDate: true }
    });

    recentSubs.forEach(sub => {
      const subDate = new Date(sub.startDate).toISOString().split('T')[0];
      if (chartDataMap[subDate]) {
        chartDataMap[subDate].suscriptores += 1;
      }
    });

    // Resto de cálculos sociales
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
        conversionRate: "12%", 
        churnRate: "1.5%"      
      },
      socialStats: {
        activeVIPs: activeSubscribers,
        totalLikes: totalLikes,
        storyViews: totalStoryViews,
        comments: totalComments,
        posts: totalPosts
      },
      topFans: topFans,
      chartData: Object.values(chartDataMap) // 👈 ¡AQUÍ ESTÁ LA GRÁFICA REAL!
    });

  } catch (error) {
    console.error('Error al obtener estadísticas:', error);
    res.status(500).json({ error: 'Error interno al cargar las estadísticas.' });
  }
};