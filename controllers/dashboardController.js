// backend/controllers/dashboardController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ==========================================
// 1. MÉTRICAS PRINCIPALES Y GRÁFICO DE 7 DÍAS
// ==========================================
exports.getMainStats = async (req, res) => {
  try {
    const creatorId = req.user.userId;
    const today = new Date();
    
    // Obtenemos el primer día de este mes (Ej: 1 de Febrero)
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    // 1. INGRESOS MENSUALES (Sumamos todo el dinero neto recibido este mes)
    const monthlyTransactions = await prisma.transaction.aggregate({
      where: {
        receiverId: creatorId,
        status: 'COMPLETED',
        createdAt: { gte: firstDayOfMonth } // gte = Greater than or equal (Desde el día 1)
      },
      _sum: { netAmount: true } // Prisma suma todo automáticamente
    });
    const ingresosMensuales = monthlyTransactions._sum.netAmount || 0;

    // 2. NUEVOS SUSCRIPTORES (Los que entraron este mes)
    const nuevosSuscriptores = await prisma.subscription.count({
      where: {
        creatorId: creatorId,
        createdAt: { gte: firstDayOfMonth }
      }
    });

    // 3. SUSCRIPTORES ACTIVOS (El total de fans que están pagando hoy)
    const suscriptoresActivos = await prisma.subscription.count({
      where: { creatorId: creatorId, status: 'ACTIVE' }
    });

    // 4. GRÁFICO: INGRESOS POR DÍA (Últimos 7 días)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(today.getDate() - 7);

    const dailyTransactions = await prisma.transaction.findMany({
      where: {
        receiverId: creatorId,
        status: 'COMPLETED',
        createdAt: { gte: sevenDaysAgo }
      },
      select: { netAmount: true, createdAt: true }
    });

    // Agrupamos el dinero por fecha exacta para que el Frontend dibuje la gráfica
    const graficoIngresos7Dias = {};
    dailyTransactions.forEach(t => {
      const date = t.createdAt.toISOString().split('T')[0]; // Extrae "YYYY-MM-DD"
      if (!graficoIngresos7Dias[date]) graficoIngresos7Dias[date] = 0;
      graficoIngresos7Dias[date] += t.netAmount;
    });

    res.status(200).json({
      message: 'Estadísticas principales cargadas 📊',
      stats: {
        ingresosMensuales,
        nuevosSuscriptores,
        suscriptoresActivos,
        graficoIngresos7Dias
      }
    });
  } catch (error) {
    console.error('Error al cargar dashboard:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ==========================================
// 2. MÉTRICAS AVANZADAS: TOP FANS, MEJOR POST, CHURN Y CONVERSIÓN
// ==========================================
exports.getAdvancedStats = async (req, res) => {
  try {
    const creatorId = req.user.userId;
    const today = new Date();
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    // --------------------------------------------------
    // 1. TOP FANS (Los 5 fans que más dinero han gastado en ti)
    // --------------------------------------------------
    const topSpenders = await prisma.transaction.groupBy({
      by: ['senderId'],
      where: { receiverId: creatorId, status: 'COMPLETED' },
      _sum: { netAmount: true },
      orderBy: { _sum: { netAmount: 'desc' } },
      take: 5 // Solo los 5 mejores
    });

    // Buscamos los nombres de esos 5 fans para mostrarlos en la pantalla
    const topFansDetails = await Promise.all(
      topSpenders.map(async (spender) => {
        const fan = await prisma.user.findUnique({ where: { id: spender.senderId }, select: { name: true, email: true } });
        return {
          fanName: fan?.name || fan?.email,
          totalSpent: spender._sum.netAmount
        };
      })
    );

    // --------------------------------------------------
    // 2. MEJOR POST DEL MES (El que más dinero PPV generó)
    // --------------------------------------------------
    const bestPostData = await prisma.transaction.groupBy({
      by: ['postId'],
      where: { 
        receiverId: creatorId, 
        type: 'PPV_POST', 
        status: 'COMPLETED',
        createdAt: { gte: firstDayOfMonth },
        postId: { not: null }
      },
      _sum: { netAmount: true },
      orderBy: { _sum: { netAmount: 'desc' } },
      take: 1
    });

    let bestPost = null;
    if (bestPostData.length > 0) {
      const postInfo = await prisma.post.findUnique({ where: { id: bestPostData[0].postId }, select: { content: true, mediaType: true } });
      bestPost = {
        postId: bestPostData[0].postId,
        content: postInfo?.content,
        mediaType: postInfo?.mediaType,
        revenue: bestPostData[0]._sum.netAmount
      };
    }

    // --------------------------------------------------
    // 3. TASA DE CANCELACIÓN (CHURN RATE)
    // Fórmula: (Cancelados este mes / Total activos) * 100
    // --------------------------------------------------
    const canceladosEsteMes = await prisma.subscription.count({
      where: { creatorId: creatorId, status: 'CANCELED', updatedAt: { gte: firstDayOfMonth } }
    });
    
    const suscriptoresActivos = await prisma.subscription.count({
      where: { creatorId: creatorId, status: 'ACTIVE' }
    });

    const totalBase = canceladosEsteMes + suscriptoresActivos;
    const churnRate = totalBase > 0 ? ((canceladosEsteMes / totalBase) * 100).toFixed(2) : 0;

    // --------------------------------------------------
    // 4. CRECIMIENTO MENSUAL (Comparación mes anterior vs mes actual)
    // --------------------------------------------------
    const firstDayOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastDayOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0); // Último día del mes pasado

    const ingresosMesPasado = await prisma.transaction.aggregate({
      where: {
        receiverId: creatorId, status: 'COMPLETED',
        createdAt: { gte: firstDayOfLastMonth, lte: lastDayOfLastMonth }
      },
      _sum: { netAmount: true }
    });
    const lastMonthRevenue = ingresosMesPasado._sum.netAmount || 0;

    res.status(200).json({
      message: 'Estadísticas avanzadas cargadas 📈',
      advancedStats: {
        topFans: topFansDetails,
        bestPost: bestPost || 'Aún no hay ventas de posts este mes.',
        churnRate: `${churnRate}%`,
        lastMonthRevenue: lastMonthRevenue,
        // Si este mes ha ganado $100 y el pasado $50, el crecimiento es positivo.
      }
    });
  } catch (error) {
    console.error('Error al cargar estadísticas avanzadas:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};