// backend/controllers/authController.js
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken'); 
const crypto = require('crypto'); 
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const { sendEmail } = require('../utils/emailService');

const prisma = new PrismaClient();

exports.register = async (req, res) => {
  try {
    const { username, email, password, role, referralCode } = req.body;

    // 1. Validar que no falten datos
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'El usuario, email y contraseña son obligatorios.' });
    }

    // ==========================================
    // 🛡️ ESCUDO ANTI-CORREOS (BLINDADO)
    // ==========================================
    const emailString = String(email).trim().toLowerCase();
    const emailParts = emailString.split('@');
    const emailDomain = emailParts.length > 1 ? emailParts : '';
    
    const allowedDomains = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'live.com', 'msn.com'];

    if (!emailDomain || !allowedDomains.includes(emailDomain)) {
      return res.status(403).json({ 
        error: 'Por seguridad, solo aceptamos correos de Gmail, Outlook, Yahoo o iCloud. No se permiten correos temporales. 🛑' 
      });
    }

    // 2. Verificar duplicados
    const existingUser = await prisma.user.findUnique({ where: { email: emailString } });
    if (existingUser) return res.status(400).json({ error: 'Este correo ya está registrado.' });

    const safeUsername = String(username).toLowerCase().replace(/\s+/g, '');
    const existingUsername = await prisma.user.findUnique({ where: { username: safeUsername } });
    if (existingUsername) return res.status(400).json({ error: 'Este nombre de usuario ya está en uso. Elige otro.' });

    // 3. Encriptación y Referidos
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(String(password), salt);

    let referrerId = null;
    if (referralCode) {
      const referrer = await prisma.user.findUnique({ where: { referralCode: String(referralCode) } });
      if (referrer) referrerId = referrer.id;
    }

    // 4. Token Mágico
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const tokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 horas

    // 5. Crear Usuario
    const newUser = await prisma.user.create({
      data: {
        username: safeUsername,
        email: emailString,
        passwordHash: hashedPassword,
        role: role === 'CREATOR' ? 'CREATOR' : 'FAN',
        referredById: referrerId,
        emailVerificationToken: verificationToken,
        emailVerificationExpires: tokenExpires
      }
    });

    // 💌 6. ENVÍO DE CORREO CON RED DE SEGURIDAD (ANTI-FANTASMAS)
    const verifyLink = `${process.env.FRONTEND_URL}/auth/verify-email?token=${verificationToken}`;
    try {
      await sendEmail(
        newUser.email, 
        'Verifica tu correo en FansMio 🔐', 
        `¡Hola @${newUser.username}!\n\nEstás a un paso de entrar al imperio. Haz clic aquí (válido por 24h):\n\n${verifyLink}`
      );
    } catch (emailError) {
      // Si el correo falla, borramos al usuario para que no quede atorado
      await prisma.user.delete({ where: { id: newUser.id } });
      console.error('🚨 Fallo SMTP, usuario eliminado para reintento:', emailError);
      return res.status(500).json({ error: 'Fallo al enviar el correo de verificación. Inténtalo de nuevo.' });
    }

    // 7. Crear perfil de creador si aplica
    if (newUser.role === 'CREATOR') {
      await prisma.creatorProfile.create({ data: { userId: newUser.id, kycStatus: 'PENDING' } });
    }

    // ==========================================
    // 🔥 8. MOTOR DE BIENVENIDA AUTOMÁTICA
    // ==========================================
    try {
      const adminUser = await prisma.user.findFirst({
        where: { role: 'ADMIN' },
        orderBy: { createdAt: 'asc' }
      });

      if (adminUser) {
        const creatorSetting = await prisma.systemSetting.findUnique({ where: { key: 'WELCOME_CREATOR' } });
        const fanSetting = await prisma.systemSetting.findUnique({ where: { key: 'WELCOME_FAN' } });

        const welcomeText = newUser.role === 'CREATOR' 
          ? (creatorSetting?.value || "¡Bienvenido a FansMio, Creador! ⚡")
          : (fanSetting?.value || "¡Bienvenido a FansMio! ⚡");

        const newConv = await prisma.conversation.create({
          data: { creatorId: adminUser.id, fanId: newUser.id }
        });

        await prisma.message.create({
          data: {
            conversationId: newConv.id, senderId: adminUser.id, receiverId: newUser.id,
            content: welcomeText, isPPV: false, price: 0
          }
        });

        await prisma.notification.create({
          data: { userId: newUser.id, type: 'MESSAGE', content: `¡Bienvenido! Tienes un mensaje del Equipo FansMio ⚡`, link: '/dashboard/messages' }
        });
      }
    } catch (welcomeError) {
      console.error("🚨 Error silencioso en el mensaje de bienvenida:", welcomeError);
    }
    // ==========================================

    res.status(201).json({ 
      message: 'Usuario registrado exitosamente. Por favor, verifica tu correo. 📩', 
      user: { id: newUser.id, username: newUser.username, email: newUser.email, role: newUser.role } 
    });

  } catch (error) { 
    console.error('Error general en registro:', error);
    res.status(500).json({ error: 'Error interno del servidor.' }); 
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) return res.status(400).json({ error: 'Email y contraseña son obligatorios' });

    const user = await prisma.user.findUnique({ 
      where: { email },
      include: { 
        creatorProfile: true,
        wallet: true // 👈 ¡NUEVO! Traemos la bóveda del usuario
      } 
    });
    
    if (!user) return res.status(401).json({ error: 'Credenciales inválidas' }); 

    // 🔥 BLINDAJE 1: Revisar el estado ANTES de dejarlo entrar
    if (user.status === 'BANNED') {
      return res.status(403).json({ error: 'Tu cuenta ha sido baneada permanentemente por violar las políticas de la plataforma.' });
    }
    if (user.status === 'SUSPENDED') {
      return res.status(403).json({ error: 'Tu cuenta se encuentra suspendida temporalmente. Contacta a soporte.' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) return res.status(401).json({ error: 'Credenciales inválidas' });

    // 🔥 BLINDAJE 2: LA PUERTA DE HIERRO (Verificación de Email)
    if (!user.isEmailVerified) {
      return res.status(403).json({ 
        error: 'Tu correo aún no está verificado. Revisa tu bandeja de entrada o spam para activar tu cuenta.',
        needsVerification: true,
        email: user.email // Lo mandamos para que el Frontend pueda mostrar el botón "Reenviar correo"
      });
    }

    // 🔥 CAMBIO DE '15m' a '7d' (7 DÍAS DE BATERÍA PARA LA SESIÓN)
    const accessToken = jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
    const refreshToken = jwt.sign({ userId: user.id, jti: crypto.randomUUID() }, process.env.JWT_REFRESH_SECRET, { expiresIn: '7d' });

    const deviceInfo = req.headers['user-agent'] || 'Dispositivo Desconocido';
    const ipAddress = req.ip || req.socket.remoteAddress || 'IP Desconocida';

    await prisma.session.create({
      data: { userId: user.id, refreshToken: refreshToken, deviceInfo: deviceInfo, ipAddress: ipAddress, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }
    });

    res.status(200).json({
      message: 'Login exitoso',
      token: accessToken, 
      refreshToken,
      user: { 
        id: user.id, 
        email: user.email, 
        name: user.name, 
        role: user.role, 
        username: user.username,
        walletBalance: user.wallet?.balance || 0, // 👈 ¡NUEVO! Enviamos el saldo real o 0 si no tiene bóveda
        creatorProfile: user.creatorProfile 
      }
    });

  } catch (error) { 
    console.error('Error en login:', error);
    res.status(500).json({ error: 'Error interno del servidor' }); 
  }
};

exports.logoutGlobal = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Se requiere el email para cerrar las sesiones' });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    await prisma.session.deleteMany({ where: { userId: user.id } });
    res.status(200).json({ message: 'Has cerrado sesión en todos tus dispositivos correctamente 🔒' });

  } catch (error) { res.status(500).json({ error: 'Error interno del servidor' }); }
};

exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) return res.status(200).json({ message: 'Si el correo existe, se ha enviado un enlace de recuperación.' });

    const resetToken = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '15m' });
    const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
    const emailText = `Hola ${user.username || 'Usuario'},\n\nHaz clic en el siguiente enlace para recuperar tu contraseña. Este enlace expira en 15 minutos:\n\n${resetLink}\n\nSi no solicitaste esto, ignora este mensaje.`;

    await sendEmail(user.email, 'Recuperación de Contraseña - FansMio', emailText);
    res.status(200).json({ message: 'Si el correo existe, se ha enviado un enlace de recuperación.' });
  } catch (error) { res.status(500).json({ error: 'Error interno del servidor' }); }
};

exports.resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const salt = await bcrypt.genSalt(10);
    const newPasswordHash = await bcrypt.hash(newPassword, salt);

    await prisma.user.update({ where: { id: decoded.userId }, data: { passwordHash: newPasswordHash } });
    res.status(200).json({ message: 'Contraseña actualizada exitosamente. Ya puedes iniciar sesión.' });
  } catch (error) { res.status(400).json({ error: 'El enlace es inválido o ha expirado.' }); }
};

exports.generate2FA = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const secret = speakeasy.generateSecret({ name: `FansMio (${user.email})` });
    await prisma.user.update({ where: { email }, data: { twoFactorSecret: secret.base32 } });
    const qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url);

    res.status(200).json({ message: 'Escanea este QR', qrCodeUrl: qrCodeUrl, secret: secret.base32 });
  } catch (error) { res.status(500).json({ error: 'Error interno' }); }
};

exports.verify2FA = async (req, res) => {
  try {
    const { email, token } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !user.twoFactorSecret) return res.status(400).json({ error: 'El 2FA no está configurado' });

    const isVerified = speakeasy.totp.verify({ secret: user.twoFactorSecret, encoding: 'base32', token: token });
    if (!isVerified) return res.status(400).json({ error: 'Código 2FA incorrecto' });

    await prisma.user.update({ where: { email }, data: { twoFactorEnabled: true } });
    res.status(200).json({ message: '2FA activado exitosamente 🛡️' });
  } catch (error) { res.status(500).json({ error: 'Error interno' }); }
};

// ==========================================
// 🔥 VERIFICAR EL CORREO ELECTRÓNICO
// ==========================================
exports.verifyEmail = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token no proporcionado.' });

    const user = await prisma.user.findUnique({ where: { emailVerificationToken: token } });
    
    if (!user || !user.emailVerificationExpires || user.emailVerificationExpires < new Date()) {
      return res.status(400).json({ error: 'El enlace de verificación es inválido o ha expirado.' });
    }

    // Activamos la cuenta y destruimos el token
    await prisma.user.update({
      where: { id: user.id },
      data: {
        isEmailVerified: true,
        emailVerificationToken: null,
        emailVerificationExpires: null
      }
    });

    res.status(200).json({ message: '¡Cuenta verificada con éxito! Ya puedes iniciar sesión.' });
  } catch (error) {
    console.error('Error verificando email:', error);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
};

// ==========================================
// ♻️ REENVIAR EL CORREO DE VERIFICACIÓN
// ==========================================
exports.resendVerificationEmail = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Se requiere un correo electrónico.' });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
    if (user.isEmailVerified) return res.status(400).json({ error: 'Esta cuenta ya está verificada.' });

    // Generar un nuevo token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const tokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerificationToken: verificationToken,
        emailVerificationExpires: tokenExpires
      }
    });

    const verifyLink = `${process.env.FRONTEND_URL}/auth/verify-email?token=${verificationToken}`;
    await sendEmail(
      user.email, 
      'Nuevo enlace de verificación - FansMio 🔐', 
      `¡Hola @${user.username}!\n\nAquí tienes un nuevo enlace para verificar tu cuenta:\n\n${verifyLink}\n\nEs válido por 24 horas.`
    );

    res.status(200).json({ message: 'Nuevo enlace de verificación enviado a tu correo.' });
  } catch (error) {
    console.error('Error reenviando verificación:', error);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
};