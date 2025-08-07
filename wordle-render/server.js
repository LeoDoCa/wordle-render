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

// Generar PIN para vinculación (solo app móvil autenticada)
app.post('/api/link/generate-pin', authMiddleware, async (req, res) => {
  try {
    if (!req.uid) {
      return res.status(401).json({ success: false, error: 'Usuario no autenticado' });
    }

    const result = await wordleService.generateLinkPin(req.uid);

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Error en generate-pin:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// Validar PIN y vincular (usado por Alexa)
app.post('/api/link/validate-pin', async (req, res) => {
  try {
    const { pin, alexaUserId } = req.body;

    if (!pin || !alexaUserId) {
      return res.status(400).json({
        success: false,
        error: 'PIN y alexaUserId son requeridos'
      });
    }

    const result = await wordleService.validatePinAndLink(pin, alexaUserId);

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Error en validate-pin:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// Rutas
app.all('/api/wordle', async (req, res) => {
  console.log('=== REQUEST DEBUG ===');
  console.log('UID:', req.uid);
  console.log('isAlexa:', req.isAlexa || false);
  console.log('Query:', req.query);
  console.log('Body:', req.body);
  console.log('====================');

  const { action, guess, pin, alexaUserId } = { ...req.query, ...req.body };
  const uid = req.uid;
  const alexaUserIdParam = req.isAlexa ? req.uid : null;

  let result = { success: false, error: 'Acción no válida' };

  try {
    switch (action) {
      case 'start':
        if (uid) {
          result = await wordleService.startGame(uid, alexaUserIdParam);
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

      // ===== Nuevos endpoints de vinculación =====
      case 'generate-pin':
        if (uid && !req.isAlexa) { // Solo para usuarios autenticados no-Alexa
          result = await wordleService.generateLinkPin(uid);
        } else {
          result = { success: false, error: 'Acción solo disponible para usuarios autenticados' };
        }
        break;

      case 'validate-pin':
        if (pin && alexaUserId) {
          result = await wordleService.validatePinAndLink(pin, alexaUserId);
        } else {
          result = { success: false, error: 'Se requiere PIN y alexaUserId' };
        }
        break;

      case 'unlink':
        if (uid && !req.isAlexa) { // Solo para usuarios autenticados no-Alexa
          result = await wordleService.unlinkAccounts(uid);
        } else {
          result = { success: false, error: 'Se requiere autenticación de usuario' };
        }
        break;

      case 'link-status':
        if (uid) {
          result = await wordleService.getLinkStatus(uid);
        } else {
          result = { success: false, error: 'Se requiere UID' };
        }
        break;

      case 'cleanup-pins':
        // Endpoint de mantenimiento (opcional)
        result = await wordleService.cleanupExpiredPins();
        break;
      case 'debug-history':
        // Endpoint para debug de historial (útil para troubleshooting)
        if (uid) {
          result = await wordleService.debugUserHistory(uid);
        } else {
          result = { success: false, error: 'Se requiere UID' };
        }
        break;
      case 'history':
        if (uid) {
          // Obtener parámetros de consulta
          const options = {
            limit: parseInt(req.query.limit) || 50,
            offset: parseInt(req.query.offset) || 0,
            sortBy: req.query.sortBy || 'completedAt',
            sortOrder: req.query.sortOrder || 'desc',
            filter: req.query.filter || 'all',
            dateFrom: req.query.dateFrom || null,
            dateTo: req.query.dateTo || null
          };

          result = await wordleService.getGameHistory(uid, options);
        } else {
          result = { success: false, error: 'Se requiere UID para obtener historial' };
        }
        break;

      case 'monthly-stats':
        if (uid) {
          const year = req.query.year ? parseInt(req.query.year) : null;
          const month = req.query.month ? parseInt(req.query.month) : null;
          result = await wordleService.getMonthlyStats(uid, year, month);
        } else {
          result = { success: false, error: 'Se requiere UID para estadísticas mensuales' };
        }
        break;

      case 'health':
        result = {
          success: true,
          message: 'API Wordle funcionando correctamente en Render',
          timestamp: new Date().toISOString(),
          version: '2.2.0',
          features: [
            'Historial de juegos',
            'Firebase UID',
            'Alexa fallback',
            'Vinculación por PIN',
            'Gestión de cuentas vinculadas'
          ]
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
            '// Juego',
            '?action=health',
            '?action=palabras',
            '?action=start&userId=usuario123',
            '?action=guess&userId=usuario123&guess=PLATO',
            '?action=current&userId=usuario123',
            '?action=reset&userId=usuario123',
            '?action=stats&userId=usuario123',
            '',
            '// Historial',
            '?action=history&userId=usuario123[&limit=20&offset=0&filter=won]',
            '?action=monthly-stats&userId=usuario123[&year=2024&month=8]',
            '',
            '// Vinculación',
            '?action=generate-pin (requiere auth)',
            '?action=validate-pin&pin=1234&alexaUserId=alexa123',
            '?action=link-status&userId=usuario123',
            '?action=unlink (requiere auth)',
            '?action=cleanup-pins'
          ]
        };
        break;
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
