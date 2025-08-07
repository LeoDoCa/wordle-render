const { db } = require('./firebase');

let PALABRAS_CACHE = [];
let PALABRAS_LOADED = false;

class WordleService {

  // ===== Palabras =====
  async loadPalabrasFromFirestore() {
    if (PALABRAS_LOADED && PALABRAS_CACHE.length > 0) return PALABRAS_CACHE;
    try {
      console.log('Cargando palabras desde Firestore...');
      const palabrasRef = db.collection('palabras');
      const snapshot = await palabrasRef.get();

      PALABRAS_CACHE = snapshot.docs
        .map(doc => doc.data().palabra?.toUpperCase())
        .filter(p => p && p.length === 5);

      PALABRAS_LOADED = true;
      console.log(`Cargadas ${PALABRAS_CACHE.length} palabras`);
      return PALABRAS_CACHE;
    } catch (error) {
      console.error('Error cargando palabras:', error);
      PALABRAS_CACHE = ["PLATO", "PRADO", "PLACA", "BRAZO", "CAMPO"];
      return PALABRAS_CACHE;
    }
  }

  async getRandomWord() {
    const palabras = await this.loadPalabrasFromFirestore();
    return palabras[Math.floor(Math.random() * palabras.length)];
  }

  async isValidWord(word) {
    const palabras = await this.loadPalabrasFromFirestore();
    return palabras.includes(word.toUpperCase());
  }

  // ===== Lógica juego =====
  generateFeedback(guess, targetWord) {
    const feedback = [];
    const target = targetWord.toUpperCase();
    const attempt = guess.toUpperCase();
    const usedPositions = Array(5).fill(false);

    // posiciones correctas
    for (let i = 0; i < 5; i++) {
      if (attempt[i] === target[i]) {
        feedback[i] = { letter: attempt[i], status: 'correct_pos' };
        usedPositions[i] = true;
      }
    }
    // letras correctas en lugar incorrecto
    for (let i = 0; i < 5; i++) {
      if (feedback[i]) continue;
      let found = false;
      for (let j = 0; j < 5; j++) {
        if (!usedPositions[j] && attempt[i] === target[j] && i !== j) {
          feedback[i] = { letter: attempt[i], status: 'correct_wrong_pos' };
          usedPositions[j] = true;
          found = true;
          break;
        }
      }
      if (!found) feedback[i] = { letter: attempt[i], status: 'not_in_word' };
    }
    return feedback;
  }

  async saveGameToHistory(gameData) {
    try {
      console.log('Guardando juego en historial:', {
        uid: gameData.uid,
        alexaUserId: gameData.alexaUserId,
        targetWord: gameData.targetWord,
        isWon: gameData.isWon,
        isLost: gameData.isLost
      });

      const historyRef = db.collection('gameHistory');

      // Calcular intentos usados de forma más robusta
      let attemptsUsed = 0;
      if (gameData.attemptsLeft !== undefined) {
        attemptsUsed = 6 - gameData.attemptsLeft;
      } else if (gameData.attempts && Array.isArray(gameData.attempts)) {
        attemptsUsed = gameData.attempts.length;
      }

      const historyData = {
        uid: gameData.uid, // Este debería ser el alexaUserId para juegos de Alexa
        alexaUserId: gameData.alexaUserId || null,
        firebaseUid: gameData.firebaseUid || null, // Agregar referencia al Firebase UID si existe
        targetWord: gameData.targetWord,
        isWon: gameData.isWon,
        isLost: gameData.isLost,
        attemptsUsed: attemptsUsed,
        attemptsLeft: gameData.attemptsLeft || 0,
        totalAttempts: gameData.attempts ? gameData.attempts.length : 0,
        attempts: gameData.attempts || [],
        completedAt: new Date(),
        gameStartedAt: gameData.createdAt || new Date()
      };

      const docRef = await historyRef.add(historyData);
      console.log('Juego guardado en historial con ID:', docRef.id);

      return { success: true, historyId: docRef.id };
    } catch (error) {
      console.error('Error guardando juego en historial:', error);
      return { success: false, error: error.message };
    }
  }

  async startGame(uid, alexaUserId = null) {
    try {
      const gameRef = db.collection('games').doc(uid);
      const gameDoc = await gameRef.get();

      if (gameDoc.exists) {
        const gameData = gameDoc.data();
        if (!gameData.isWon && !gameData.isLost) {
          return { success: true, game: gameData, message: 'Juego actual recuperado' };
        }
      }

      const randomWord = await this.getRandomWord();
      const newGame = {
        uid,
        alexaUserId,
        targetWord: randomWord,
        attempts: [],
        attemptsLeft: 6,
        isWon: false,
        isLost: false,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await gameRef.set(newGame);
      const responseGame = { ...newGame };
      delete responseGame.targetWord;

      return { success: true, game: responseGame, message: 'Nuevo juego iniciado' };
    } catch (error) {
      console.error('Error starting game:', error);
      return { success: false, error: 'Error al iniciar el juego' };
    }
  }

  async guessWord(uid, guess) {
    try {
      if (!guess || guess.length !== 5) {
        return { success: false, error: 'La palabra debe tener exactamente 5 letras' };
      }
      if (!await this.isValidWord(guess)) {
        return { success: false, error: 'Palabra no válida' };
      }

      const gameRef = db.collection('games').doc(uid);
      const gameDoc = await gameRef.get();
      if (!gameDoc.exists) return { success: false, error: 'No hay juego activo.' };

      const gameData = gameDoc.data();
      if (gameData.isWon || gameData.isLost) return { success: false, error: 'El juego ya ha terminado' };
      if (gameData.attemptsLeft <= 0) return { success: false, error: 'No quedan intentos' };

      const feedback = this.generateFeedback(guess, gameData.targetWord);
      const isWon = guess.toUpperCase() === gameData.targetWord.toUpperCase();
      const newAttemptsLeft = gameData.attemptsLeft - 1;
      const isLost = !isWon && newAttemptsLeft <= 0;

      const updatedGame = {
        ...gameData,
        attempts: [...gameData.attempts, { guess: guess.toUpperCase(), feedback }],
        attemptsLeft: newAttemptsLeft,
        isWon,
        isLost,
        updatedAt: new Date()
      };
      await gameRef.update(updatedGame);

      if (isWon || isLost) await this.saveGameToHistory(updatedGame);

      const response = {
        success: true,
        feedback,
        attemptsLeft: newAttemptsLeft,
        isWon,
        isLost,
        attempts: updatedGame.attempts,
        message: isWon ? `¡Ganaste! Palabra: ${gameData.targetWord}` :
          isLost ? `¡Perdiste! Palabra: ${gameData.targetWord}` :
            `Te quedan ${newAttemptsLeft} intentos`,
        gameStatus: isWon ? 'won' : isLost ? 'lost' : 'playing'
      };
      if (isWon || isLost) response.targetWord = gameData.targetWord;
      return response;

    } catch (error) {
      console.error('Error processing guess:', error);
      return { success: false, error: 'Error al procesar el intento' };
    }
  }

  async getCurrentGame(uid) {
    try {
      // Verificar si hay vinculación Alexa
      const linkDoc = await db.collection('linkedAccounts')
        .where('firebaseUid', '==', uid)
        .limit(1)
        .get();

      let gameUid = uid;
      let isLinkedToAlexa = false;
      let linkInfo = null;

      if (!linkDoc.empty) {
        const link = linkDoc.docs[0].data();
        gameUid = link.alexaUserId; // usar la partida de Alexa
        isLinkedToAlexa = true;
        linkInfo = {
          alexaUserId: link.alexaUserId,
          linkedAt: link.linkedAt
        };
      }

      const gameRef = db.collection('games').doc(gameUid);
      const gameDoc = await gameRef.get();

      if (!gameDoc.exists) {
        return {
          success: false,
          game: null,
          error: 'No hay juego activo',
          isLinkedToAlexa,
          linkInfo
        };
      }

      const gameData = gameDoc.data();
      const responseGame = { ...gameData };

      // Asegurar que siempre devolvamos los attempts para la visualización
      responseGame.attempts = gameData.attempts || [];
      responseGame.isLinkedToAlexa = isLinkedToAlexa;
      responseGame.linkInfo = linkInfo;

      // Agregar información adicional para la UI
      responseGame.totalAttempts = 6;
      responseGame.usedAttempts = responseGame.attempts.length;
      responseGame.remainingAttempts = gameData.attemptsLeft || 0;

      if (gameData.isWon) {
        responseGame.message = `¡Juego ganado! La palabra era: ${gameData.targetWord}`;
        responseGame.gameStatus = 'won';
        responseGame.targetWord = gameData.targetWord;
      } else if (gameData.isLost) {
        responseGame.message = `¡Juego perdido! La palabra era: ${gameData.targetWord}`;
        responseGame.gameStatus = 'lost';
        responseGame.targetWord = gameData.targetWord;
      } else {
        responseGame.message = `Juego en progreso. Intentos restantes: ${gameData.attemptsLeft}`;
        responseGame.gameStatus = 'playing';
        // En juegos activos, NO mostrar la palabra objetivo
        delete responseGame.targetWord;
      }

      return { success: true, game: responseGame };

    } catch (error) {
      console.error('Error getting current game:', error);
      return { success: false, error: 'Error al obtener el juego actual' };
    }
  }

  async resetGame(uid) {
    try {
      const gameRef = db.collection('games').doc(uid);
      await gameRef.delete();
      return await this.startGame(uid);
    } catch (error) {
      console.error('Error resetting game:', error);
      return { success: false, error: 'Error al reiniciar el juego' };
    }
  }

  // ===== Estadísticas =====
  async getEffectiveUid(uid) {
    try {
      // Si es una request de Alexa, usar directamente el alexaUserId
      if (uid && uid.startsWith('amzn1.ask')) {
        return uid;
      }

      // Si es un Firebase UID, verificar si hay vinculación
      const linkDoc = await db.collection('linkedAccounts')
        .where('firebaseUid', '==', uid)
        .limit(1)
        .get();

      if (!linkDoc.empty) {
        const link = linkDoc.docs[0].data();
        return link.alexaUserId; // usar el alexaUserId para las estadísticas
      }

      // Si no hay vinculación, usar el UID original
      return uid;
    } catch (error) {
      console.error('Error getting effective UID:', error);
      return uid; // fallback al UID original
    }
  }

  async calculateCurrentStreak(uid) {
    try {
      const effectiveUid = await this.getEffectiveUid(uid);
      console.log(`Calculando current streak para UID: ${uid} -> effectiveUid: ${effectiveUid}`);

      const historyRef = db.collection('gameHistory')
        .where('uid', '==', effectiveUid)
        .orderBy('completedAt', 'desc')
        .limit(50); // Limitar para optimizar

      const snapshot = await historyRef.get();

      if (snapshot.empty) {
        console.log('No hay historial de juegos');
        return 0;
      }

      let currentStreak = 0;
      for (const doc of snapshot.docs) {
        const game = doc.data();
        console.log(`Juego: isWon=${game.isWon}, completedAt=${game.completedAt?.toDate()}`);

        if (game.isWon) {
          currentStreak++;
        } else {
          break; // Se rompe la racha en el primer juego perdido
        }
      }

      console.log(`Current streak calculado: ${currentStreak}`);
      return currentStreak;
    } catch (error) {
      console.error('Error calculating current streak:', error);
      return 0;
    }
  }

  async calculateMaxStreak(uid) {
    try {
      const effectiveUid = await this.getEffectiveUid(uid);
      console.log(`Calculando max streak para UID: ${uid} -> effectiveUid: ${effectiveUid}`);

      const historyRef = db.collection('gameHistory')
        .where('uid', '==', effectiveUid)
        .orderBy('completedAt', 'asc');

      const snapshot = await historyRef.get();

      if (snapshot.empty) {
        console.log('No hay historial de juegos para max streak');
        return 0;
      }

      let maxStreak = 0;
      let currentStreak = 0;

      for (const doc of snapshot.docs) {
        const game = doc.data();
        if (game.isWon) {
          currentStreak++;
          maxStreak = Math.max(maxStreak, currentStreak);
        } else {
          currentStreak = 0; // Reiniciar racha
        }
      }

      console.log(`Max streak calculado: ${maxStreak}`);
      return maxStreak;
    } catch (error) {
      console.error('Error calculating max streak:', error);
      return 0;
    }
  }

  async getUserStats(uid) {
    try {
      const effectiveUid = await this.getEffectiveUid(uid);
      console.log(`Obteniendo estadísticas para UID: ${uid} -> effectiveUid: ${effectiveUid}`);

      const historyRef = db.collection('gameHistory').where('uid', '==', effectiveUid);
      const historySnapshot = await historyRef.get();

      if (historySnapshot.empty) {
        console.log('No hay historial de juegos para estadísticas');
        return {
          success: true,
          stats: {
            totalGames: 0,
            wins: 0,
            losses: 0,
            winPercentage: 0,
            currentStreak: 0,
            maxStreak: 0,
            attemptDistribution: [0, 0, 0, 0, 0, 0],
            averageAttempts: 0,
            effectiveUid,
            isLinked: effectiveUid !== uid
          }
        };
      }

      let totalGames = 0;
      let wins = 0;
      const attemptDistribution = [0, 0, 0, 0, 0, 0];

      historySnapshot.forEach(doc => {
        const game = doc.data();
        totalGames++;

        if (game.isWon) {
          wins++;
          // Calcular intentos usados
          let attemptsUsed = game.attemptsUsed;

          // Fallback si no existe attemptsUsed
          if (!attemptsUsed) {
            if (game.attemptsLeft !== undefined) {
              attemptsUsed = 6 - game.attemptsLeft;
            } else if (game.attempts && Array.isArray(game.attempts)) {
              attemptsUsed = game.attempts.length;
            } else {
              attemptsUsed = 1; // fallback por defecto
            }
          }

          // Asegurar que esté en rango válido
          if (attemptsUsed >= 1 && attemptsUsed <= 6) {
            attemptDistribution[attemptsUsed - 1]++;
          }
        }
      });

      // Calcular rachas
      const currentStreak = await this.calculateCurrentStreak(uid);
      const maxStreak = await this.calculateMaxStreak(uid);

      // Calcular promedio de intentos
      const totalSuccessfulAttempts = attemptDistribution.reduce(
        (sum, count, index) => sum + (count * (index + 1)),
        0
      );
      const averageAttempts = wins > 0
        ? Math.round((totalSuccessfulAttempts / wins) * 10) / 10
        : 0;

      const stats = {
        totalGames,
        wins,
        losses: totalGames - wins,
        winPercentage: totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0,
        currentStreak,
        maxStreak,
        attemptDistribution,
        averageAttempts,
        effectiveUid,
        isLinked: effectiveUid !== uid
      };

      console.log('Estadísticas calculadas:', stats);

      return {
        success: true,
        stats
      };
    } catch (error) {
      console.error('Error getting user stats:', error);
      return {
        success: false,
        error: 'Error al obtener estadísticas: ' + error.message
      };
    }
  }

  // Método adicional para debug/verificación
  async debugUserHistory(uid) {
    try {
      const effectiveUid = await this.getEffectiveUid(uid);
      console.log(`=== DEBUG HISTORY para ${uid} -> ${effectiveUid} ===`);

      const historyRef = db.collection('gameHistory')
        .where('uid', '==', effectiveUid)
        .orderBy('completedAt', 'desc')
        .limit(10);

      const snapshot = await historyRef.get();

      const games = [];
      snapshot.forEach(doc => {
        const game = doc.data();
        games.push({
          id: doc.id,
          isWon: game.isWon,
          isLost: game.isLost,
          attemptsUsed: game.attemptsUsed,
          attemptsLeft: game.attemptsLeft,
          totalAttempts: game.attempts?.length || 0,
          completedAt: game.completedAt?.toDate(),
          targetWord: game.targetWord
        });
      });

      console.log('Últimos 10 juegos:', games);
      console.log('===============================');

      return {
        success: true,
        effectiveUid,
        totalFound: snapshot.size,
        games: games.slice(0, 5) // Solo devolver 5 para la respuesta
      };
    } catch (error) {
      console.error('Error en debug:', error);
      return { success: false, error: error.message };
    }
  }

  // ===== Vinculación de cuentas =====
  async generateLinkPin(firebaseUid) {
    try {
      // Verificar si ya hay un PIN activo para este usuario
      const existingPinsQuery = await db.collection('linkPins')
        .where('firebaseUid', '==', firebaseUid)
        .get();

      // Eliminar PINs existentes del usuario
      if (!existingPinsQuery.empty) {
        const batch = db.batch();
        existingPinsQuery.docs.forEach(doc => {
          batch.delete(doc.ref);
        });
        await batch.commit();
      }

      // Generar nuevo PIN único
      let pin, pinExists;
      do {
        pin = Math.floor(1000 + Math.random() * 9000).toString();
        const pinDoc = await db.collection('linkPins').doc(pin).get();
        pinExists = pinDoc.exists;
      } while (pinExists);

      // Guardar PIN con expiración de 5 minutos
      await db.collection('linkPins').doc(pin).set({
        firebaseUid,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000) // 5 minutos
      });

      return {
        success: true,
        pin,
        expiresIn: 300, // segundos
        message: 'PIN generado correctamente. Válido por 5 minutos.'
      };
    } catch (error) {
      console.error('Error generating PIN:', error);
      return { success: false, error: 'Error al generar PIN' };
    }
  }

  async validatePinAndLink(pin, alexaUserId) {
    try {
      if (!pin || !alexaUserId) {
        return { success: false, error: 'PIN y alexaUserId son requeridos' };
      }

      // Buscar PIN
      const pinDoc = await db.collection('linkPins').doc(pin).get();
      if (!pinDoc.exists) {
        return { success: false, error: 'PIN inválido' };
      }

      const pinData = pinDoc.data();
      const { firebaseUid, createdAt } = pinData;

      // Verificar expiración
      const ageMs = Date.now() - createdAt.toDate().getTime();
      if (ageMs > 5 * 60 * 1000) {
        // Eliminar PIN expirado
        await pinDoc.ref.delete();
        return { success: false, error: 'PIN expirado' };
      }

      // Verificar si ya existe una vinculación para este Alexa User
      const existingLinkQuery = await db.collection('linkedAccounts')
        .where('alexaUserId', '==', alexaUserId)
        .limit(1)
        .get();

      if (!existingLinkQuery.empty) {
        // Actualizar vinculación existente
        const linkDoc = existingLinkQuery.docs[0];
        await linkDoc.ref.update({
          firebaseUid,
          linkedAt: new Date(),
          updatedAt: new Date()
        });
      } else {
        // Crear nueva vinculación
        await db.collection('linkedAccounts').add({
          alexaUserId,
          firebaseUid,
          linkedAt: new Date(),
          createdAt: new Date()
        });
      }

      // Eliminar PIN usado
      await pinDoc.ref.delete();

      return {
        success: true,
        message: 'Cuenta vinculada correctamente',
        firebaseUid,
        alexaUserId
      };
    } catch (error) {
      console.error('Error validating PIN:', error);
      return { success: false, error: 'Error al validar PIN' };
    }
  }

  async unlinkAccounts(firebaseUid) {
    try {
      // Buscar vinculaciones por Firebase UID
      const linkQuery = await db.collection('linkedAccounts')
        .where('firebaseUid', '==', firebaseUid)
        .get();

      if (linkQuery.empty) {
        return { success: false, error: 'No hay vinculación existente' };
      }

      // Eliminar todas las vinculaciones para este usuario
      const batch = db.batch();
      linkQuery.docs.forEach(doc => {
        batch.delete(doc.ref);
      });
      await batch.commit();

      // También eliminar PINs pendientes del usuario
      const pinsQuery = await db.collection('linkPins')
        .where('firebaseUid', '==', firebaseUid)
        .get();

      if (!pinsQuery.empty) {
        const pinsBatch = db.batch();
        pinsQuery.docs.forEach(doc => {
          pinsBatch.delete(doc.ref);
        });
        await pinsBatch.commit();
      }

      return {
        success: true,
        message: 'Cuenta desvinculada exitosamente'
      };
    } catch (error) {
      console.error('Error unlinking accounts:', error);
      return { success: false, error: 'Error al desvincular cuenta' };
    }
  }

  async getLinkStatus(firebaseUid) {
    try {
      const linkDoc = await db.collection('linkedAccounts')
        .where('firebaseUid', '==', firebaseUid)
        .limit(1)
        .get();

      if (linkDoc.empty) {
        return {
          success: true,
          isLinked: false,
          message: 'Cuenta no vinculada con Alexa'
        };
      }

      const link = linkDoc.docs[0].data();
      return {
        success: true,
        isLinked: true,
        alexaUserId: link.alexaUserId,
        linkedAt: link.linkedAt,
        message: 'Cuenta vinculada con Alexa'
      };
    } catch (error) {
      console.error('Error getting link status:', error);
      return { success: false, error: 'Error al verificar estado de vinculación' };
    }
  }

  // Método para limpiar PINs expirados (opcional, para mantenimiento)
  async cleanupExpiredPins() {
    try {
      const now = new Date();
      const expiredPinsQuery = await db.collection('linkPins')
        .where('createdAt', '<', new Date(now.getTime() - 5 * 60 * 1000))
        .get();

      if (!expiredPinsQuery.empty) {
        const batch = db.batch();
        expiredPinsQuery.docs.forEach(doc => {
          batch.delete(doc.ref);
        });
        await batch.commit();
        console.log(`Limpiados ${expiredPinsQuery.docs.length} PINs expirados`);
      }

      return { success: true, cleaned: expiredPinsQuery.docs.length };
    } catch (error) {
      console.error('Error cleaning expired PINs:', error);
      return { success: false, error: 'Error al limpiar PINs expirados' };
    }
  }

  // Agregar este método a tu WordleService.js

  async getGameHistory(uid, options = {}) {
    try {
      const {
        limit = 50,
        offset = 0,
        sortBy = 'completedAt',
        sortOrder = 'desc',
        filter = 'all', // 'all', 'won', 'lost'
        dateFrom = null,
        dateTo = null
      } = options;

      const effectiveUid = await this.getEffectiveUid(uid);
      console.log(`Obteniendo historial para UID: ${uid} -> effectiveUid: ${effectiveUid}`);

      let query = db.collection('gameHistory').where('uid', '==', effectiveUid);

      // Aplicar filtros
      if (filter === 'won') {
        query = query.where('isWon', '==', true);
      } else if (filter === 'lost') {
        query = query.where('isLost', '==', true);
      }

      // Filtros de fecha
      if (dateFrom) {
        query = query.where('completedAt', '>=', new Date(dateFrom));
      }
      if (dateTo) {
        query = query.where('completedAt', '<=', new Date(dateTo));
      }

      // Ordenar
      query = query.orderBy(sortBy, sortOrder);

      // Obtener total de documentos para paginación
      const totalSnapshot = await query.get();
      const totalCount = totalSnapshot.size;

      // Aplicar paginación
      if (offset > 0) {
        query = query.offset(offset);
      }
      query = query.limit(limit);

      const snapshot = await query.get();

      if (snapshot.empty) {
        return {
          success: true,
          games: [],
          pagination: {
            total: 0,
            limit,
            offset,
            hasMore: false
          },
          summary: {
            totalGames: 0,
            wonGames: 0,
            lostGames: 0,
            winRate: 0,
            averageAttempts: 0
          }
        };
      }

      const games = [];
      let totalAttempts = 0;
      let wonGames = 0;

      snapshot.forEach(doc => {
        const gameData = doc.data();

        // Calcular intentos usados de forma robusta
        let attemptsUsed = gameData.attemptsUsed;
        if (!attemptsUsed) {
          if (gameData.attemptsLeft !== undefined) {
            attemptsUsed = 6 - gameData.attemptsLeft;
          } else if (gameData.attempts && Array.isArray(gameData.attempts)) {
            attemptsUsed = gameData.attempts.length;
          } else {
            attemptsUsed = gameData.isWon ? 1 : 6; // fallback
          }
        }

        const game = {
          id: doc.id,
          targetWord: gameData.targetWord,
          isWon: gameData.isWon,
          isLost: gameData.isLost,
          attemptsUsed,
          attemptsLeft: gameData.attemptsLeft || 0,
          attempts: gameData.attempts || [],
          completedAt: gameData.completedAt?.toDate(),
          gameStartedAt: gameData.gameStartedAt?.toDate(),
          duration: this.calculateGameDuration(gameData.gameStartedAt, gameData.completedAt),
          score: this.calculateGameScore(gameData.isWon, attemptsUsed),
          difficulty: this.assessWordDifficulty(gameData.targetWord)
        };

        games.push(game);

        // Acumular para estadísticas
        if (gameData.isWon) {
          wonGames++;
          totalAttempts += attemptsUsed;
        }
      });

      // Calcular estadísticas del historial
      const summary = {
        totalGames: games.length,
        wonGames,
        lostGames: games.length - wonGames,
        winRate: games.length > 0 ? Math.round((wonGames / games.length) * 100) : 0,
        averageAttempts: wonGames > 0 ? Math.round((totalAttempts / wonGames) * 10) / 10 : 0,
        bestGame: this.findBestGame(games),
        recentStreak: this.calculateRecentStreak(games),
        favoriteStartingLetters: this.analyzeFavoriteLetters(games)
      };

      return {
        success: true,
        games,
        pagination: {
          total: totalCount,
          limit,
          offset,
          hasMore: offset + limit < totalCount,
          currentPage: Math.floor(offset / limit) + 1,
          totalPages: Math.ceil(totalCount / limit)
        },
        summary,
        effectiveUid,
        isLinked: effectiveUid !== uid
      };

    } catch (error) {
      console.error('Error getting game history:', error);
      return {
        success: false,
        error: 'Error al obtener el historial: ' + error.message
      };
    }
  }

  // Métodos auxiliares para análisis del historial
  calculateGameDuration(startTime, endTime) {
    if (!startTime || !endTime) return null;
    const diffMs = endTime.toDate().getTime() - startTime.toDate().getTime();
    const diffMinutes = Math.round(diffMs / (1000 * 60));
    return diffMinutes;
  }

  calculateGameScore(isWon, attemptsUsed) {
    if (!isWon) return 0;
    // Puntuación: más puntos por menos intentos
    return Math.max(0, 60 - (attemptsUsed * 10));
  }

  assessWordDifficulty(word) {
    if (!word) return 'unknown';

    // Palabras con letras repetidas son más difíciles
    const uniqueLetters = new Set(word.toLowerCase()).size;
    const hasRepeatedLetters = uniqueLetters < word.length;

    // Palabras con letras poco comunes
    const commonLetters = 'aeiourlnstcdm';
    const uncommonLetterCount = word.toLowerCase()
      .split('')
      .filter(letter => !commonLetters.includes(letter))
      .length;

    if (uncommonLetterCount >= 3 || hasRepeatedLetters) {
      return 'hard';
    } else if (uncommonLetterCount >= 1) {
      return 'medium';
    }
    return 'easy';
  }

  findBestGame(games) {
    if (!games.length) return null;

    const wonGames = games.filter(g => g.isWon);
    if (!wonGames.length) return null;

    // Mejor juego: menos intentos, o más reciente si hay empate
    return wonGames.reduce((best, current) => {
      if (current.attemptsUsed < best.attemptsUsed) {
        return current;
      } else if (current.attemptsUsed === best.attemptsUsed &&
        current.completedAt > best.completedAt) {
        return current;
      }
      return best;
    });
  }

  calculateRecentStreak(games) {
    if (!games.length) return 0;

    // Juegos ya están ordenados por fecha desc
    let streak = 0;
    for (const game of games) {
      if (game.isWon) {
        streak++;
      } else {
        break;
      }
    }
    return streak;
  }

  analyzeFavoriteLetters(games) {
    const letterCount = {};

    games.forEach(game => {
      if (game.targetWord && game.targetWord.length > 0) {
        const firstLetter = game.targetWord[0].toUpperCase();
        letterCount[firstLetter] = (letterCount[firstLetter] || 0) + 1;
      }
    });

    return Object.entries(letterCount)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([letter, count]) => ({ letter, count }));
  }

  // Método para obtener estadísticas mensuales
  async getMonthlyStats(uid, year = null, month = null) {
    try {
      const effectiveUid = await this.getEffectiveUid(uid);
      const currentDate = new Date();
      const targetYear = year || currentDate.getFullYear();
      const targetMonth = month || currentDate.getMonth() + 1;

      const startDate = new Date(targetYear, targetMonth - 1, 1);
      const endDate = new Date(targetYear, targetMonth, 0, 23, 59, 59);

      const query = db.collection('gameHistory')
        .where('uid', '==', effectiveUid)
        .where('completedAt', '>=', startDate)
        .where('completedAt', '<=', endDate)
        .orderBy('completedAt', 'desc');

      const snapshot = await query.get();

      const dailyStats = {};
      let totalGames = 0;
      let totalWins = 0;

      snapshot.forEach(doc => {
        const game = doc.data();
        const day = game.completedAt.toDate().getDate();

        if (!dailyStats[day]) {
          dailyStats[day] = { games: 0, wins: 0, attempts: [] };
        }

        dailyStats[day].games++;
        totalGames++;

        if (game.isWon) {
          dailyStats[day].wins++;
          totalWins++;

          const attemptsUsed = game.attemptsUsed || (6 - (game.attemptsLeft || 0));
          dailyStats[day].attempts.push(attemptsUsed);
        }
      });

      return {
        success: true,
        year: targetYear,
        month: targetMonth,
        totalGames,
        totalWins,
        winRate: totalGames > 0 ? Math.round((totalWins / totalGames) * 100) : 0,
        dailyStats,
        monthName: new Date(targetYear, targetMonth - 1).toLocaleString('es', { month: 'long' })
      };

    } catch (error) {
      console.error('Error getting monthly stats:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new WordleService();
