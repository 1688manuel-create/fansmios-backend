// backend/controllers/reportController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ==========================================
// 1. CREAR UN REPORTE (Universal: Usuario, Post o Mensaje)
// ==========================================
exports.createReport = async (req, res) => {
  try {
    const reporterId = req.user.userId;
    const { targetId, reportedUsername, type, reason, description } = req.body;

    let reportData = {
      reporterId,
      type: type || 'USER',
      reason,
      description,
      status: 'PENDING'
    };

    // 🔥 EL BLINDAJE: Buscamos quién es el Acusado
    let accusedUserId = null;
    if (reportedUsername) {
      const accused = await prisma.user.findUnique({ where: { username: reportedUsername } });
      if (accused) accusedUserId = accused.id;
    }

    if (reportData.type === 'USER') {
      reportData.reportedUserId = accusedUserId || targetId;
    } else if (reportData.type === 'POST') {
      reportData.postId = targetId;
      reportData.reportedUserId = accusedUserId; 
    } else if (reportData.type === 'MESSAGE') {
      reportData.messageId = targetId;
      reportData.reportedUserId = accusedUserId; 
    } else {
      return res.status(400).json({ error: "Tipo de reporte inválido" });
    }

    const newReport = await prisma.report.create({ data: reportData });
    res.status(201).json({ message: '🚩 Reporte enviado al Administrador exitosamente. Lo revisaremos pronto.', report: newReport });
  } catch (error) {
    console.error('Error al crear reporte:', error);
    res.status(500).json({ error: 'Error interno al enviar el reporte.' });
  }
};

// ==========================================
// 2. OBTENER TODOS LOS REPORTES (Solo para el ADMIN)
// ==========================================
exports.getAllReports = async (req, res) => {
  try {
    const reports = await prisma.report.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        reporter: { select: { username: true, email: true } },
        reportedUser: { select: { username: true, email: true } },
        post: { select: { id: true, content: true, mediaUrl: true } },
        message: { select: { id: true, content: true, mediaUrl: true } }
      }
    });

    res.status(200).json({ reports });
  } catch (error) {
    console.error("Error al obtener reportes:", error);
    res.status(500).json({ error: "Error al cargar los reportes." });
  }
};