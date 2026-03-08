// backend/utils/socketHandler.js
const { Server } = require('socket.io');

let io;

module.exports = {
  // Inicializamos la antena en el servidor
  init: (httpServer) => {
    io = new Server(httpServer, {
      cors: {
        origin: "*", // En producción aquí pondremos la URL de tu frontend (Ej: https://tudominio.com)
        methods: ["GET", "POST"]
      }
    });

    io.on('connection', (socket) => {
      console.log(`🔌 Nuevo cliente conectado: ${socket.id}`);

      // Cuando un usuario inicie sesión, lo unimos a un "cuarto" personal con su ID
      socket.on('joinRoom', (userId) => {
        socket.join(userId);
        console.log(`👤 Usuario ${userId} se unió a su cuarto privado.`);
      });

      socket.on('disconnect', () => {
        console.log(`🚫 Cliente desconectado: ${socket.id}`);
      });
    });

    return io;
  },
  
  // Función para obtener la antena desde cualquier otro archivo (Ej: para mandar notificaciones)
  getIO: () => {
    if (!io) {
      throw new Error('Socket.io no ha sido inicializado.');
    }
    return io;
  }
};