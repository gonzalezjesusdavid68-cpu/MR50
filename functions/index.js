/* eslint-disable */
const admin = require("firebase-admin");
const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentUpdated,} = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const fetch = require("node-fetch");

admin.initializeApp();

const db = admin.firestore();
const bucket = admin.storage().bucket();
const FieldValue = admin.firestore.FieldValue;

// 🔐 Secrets
const WHATSAPP_TOKEN = defineSecret("WHATSAPP_TOKEN");
const WHATSAPP_PHONE_ID = defineSecret("WHATSAPP_PHONE_ID");

/* =====================================
   CREAR SIGUIENTE SORTEO
===================================== */
async function crearSiguienteSorteo(fechaActual){

    const nuevaFecha = new Date(fechaActual);

    nuevaFecha.setMonth(
        nuevaFecha.getMonth()+1
    );

    const nombreMes =
    nuevaFecha
    .toLocaleString(
        "es-CO",
        {
            month:"long"
        }
    )
    .toLowerCase();
    const anio =
    nuevaFecha.getFullYear();
    const nuevoId =
    `sorteo_${nombreMes}_${anio}`;
    const nuevoRef =
    db.collection("sorteos")
    .doc(nuevoId);
    const existe =
    await nuevoRef.get();
    if(!existe.exists){
        await nuevoRef.set({
            estado:"activo",
            fechaSorteo:nuevaFecha,
            ganadorElegido:false,
            numeroGanador:null,
            creadoEn:
            FieldValue.serverTimestamp()
        });
        console.log(
            "Nuevo sorteo creado:",
            nuevoId
        );
    }else{
        console.log(
            "El sorteo ya existe:",
            nuevoId
        );
    }
    return nuevoId;
}
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
    const token = authHeader.substring(7);
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
        creadoEn: FieldValue.serverTimestamp(),
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
      console.log("📲 Enviando WhatsApp a:", telefono);
     // ✅ 1️⃣ Aprobar primero SIEMPRE
await docRef.update({
  estado: "aprobado",
  telefono,
  aprobadoEn: FieldValue.serverTimestamp(),
  mensajeEnviado: false,
});
console.log({
    participante: data.nombre,
    numero,
    telefono,
    estado: "APROBADO"
});
/* =====================================
   GUARDAR CLIENTE
===================================== */

const clienteRef = db
  .collection("clientes")
  .doc(telefono);

const clienteSnap = await clienteRef.get();

if (clienteSnap.exists) {

  await clienteRef.update({
    nombre: data.nombre || "",
    telefono,
    email: data.email || "",
    totalRifas: FieldValue.increment(1),
    ultimaParticipacion:
      FieldValue.serverTimestamp(),
  });

  console.log("✅ CLIENTE ACTUALIZADO");

} else {

  await clienteRef.set({
    nombre: data.nombre || "",
    telefono: telefono,
    email: data.email || "",
    totalCompras: 0,
    totalRifas: 1,
    creadoEn:
      FieldValue.serverTimestamp(),
  });

  console.log("✅ CLIENTE CREADO");
}

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
          name: "pago_aprobado",
          language: { code: "es_CO" },
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: data.nombre || nombre || "Participante" },
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
  }

} catch (err) {
  console.error("⚠ Error enviando WhatsApp:", err.message);
}

// ✅ 3️⃣ Siempre responder éxito porque ya aprobamos
return res.json({
    success: true,
    participante: data.nombre,
    telefono,
    numero
});

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

      const sorteoRef = db.collection("sorteos").doc(sorteoId);
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
        fechaEleccion: FieldValue.serverTimestamp(),
      });

      // 📅 Crear siguiente mes automáticamente
      const fechaActual =
      sorteoData.fechaSorteo.toDate();

      const nuevoId =
      await crearSiguienteSorteo(
          fechaActual
      );
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
        fechaFinalizacion: FieldValue.serverTimestamp(),
      });

      // 📆 Calcular siguiente mes
      const nuevoId =
        await crearSiguienteSorteo(
            fechaSorteo
        );
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
/* ==========================================================
   REGISTRAR VENTA CON CUPÓN
   Moto Ruta 50
========================================================== */
exports.registrarVentaConCupon = onDocumentUpdated(
"pedidos_tienda/{pedidoId}",
async (event) => {
try{
    const pedidoId = event.params.pedidoId;
    const pedidoRef =
    db.collection("pedidos_tienda")
    .doc(pedidoId);
    if (!event.data) {
    console.log("Evento sin datos.");
    return;
}   
     const antes = event.data.before.data();
      const despues = event.data.after.data();
      if (!antes || !despues) {
          console.log("Documento inválido.");
          return;
      }
        if (
            antes.estado !== "entregado" &&
            despues.estado === "entregado"
        ) {
            console.log("Pedido entregado");
        } else {
            return;
        }
    await db.runTransaction(async(transaction)=>{

        //--------------------------------------------------
        // LEER PEDIDO
        //--------------------------------------------------
        const pedidoSnap =
        await transaction.get(pedidoRef);

        if(!pedidoSnap.exists){
            console.log("Pedido no existe");
            return;
        }
        const pedido = pedidoSnap.data();
        //--------------------------------------------------
      // VALIDAR PRODUCTOS
      //--------------------------------------------------
      if (
          !pedido.productos ||
          pedido.productos.length === 0
      ){
          throw new Error(
              "Pedido sin productos."
          );
      }
        //--------------------------------------------------
        // EVITAR DOBLE PROCESO
        //--------------------------------------------------
        if (pedido.comisionProcesada) {
            console.log("Comisión ya procesada.");
            return;
        }
        //--------------------------------------------------
        // VALIDAR CUPÓN
        //--------------------------------------------------
          if (!pedido.cupon || !pedido.cupon.id) {
              console.log("Pedido sin cupón.");
              return;
          }
        //--------------------------------------------------
        // DATOS CUPÓN
        //--------------------------------------------------
        const cupon = pedido.cupon;
        const vendedorId =
        cupon.vendedorId;

        if(!vendedorId){
            console.log("Cupón sin vendedor.");
            return;
        }
        //--------------------------------------------------
        // REFERENCIAS
        //--------------------------------------------------
        const vendedorRef =
        db.collection("vendedores")
        .doc(vendedorId);
        const cuponRef =
        db.collection("cupones")
       .doc(cupon.id);
        const historialRef =
        db.collection("historial_comisiones")
        .doc(pedidoId);
        //--------------------------------------------------
        // LEER CUPÓN
        //--------------------------------------------------
        const cuponSnap =
        await transaction.get(cuponRef);
        if(!cuponSnap.exists){
            throw new Error("El cupón no existe.");
        }
        const cuponData =
        cuponSnap.data();
        //--------------------------------------------------
        // VALIDAR CUPÓN ACTIVO
        //--------------------------------------------------
        if(cuponData.activo === false){
            throw new Error("Cupón desactivado.");
        }
        //--------------------------------------------------
        // VALIDAR LÍMITE DE USOS
        //--------------------------------------------------
        if (
            Number(cuponData.usados || 0) >=
            Number(cuponData["usos maximos"] || 0)
        ) {
            throw new Error("Cupón agotado.");
        }
        //--------------------------------------------------
        // LEER VENDEDOR
        //--------------------------------------------------
        const vendedorSnap =
        await transaction.get(vendedorRef);
        if(!vendedorSnap.exists){
            throw new Error("No existe vendedor.");
        }
        const vendedor =
        vendedorSnap.data();
        //--------------------------------------------------
        // CALCULAR COMISIÓN
        //--------------------------------------------------
        const porcentaje =
        Number(
            cuponData.comision ??
            vendedor.porcentaje ??
            0
        );
        if(
        porcentaje < 0 ||
        porcentaje > 100
    ){
        throw new Error(
            "Porcentaje de comisión inválido."
        );
    }
        const subtotal =
        Number(pedido.subtotal || 0);
        if(subtotal <= 0){
        throw new Error(
            "Subtotal inválido."
        );
    }
        const total =
        Number(pedido.total || 0);
        if(total <= 0){
        throw new Error(
            "Total inválido."
        );
    }
        const descuento =
        Number(pedido.descuento || 0);
        const valorDescuento =
        Number(pedido.valorDescuento || 0);
        const comision =
        Math.round(
            subtotal *
            (porcentaje/100)
        );
       console.table({
          Pedido: pedidoId,
          Cliente: pedido.nombre,
          Vendedor: vendedor.nombre,
          Cupon: cupon.codigo,
          Subtotal: subtotal,
          Descuento: descuento,
          ValorDescuento: valorDescuento,
          Total: total,
          Comision: comision
      });
        //--------------------------------------------------
        // ACTUALIZAR VENDEDOR
        //--------------------------------------------------
        transaction.update(
            vendedorRef,
            {
                ventas:
                FieldValue.increment(total),
                pedidos:
                FieldValue.increment(1),
                descuentoEntregado:
                FieldValue.increment(valorDescuento),
                comisiones:
                FieldValue.increment(comision)
            }
        );
        //--------------------------------------------------
        // ACTUALIZAR CUPÓN
        //--------------------------------------------------
        transaction.update(
            cuponRef,
            {
                usados:
                FieldValue.increment(1),
                total_ventas:
                FieldValue.increment(total),
                dinero_generado:
                FieldValue.increment(total),
                total_comisiones:
                FieldValue.increment(comision)
            }
        );
        //--------------------------------------------------
        // HISTORIAL
        //--------------------------------------------------
        const historialSnap =
        await transaction.get(historialRef);
        if (!historialSnap.exists){
                
        transaction.set(
            historialRef,
            {
              pedidoId: pedidoId,
                cliente:
                pedido.nombre,
                telefono:
                pedido.telefono,
                vendedor:
                cupon.vendedor,
                vendedorId:
                cupon.vendedorId,
                codigoCupon:
                cupon.codigo,
                subtotal:
                subtotal,
                descuento:
                descuento,
                valorDescuento:
                valorDescuento,
                comision:
                comision,
                total:
                total,
                fecha:
                pedido.fecha ||
                FieldValue.serverTimestamp(),
                estado:
                pedido.estado,
               procesadoEn:
              FieldValue.serverTimestamp()
            }
        );
        }  
        //--------------------------------------------------
        // MARCAR PEDIDO
        //--------------------------------------------------
        transaction.update(
            pedidoRef,
            {
              comisionProcesada:true,
              fechaComision:
              FieldValue.serverTimestamp(),
              historialComision: pedidoId,
              ultimaActualizacion:
              FieldValue.serverTimestamp()
            }
        );
    });
    console.log(
        "===================================="
    );
    console.log(
        "Venta registrada correctamente."
    );
    console.log(
        "===================================="
    );
}
catch(error){
    console.error(
        "===================================="
    );
    console.error(
        "ERROR registrarVentaConCupon"
    );
    console.error(error);
    console.error(
        "===================================="
    );
    throw error; 
}
});
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
