// backend/controllers/settingsController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const bcrypt = require('bcryptjs');

// ==========================================
// 1. ACTUALIZAR CONFIGURACIÓN DE USUARIO (Fans y Creadores)
// ==========================================
exports.updateUserSettings = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { email, newPassword, emailNotifications, pushNotifications, isPrivateProfile, language, currency } = req.body;

    let updateData = {};

    if (email) {
      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser && existingUser.id !== userId) {
        return res.status(400).json({ error: 'Este correo electrónico ya está en uso por otra cuenta.' });
      }
      updateData.email = email;
    }

    if (newPassword) {
      if (newPassword.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
      const salt = await bcrypt.genSalt(10);
      updateData.passwordHash = await bcrypt.hash(newPassword, salt);
    }

    if (emailNotifications !== undefined) updateData.emailNotifications = emailNotifications;
    if (pushNotifications !== undefined) updateData.pushNotifications = pushNotifications;
    if (isPrivateProfile !== undefined) updateData.isPrivateProfile = isPrivateProfile;
    if (language !== undefined) updateData.language = language;
    if (currency !== undefined) updateData.currency = currency;

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: { 
        id: true, email: true, emailNotifications: true, pushNotifications: true, 
        isPrivateProfile: true, language: true, currency: true 
      }
    });

    res.status(200).json({ message: 'Configuraciones actualizadas con éxito ⚙️', user: updatedUser });
  } catch (error) {
    console.error('Error al actualizar settings de usuario:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ==========================================
// 2. ACTUALIZAR CONFIGURACIÓN DEL CREADOR (Mensaje de bienvenida y más)
// ==========================================
exports.updateCreatorSettings = async (req, res) => {
  try {
    const creatorId = req.user.userId;
    const { monthlyPrice, welcomeMessage, minPpvPrice, blockedCountries, hideBalance } = req.body;

    let updateData = {};

    if (monthlyPrice !== undefined) updateData.monthlyPrice = parseFloat(monthlyPrice);
    if (welcomeMessage !== undefined) updateData.welcomeMessage = welcomeMessage; // 🔥 Nuestro robot recepcionista
    if (minPpvPrice !== undefined) updateData.minPpvPrice = parseFloat(minPpvPrice);
    if (blockedCountries !== undefined) updateData.blockedCountries = blockedCountries; 
    if (hideBalance !== undefined) updateData.hideBalance = hideBalance;

    const updatedProfile = await prisma.creatorProfile.update({
      where: { userId: creatorId },
      data: updateData
    });

    res.status(200).json({ message: 'Configuraciones de creador guardadas 🤖', profile: updatedProfile });
  } catch (error) {
    console.error('Error al actualizar settings de creador:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ==========================================
// 3. CAMBIAR CONTRASEÑA (Con validación de la antigua)
// ==========================================
exports.updatePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.userId;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Debes proporcionar la contraseña actual y la nueva.' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    
    const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isMatch) return res.status(400).json({ error: 'La contraseña actual es incorrecta.' });

    const salt = await bcrypt.genSalt(10);
    const newPasswordHash = await bcrypt.hash(newPassword, salt);

    await prisma.user.update({ where: { id: userId }, data: { passwordHash: newPasswordHash } });
    res.status(200).json({ message: 'Contraseña actualizada con éxito. 🔒' });
  } catch (error) { 
    console.error('Error al actualizar contraseña:', error);
    res.status(500).json({ error: 'Error interno del servidor.' }); 
  }
};

// ==========================================
// 4. OBTENER RECIBOS DE COMPRA (Historial de Facturación)
// ==========================================
exports.getBillingHistory = async (req, res) => {
  try {
    const userId = req.user.userId;
    const transactions = await prisma.transaction.findMany({
      where: { senderId: userId, status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
      include: { receiver: { select: { username: true } } }
    });
    res.status(200).json({ transactions });
  } catch (error) { 
    console.error('Error al obtener historial de facturación:', error);
    res.status(500).json({ error: 'Error interno del servidor.' }); 
  }
};