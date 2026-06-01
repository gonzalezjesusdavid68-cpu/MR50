      let sorteoActualId = null;
      
      // 🔥 Firebase imports
      import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
      import {
        getAuth,
        signInWithEmailAndPassword,
        onAuthStateChanged,
        signOut,
      } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
      import {
        getFirestore,
        collection,
        getDocs,
        onSnapshot,
        doc,
        getDoc,
        query,
        where,
        orderBy,
        limit,
        updateDoc,
        deleteDoc,
        addDoc,
        serverTimestamp,
        setDoc,
      } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
      
      import {
        getStorage,
        ref,
        uploadBytes,
        getDownloadURL
      } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
      
      // 🚪 LOGOUT
      async function logout() {
        await signOut(auth);
      }
      window.logout = logout;

      // 🔥 TU CONFIG FIREBASE
      const firebaseConfig = {
        apiKey: "AIzaSyCGPv5ciPmClCyfEK3qK_vYuo5ijxOJVZo",
        authDomain: "rifa-digital-mr50.firebaseapp.com",
        projectId: "rifa-digital-mr50",
        storageBucket: "rifa-digital-mr50.firebasestorage.app",
        messagingSenderId: "1032251067096",
        appId: "1:1032251067096:web:c05997ebd0b7563c7525ad",
        measurementId: "G-KVKV9LG6JY",
      };

      const app = initializeApp(firebaseConfig);
      const auth = getAuth(app);
      const db = getFirestore(app);
      const storage = getStorage(app);

      // 🔥 5. EXPONER AUTH A LA CONSOLA (AQUÍ VA)
      window.auth = auth;
      // (opcional pero útil)
      window.db = db;
      window.storage = storage;

      import { getIdTokenResult } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

      window.verClaims = async () => {
        const user = auth.currentUser;
        if (!user) {
          console.log("❌ No hay usuario logueado");
          return;
        }

        const token = await getIdTokenResult(user, true);
        console.log("CLAIMS:", token.claims);
      };

      const loginBox = document.getElementById("loginBox");
      const panel = document.getElementById("panel");
      const lista = document.getElementById("lista");
      const loginMsg = document.getElementById("loginMsg");

      // 🔐 LOGIN
      document.getElementById("loginBtn").onclick = async () => {
        try {
          await signInWithEmailAndPassword(
            auth,
            document.getElementById("email").value,
            document.getElementById("password").value,
          );
        } catch (err) {
          loginMsg.textContent = err.message;
        }
      };
            async function esAdmin() {
        const token = await auth.currentUser.getIdTokenResult(true);
        return token.claims.admin === true;
      }
      // 👀 SESIÓN
      onAuthStateChanged(auth, async (user) => {
        if (user) {
          const admin = await esAdmin();
          if (!admin) {
            alert("❌ No eres administrador");
            await signOut(auth);
            return;
          }
          loginBox.classList.add("hidden");
          panel.classList.remove("hidden");
          // 🔎 Buscar sorteo activo
          const snapshot = await getDocs(collection(db, "sorteos"));

          snapshot.forEach((doc) => {
            if (doc.data().estado === "activo") {
              sorteoActualId = doc.id;
              console.log("🎯 Sorteo activo:", sorteoActualId);
            }
          });
          const sorteoRef = doc(db, "sorteos", sorteoActualId);
          const sorteoSnap = await getDoc(sorteoRef);

          const fechaSorteo = sorteoSnap.data().fechaSorteo.toDate();

          const hoy = new Date();

          // Convertimos ambas fechas a formato YYYY-MM-DD
          const hoyStr = hoy.toISOString().split("T")[0];
          const fechaStr = fechaSorteo.toISOString().split("T")[0];

          if (hoyStr !== fechaStr) {
            document.getElementById("btnPreview").disabled = true;
            document.getElementById("btnConfirmar").disabled = true;

            document.getElementById("btnPreview").textContent =
              "⛔ Solo disponible el día del sorteo";
          }
          cargarPendientes();
          iniciarContador();
          cargarHistorial();
          cargarParticipantes();
        } else {
          loginBox.classList.remove("hidden");
          panel.classList.add("hidden");
        }
      });

      // 📋 CARGAR PAGOS
      function cargarPendientes() {
        if (!sorteoActualId) {
          console.log("❌ No hay sorteo activo aún");
          return;
        }

        onSnapshot(
          collection(db, "sorteos", sorteoActualId, "participantes"),
          (snap) => {
            lista.innerHTML = "";

            snap.forEach((doc) => {
              const d = doc.data();

              if (d.estado === "pendiente") {
                const div = document.createElement("div");
                div.className = "card";
                div.innerHTML = `
                            <p><strong>Número:</strong> ${doc.id}</p>
                            <p><strong>Nombre:</strong> ${d.nombre}</p>
                            <p><strong>Teléfono:</strong> ${d.telefono}</p>
                            ${d.comprobanteURL ? `<img src="${d.comprobanteURL}" style="width:100px"/>` : ""}
                            <button
                              class="btn-aprobar"
                              data-numero="${doc.id}"
                              data-telefono="${d.telefono}"
                              data-nombre="${d.nombre}">
                              ✅ Aprobar pago
                            </button>
                          `;
                lista.appendChild(div);
              }
            });
          },
        );
      }
      window.cambiarEstadoPedido = async (id, estado) => {
  try {
    await updateDoc(doc(db, "pedidos", id), {
      estado: estado
    });

    console.log("✅ Estado actualizado");
    cargarPedidos(); // refresca lista
  } catch (error) {
    console.error("❌ Error actualizando:", error);
  }
};
      // ✅ APROBAR PAGO (Cloud Function)
      document.addEventListener("click", async (e) => {
        if (!e.target.classList.contains("btn-aprobar")) return;

        const { numero, telefono, nombre } = e.target.dataset;

        if (!sorteoActualId) {
        alert("❌ No hay sorteo activo cargado");
        return;
      }
        console.log("Aprobando número:", numero);

        const user = auth.currentUser;
        if (!user) {
          alert("No autenticado");
          return;
        }

        const token = await user.getIdToken(true); // 🔑 token fresco

        try {
          console.log(
            "👉 URL:",
            "https://us-central1-rifa-digital-mr50.cloudfunctions.net/aprobarPago",
          );
          console.log("👉 Body:", { numero });
          console.log("📦 Enviando:", {
            sorteoId: sorteoActualId,
            numero,
            telefono,
          });
          const res = await fetch(
            "https://us-central1-rifa-digital-mr50.cloudfunctions.net/aprobarPago",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer " + token,
              },
              body: JSON.stringify({
                sorteoId: sorteoActualId,
                numero: numero,
                telefono: telefono,
                nombre: nombre,
              }),
            },
          );

          const data = await res.json();
          if (!data.success) {
            console.error("❌ Error completo:", JSON.stringify(data, null, 2));
            alert(data.error);
            return;
          }

          alert("✅ Pago aprobado");
          e.target.disabled = true;
          e.target.textContent = "Aprobado";
          e.target.closest(".card").style.opacity = "0.6";
          await cargarPendientes();
        } catch (err) {
          console.error(err);
          alert("❌ Error aprobando pago");
        }
      });
      window.refreshToken = async () => {
        const user = auth.currentUser;
        if (!user) return console.log("No user");

        await user.getIdToken(true); // fuerza refresh
        const res = await user.getIdTokenResult();
        console.log("CLAIMS:", res.claims);
      };
      // 📊 CONTADOR EN TIEMPO REAL
      function iniciarContador() {
        const contador = document.getElementById("contador");
        if (!contador || !sorteoActualId) return;

        onSnapshot(
          collection(db, "sorteos", sorteoActualId, "participantes"),
          (snap) => {
            let aprobados = 0;
            let pendientes = 0;
            

            snap.forEach((doc) => {
              if (doc.data().estado === "aprobado") aprobados++;
              if (doc.data().estado === "pendiente") pendientes++;
            });

            contador.innerHTML = `
                        ✅ Aprobados: ${aprobados} | ⏳ Pendientes: ${pendientes}
                      `;
          },
        );
      }
      document
        .getElementById("btnPreview")
        .addEventListener("click", async () => {
          const numeroLoteria = document.getElementById("numeroLoteria").value;

          if (!numeroLoteria) {
            alert("Ingresa el número de la lotería");
            return;
          }

          const ultimasDos = numeroLoteria.slice(-2);

          const participanteRef = doc(
            db,
            "sorteos",
            sorteoActualId,
            "participantes",
            ultimasDos,
          );
          const snap = await getDoc(participanteRef);

          const preview = document.getElementById("previewGanador");
          const btnConfirmar = document.getElementById("btnConfirmar");

          if (!snap.exists()) {
            preview.style.display = "block";
            preview.innerHTML = "❌ Ese número no fue vendido.";
            btnConfirmar.style.display = "none";
            return;
          }

          const data = snap.data();

          preview.style.display = "block";
          preview.innerHTML = `
                    <h3>🏆 Posible Ganador</h3>
                    <p><strong>Número:</strong> ${ultimasDos}</p>
                    <p><strong>Nombre:</strong> ${data.nombre}</p>
                    <p><strong>Teléfono:</strong> ${data.telefono}</p>
                    <p><strong>Email:</strong> ${data.email}</p>
                    <p><strong>Estado:</strong> ${data.estado}</p>
                  `;

          if (data.estado === "aprobado") {
            btnConfirmar.style.display = "inline-block";
          } else {
            btnConfirmar.style.display = "none";
          }
        });
      document
        .getElementById("btnConfirmar")
        .addEventListener("click", async () => {
          const btn = document.getElementById("btnConfirmar");
          const preview = document.getElementById("previewGanador");

          btn.disabled = true;
          preview.innerHTML = "<h3>🎰 Seleccionando ganador...</h3>";

          // 🎰 Animación ruleta
          const intervalo = setInterval(() => {
            preview.innerHTML = `
        <h2 style="font-size:40px;">
          ${Math.floor(Math.random() * 100)
            .toString()
            .padStart(2, "0")}
        </h2>
      `;
          }, 80);
          // Espera 3 segundos antes de confirmar real
          setTimeout(async () => {
            clearInterval(intervalo);
            try {
              const numeroLoteria =
                document.getElementById("numeroLoteria").value;
              const nombreLoteria =
                document.getElementById("nombreLoteria").value;
              
              const user = auth.currentUser;
              const token = await user.getIdToken(true);

              const res = await fetch(
                "https://us-central1-rifa-digital-mr50.cloudfunctions.net/elegirGanadorPorLoteria",
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: "Bearer " + token,
                  },
                  body: JSON.stringify({
                    sorteoId: sorteoActualId,
                    numeroLoteria,
                    nombreLoteria,
                  }),
                },
              );
              const data = await res.json();
              if (data.success) {
                preview.innerHTML = `
            <h2>🏆 Número Ganador: ${data.numeroGanador}</h2>
            <p><strong>Nombre:</strong> ${data.nombreGanador}</p>
            <p><strong>Teléfono:</strong> ${data.telefonoGanador}</p>
          `;
              } else {
                preview.innerHTML = "❌ " + data.error;
                btn.disabled = false;
              }
            } catch (error) {
              preview.innerHTML = "❌ Error al elegir ganador";
              btn.disabled = false;
            }
          }, 3000);
        });

      async function cargarHistorial() {
        const historialDiv = document.getElementById("historialGanadores");
        const q = query(
          collection(db, "sorteos"),
          where("estado", "==", "finalizado"),
          orderBy("fechaEleccion", "desc"),
          limit(5),
        );
        const snap = await getDocs(q);
        historialDiv.innerHTML = "";
        snap.forEach((docu) => {
        const d = docu.data();
          historialDiv.innerHTML += `
            <div class="card">
            <p><strong>Sorteo:</strong> ${docu.id}</p>
            <p><strong>Número:</strong> ${d.numeroGanador}</p>
            <p><strong>Ganador:</strong> ${d.nombreGanador || "No registrado"}</p>
            <p><strong>Teléfono:</strong> ${d.telefonoGanador || "-"}</p>
            <p><strong>Lotería:</strong> ${d.loteriaReferencia}</p>
          </div>
        `;
        });
      }

      cargarHistorial();
      
        window.verRifas = function() {
          document.getElementById("rifasPanel").style.display = "block";
          document.getElementById("pedidosPanel").style.display = "none";
        };

        window.verPedidos = function() {
          console.log("CLICK PEDIDOS"); 
          document.getElementById("rifasPanel").style.display = "none";
          document.getElementById("pedidosPanel").style.display = "block";
        cargarPedidos();
        };
        window.verProductos = function() {
          document.getElementById("rifasPanel").style.display = "none";
          document.getElementById("pedidosPanel").style.display = "none";
          document.getElementById("productosPanel").style.display = "block";
          cargarProductos();
        };
        async function cargarPedidos(){
          const contenedor = document.getElementById("pedidosPanel");
          contenedor.innerHTML = "";
          let pendientes = 0;
          let confirmados = 0;
          let entregados = 0;

          const querySnapshot = await getDocs(
          collection(db,"pedidos_tienda")
          );
          querySnapshot.forEach((doc) => {
            const data = doc.data();
            let colorEstado = "#f59e0b";
            if(data.estado === "confirmado") colorEstado = "green";
            if(data.estado === "entregado") colorEstado = "blue";
            if(data.estado === "pendiente") pendientes++;
            if(data.estado === "confirmado") confirmados++;
            if(data.estado === "entregado") entregados++;
            let productosHTML = "";
            if(data.productos){
              data.productos.forEach(p => {
                productosHTML += `
                  <li>${p.nombre} x${p.cantidad} - $${p.precio}</li>
                `;
              });
            }
            contenedor.innerHTML += `
              <div style="
                border:1px solid #ddd;
                padding:15px;
                margin:10px 0;
                border-radius:10px;
              ">
                <b>${data.nombreCompleto || data.nombre}</b><br>
                📞 ${data.telefono}<br>
                📍 ${data.direccion}<br>
                💳 ${data.pago}<br>

                <b>Productos:</b>
                <ul>
                  ${productosHTML}
                </ul>
               <b>Total: $${data.total}</b><br>
                Estado: ${data.estado}
                ${data.comprobanteEnvio ? `
                <br>
                <a href="${data.comprobanteEnvio}" target="_blank">
                📦 Ver comprobante transportadora
                </a>
                ` : ""}
                <br>
                <input type="file"
                id="file-${doc.id}"
                accept="image/*"
                style="margin-top:5px">
                <br><br>
                <button onclick="confirmarPedido('${doc.id}')"
                style="background:green;color:white;padding:5px 10px;margin-top:5px">
                Confirmar
                </button>
                <button onclick="entregarPedido('${doc.id}')"
                style="background:blue;color:white;padding:5px 10px;margin-left:5px">
                Entregado
                </button>
                <button onclick="whatsappPedido('${doc.id}')"
                style="background:#25D366;color:white;padding:5px 10px;margin-left:5px">
                WhatsApp
                </button>
                <button onclick="eliminarPedido('${doc.id}')"
              style="background:red;color:white;padding:5px 10px;margin-left:5px">
              Eliminar
              </button>
              </div>
            `;
          });
          document.getElementById("contadorPedidos").innerHTML =
          `✅ Confirmados: ${confirmados} | ⏳ Pendientes: ${pendientes} | 🚚 Entregados: ${entregados}`;
        }
      async function enviarPedido() {
        if (!validarFormulario()) return;
        const datos = {
          nombre: document.getElementById("nombre").value,
          telefono: document.getElementById("telefono").value,
          direccion: document.getElementById("direccion").value,
        };
        await guardarPedido(datos);
        let mensaje = "🛒 Pedido:%0A";
        carrito.forEach(item => {
          mensaje += `• ${item.nombre} x${item.cantidad}%0A`;
        });
        const url = `https://wa.me/573107643039?text=${mensaje}`;
        window.open(url, "_blank");
        carrito = [];
        guardarCarrito();
        renderCarrito();
        alert("Pedido enviado ✅");
      }
      async function cargarPedidosTienda() {
        const contenedor = document.getElementById("pedidosPanel");
        contenedor.innerHTML = "";
        const snapshot = await getDocs(collection(db, "pedidos_tienda"));
        snapshot.forEach(doc => {
          const data = doc.data();
          contenedor.innerHTML += `
            <div class="card">
              <h3>${data.nombre}</h3>
              <p>${data.telefono}</p>
              <p>${data.direccion}</p>
              <p>Estado: ${data.estado}</p>
            </div>
          `;
        });
      }
      window.confirmarPedido = async function(id){
      await updateDoc(
      doc(db,"pedidos_tienda",id),
      {
      estado:"confirmado"
      }
      );
      alert("Pedido confirmado");
      cargarPedidos();
      }
      window.eliminarPedido = async function(id){
      if(!confirm("¿Eliminar pedido?")) return;
      await deleteDoc(
      doc(db,"pedidos_tienda",id)
      );
      alert("Pedido eliminado");
      cargarPedidos();
      }
      window.entregarPedido = async function(id){
        const input = document.getElementById(`file-${id}`);
        if(!input.files.length){
        alert("Adjunta comprobante de transportadora");
        return;
        }
        const file = input.files[0];
        // nombre archivo
        const nombre = "pedido_" + id;
        const storageRef = ref(
        storage,
        `transportadoras/${nombre}_${id}_${file.name}`
        );
        // subir imagen
        await uploadBytes(storageRef, file);
        // obtener url
        const url = await getDownloadURL(storageRef);
        // guardar en firestore
        await updateDoc(
        doc(db,"pedidos_tienda",id),
        {
        estado:"entregado",
        comprobanteEnvio:url
        }
        );
        alert("mercancia entregada y cancelada");
        cargarPedidos();
        }
        window.whatsappPedido = async function(id){
        const ref = doc(db,"pedidos_tienda",id);
        const snap = await getDoc(ref);
        const data = snap.data();
        let mensaje = "Hola "+data.nombre+" tu pedido fue confirmado:\n\n";
        data.productos.forEach(p=>{
        mensaje += `${p.nombre} x${p.cantidad}\n`;
        });
        mensaje += `\nTotal: $${data.total}`;
        const url =
        `https://wa.me/57${data.telefono}?text=${encodeURIComponent(mensaje)}`;
        window.open(url,"_blank");
        }
        async function aprobarNumero(numero) {
          const ref = firestoreDoc(
            db,
            "sorteos",
            sorteoActualId,
            "participantes",
            numero
          );
          await updateDoc(ref, {
            estado: "aprobado"
          });
        }
        async function obtenerSorteoActivo() {
          const q = query(
            collection(db, "sorteos"),
            where("estado", "==", "activo"),
            limit(1)
          );
          const snapshot = await getDocs(q);
          if (snapshot.empty) {
            console.error("❌ No hay sorteo activo");
            return;
          }
          sorteoActualId = snapshot.docs[0].id;
          console.log("🎯 Sorteo activo:", sorteoActualId);
        }
          obtenerSorteoActivo(); 
          window.crearProducto = async function(){
          try{
            const nombre =
            document.getElementById("productoNombre").value;
            const precio =
            Number(document.getElementById("productoPrecio").value);
            const stock =
            Number(document.getElementById("productoStock").value);
            const categoria =
            document.getElementById("productoCategoria").value;
            const marca =
            document.getElementById("productoMarca").value;
            const descripcion =
            document.getElementById("productoDescripcion").value;
            const files =
            document.getElementById("productoImagen").files;
            if(!nombre || !precio){
              alert("Completa datos");
              return;
            }
            let imagenes = [];
            // 🔥 SUBIR IMÁGENES
            for(const file of files){
              const nombreArchivo =
              `productos/${Date.now()}_${file.name}`;
              const storageRef =
              ref(storage, nombreArchivo);
              await uploadBytes(storageRef, file);
              const url =
              await getDownloadURL(storageRef);
              imagenes.push(url);
            }
            // 🔥 GUARDAR FIRESTORE
            await addDoc(
              collection(db,"productos"),
              {
                nombre,
                precio,
                stock,
                categoria,
                marca,
                descripcion,
                imagenes,
                activo:true,
                destacado:false,
                creadoEn:serverTimestamp()
              }
            );
            alert("✅ Producto creado");
            cargarProductos();
          }catch(error){
            console.error(error);
            alert("❌ Error creando producto");
          }
        }
        async function cargarProductos(){

  const contenedor =
  document.getElementById("listaProductos");

  contenedor.innerHTML = "";

  const snapshot =
  await getDocs(collection(db,"productos"));

  snapshot.forEach(docu => {

    const p = docu.data();

    contenedor.innerHTML += `

      <div class="card">

        <img
          src="${p.imagenes?.[0] || ''}"
          style="
            width:120px;
            border-radius:10px;
          "
        >

        <h3>${p.nombre}</h3>

        <p>$${p.precio.toLocaleString()}</p>

        <p>Stock: ${p.stock}</p>

        <p>${p.categoria}</p>

        <button
          onclick="eliminarProductoAdmin('${docu.id}')"
          style="
            background:red;
            color:white;
            margin-top:10px;
          "
        >
          Eliminar
        </button>

      </div>
    `;
  });
}
    window.eliminarProductoAdmin =
async function(id){

  if(!confirm("Eliminar producto?")) return;

  await deleteDoc(
    doc(db,"productos",id)
  );

  cargarProductos();
}
window.verDashboard = function(){

  ocultarPanels();

  document.getElementById("dashboardPanel")
  .style.display = "block";

  cargarDashboard();
}

window.verClientes = function(){

  ocultarPanels();

  document.getElementById("clientesPanel")
  .style.display = "block";

  cargarClientes();
}

window.verAnalytics = function(){

  ocultarPanels();

  document.getElementById("analyticsPanel")
  .style.display = "block";

  cargarAnalytics();
}
function ocultarPanels(){
  document.getElementById("dashboardPanel")
  .style.display = "none";
  document.getElementById("rifasPanel")
  .style.display = "none";
  document.getElementById("pedidosPanel")
  .style.display = "none";
  document.getElementById("productosPanel")
  .style.display = "none";
  document.getElementById("clientesPanel")
  .style.display = "none";
  document.getElementById("analyticsPanel")
  .style.display = "none";
  document.getElementById("participantesPanel")
  .style.display = "none";
}      
async function cargarDashboard(){

  const pedidos =
  await getDocs(collection(db,"pedidos_tienda"));

  const rifas =
  await getDocs(collection(db,"sorteos"));

  let ventas = 0;

  pedidos.forEach(docu => {

    ventas += docu.data().total || 0;
  });

  document.getElementById("ventasTotal")
  .innerText =
  "$" + ventas.toLocaleString();

  document.getElementById("pedidosTotal")
  .innerText =
  pedidos.size;

  document.getElementById("rifasTotal")
  .innerText =
  rifas.size;
}
   async function cargarClientes(){
  const contenedor =
  document.getElementById("listaClientes");
  contenedor.innerHTML = "";
  const snapshot =
  await getDocs(collection(db,"clientes"));
  snapshot.forEach(docu => {
    const c = docu.data();
    contenedor.innerHTML += `
      <div class="card">
        <h3>${c.nombre || "Sin nombre"}</h3>
        <p>📞 ${c.telefono || "-"}</p>
        <p>📧 ${c.email || "-"}</p>
        <p>🏙️ ${c.ciudad || "-"}</p>
        <p>
          🎟️ Rifas:
          ${c.totalRifas || 0}
        </p>
        <p>
          🛒 Compras:
          ${c.totalCompras || 0}
        </p>
      </div>
    `;
  });
}
async function cargarAnalytics(){

  const snapshot =
  await getDocs(collection(db,"pedidos_tienda"));

  let pendientes = 0;
  let entregados = 0;

  snapshot.forEach(docu => {

    const p = docu.data();

    if(p.estado === "pendiente"){
      pendientes++;
    }

    if(p.estado === "entregado"){
      entregados++;
    }
  });

  document.getElementById("analyticsPendientes")
  .innerText = pendientes;

  document.getElementById("analyticsEntregados")
  .innerText = entregados;
}
async function cargarParticipantes() {

  if(!sorteoActualId) return;

  const contenedor =
  document.getElementById("listaParticipantes");

  contenedor.innerHTML = "";

  const snapshot =
  await getDocs(
    collection(
      db,
      "sorteos",
      sorteoActualId,
      "participantes"
    )
  );

  let html = `
  <table class="tablaParticipantes">
    <tr>
      <th>Número</th>
      <th>Nombre</th>
      <th>Estado</th>
    </tr>
  `;

  snapshot.forEach(docu => {

    const p = docu.data();

    html += `
      <tr>
        <td>${docu.id}</td>
        <td>${p.nombre || "-"}</td>
        <td>${p.estado || "-"}</td>
      </tr>
    `;
  });

  html += "</table>";

  contenedor.innerHTML = html;
}
window.verParticipantes = function(){
  ocultarPanels();
  document
  .getElementById("participantesPanel")
  .style.display = "block";
  cargarParticipantes();
}