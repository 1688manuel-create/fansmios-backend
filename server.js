// backend/server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit'); 
require('dotenv').config();
const Sentry = require('@sentry/node'); 
const http = require('http');
const { Server } = require('socket.io'); 

// 🔥 NUEVO: El Cadenero VIP de LiveKit
const { AccessToken } = require('livekit-server-sdk');

// Importación de Tareas en Segundo Plano (Cron Jobs)
const { startSubscriptionCron } = require('./utils/subscriptionCron'); 
const startBalanceReleaser = require('./cron/balanceReleaser'); 
const cron = require('node-cron'); 
const postController = require('./controllers/postController'); 

// ==========================================
// 1. INICIALIZACIÓN Y MONITOREO (Sentry)
// ==========================================
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0, 
});

const app = express();

// 🔥 CRÍTICO: Confiar en el proxy de Coolify para que el Escudo Anti-Bots no bloquee usuarios reales
app.set('trust proxy', 1);

const server = http.createServer(app); 
const PORT = process.env.PORT || 5000;

// ==========================================
// 2. SISTEMA MAESTRO DE WEBSOCKETS (TIEMPO REAL)
// ==========================================
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

try {
  const socketHandler = require('./utils/socketHandler');
  if (typeof socketHandler.init === 'function') {
      socketHandler.init(io); 
  }
  console.log("✅ Antena de Chat Privado conectada.");
} catch (error) {
  console.log("⚠️ Aviso: Antena de Chat requiere revisión, pero el servidor sigue vivo.");
}

try {
  require('./sockets/liveSocket')(io);
  console.log("✅ Antena de Live Streaming conectada.");
} catch (error) {
  console.log("⚠️ Aviso: Antena de Live Streaming en pausa.");
}

// ==========================================
// 3. MIDDLEWARES GLOBALES (El Filtro)
// ==========================================
app.use(cors());
app.use(express.json()); 
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ==========================================
// 4. ESCUDO ANTI-BOTS (Rate Limiting)
// ==========================================
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 10, 
  message: { error: 'Demasiados intentos desde esta IP, por favor intenta más tarde. 🛡️' }
});

// ==========================================
// 5. ENRUTADOR PRINCIPAL
// ==========================================
app.get('/', (req, res) => {
  res.json({ message: 'Motor Unicornio funcionando y blindado 🚀' });
});

app.use('/api/auth', authLimiter, require('./routes/authRoutes'));
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/profile', require('./routes/profileRoutes'));
app.use('/api/content', require('./routes/contentRoutes'));
app.use('/api/posts', require('./routes/postRoutes'));
app.use('/api/stories', require('./routes/storyRoutes'));
app.use('/api/explore', require('./routes/exploreRoutes')); 
app.use('/api/discover', require('./routes/discoverRoutes'));
app.use('/api/bookmarks', require('./routes/bookmarkRoutes'));

app.use('/api/payments', require('./routes/paymentRoutes'));
app.use('/api/webhooks', require('./routes/webhookRoutes')); 
app.use('/api/finance', require('./routes/monetizationRoutes'));
app.use('/api/wallet', require('./routes/walletRoutes')); 
app.use('/api/bundles', require('./routes/bundleRoutes'));
app.use('/api/coupons', require('./routes/couponRoutes'));
app.use('/api/promotions', require('./routes/promotionRoutes')); 

app.use('/api/messages', require('./routes/messageRoutes'));
app.use('/api/live', require('./routes/liveRoutes'));
app.use('/api/fans', require('./routes/fanRoutes'));

app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/dashboard', require('./routes/dashboardRoutes'));
app.use('/api/moderation', require('./routes/moderationRoutes'));
app.use('/api/reports', require('./routes/reportRoutes'));
app.use('/api/settings', require('./routes/settingsRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));
app.use('/api/upload', require('./routes/uploadRoutes'));
app.use('/api/referrals', require('./routes/referralRoutes'));
app.use('/api/analytics', require('./routes/analyticsRoutes'));
app.use('/api/profile/kyc', require('./routes/kycRoutes'));
app.use('/api/2fa', require('./routes/auth2faRoutes'));

// 🔥 NUEVO: RUTA PARA EL BOLETO DE LIVEKIT (EXPERIENCIA TIKTOK)
app.post('/api/livekit/token', async (req, res) => {
  try {
    const { roomName, participantName, isCreator } = req.body;

    const at = new AccessToken(
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET,
      {
        identity: participantName,
        ttl: '2h', 
      }
    );

    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: isCreator === true, 
      canSubscribe: true,    
    });

    const token = await at.toJwt();
    res.json({ token: token });

  } catch (error) {
    console.error("Error generando token de LiveKit:", error);
    res.status(500).json({ error: "No se pudo generar el acceso al Live" });
  }
});

// ==========================================
// 6. TRABAJADORES Y MANEJO DE ERRORES
// ==========================================
try { require('./workers/broadcastWorker'); } catch(e) {}
Sentry.setupExpressErrorHandler(app);

// 🤖 ENCENDIDO DE CRON JOBS (ROBOTS EN SEGUNDO PLANO)
startSubscriptionCron(); 
startBalanceReleaser(); 
console.log('🤖 Motores de Automatización (Suscripciones y Saldos) Activados.');

// 🔥 EL PERRO GUARDIÁN: Patrulla Anti-IA todos los días a las 3:00 AM
cron.schedule('0 3 * * *', async () => {
  console.log('🐕 [CRON] Despertando al Perro Guardián Anti-IA...');
  
  const mockReq = {};
  const mockRes = {
    status: function(code) {
      return {
        json: function(data) {
          console.log(`🐕 [CRON] Patrullaje finalizado (Status: ${code}):`, data);
        }
      };
    }
  };

  try {
    if (typeof postController.scanExistingPostsForAI === 'function') {
      await postController.scanExistingPostsForAI(mockReq, mockRes);
    } else {
      console.log('⚠️ [CRON] La función scanExistingPostsForAI no se encontró en postController.');
    }
  } catch (error) {
    console.error('❌ [CRON] Error durante el patrullaje Anti-IA:', error);
  }
});
console.log('⏳ Reloj Biológico (Cron) activado. El Perro Guardián patrullará a las 3:00 AM.');

// ==========================================
// 7. ENCENDIDO DEL SERVIDOR
// ==========================================
server.listen(PORT, () => {
  console.log(`🚀 Servidor HTTP y WebSockets corriendo en el puerto ${PORT}`);
});