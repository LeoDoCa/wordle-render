const express = require('express');
const cors = require('cors');
const wordleService = require('./lib/wordleService');
const authMiddleware = require('./authMiddleware');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware de autenticación
app.use('/api/wordle', authMiddleware);

// Rutas
app.all('/api/wordle', async (req, res) => {
  console.log('=== REQUEST DEBUG ===');
  console.log('UID:', req.uid);
  console.log('isAlexa:', req.isAlexa || false);
  console.log('Query:', req.query);
  console.log('Body:', req.body);
  console.log('====================');

  const { action, guess } = { ...req.query, ...req.body };
  const uid = req.uid;
  const alexaUserId = req.isAlexa ? req.uid : null;

  let result = { success: false, error: 'Acción no válida' };

  try {
    switch (action) {
      case 'start':
        if (uid) {
          result = await wordleService.startGame(uid, alexaUserId);
        } else {
          result = { success: false, error: 'Se requiere UID o userId' };
        }
        break;

      case 'guess':
        if (uid && guess) {
          result = await wordleService.guessWord(uid, guess);
        } else {
          result = { success: false, error: 'Se requiere UID/userId y guess' };
        }
        break;

      case 'current':
        if (uid) {
          result = await wordleService.getCurrentGame(uid);
        } else {
          result = { success: false, error: 'Se requiere UID/userId' };
        }
        break;

      case 'reset':
        if (uid) {
          result = await wordleService.resetGame(uid);
        } else {
          result = { success: false, error: 'Se requiere UID/userId' };
        }
        break;

      case 'stats':
        if (uid) {
          result = await wordleService.getUserStats(uid);
        } else {
          result = { success: false, error: 'Se requiere UID/userId' };
        }
        break;

      case 'health':
        result = {
          success: true,
          message: 'API Wordle funcionando correctamente en Render',
          timestamp: new Date().toISOString(),
          version: '2.1.0',
          features: ['Historial de juegos', 'Firebase UID', 'Alexa fallback']
        };
        break;

      case 'palabras':
        const palabras = await wordleService.loadPalabrasFromFirestore();
        result = {
          success: true,
          totalPalabras: palabras.length,
          ejemplos: palabras.slice(0, 10),
          message: `Se cargaron ${palabras.length} palabras`
        };
        break;

      default:
        result = {
          success: false,
          error: 'Acción no válida',
          usage: [
            '?action=health',
            '?action=palabras',
            '?action=start&userId=usuario123',
            '?action=guess&userId=usuario123&guess=PLATO',
            '?action=current&userId=usuario123',
            '?action=reset&userId=usuario123',
            '?action=stats&userId=usuario123'
          ]
        };
    }
  } catch (error) {
    console.error('Error en API:', error);
    result = { success: false, error: error.message || 'Error interno del servidor' };
  }

  res.json(result);
});

// Health Check
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'API Wordle funcionando correctamente',
    timestamp: new Date().toISOString(),
    endpoints: ['/api/wordle']
  });
});

app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
