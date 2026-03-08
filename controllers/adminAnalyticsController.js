// backend/controllers/adminAnalyticsController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.getSuperAdminDashboard = async (req, res) => {
  try {
    // 1. MÉTRICAS DE USUARIOS
    const totalFans = await prisma.user.count({ where: { role: 'FAN' } });
    const totalCreators = await prisma.user.count({ where: { role: 'CREATOR' } });
    
    // 2. MÉTRICAS FINANCIERAS (El dinero real)
    const transactions = await prisma.transaction.aggregate({
      where: { status: 'COMPLETED' },
      _sum: {
        amount: true,       // Volumen total movido (Gross)
        platformFee: true   // Ganancia neta de la Plataforma (Tu dinero)
      }
    });

    const totalVolume = transactions._sum.amount || 0;
    const totalRevenue = transactions._sum.platformFee || 0;

    // 3. PASIVOS (Dinero que le debes a los creadores)
    const pendingWithdrawals = await prisma.withdrawal.aggregate({
      where: { status: 'PENDING' },
      _sum: { amount: true },
      _count: true
    });

    const liabilityAmount = pendingWithdrawals._sum.amount || 0;
    const pendingPayoutsCount = pendingWithdrawals._count || 0;

    // 4. SISTEMA ANTIFRAUDE (Reportes y KYC pendientes)
    const pendingReports = await prisma.report.count({ where: { status: 'PENDING' } });
    const pendingKyc = await prisma.creatorProfile.count({ where: { kycStatus: 'PENDING' } });

    // 5. FLUJO DE CAJA RECIENTE (Últimas 5 transacciones en la plataforma)
    const recentTransactions = await prisma.transaction.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: {
        sender: { select: { username: true } },
        receiver: { select: { username: true } }
      }
    });

    res.status(200).json({
      metrics: {
        users: { fans: totalFans, creators: totalCreators, total: totalFans + totalCreators },
        finance: {
          totalVolumeProcessed: totalVolume,
          platformNetRevenue: totalRevenue,
          pendingLiability: liabilityAmount,
          payoutsInQueue: pendingPayoutsCount
        },
        security: {
          pendingReports: pendingReports,
          pendingKyc: pendingKyc
        }
      },
      recentActivity: recentTransactions
    });

  } catch (error) {
    console.error("Error cargando analíticas del SuperAdmin:", error);
    res.status(500).json({ error: "Error interno al generar el reporte financiero." });
  }
};