// backend/controllers/referralController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ==========================================
// 1. OBTENER MI ENLACE Y CÓDIGO DE REFERIDO
// ==========================================
exports.getMyReferralInfo = async (req, res) => {
  try {
    const userId = req.user.userId;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { referralCode: true }
    });

    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

    // En producción, cambiarás "localhost:3000" por tu dominio real (Ej: fansmio.com)
    const referralLink = `http://localhost:3000/register?ref=${user.referralCode}`;

    res.status(200).json({ 
      message: 'Información de referidos cargada 🤝',
      referralCode: user.referralCode,
      referralLink: referralLink
    });
  } catch (error) {
    console.error('Error al obtener info de referidos:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ==========================================
// 2. VER MI RED DE AFILIADOS (A quién he invitado)
// ==========================================
exports.getMyNetwork = async (req, res) => {
  try {
    const userId = req.user.userId;

    // Buscamos a todos los usuarios que tengan nuestro ID en su campo "referredById"
    const myReferrals = await prisma.user.findMany({
      where: { referredById: userId },
      select: {
        id: true,
        username: true,
        role: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' }
    });

    res.status(200).json({ 
      message: 'Red de afiliados cargada 🌐',
      totalReferrals: myReferrals.length,
      network: myReferrals 
    });
  } catch (error) {
    console.error('Error al obtener red de afiliados:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ==========================================
// 3. 🔥 NUEVO: ESTADÍSTICAS PARA EL PANEL NEOMÓRFICO
// ==========================================
exports.getReferralStats = async (req, res) => {
  try {
    const userId = req.user.userId;

    // 1. Buscamos a todos los "hijos" (usuarios invitados)
    const invitedUsers = await prisma.user.findMany({
      where: { referredById: userId },
      select: { 
        id: true, 
        username: true, 
        createdAt: true, 
        status: true 
      },
      orderBy: { createdAt: 'desc' }
    });

    // 2. Buscamos el dinero ganado por comisiones
    const referralEarnings = await prisma.transaction.findMany({
      where: { 
        receiverId: userId,
        attachedMessage: { contains: "Comisión por referido" }
      }
    });

    const totalEarned = referralEarnings.reduce((acc, tx) => acc + (parseFloat(tx.amount || tx.netAmount || 0)), 0);

    // 3. Traemos la comisión configurada en la base de datos (Ej: 5%)
    const settings = await prisma.platformSettings.findFirst();
    const commissionRate = settings?.feeReferral || 5;

    // 4. Formateamos los datos exactamente como los pide el Frontend
    const recentReferrals = invitedUsers.map(u => ({
      username: u.username || 'Usuario',
      date: u.createdAt.toISOString().split('T'),
      status: u.status === 'ACTIVE' ? 'Activo' : 'Inactivo'
    }));

    res.status(200).json({
      totalReferred: invitedUsers.length,
      totalEarned: totalEarned,
      commissionRate: `${commissionRate}%`,
      recentReferrals: recentReferrals
    });

  } catch (error) {
    console.error('Error en getReferralStats:', error);
    res.status(500).json({ error: 'Error cargando las estadísticas de referidos.' });
  }
};