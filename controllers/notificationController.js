// backend/controllers/notificationController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ==========================================
// 1. VER MIS NOTIFICACIONES (Bandeja de entrada)
// ==========================================
exports.getMyNotifications = async (req, res) => {
  try {
    const userId = req.user.userId;

    // Traemos las últimas 50 notificaciones, de la más nueva a la más vieja
    const notifications = await prisma.notification.findMany({
      where: { userId: userId },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    // Contamos cuántas están sin leer para mostrar el numerito rojo en la campana
    const unreadCount = await prisma.notification.count({
      where: { userId: userId, isRead: false }
    });

    res.status(200).json({ message: 'Notificaciones cargadas 🔔', unreadCount, notifications });
  } catch (error) {
    console.error('Error al obtener notificaciones:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ==========================================
// 2. MARCAR UNA NOTIFICACIÓN COMO LEÍDA
// ==========================================
exports.markAsRead = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { notificationId } = req.params;

    const updatedNotification = await prisma.notification.updateMany({
      where: { id: notificationId, userId: userId },
      data: { isRead: true }
    });

    res.status(200).json({ message: 'Notificación marcada como leída ✅' });
  } catch (error) {
    console.error('Error al leer notificación:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ==========================================
// 3. MARCAR TODAS COMO LEÍDAS (Botón "Limpiar")
// ==========================================
exports.markAllAsRead = async (req, res) => {
  try {
    const userId = req.user.userId;

    await prisma.notification.updateMany({
      where: { userId: userId, isRead: false },
      data: { isRead: true }
    });

    res.status(200).json({ message: 'Todas las notificaciones marcadas como leídas 🧹' });
  } catch (error) {
    console.error('Error al limpiar notificaciones:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ==========================================
// GUARDAR TOKEN PUSH DEL CELULAR
// ==========================================
exports.saveFcmToken = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { token } = req.body;

    await prisma.user.update({
      where: { id: userId },
      data: { fcmToken: token }
    });

    res.status(200).json({ message: "Dispositivo registrado para Push Notifications 📱" });
  } catch (error) {
    console.error("Error guardando FCM Token:", error);
    res.status(500).json({ error: "Error interno" });
  }
};