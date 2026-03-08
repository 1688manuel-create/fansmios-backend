// backend/utils/emailService.js
const nodemailer = require('nodemailer');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Configuramos el "cartero" (Transporter)
const transporter = nodemailer.createTransport({
  service: 'gmail', // Puedes cambiarlo luego a 'SendGrid', 'AWS SES', etc.
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// =========================================================
// 1. FUNCIÓN ORIGINAL (Para correos como "Recuperar Contraseña")
// =========================================================
const sendEmail = async (to, subject, text) => {
  try {
    const mailOptions = {
      from: `"FansMios Soporte" <${process.env.EMAIL_USER}>`,
      to: to,
      subject: subject,
      text: text,
    };
    await transporter.sendMail(mailOptions);
    console.log(`Correo básico enviado exitosamente a: ${to}`);
  } catch (error) {
    console.error('Error enviando correo básico:', error);
  }
};

// =========================================================
// 2. NUEVA FUNCIÓN INTELIGENTE (Para Notificaciones de Ganancias/Seguidores)
// =========================================================
const sendNotificationEmail = async (userId, type, subject, text) => {
  try {
    // 1. Buscamos al usuario y sus interruptores de correo
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, emailPromotions: true, emailNewMessages: true, emailSales: true }
    });

    if (!user) return;

    // 2. 🛡️ FILTRO DE PRIVACIDAD: Revisamos si el usuario APAGÓ este correo
    if (type === 'sale' && !user.emailSales) return; 
    if (type === 'message' && !user.emailNewMessages) return; 
    if (type === 'promotion' && !user.emailPromotions) return; 

    // 3. Armamos un diseño HTML elegante (Plantilla Oscura)
    const htmlTemplate = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #050505; color: #ffffff; border-radius: 15px; overflow: hidden; border: 1px solid #333;">
        <div style="background: linear-gradient(90deg, #6b21a8, #2563eb); padding: 20px; text-align: center;">
          <h1 style="margin: 0; color: white; font-size: 24px;">FansMios 🌟</h1>
        </div>
        <div style="padding: 30px; background-color: #111;">
          <h2 style="color: #fff; margin-top: 0;">¡Tienes novedades!</h2>
          <p style="font-size: 16px; color: #ccc; line-height: 1.5;">${text}</p>
          <div style="text-align: center; margin-top: 30px;">
            <a href="http://localhost:3000/dashboard/notifications" style="background-color: #2563eb; color: white; padding: 12px 25px; text-decoration: none; border-radius: 25px; font-weight: bold; display: inline-block;">Ir a mi cuenta</a>
          </div>
        </div>
        <div style="padding: 15px; text-align: center; font-size: 12px; color: #666; background-color: #0a0a0a;">
          Puedes cambiar tus preferencias de correo en la Configuración de tu cuenta.
        </div>
      </div>
    `;

    // 4. Enviamos el correo bonito
    await transporter.sendMail({
      from: `"FansMios Notificaciones" <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: subject,
      html: htmlTemplate,
    });

    console.log(`📧 Correo de notificación enviado a ${user.email} (Tipo: ${type})`);

  } catch (error) {
    console.error("❌ Error al enviar correo inteligente:", error);
  }
};

// Exportamos ambas funciones sin romper lo que ya tenías
module.exports = sendEmail;
module.exports.sendEmail = sendEmail;
module.exports.sendNotificationEmail = sendNotificationEmail;