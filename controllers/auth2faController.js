// backend/controllers/auth2faController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');

// ==========================================
// 1. GENERAR EL CÓDIGO QR Y LA LLAVE SECRETA
// ==========================================
exports.generate2FA = async (req, res) => {
  try {
    const userId = req.user.userId;
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (user.twoFactorEnabled) {
      return res.status(400).json({ error: 'La Autenticación 2FA ya está activada en tu cuenta.' });
    }

    // 1. Generamos un secreto criptográfico único para este usuario
    const secret = speakeasy.generateSecret({ 
      name: `Fansmio (${user.username || user.email})` 
    });

    // 2. Guardamos el secreto en la BD (aún sin activar)
    await prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: secret.base32 } // base32 es el formato que lee Google Authenticator
    });

    // 3. Convertimos la URL del secreto en una imagen QR
    const qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url);

    res.status(200).json({ 
      secret: secret.base32, 
      qrCodeUrl: qrCodeUrl 
    });
  } catch (error) {
    console.error("Error generando 2FA:", error);
    res.status(500).json({ error: 'Error interno al generar el candado de seguridad.' });
  }
};

// ==========================================
// 2. VERIFICAR EL CÓDIGO (6 DÍGITOS) Y ACTIVAR
// ==========================================
exports.verifyAndEnable2FA = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { token } = req.body; // El código de 6 dígitos que pone el usuario

    if (!token) {
      return res.status(400).json({ error: 'Debes ingresar el código de 6 dígitos.' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });

    // 1. El motor Speakeasy revisa si el código coincide con el tiempo actual
    const isVerified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token: token,
      window: 1 // Da un margen de 30 segundos por si el usuario teclea lento
    });

    if (isVerified) {
      // 2. ¡Éxito! Activamos el 2FA permanentemente
      await prisma.user.update({
        where: { id: userId },
        data: { twoFactorEnabled: true }
      });
      res.status(200).json({ message: '🛡️ ¡Seguridad 2FA activada con éxito!' });
    } else {
      res.status(400).json({ error: '❌ Código inválido o expirado. Intenta de nuevo.' });
    }
  } catch (error) {
    console.error("Error verificando 2FA:", error);
    res.status(500).json({ error: 'Error interno al verificar el código.' });
  }
};