/* eslint-disable */
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const fetch = require("node-fetch");
const { onSchedule } = require("firebase-functions/v2/scheduler");

admin.initializeApp();

const db = admin.firestore();
const bucket = admin.storage().bucket();

// 🔐 Secrets
const WHATSAPP_TOKEN = defineSecret("WHATSAPP_TOKEN");
const WHATSAPP_PHONE_ID = defineSecret("WHATSAPP_PHONE_ID");

/* =====================================
   MIDDLEWARE VERIFICAR ADMIN
===================================== */
async function verificarAdmin(req, res) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({
      success: false,
      error: "No autorizado",
    });
    return null;
  }

  try {
    const token = authHeader.split("Bearer ")[1];
    const decodedToken = await admin.auth().verifyIdToken(token);

    if (!decodedToken.admin) {
      res.status(403).json({
        success: false,
        error: "Solo administradores pueden ejecutar esta acción",
      });
      return null;
    }

    return decodedToken;

  } catch (error) {
    res.status(401).json({
      success: false,
      error: "Token inválido",
    });
    return null;
  }
}
/* =====================================
   CREAR RIFA + SUBIR COMPROBANTE
===================================== */
exports.crearRifaConComprobante = onRequest(
  { cors: true },
  async (req, res) => {
    try {
      const { numero, nombre, telefono, email, imagenBase64 } = req.body;

      if (!numero || !nombre || !telefono || !email || !imagenBase64) {
        return res
          .status(400)
          .json({ success: false, error: "Datos incompletos" });
      }

      // 🔎 Buscar sorteo activo
      const sorteoSnapshot = await db
        .collection("sorteos")
        .where("estado", "==", "activo")
        .limit(1)
        .get();

      if (sorteoSnapshot.empty) {
        return res.status(400).json({
          success: false,
          error: "No hay sorteo activo",
        });
      }
      const sorteoDoc = sorteoSnapshot.docs[0];
      const sorteoId = sorteoDoc.id;
      const sorteoData = sorteoDoc.data();

      if (new Date() > sorteoData.fechaSorteo.toDate()) {
        return res.status(400).json({
          success: false,
          error: "El sorteo ya finalizó",
        });
      }

      const participanteRef = db
        .collection("sorteos")
        .doc(sorteoId)
        .collection("participantes")
        .doc(numero.toString());

      // 🚫 Verificar si el número ya existe en este sorteo
      const existente = await participanteRef.get();

      if (existente.exists) {
        return res.status(400).json({
          success: false,
          error: "Este número ya está reservado en este sorteo",
        });
      }

      // 🖼️ Guardar imagen
      const buffer = Buffer.from(imagenBase64, "base64");
      const file = bucket.file(
        `comprobantes/${sorteoId}_${numero}_${Date.now()}.jpg`,
      );

      await file.save(buffer, { contentType: "image/jpeg" });

      const [url] = await file.getSignedUrl({
        action: "read",
        expires: "03-01-2030",
      });

      // 💾 Guardar participante dentro del sorteo
      await participanteRef.set({
        numero,
        nombre,
        telefono,
        email,
        comprobanteURL: url,
        estado: "pendiente",
        creadoEn: admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.json({ success: true });
    } catch (err) {
      console.error("❌ crearRifa:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  },
);

/* =====================================
   APROBAR PAGO + WHATSAPP
===================================== */
exports.aprobarPago = onRequest(
  {
    secrets: [WHATSAPP_TOKEN, WHATSAPP_PHONE_ID],
    cors: true,
  },
  async (req, res) => {
    try {
      const adminUser = await verificarAdmin(req, res);
      if (!adminUser) return;
      // rename telefono from body to avoid conflicts with later sanitization
      const { numero, telefono: telefonoGanador, nombre } = req.body;

      console.log("📥 BODY:", req.body);

      if (!numero || !telefonoGanador) {
        return res.status(400).json({
          success: false,
          error: "numero y telefono son requeridos",
        });
      }

      // 🔎 Buscar sorteo activo automáticamente
      const sorteoSnapshot = await db
        .collection("sorteos")
        .where("estado", "==", "activo")
        .limit(1)
        .get();

      if (sorteoSnapshot.empty) {
        return res.status(400).json({
          success: false,
          error: "No hay sorteo activo",
        });
      }

      const sorteoId = sorteoSnapshot.docs[0].id;

      const docRef = db
        .collection("sorteos")
        .doc(sorteoId)
        .collection("participantes")
        .doc(numero.toString());

      const snap = await docRef.get();

      if (!snap.exists) {
        return res.status(404).json({
          success: false,
          error: "Participante no existe en este sorteo",
        });
      }

      const data = snap.data();

      if (data.estado === "aprobado") {
        return res.status(400).json({
          success: false,
          error: "Este número ya fue aprobado",
        });
      }
      let telefono = telefonoGanador.toString().replace(/\D/g, "");
      if (telefono.startsWith("0")) {
        telefono = telefono.substring(1);
      }
      // ✅ agregar código país Colombia
      if (!telefono.startsWith("57")) {
        telefono = "57" + telefono;
      }
      console.log("📲 Teléfono final:", telefono);
     // ✅ 1️⃣ Aprobar primero SIEMPRE
await docRef.update({
  estado: "aprobado",
  aprobadoEn: admin.firestore.FieldValue.serverTimestamp(),
  mensajeEnviado: false,
});

// 📲 2️⃣ Intentar enviar WhatsApp (pero que no bloquee)
try {
  const whatsappResponse = await fetch(
    `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_ID.value()}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN.value()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: telefono, // ⚠ ya tiene 57
        type: "template",
        template: {
          name: "hello_world",
          language: { code: "en_US" },
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: nombre || "Participante" },
                { type: "text", text: numero.toString() },
              ],
            },
          ],
        },
      }),
    }
  );

  const whatsappData = await whatsappResponse.json();

  if (whatsappResponse.ok) {
    await docRef.update({
      mensajeEnviado: true,
    });
  } else {
    console.error("⚠ WhatsApp falló:", whatsappData);
      return res.status(400).json({
    success: false,
    error: whatsappData,
  });
}

} catch (err) {
  console.error("⚠ Error enviando WhatsApp:", err.message);
}

// ✅ 3️⃣ Siempre responder éxito porque ya aprobamos
return res.json({ success: true });

  } catch (error) {
    console.error(" Error Whatsapp", error);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});


/* =====================================
   ELEGIR GANADOR POR LOTERÍA + AUTO MES
===================================== */
exports.elegirGanadorPorLoteria = onRequest(
  { cors: true, secrets: [WHATSAPP_TOKEN, WHATSAPP_PHONE_ID] },
  async (req, res) => {
    try {
      const adminUser = await verificarAdmin(req, res);
      if (!adminUser) return;

      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
          success: false,
          error: "No autorizado",
        });
      }

      const token = authHeader.split("Bearer ")[1];
      const decodedToken = await admin.auth().verifyIdToken(token);

      if (!decodedToken.admin) {
        return res.status(403).json({
          success: false,
          error: "Solo administradores pueden ejecutar esta acción",
        });
      }
      const { sorteoId, numeroLoteria, nombreLoteria } = req.body;

      if (!sorteoId || !numeroLoteria || !nombreLoteria) {
        return res.status(400).json({
          success: false,
          error: "Datos incompletos",
        });
      }

      const sorteoRef = db.collection(db, "sorteos").doc(sorteoId);
      const sorteoSnap = await sorteoRef.get();

      if (!sorteoSnap.exists) {
        return res.status(404).json({
          success: false,
          error: "Sorteo no existe",
        });
      }

      const sorteoData = sorteoSnap.data();

      if (sorteoData.ganadorElegido) {
        return res.status(400).json({
          success: false,
          error: "Ya hay un ganador elegido",
        });
      }

      // 🔢 Últimas 2 cifras
      const numeroGanador = numeroLoteria.toString().slice(-2);

      const participanteRef = sorteoRef
        .collection("participantes")
        .doc(numeroGanador);

      const participanteSnap = await participanteRef.get();

      if (!participanteSnap.exists) {
        return res.status(400).json({
          success: false,
          error: "El número ganador no fue vendido",
        });
      }

      if (participanteSnap.data().estado !== "aprobado") {
        return res.status(400).json({
          success: false,
          error: "El número ganador no está aprobado",
        });
      }

      const ganador = participanteSnap.data();

      // 📲 Enviar WhatsApp automáticamente
      await fetch(
        `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_ID.value()}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${WHATSAPP_TOKEN.value()}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: ganador.telefono,
            type: "text",
            text: {
              body: `🎉 ¡Felicidades ${ganador.nombre}! Tu número ${numeroGanador} fue el ganador del sorteo (${nombreLoteria}). Nos estaremos comunicando contigo.`,
            },
          }),
        }
      );

      // 🏁 Finalizar sorteo actual
      await sorteoRef.update({
        numeroGanador: numeroGanador,
        ganadorElegido: true,
        estado: "finalizado",
        loteriaReferencia: nombreLoteria,
        numeroLoteriaOficial: numeroLoteria,
        fechaEleccion: admin.firestore.FieldValue.serverTimestamp(),
      });

      // 📅 Crear siguiente mes automáticamente
      const fechaActual = sorteoData.fechaSorteo.toDate();
      const nuevaFecha = new Date(fechaActual);
      nuevaFecha.setMonth(nuevaFecha.getMonth() + 1);

      const nombreMes = nuevaFecha
        .toLocaleString("es-CO", { month: "long" })
        .toLowerCase();

      const anio = nuevaFecha.getFullYear();
      const nuevoId = `sorteo_${nombreMes}_${anio}`;

      await db.collection("sorteos").doc(nuevoId).set({
        estado: "activo",
        fechaSorteo: nuevaFecha,
        ganadorElegido: false,
        numeroGanador: null,
        creadoEn: admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.json({
        success: true,
        numeroGanador,
        nuevoSorteo: nuevoId,
        mensaje: "Ganador elegido y nuevo sorteo creado automáticamente",
      });

    } catch (err) {
      console.error("❌ Error elegirGanador:", err);
      return res.status(500).json({
        success: false,
        error: err.message,
      });
    }
  }
);
/* =====================================
   FINALIZAR SORTEO Y CREAR EL SIGUIENTE
===================================== */
exports.finalizarYCrearNuevoSorteo = onRequest(
  { cors: true },
  async (req, res) => {
    try {
      const adminUser = await verificarAdmin(req, res);
      if (!adminUser) return;
      // 🔎 Buscar sorteo activo
      const snapshot = await db
        .collection("sorteos")
        .where("estado", "==", "activo")
        .limit(1)
        .get();

      if (snapshot.empty) {
        return res.status(400).json({
          success: false,
          error: "No hay sorteo activo",
        });
      }

      const sorteoDoc = snapshot.docs[0];
      const sorteoData = sorteoDoc.data();
      const sorteoId = sorteoDoc.id;

      if (!sorteoData.fechaSorteo) {
        return res.status(400).json({
          success: false,
          error: "El sorteo no tiene fecha definida",
        });
      }

      const fechaSorteo = sorteoData.fechaSorteo.toDate();

      if (new Date() < fechaSorteo) {
        return res.status(400).json({
          success: false,
          error: "Aún no ha llegado la fecha del sorteo",
        });
      }

      // 🏁 Finalizar sorteo actual
      await sorteoDoc.ref.update({
        estado: "finalizado",
        fechaFinalizacion: admin.firestore.FieldValue.serverTimestamp(),
      });

      // 📆 Calcular siguiente mes
      const siguienteFecha = new Date(fechaSorteo);
      siguienteFecha.setMonth(siguienteFecha.getMonth() + 1);

      const nombreMes = siguienteFecha
        .toLocaleString("es-CO", { month: "long" })
        .toLowerCase();

      const anio = siguienteFecha.getFullYear();

      const nuevoId = `sorteo_${nombreMes}_${anio}`;

      // 🚀 Crear nuevo sorteo
      await db.collection("sorteos").doc(nuevoId).set({
        estado: "activo",
        fechaSorteo: siguienteFecha,
        ganadorElegido: false,
        numeroGanador: null,
        creadoEn: admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.json({
        success: true,
        mensaje: "Sorteo finalizado y nuevo sorteo creado",
        nuevoSorteo: nuevoId,
      });
    } catch (err) {
      console.error("❌ Error automatización:", err);
      return res.status(500).json({
        success: false,
        error: err.message,
      });
    }
  },
);
/* =====================================
   HACER ADMIN
===================================== */
exports.makeAdmin = onRequest({ cors: true }, async (req, res) => {
  try {
    const { uid } = req.body;
    await admin.auth().setCustomUserClaims(uid, { admin: true });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
