# PRD.md — Sistema de Inventario, Ventas y Facturación con Escaneo de Productos

## 1. Resumen del producto

### 1.1 Nombre provisional

**Smart Inventory POS**

Nombre alternativo:

**Inventario Inteligente POS**

### 1.2 Descripción general

Smart Inventory POS es un sistema web/PWA para gestionar inventario, ventas y facturación de productos mediante escaneo con cámara. El sistema permitirá escanear productos desde la cámara de un teléfono, tablet o computadora, consultar información del producto en tiempo real, agregar productos a un carrito de venta, generar factura o ticket, y descontar automáticamente el stock desde un sistema central de inventario.

La versión inicial se construirá con **Flutter Web como frontend**, **FastAPI como backend intermedio** y **ERPNext como sistema central de inventario, ventas y facturación**. El sistema se desplegará usando herramientas gratuitas o con planes gratuitos, priorizando tecnologías open source y servicios sin costo inicial.

### 1.3 Idea central

El sistema no dependerá inicialmente de inteligencia artificial generativa para identificar productos. La identificación principal se hará mediante **código de barras**, ya que es más exacto, rápido y confiable.

Flujo principal:

```text
Escanear código de barras
→ Consultar producto en ERPNext
→ Mostrar nombre, precio y stock
→ Agregar al carrito
→ Confirmar venta
→ Crear factura/ticket
→ Descontar inventario automáticamente
```

La inteligencia artificial, OCR y reconocimiento visual se considerarán para fases posteriores como apoyo para registrar productos nuevos o leer información desde etiquetas.

---

## 2. Problema que resuelve

Muchos negocios pequeños y medianos llevan su inventario y ventas de forma manual, usando hojas de cálculo, cuadernos, notas, WhatsApp o sistemas incompletos. Esto genera problemas como:

- Falta de control real del stock.
- Errores al vender productos.
- Dificultad para saber cuántas unidades quedan.
- Pérdida de tiempo buscando precios manualmente.
- Inventario desactualizado.
- Facturación separada del inventario.
- Falta de trazabilidad en movimientos de stock.
- Dificultad para saber qué productos se venden más.
- Problemas para detectar productos con bajo stock.
- Riesgo de vender productos vencidos o sin disponibilidad.

Este producto busca resolver esos problemas con un sistema simple, accesible desde navegador, instalable como PWA, y basado en tecnologías gratuitas.

---

## 3. Objetivos del producto

### 3.1 Objetivo principal

Crear un sistema funcional de inventario, ventas y facturación que permita vender productos escaneando su código de barras con la cámara, consultando precio y stock en tiempo real, generando factura o ticket, y descontando automáticamente el inventario.

### 3.2 Objetivos específicos

- Permitir escanear productos desde Flutter Web usando la cámara del dispositivo.
- Consultar productos por código de barras.
- Mostrar información relevante del producto:
  - nombre
  - imagen
  - precio
  - stock disponible
  - categoría
  - unidad de medida
- Permitir búsqueda manual por código, nombre o SKU.
- Permitir agregar productos a un carrito de venta.
- Calcular subtotal, impuestos, descuentos y total.
- Confirmar ventas desde una pantalla tipo POS.
- Crear facturas o tickets en ERPNext.
- Descontar inventario automáticamente después de una venta.
- Mostrar alertas de bajo stock.
- Registrar todos los movimientos de inventario.
- Controlar permisos por roles.
- Desplegar el sistema con herramientas gratuitas o open source.

---

## 4. Usuarios objetivo

### 4.1 Usuario administrador

Persona encargada de configurar el sistema, gestionar productos, cambiar precios, revisar reportes, crear usuarios y supervisar ventas.

Responsabilidades:

- Crear productos.
- Editar información de productos.
- Gestionar precios.
- Ver reportes.
- Crear usuarios.
- Ver movimientos de stock.
- Configurar reglas de negocio.
- Revisar ventas del día.
- Hacer ajustes de inventario.

### 4.2 Usuario cajero

Persona encargada de vender productos en caja.

Responsabilidades:

- Escanear productos.
- Buscar productos manualmente.
- Agregar productos al carrito.
- Cobrar ventas.
- Generar ticket o factura.
- Consultar stock básico.

Restricciones:

- No puede cambiar precios.
- No puede borrar productos.
- No puede modificar inventario manualmente.
- No puede ver reportes administrativos avanzados.

### 4.3 Usuario de inventario

Persona encargada de revisar existencias, entradas, salidas, productos vencidos y reposición.

Responsabilidades:

- Revisar stock.
- Registrar entradas de productos.
- Revisar productos con bajo stock.
- Revisar productos próximos a vencer.
- Hacer conteos físicos.
- Solicitar reposición.

### 4.4 Usuario supervisor

Persona con permisos intermedios entre cajero y administrador.

Responsabilidades:

- Ver ventas.
- Autorizar descuentos.
- Autorizar devoluciones.
- Revisar caja.
- Validar ajustes pequeños.

---

## 5. Alcance del MVP

### 5.1 Funciones incluidas en el MVP

El MVP debe enfocarse en lo esencial para que el sistema pueda vender productos y mantener inventario actualizado.

Funciones incluidas:

1. Autenticación básica.
2. Pantalla de login.
3. Pantalla de venta rápida tipo POS.
4. Escaneo de código de barras usando cámara.
5. Búsqueda manual de productos.
6. Consulta de producto por código de barras.
7. Visualización de nombre, precio y stock.
8. Carrito de venta.
9. Modificación de cantidades en el carrito.
10. Eliminación de productos del carrito.
11. Cálculo de total.
12. Confirmación de venta.
13. Creación de factura o ticket en ERPNext.
14. Descuento automático de inventario.
15. Dashboard básico.
16. Lista de productos con bajo stock.
17. Registro básico de ventas del día.
18. Control básico de roles.
19. Manejo de errores cuando un producto no existe.
20. Fallback manual si el escáner falla.

### 5.2 Funciones fuera del MVP

Estas funciones quedan para fases posteriores:

- OCR para leer etiquetas.
- Reconocimiento visual con IA.
- RAG.
- Predicción de inventario.
- Modo offline completo.
- Multi-sucursal.
- Integración con impresoras térmicas.
- Integración con lectores físicos USB/Bluetooth.
- App móvil nativa.
- Gestión avanzada de proveedores.
- Reportes contables avanzados.
- Integraciones fiscales específicas por país.
- Sincronización offline con resolución de conflictos.
- Programa de fidelización.
- Cupones avanzados.
- Recomendaciones automáticas de reposición.
- Notificaciones push.
- Integración con WhatsApp.
- Integración con pasarelas de pago.

---

## 6. Principios del producto

### 6.1 Precisión sobre automatización

El sistema debe priorizar datos exactos. Precio, stock y disponibilidad deben venir de la base de datos/ERPNext, no de una respuesta generada por IA.

### 6.2 IA como apoyo, no como fuente de verdad

La IA puede ayudar a sugerir información, leer etiquetas o registrar productos nuevos, pero no debe decidir precio ni stock.

### 6.3 Código de barras como mecanismo principal

El flujo principal debe depender del código de barras porque es rápido, confiable y barato.

### 6.4 Inventario auditable

Cada movimiento de inventario debe quedar registrado. No debe existir una modificación de stock sin historial.

### 6.5 Simplicidad del MVP

La primera versión debe funcionar bien con pocas pantallas y pocas reglas. No debe intentar resolver todos los casos desde el inicio.

### 6.6 Costo inicial cero o mínimo

El sistema debe construirse con herramientas gratuitas, open source o planes gratuitos.

---

## 7. Stack tecnológico propuesto

### 7.1 Frontend

**Flutter Web**

Motivo:

- El desarrollador principal ya tiene experiencia con Flutter.
- Permite construir una web responsive.
- Puede convertirse en PWA.
- Más adelante se puede reutilizar conocimiento para app móvil.
- Permite crear interfaces tipo POS con buena experiencia de usuario.

### 7.2 PWA

El frontend debe estar preparado para funcionar como Progressive Web App.

Beneficios:

- Instalación desde navegador.
- No requiere App Store ni Play Store al inicio.
- Mejor experiencia en teléfono.
- Acceso rápido desde pantalla principal.
- Uso de HTTPS para cámara.

### 7.3 Escaneo de códigos

Librería propuesta:

- `mobile_scanner` para Flutter.

Objetivo:

- Leer códigos de barras desde la cámara.
- Soportar web y dispositivos móviles.
- Permitir fallback manual si el escaneo falla.

Formatos esperados:

- EAN-13
- EAN-8
- UPC-A
- UPC-E
- QR
- Code 128
- Code 39

### 7.4 Backend intermedio

**FastAPI**

Motivo:

- Ligero.
- Rápido.
- Excelente para APIs.
- Buen soporte para documentación automática con OpenAPI/Swagger.
- Permite practicar Python.
- Ideal como capa intermedia entre Flutter y ERPNext.

Responsabilidades de FastAPI:

- Recibir solicitudes desde Flutter.
- Validar datos.
- Autenticar usuarios.
- Consultar ERPNext.
- Crear ventas/facturas.
- Manejar errores.
- Evitar duplicados.
- Proteger credenciales de ERPNext.
- Implementar reglas adicionales si son necesarias.
- Exponer endpoints limpios para el frontend.

### 7.5 Sistema central de inventario y facturación

**ERPNext**

Motivo:

- Open source.
- Ya incluye inventario.
- Ya incluye ventas.
- Ya incluye facturación.
- Maneja clientes.
- Maneja productos/items.
- Maneja stock ledger.
- Maneja precios.
- Maneja usuarios y roles.
- Tiene API REST.
- Evita construir desde cero toda la lógica compleja del inventario.

ERPNext será la fuente principal de verdad para:

- productos
- precios
- stock
- clientes
- ventas
- facturas
- movimientos de inventario

### 7.6 Base de datos

La base de datos principal será la utilizada internamente por ERPNext.

No se recomienda agregar otra base de datos para el MVP, salvo que FastAPI necesite guardar información muy específica como logs técnicos o tokens temporales.

### 7.7 Hosting gratuito recomendado

#### Frontend

**Cloudflare Pages**

Uso:

- Hospedar Flutter Web compilado.
- Servir la PWA con HTTPS.
- Tener despliegue estático gratuito.

Alternativas:

- Vercel Hobby.
- Netlify Free.
- Firebase Hosting Spark.

#### Backend y ERP

**Oracle Cloud Always Free**

Uso recomendado:

- Hospedar ERPNext.
- Hospedar FastAPI.
- Usar Docker Compose.
- Exponer servicios con Nginx o Caddy.
- Aprovechar recursos gratuitos de Oracle Cloud.

Arquitectura inicial recomendada:

```text
Oracle Cloud Always Free
└── VM principal
    ├── ERPNext
    ├── FastAPI
    ├── MariaDB
    ├── Redis
    ├── Workers de Frappe
    └── Nginx/Caddy
```

Arquitectura futura:

```text
Oracle Cloud Always Free
├── VM 1: ERPNext
└── VM 2: FastAPI
```

### 7.8 Proxy y SSL

Opciones:

- Nginx
- Caddy

Caddy puede simplificar la configuración de HTTPS automático. Nginx ofrece más control y es muy común en producción.

### 7.9 Contenedores

**Docker / Docker Compose**

Uso:

- Levantar ERPNext.
- Levantar FastAPI.
- Levantar servicios auxiliares.
- Mantener configuración reproducible.
- Facilitar despliegue.

---

## 8. Arquitectura general

### 8.1 Arquitectura MVP

```text
Usuario
  ↓
Flutter Web PWA
  ↓
Cámara del navegador
  ↓
Escaneo de código de barras
  ↓
FastAPI
  ↓
ERPNext API
  ↓
Inventario / Productos / Ventas / Facturación
```

### 8.2 Responsabilidades por capa

#### Flutter Web

- Interfaz de usuario.
- Cámara.
- Escaneo.
- Carrito.
- Pantallas de venta.
- Validaciones básicas.
- Feedback visual.
- Manejo de sesión.
- Comunicación con FastAPI.

#### FastAPI

- API pública para frontend.
- Validaciones de negocio.
- Seguridad.
- Conexión con ERPNext.
- Adaptación de respuestas.
- Control de errores.
- Idempotencia en ventas.
- Logging técnico.
- Middleware.
- Rate limiting futuro.

#### ERPNext

- Catálogo de productos.
- Precios.
- Inventario.
- Facturas.
- Clientes.
- Stock ledger.
- Reglas de precio.
- Reportes base.
- Roles internos.
- Auditoría de movimientos.

---

## 9. Flujo principal de venta

### 9.1 Escaneo de producto

1. Usuario abre la pantalla de venta.
2. Usuario activa la cámara.
3. El sistema solicita permiso para usar la cámara.
4. El usuario escanea el código de barras.
5. Flutter obtiene el valor del código.
6. Flutter envía el código a FastAPI.
7. FastAPI consulta ERPNext.
8. ERPNext devuelve información del producto.
9. FastAPI normaliza la respuesta.
10. Flutter muestra el producto.

### 9.2 Producto encontrado

Información mostrada:

- Nombre.
- Imagen.
- Precio.
- Stock disponible.
- Código.
- Unidad.
- Categoría.
- Estado.

Acciones disponibles:

- Agregar al carrito.
- Cambiar cantidad.
- Ver detalle.
- Cancelar.

### 9.3 Producto no encontrado

El sistema debe mostrar un mensaje claro:

```text
Producto no encontrado.
Puedes buscar manualmente o registrar el producto desde ERPNext.
```

Acciones disponibles:

- Buscar por nombre.
- Escribir código manualmente.
- Cancelar.
- Fase futura: registrar producto con OCR/IA.

### 9.4 Agregar al carrito

Cuando un producto se agrega al carrito:

- Se valida que exista stock suficiente.
- Se calcula subtotal.
- Se actualiza total.
- Se permite modificar cantidad.
- Se permite eliminar el producto.

### 9.5 Confirmar venta

1. Usuario revisa carrito.
2. Usuario selecciona método de pago.
3. Usuario confirma venta.
4. Flutter genera un `client_sale_id` único.
5. Flutter envía la venta a FastAPI.
6. FastAPI valida:
   - carrito no vacío
   - productos existentes
   - cantidades válidas
   - stock disponible
   - venta no duplicada
7. FastAPI crea la factura/ticket en ERPNext.
8. ERPNext descuenta inventario.
9. ERPNext devuelve identificador de factura.
10. Flutter muestra venta exitosa.
11. Usuario puede imprimir, descargar o compartir ticket.

---

## 10. Módulos del sistema

## 10.1 Módulo de autenticación

### Objetivo

Permitir que usuarios autorizados accedan al sistema según su rol.

### Funciones

- Login.
- Logout.
- Manejo de sesión.
- Token JWT.
- Protección de rutas.
- Control básico por roles.

### Roles iniciales

- Administrador.
- Cajero.
- Supervisor.
- Inventario.
- Solo lectura.

### Reglas

- Un usuario no autenticado no puede acceder al sistema.
- Un cajero no puede cambiar precios.
- Un cajero no puede ajustar stock manualmente.
- Un administrador puede acceder a todas las funciones.
- Un supervisor puede autorizar ciertas acciones.
- El sistema debe expirar sesión después de cierto tiempo de inactividad.

---

## 10.2 Módulo de escaneo

### Objetivo

Permitir consultar productos usando la cámara.

### Funciones

- Activar cámara.
- Leer código de barras.
- Pausar escaneo después de detectar un código.
- Evitar lecturas duplicadas muy rápidas.
- Permitir reintentar.
- Permitir cambiar cámara si hay más de una.
- Permitir entrada manual.

### Reglas

- La cámara solo debe activarse cuando el usuario lo solicite.
- El navegador debe pedir permiso.
- El sistema debe funcionar sobre HTTPS.
- Si la cámara falla, debe existir búsqueda manual.
- Si el código leído no existe, se debe mostrar mensaje claro.

### Estados posibles

- Cámara inactiva.
- Solicitando permiso.
- Escaneando.
- Código detectado.
- Producto encontrado.
- Producto no encontrado.
- Error de cámara.
- Permiso denegado.

---

## 10.3 Módulo de productos

### Objetivo

Consultar productos desde ERPNext.

### Datos del producto

- ID interno.
- Código de barras.
- SKU.
- Nombre.
- Descripción.
- Categoría.
- Marca.
- Imagen.
- Precio de venta.
- Precio de compra.
- Stock disponible.
- Stock mínimo.
- Unidad de medida.
- Estado.
- Lote, si aplica.
- Fecha de vencimiento, si aplica.

### Funciones

- Buscar por código de barras.
- Buscar por nombre.
- Buscar por SKU.
- Ver detalle del producto.
- Ver stock disponible.
- Ver precio actual.
- Ver si está activo o inactivo.

### Reglas

- El precio debe venir de ERPNext.
- El stock debe venir de ERPNext.
- El frontend no debe inventar precios.
- El frontend no debe calcular stock.
- Si hay varias coincidencias, el usuario debe seleccionar una.

---

## 10.4 Módulo de carrito

### Objetivo

Gestionar los productos antes de confirmar una venta.

### Funciones

- Agregar producto.
- Modificar cantidad.
- Eliminar producto.
- Limpiar carrito.
- Calcular subtotal.
- Calcular impuestos.
- Calcular descuento.
- Calcular total.

### Reglas

- No se puede vender cantidad cero.
- No se puede vender cantidad negativa.
- No se puede vender más stock del disponible, salvo configuración especial futura.
- Si se escanea el mismo producto dos veces, debe aumentar la cantidad.
- Se debe validar stock nuevamente al confirmar venta.

---

## 10.5 Módulo de ventas

### Objetivo

Crear ventas/facturas conectadas con ERPNext.

### Funciones

- Confirmar venta.
- Seleccionar método de pago.
- Crear factura o ticket.
- Descontar inventario.
- Mostrar comprobante.
- Ver últimas ventas.
- Reintentar si falla la conexión.
- Evitar ventas duplicadas.

### Métodos de pago iniciales

- Efectivo.
- Tarjeta.
- Transferencia.
- Pago móvil.
- Otro.

### Reglas

- Toda venta debe tener un identificador único.
- Toda venta debe quedar registrada en ERPNext.
- Una venta confirmada debe descontar stock.
- No debe haber doble facturación por doble click o reintento.
- Si ERPNext responde con error, la venta no debe mostrarse como completada.

---

## 10.6 Módulo de facturación/ticket

### Objetivo

Generar comprobantes de venta.

### Funciones

- Generar ticket.
- Ver factura.
- Descargar PDF.
- Imprimir desde navegador.
- Mostrar número de factura.
- Mostrar fecha y hora.
- Mostrar productos vendidos.
- Mostrar totales.

### Contenido mínimo del ticket

- Nombre del negocio.
- Fecha.
- Número de venta/factura.
- Cajero.
- Productos.
- Cantidades.
- Precio unitario.
- Subtotal.
- Impuestos, si aplica.
- Descuento, si aplica.
- Total.
- Método de pago.

### Reglas

- El ticket debe generarse solo si la venta fue creada correctamente.
- El número oficial debe venir de ERPNext.
- El PDF puede ser generado por ERPNext o renderizado desde frontend en una fase posterior.

---

## 10.7 Módulo de inventario

### Objetivo

Mostrar y controlar existencias de productos.

### Funciones MVP

- Ver stock actual.
- Ver productos con bajo stock.
- Ver movimientos recientes.
- Consultar producto por código.
- Consultar producto por nombre.

### Funciones futuras

- Ajuste manual de inventario.
- Conteo físico.
- Entrada de mercancía.
- Transferencia entre almacenes.
- Devoluciones.
- Productos dañados.
- Productos vencidos.

### Reglas

- Todo movimiento debe quedar registrado.
- Los ajustes deben requerir permisos.
- El stock disponible debe venir de ERPNext.
- El sistema debe mostrar alerta cuando el stock esté por debajo del mínimo.

---

## 10.8 Módulo de dashboard

### Objetivo

Dar visibilidad rápida del estado del negocio.

### Métricas MVP

- Ventas de hoy.
- Total vendido hoy.
- Cantidad de productos vendidos hoy.
- Últimas ventas.
- Productos con bajo stock.
- Productos más vendidos.
- Productos agotados.

### Métricas futuras

- Margen estimado.
- Ganancia por producto.
- Ventas por categoría.
- Ventas por cajero.
- Ventas por método de pago.
- Productos próximos a vencer.
- Valor total del inventario.
- Comparación semanal/mensual.

---

## 10.9 Módulo de reglas de precio y descuentos

### Objetivo

Aprovechar ERPNext para manejar precios y descuentos.

### Funciones MVP

- Obtener precio del producto.
- Aplicar precio configurado en ERPNext.

### Funciones futuras

- Descuentos por cantidad.
- Descuentos por cliente.
- Descuentos por categoría.
- Promociones.
- Compra X y lleva Y.
- Reglas por fecha.
- Autorización de descuentos manuales.

### Reglas

- El frontend no debe aplicar descuentos críticos sin validación del backend.
- El backend debe pedir a ERPNext el precio final cuando aplique.
- Un cajero no debe crear descuentos no autorizados.

---

## 10.10 Módulo de lotes y vencimientos

### Objetivo

Permitir trazabilidad para productos perecederos o con seriales.

### Estado

Fuera del MVP, recomendado para fase 2 o fase 3.

### Funciones futuras

- Registrar lote.
- Registrar fecha de vencimiento.
- Ver productos próximos a vencer.
- Alertar productos vencidos.
- Vender usando criterio FEFO: First Expired, First Out.
- Bloquear venta de productos vencidos.

### Casos ideales

- Alimentos.
- Cosméticos.
- Farmacia.
- Productos químicos.
- Repuestos con seriales.

---

## 10.11 Módulo OCR

### Objetivo

Leer texto desde una imagen del producto o etiqueta.

### Estado

Fuera del MVP.

### Funciones futuras

- Tomar foto de etiqueta.
- Leer texto del empaque.
- Detectar nombre, marca y presentación.
- Sugerir datos para registrar producto.
- Ayudar cuando no exista código de barras.

### Herramientas posibles

- Tesseract OCR.
- PaddleOCR.

### Reglas

- OCR no debe definir precio automáticamente.
- OCR no debe definir stock.
- OCR solo debe sugerir datos.
- El usuario debe confirmar antes de guardar.

---

## 10.12 Módulo de reconocimiento visual con IA

### Objetivo

Permitir que el sistema sugiera qué producto aparece en una imagen.

### Estado

Fuera del MVP.

### Posible flujo

```text
Producto no encontrado
→ Usuario toma foto
→ IA sugiere coincidencias
→ Usuario selecciona una opción
→ Sistema consulta ERPNext
```

### Reglas

- La IA no debe ser fuente de verdad.
- El resultado debe ser tratado como sugerencia.
- El usuario debe confirmar.
- El sistema debe priorizar código de barras y base de datos.

---

## 10.13 Módulo RAG

### Decisión

RAG no es necesario para el MVP.

### Motivo

El sistema trabaja principalmente con datos estructurados:

- productos
- precios
- stock
- ventas
- facturas
- clientes

Estos datos se consultan mejor con base de datos y API, no con RAG.

### Casos futuros donde RAG podría ser útil

- Asistente interno para políticas del negocio.
- Preguntas sobre manuales de uso.
- Búsqueda en documentos administrativos.
- Resúmenes de reportes.
- Explicación de procesos internos.
- Ayuda para nuevos empleados.

### Ejemplos futuros

```text
¿Cómo registro una devolución?
¿Qué dice la política de descuentos?
Resume las ventas de la semana.
¿Qué productos están cerca de agotarse?
```

---

## 11. Requisitos funcionales

## 11.1 Autenticación

### RF-001 — Login

El sistema debe permitir que un usuario inicie sesión con credenciales válidas.

Criterios de aceptación:

- El usuario ingresa usuario/email y contraseña.
- Si las credenciales son correctas, entra al sistema.
- Si son incorrectas, ve un mensaje de error.
- El sistema guarda una sesión válida.
- El sistema protege rutas privadas.

### RF-002 — Logout

El sistema debe permitir cerrar sesión.

Criterios de aceptación:

- El usuario puede cerrar sesión desde el menú.
- El token local se elimina.
- El usuario vuelve a login.
- No puede volver a pantallas privadas sin autenticarse.

### RF-003 — Roles

El sistema debe restringir funciones según rol.

Criterios de aceptación:

- Cajero no puede editar precios.
- Cajero no puede ajustar stock.
- Administrador puede acceder a configuración.
- Usuario de solo lectura no puede vender.
- Supervisor puede tener permisos intermedios.

---

## 11.2 Escaneo

### RF-004 — Activar cámara

El sistema debe permitir activar la cámara desde la pantalla de venta.

Criterios de aceptación:

- El navegador solicita permiso.
- Si el permiso es aceptado, se muestra la cámara.
- Si el permiso es denegado, se muestra una alternativa manual.
- La cámara se puede cerrar.

### RF-005 — Escanear código de barras

El sistema debe detectar códigos de barras desde la cámara.

Criterios de aceptación:

- El sistema detecta un código válido.
- El sistema evita duplicados en menos de cierto intervalo.
- El código detectado se envía al backend.
- El usuario recibe feedback visual o sonoro opcional.

### RF-006 — Entrada manual

El sistema debe permitir escribir un código manualmente.

Criterios de aceptación:

- El usuario escribe código.
- El sistema busca producto.
- El resultado se muestra igual que con escaneo.
- Si no existe, se muestra producto no encontrado.

---

## 11.3 Productos

### RF-007 — Buscar producto por código

El sistema debe buscar producto por código de barras.

Criterios de aceptación:

- Flutter envía código a FastAPI.
- FastAPI consulta ERPNext.
- Si existe, devuelve producto.
- Si no existe, devuelve error controlado.
- La respuesta incluye precio y stock.

### RF-008 — Buscar producto por nombre

El sistema debe permitir búsqueda por nombre.

Criterios de aceptación:

- El usuario escribe texto.
- El sistema muestra resultados coincidentes.
- El usuario selecciona un producto.
- Se muestra información del producto.

### RF-009 — Mostrar detalle de producto

El sistema debe mostrar detalle básico del producto.

Criterios de aceptación:

- Nombre visible.
- Precio visible.
- Stock visible.
- Imagen visible si existe.
- Categoría visible si existe.
- Código visible.

---

## 11.4 Carrito

### RF-010 — Agregar producto al carrito

El sistema debe permitir agregar producto al carrito.

Criterios de aceptación:

- Producto encontrado puede agregarse.
- Si ya existe en carrito, aumenta cantidad.
- Se recalcula total.
- Se valida cantidad mínima.

### RF-011 — Modificar cantidad

El sistema debe permitir cambiar cantidad.

Criterios de aceptación:

- El usuario puede aumentar cantidad.
- El usuario puede disminuir cantidad.
- No se permite cantidad menor o igual a cero.
- Se recalcula total.
- Se valida stock disponible.

### RF-012 — Eliminar producto del carrito

El sistema debe permitir eliminar un producto del carrito.

Criterios de aceptación:

- El producto desaparece del carrito.
- El total se recalcula.
- Si el carrito queda vacío, se muestra estado vacío.

### RF-013 — Limpiar carrito

El sistema debe permitir cancelar una venta en proceso.

Criterios de aceptación:

- El usuario confirma limpieza.
- El carrito se vacía.
- No se genera venta.
- No se modifica inventario.

---

## 11.5 Venta

### RF-014 — Confirmar venta

El sistema debe permitir confirmar una venta.

Criterios de aceptación:

- El carrito no está vacío.
- Hay stock disponible.
- Se selecciona método de pago.
- Se genera `client_sale_id`.
- FastAPI recibe la venta.
- ERPNext crea la factura/ticket.
- Se descuenta inventario.
- Se muestra confirmación.

### RF-015 — Evitar venta duplicada

El sistema debe evitar duplicar ventas por doble click o reintento.

Criterios de aceptación:

- Cada venta tiene un ID único.
- Si se reenvía la misma venta, no se crea duplicada.
- El sistema devuelve la factura existente si ya fue creada.
- El botón de confirmar se bloquea durante el proceso.

### RF-016 — Validar stock al confirmar

El sistema debe validar stock justo antes de crear la venta.

Criterios de aceptación:

- Si el stock cambió, el sistema informa al usuario.
- No se completa venta con stock insuficiente.
- El usuario puede ajustar cantidades.

---

## 11.6 Facturación

### RF-017 — Generar comprobante

El sistema debe mostrar comprobante después de venta exitosa.

Criterios de aceptación:

- Se muestra número de factura/ticket.
- Se muestra fecha.
- Se muestran productos.
- Se muestra total.
- Se permite descargar o imprimir si está disponible.

### RF-018 — Descargar PDF

El sistema debe permitir descargar comprobante en PDF si ERPNext lo soporta.

Criterios de aceptación:

- El usuario ve opción de descargar.
- El archivo corresponde a la venta.
- Si falla, se muestra mensaje claro.

---

## 11.7 Dashboard

### RF-019 — Ver ventas del día

El sistema debe mostrar ventas del día.

Criterios de aceptación:

- Se muestra total vendido.
- Se muestra cantidad de ventas.
- Se muestran últimas ventas.
- Los datos vienen de ERPNext o FastAPI.

### RF-020 — Ver productos con bajo stock

El sistema debe mostrar productos bajo stock.

Criterios de aceptación:

- Se listan productos con stock menor o igual al mínimo.
- Se muestra stock actual.
- Se muestra stock mínimo.
- Se puede abrir detalle del producto.

---

## 12. Requisitos no funcionales

## 12.1 Rendimiento

- La búsqueda por código debe responder idealmente en menos de 1 segundo en condiciones normales.
- La confirmación de venta debe responder idealmente en menos de 3 segundos.
- El frontend debe cargar rápido en dispositivos móviles.
- La pantalla de venta debe ser fluida.
- El escáner no debe disparar múltiples búsquedas por el mismo código.

## 12.2 Seguridad

- El frontend no debe guardar credenciales de ERPNext.
- FastAPI debe ocultar los tokens internos de ERPNext.
- Toda comunicación debe usar HTTPS.
- Se debe usar JWT o sesión segura.
- Se deben validar permisos por rol.
- Se deben validar datos del frontend.
- No se debe confiar en precios enviados por el frontend.
- No se debe confiar en stock enviado por el frontend.
- El backend debe recalcular o validar datos críticos.

## 12.3 Disponibilidad

- El sistema debe manejar errores de conexión.
- Si ERPNext está caído, FastAPI debe responder error claro.
- Si FastAPI está caído, el frontend debe mostrar error claro.
- El sistema debe tener backups.
- El MVP no requiere alta disponibilidad, pero debe ser recuperable.

## 12.4 Mantenibilidad

- El backend debe estar separado por módulos.
- Las integraciones con ERPNext deben estar encapsuladas.
- Las respuestas deben tener modelos claros.
- El código debe tener estructura limpia.
- Se debe usar documentación OpenAPI.
- Se debe mantener un README técnico.

## 12.5 Escalabilidad

- La arquitectura debe permitir separar FastAPI y ERPNext en diferentes VMs.
- El frontend debe poder desplegarse de forma independiente.
- FastAPI debe poder crecer sin reescribir el frontend.
- OCR/IA debe poder agregarse como servicio separado.

## 12.6 Usabilidad

- El sistema debe ser simple para cajeros.
- Debe requerir pocos clicks para vender.
- Debe funcionar bien en pantallas pequeñas.
- Debe tener mensajes de error claros.
- Debe permitir fallback manual.
- Debe evitar confusión cuando un producto no se encuentra.

## 12.7 Auditoría

- Toda venta debe quedar registrada.
- Todo cambio de stock debe tener origen.
- Todo ajuste manual futuro debe tener usuario responsable.
- Debe poder rastrearse qué usuario hizo una venta.

---

## 13. Diseño de pantallas MVP

## 13.1 Login

Elementos:

- Logo/nombre del sistema.
- Email o usuario.
- Contraseña.
- Botón de entrar.
- Mensaje de error.
- Estado de carga.

## 13.2 Dashboard principal

Elementos:

- Ventas de hoy.
- Total vendido hoy.
- Productos con bajo stock.
- Últimas ventas.
- Acceso rápido a venta.
- Acceso rápido a productos.

## 13.3 Pantalla de venta rápida

Elementos:

- Botón activar cámara.
- Área de escaneo.
- Campo de código manual.
- Buscador de producto.
- Lista/carrito.
- Cantidad.
- Subtotal.
- Total.
- Método de pago.
- Botón confirmar venta.
- Botón limpiar carrito.

## 13.4 Modal de producto encontrado

Elementos:

- Imagen.
- Nombre.
- Precio.
- Stock.
- Código.
- Cantidad.
- Botón agregar.
- Botón cancelar.

## 13.5 Producto no encontrado

Elementos:

- Mensaje claro.
- Código escaneado.
- Botón buscar manualmente.
- Botón intentar de nuevo.
- Fase futura: botón sugerir con OCR/IA.

## 13.6 Comprobante de venta

Elementos:

- Mensaje de éxito.
- Número de factura.
- Fecha.
- Total.
- Método de pago.
- Botón descargar PDF.
- Botón imprimir.
- Botón nueva venta.

## 13.7 Productos bajo stock

Elementos:

- Tabla de productos.
- Nombre.
- Código.
- Stock actual.
- Stock mínimo.
- Categoría.
- Acción para ver detalle.

---

## 14. Modelo de datos conceptual

Nota: ERPNext ya tiene sus propios DocTypes. Este modelo es conceptual para entender la lógica del producto.

## 14.1 Producto

```json
{
  "id": "ITEM-0001",
  "barcode": "7590000000000",
  "sku": "COCA-600",
  "name": "Coca-Cola 600ml",
  "description": "Refresco Coca-Cola presentación 600ml",
  "category": "Bebidas",
  "brand": "Coca-Cola",
  "image_url": "https://example.com/image.png",
  "sale_price": 1.5,
  "purchase_price": 0.9,
  "stock": 24,
  "minimum_stock": 5,
  "unit": "Unidad",
  "active": true
}
```

## 14.2 Carrito

```json
{
  "items": [
    {
      "product_id": "ITEM-0001",
      "barcode": "7590000000000",
      "name": "Coca-Cola 600ml",
      "quantity": 2,
      "unit_price": 1.5,
      "subtotal": 3.0
    }
  ],
  "subtotal": 3.0,
  "discount": 0,
  "tax": 0,
  "total": 3.0
}
```

## 14.3 Venta

```json
{
  "client_sale_id": "SALE-CLIENT-20260505-ABC123",
  "cashier_id": "USER-001",
  "customer_id": null,
  "payment_method": "cash",
  "items": [
    {
      "product_id": "ITEM-0001",
      "quantity": 2
    }
  ],
  "created_at": "2026-05-05T16:00:00Z"
}
```

## 14.4 Respuesta de venta

```json
{
  "success": true,
  "invoice_id": "SINV-0001",
  "client_sale_id": "SALE-CLIENT-20260505-ABC123",
  "total": 3.0,
  "pdf_url": "https://example.com/invoice.pdf"
}
```

---

## 15. Endpoints propuestos para FastAPI

## 15.1 Auth

### POST `/auth/login`

Descripción:

Autentica usuario y devuelve token.

Request:

```json
{
  "username": "cashier@example.com",
  "password": "password"
}
```

Response:

```json
{
  "access_token": "jwt-token",
  "token_type": "bearer",
  "user": {
    "id": "USER-001",
    "name": "Juan Pérez",
    "role": "cashier"
  }
}
```

### POST `/auth/logout`

Descripción:

Cierra sesión o invalida token si se implementa blacklist.

---

## 15.2 Products

### GET `/products/barcode/{barcode}`

Descripción:

Busca producto por código de barras.

Response:

```json
{
  "id": "ITEM-0001",
  "barcode": "7590000000000",
  "name": "Coca-Cola 600ml",
  "price": 1.5,
  "stock": 24,
  "image_url": "https://example.com/image.png",
  "category": "Bebidas"
}
```

### GET `/products/search?q=coca`

Descripción:

Busca productos por nombre, SKU o código.

Response:

```json
[
  {
    "id": "ITEM-0001",
    "barcode": "7590000000000",
    "name": "Coca-Cola 600ml",
    "price": 1.5,
    "stock": 24
  }
]
```

### GET `/products/{product_id}`

Descripción:

Obtiene detalle completo del producto.

---

## 15.3 Sales

### POST `/sales`

Descripción:

Crea venta/factura en ERPNext.

Request:

```json
{
  "client_sale_id": "SALE-CLIENT-20260505-ABC123",
  "payment_method": "cash",
  "items": [
    {
      "product_id": "ITEM-0001",
      "quantity": 2
    }
  ]
}
```

Response:

```json
{
  "success": true,
  "invoice_id": "SINV-0001",
  "total": 3.0,
  "pdf_url": "https://example.com/invoice.pdf"
}
```

### GET `/sales/today`

Descripción:

Obtiene resumen de ventas del día.

Response:

```json
{
  "total_sales": 20,
  "total_amount": 250.75,
  "items_sold": 75,
  "latest_sales": []
}
```

### GET `/sales/{invoice_id}`

Descripción:

Obtiene detalle de una venta.

---

## 15.4 Inventory

### GET `/inventory/low-stock`

Descripción:

Lista productos con bajo stock.

Response:

```json
[
  {
    "product_id": "ITEM-0001",
    "name": "Coca-Cola 600ml",
    "stock": 3,
    "minimum_stock": 5
  }
]
```

### GET `/inventory/product/{product_id}`

Descripción:

Obtiene stock actual de un producto.

---

## 15.5 Health

### GET `/health`

Descripción:

Verifica estado de FastAPI.

Response:

```json
{
  "status": "ok"
}
```

### GET `/health/erpnext`

Descripción:

Verifica conexión con ERPNext.

Response:

```json
{
  "status": "ok",
  "erpnext": "connected"
}
```

---

## 16. Integración con ERPNext

## 16.1 Recursos principales de ERPNext

El sistema debe integrarse con DocTypes relacionados con:

- Item.
- Item Price.
- Barcode.
- Stock Ledger Entry.
- Sales Invoice.
- Sales Invoice Item.
- Customer.
- Warehouse.
- Payment Entry, si aplica.
- POS Profile, si se usa modo POS de ERPNext.

## 16.2 Estrategia de integración

FastAPI debe actuar como adaptador.

Ejemplo:

```text
Flutter pide:
GET /products/barcode/7590000000000

FastAPI consulta ERPNext:
Buscar Item asociado a barcode

ERPNext responde:
Documento interno de Item

FastAPI transforma:
Producto simple para Flutter
```

## 16.3 Beneficios de usar FastAPI como capa intermedia

- No exponer API keys de ERPNext en el frontend.
- Unificar respuestas.
- Simplificar consumo desde Flutter.
- Agregar seguridad propia.
- Controlar errores.
- Implementar idempotencia.
- Agregar lógica futura sin tocar frontend.
- Evitar acoplamiento fuerte entre Flutter y ERPNext.

---

## 17. Seguridad y permisos

## 17.1 Reglas generales

- Todo endpoint privado requiere autenticación.
- Los tokens deben tener expiración.
- Los roles deben validarse en FastAPI.
- Las credenciales de ERPNext no deben llegar al navegador.
- Se deben usar variables de entorno para secretos.
- Se debe activar HTTPS.
- Se debe limitar CORS al dominio del frontend.

## 17.2 Datos críticos

El frontend no debe ser fuente de verdad para:

- Precio.
- Stock.
- Descuentos.
- Impuestos.
- Permisos.
- Estado de factura.

El backend debe consultar o validar esos datos con ERPNext.

## 17.3 Acciones sensibles

Requieren permisos especiales:

- Cambiar precio.
- Ajustar stock.
- Eliminar producto.
- Cancelar factura.
- Registrar devolución.
- Autorizar descuento.
- Ver reportes administrativos.

---

## 18. Idempotencia

## 18.1 Problema

Un usuario puede presionar dos veces el botón de confirmar venta o perder conexión justo cuando se crea una factura.

Esto puede generar ventas duplicadas.

## 18.2 Solución

Cada venta enviada desde Flutter debe incluir un identificador único:

```text
client_sale_id
```

FastAPI debe:

1. Recibir `client_sale_id`.
2. Verificar si ya existe una venta con ese ID.
3. Si existe, devolver la factura ya creada.
4. Si no existe, crear una venta nueva.
5. Guardar la relación entre `client_sale_id` y factura.

## 18.3 Criterios de aceptación

- Dos requests con el mismo `client_sale_id` no crean dos facturas.
- Si el frontend reintenta, recibe la misma respuesta.
- El botón de confirmar se bloquea durante la operación.
- El usuario no puede crear duplicados por error.

---

## 19. Manejo de errores

## 19.1 Producto no encontrado

Mensaje:

```text
Producto no encontrado. Puedes buscar manualmente o registrar este producto.
```

## 19.2 Stock insuficiente

Mensaje:

```text
Stock insuficiente. Solo quedan X unidades disponibles.
```

## 19.3 Cámara no disponible

Mensaje:

```text
No se pudo acceder a la cámara. Puedes ingresar el código manualmente.
```

## 19.4 Permiso de cámara denegado

Mensaje:

```text
Permiso de cámara denegado. Activa el permiso desde la configuración del navegador o ingresa el código manualmente.
```

## 19.5 Error de ERPNext

Mensaje:

```text
No se pudo consultar el sistema de inventario. Intenta nuevamente.
```

## 19.6 Error al crear venta

Mensaje:

```text
No se pudo completar la venta. No se ha descontado inventario.
```

## 19.7 Error de conexión

Mensaje:

```text
Hay un problema de conexión. Revisa internet e intenta nuevamente.
```

---

## 20. Modo offline

## 20.1 Decisión MVP

El MVP no tendrá venta offline completa.

### Motivo

Vender offline puede causar inconsistencias de inventario si varios usuarios venden el mismo producto al mismo tiempo.

## 20.2 Modo offline básico MVP

Se permitirá:

- Mostrar mensaje si no hay conexión.
- Mantener productos recientes cacheados solo como consulta.
- Bloquear confirmación de venta si no hay conexión con backend/ERPNext.

## 20.3 Modo offline futuro

En fases posteriores se puede implementar:

```text
Venta offline
→ Guardar localmente
→ Sincronizar al volver internet
→ Resolver conflictos
→ Evitar duplicados
```

Requisitos futuros:

- IDs únicos.
- Cola local.
- Estado pendiente.
- Reintentos.
- Validación de stock al sincronizar.
- Resolución de conflictos.

---

## 21. Backups

## 21.1 Necesidad

El sistema manejará datos críticos:

- ventas
- facturas
- productos
- stock
- clientes
- movimientos

Perder estos datos sería grave.

## 21.2 Requisitos mínimos

- Backup diario de base de datos ERPNext.
- Backup diario de archivos ERPNext.
- Backup antes de actualizaciones.
- Copia externa cuando sea posible.
- Documentar proceso de restauración.

## 21.3 Fase MVP

Para el MVP se debe dejar preparado:

- Script manual de backup.
- Carpeta de backups.
- Documentación de restauración básica.

## 21.4 Fase futura

- Backups automáticos.
- Subida a almacenamiento externo.
- Alertas si falla backup.
- Pruebas periódicas de restauración.

---

## 22. Observabilidad y logging

## 22.1 Logs de FastAPI

FastAPI debe registrar:

- errores de conexión con ERPNext
- intentos fallidos de venta
- errores de autenticación
- llamadas críticas
- latencia de endpoints
- errores inesperados

## 22.2 Logs de negocio

ERPNext debe ser usado para trazabilidad de:

- ventas
- facturas
- movimientos de stock
- usuarios responsables
- cambios en documentos

## 22.3 Fase futura

- Dashboard técnico.
- Alertas.
- Métricas de performance.
- Integración con herramientas externas.

---

## 23. Despliegue

## 23.1 Entornos

### Local

Usado para desarrollo.

Componentes:

- Flutter Web local.
- FastAPI local.
- ERPNext local o remoto.
- Docker Compose.

### Staging

Deseable después del MVP.

Componentes:

- Flutter Web en ambiente de prueba.
- FastAPI staging.
- ERPNext staging.
- Datos de prueba.

### Producción

Componentes:

- Flutter Web en Cloudflare Pages.
- FastAPI en Oracle Cloud.
- ERPNext en Oracle Cloud.
- HTTPS.
- Backups.

## 23.2 Despliegue frontend

Comando:

```bash
flutter build web
```

Resultado:

```text
build/web
```

Deploy:

- Cloudflare Pages.
- Configurar dominio.
- Activar HTTPS.
- Configurar PWA.

## 23.3 Despliegue backend

FastAPI en Oracle Cloud usando:

- Docker.
- Uvicorn/Gunicorn.
- Variables de entorno.
- Nginx/Caddy.
- HTTPS.

Variables de entorno esperadas:

```env
ERPNext_BASE_URL=
ERPNext_API_KEY=
ERPNext_API_SECRET=
JWT_SECRET=
JWT_EXPIRES_IN=
CORS_ALLOWED_ORIGINS=
ENVIRONMENT=
```

## 23.4 Despliegue ERPNext

ERPNext en Oracle Cloud usando Docker Compose o instalación recomendada por Frappe/ERPNext.

Componentes:

- ERPNext.
- MariaDB.
- Redis.
- Workers.
- Scheduler.
- Nginx/Caddy.
- Volúmenes persistentes.
- Backups.

---

## 24. Estructura recomendada de repositorios

## 24.1 Opción monorepo

```text
smart-inventory-pos/
├── frontend/
│   └── flutter_app/
├── backend/
│   └── fastapi_app/
├── infra/
│   ├── docker-compose.yml
│   ├── nginx/
│   └── scripts/
├── docs/
│   ├── PRD.md
│   ├── ARCHITECTURE.md
│   ├── API.md
│   └── DEPLOYMENT.md
└── README.md
```

Ventajas:

- Todo está en un solo lugar.
- Más simple para MVP.
- Fácil de documentar.
- Fácil de versionar.

## 24.2 Opción repos separados

```text
smart-inventory-frontend
smart-inventory-backend
smart-inventory-infra
```

Ventajas:

- Mejor separación a futuro.
- Despliegue independiente.
- Más profesional si el equipo crece.

Decisión recomendada para MVP:

**Monorepo.**

---

## 25. Roadmap

## Fase 0 — Preparación

Objetivo:

Definir arquitectura, repositorio y entorno local.

Tareas:

- Crear repositorio.
- Crear estructura monorepo.
- Crear PRD.
- Crear README inicial.
- Definir variables de entorno.
- Definir dominios/subdominios.
- Preparar cuenta Oracle Cloud.
- Preparar Cloudflare Pages.
- Investigar instalación de ERPNext.

Resultado esperado:

- Proyecto inicial organizado.
- Decisiones técnicas documentadas.

---

## Fase 1 — ERPNext base

Objetivo:

Tener ERPNext funcionando con datos básicos.

Tareas:

- Desplegar ERPNext en local o Oracle Cloud.
- Crear productos de prueba.
- Configurar almacén.
- Configurar precios.
- Configurar stock inicial.
- Configurar factura/ticket.
- Crear usuario API.
- Probar API REST.
- Crear producto con código de barras.
- Consultar producto desde API.

Resultado esperado:

- ERPNext responde datos reales de producto, precio y stock.

---

## Fase 2 — FastAPI base

Objetivo:

Crear backend intermedio funcional.

Tareas:

- Crear proyecto FastAPI.
- Configurar entorno virtual.
- Crear endpoint `/health`.
- Crear cliente ERPNext.
- Crear endpoint buscar producto por barcode.
- Crear endpoint buscar por nombre.
- Crear modelos Pydantic.
- Manejar errores.
- Configurar CORS.
- Crear documentación OpenAPI.
- Agregar variables de entorno.

Resultado esperado:

- FastAPI puede consultar productos en ERPNext.

---

## Fase 3 — Flutter Web base

Objetivo:

Crear frontend inicial.

Tareas:

- Crear proyecto Flutter Web.
- Configurar rutas.
- Crear pantalla login.
- Crear layout base.
- Crear dashboard básico.
- Crear pantalla venta rápida.
- Conectar con FastAPI.
- Mostrar productos consultados.
- Crear carrito local.

Resultado esperado:

- Usuario puede buscar producto y agregarlo a carrito.

---

## Fase 4 — Escaneo con cámara

Objetivo:

Integrar lectura de código de barras.

Tareas:

- Agregar `mobile_scanner`.
- Crear componente de cámara.
- Leer código.
- Evitar escaneos duplicados.
- Enviar código a FastAPI.
- Mostrar producto encontrado.
- Manejar errores de cámara.
- Permitir entrada manual.

Resultado esperado:

- Usuario puede escanear un producto desde navegador y verlo en pantalla.

---

## Fase 5 — Venta y facturación

Objetivo:

Completar flujo de venta.

Tareas:

- Crear endpoint `/sales`.
- Validar carrito.
- Validar stock.
- Crear factura/ticket en ERPNext.
- Descontar inventario.
- Implementar `client_sale_id`.
- Evitar duplicados.
- Mostrar venta exitosa.
- Mostrar comprobante.

Resultado esperado:

- Usuario puede vender productos escaneados y el inventario se descuenta.

---

## Fase 6 — Dashboard y bajo stock

Objetivo:

Agregar visibilidad básica.

Tareas:

- Crear endpoint ventas del día.
- Crear endpoint bajo stock.
- Crear cards en dashboard.
- Crear lista de últimas ventas.
- Crear lista de productos bajo stock.

Resultado esperado:

- Usuario puede ver estado básico del negocio.

---

## Fase 7 — Seguridad y roles

Objetivo:

Controlar acceso.

Tareas:

- Implementar login real.
- Implementar JWT.
- Implementar middleware de autenticación.
- Implementar roles.
- Proteger endpoints.
- Proteger rutas frontend.
- Ocultar acciones según rol.

Resultado esperado:

- Usuarios solo pueden usar funciones permitidas.

---

## Fase 8 — Despliegue MVP

Objetivo:

Publicar sistema usable.

Tareas:

- Desplegar ERPNext en Oracle Cloud.
- Desplegar FastAPI en Oracle Cloud.
- Configurar Nginx/Caddy.
- Configurar HTTPS.
- Desplegar Flutter Web en Cloudflare Pages.
- Configurar variables de entorno.
- Configurar CORS.
- Probar cámara en HTTPS.
- Probar venta completa.
- Documentar despliegue.

Resultado esperado:

- MVP funcionando en internet.

---

## Fase 9 — Mejoras post-MVP

Objetivo:

Agregar inteligencia y automatización.

Tareas posibles:

- OCR.
- Reconocimiento visual.
- Registro inteligente de productos.
- Modo offline avanzado.
- Impresora térmica.
- Multi-sucursal.
- Reportes avanzados.
- Alertas.
- Notificaciones.
- Predicción de reposición.
- RAG para documentos internos.

---

## 26. Criterios de éxito del MVP

El MVP se considerará exitoso si:

1. Un usuario puede iniciar sesión.
2. Un usuario puede abrir el sistema desde navegador móvil.
3. Un usuario puede activar la cámara.
4. Un usuario puede escanear un código de barras.
5. El sistema encuentra el producto en ERPNext.
6. El sistema muestra nombre, precio y stock.
7. El usuario puede agregar productos a carrito.
8. El usuario puede confirmar una venta.
9. ERPNext crea la factura o ticket.
10. ERPNext descuenta inventario.
11. El sistema evita ventas duplicadas.
12. El usuario puede ver ventas del día.
13. El usuario puede ver productos con bajo stock.
14. El sistema funciona con HTTPS.
15. El frontend no expone credenciales de ERPNext.
16. FastAPI actúa como intermediario seguro.
17. El proyecto puede desplegarse usando herramientas gratuitas.

---

## 27. Riesgos técnicos

## 27.1 Cámara en Flutter Web

Riesgo:

Algunos navegadores o dispositivos pueden tener problemas con cámara o escaneo.

Mitigación:

- Usar HTTPS.
- Probar en Chrome Android.
- Probar en Safari iOS.
- Tener entrada manual.
- Tener búsqueda por nombre.

## 27.2 ERPNext consume recursos

Riesgo:

ERPNext puede consumir más recursos que FastAPI.

Mitigación:

- Usar Oracle Cloud Always Free con instancia Ampere A1.
- Empezar con pocos usuarios.
- Monitorear RAM/CPU.
- Separar FastAPI en otra VM si es necesario.

## 27.3 Integración con ERPNext

Riesgo:

Los DocTypes y flujos de ERPNext pueden requerir configuración cuidadosa.

Mitigación:

- Empezar con productos y ventas simples.
- Documentar endpoints usados.
- Crear datos de prueba.
- Mantener FastAPI como adaptador.

## 27.4 Facturación fiscal

Riesgo:

La facturación legal depende del país.

Mitigación:

- MVP genera ticket/factura interna.
- Dejar integración fiscal específica fuera del MVP.
- Evaluar requisitos legales por país más adelante.

## 27.5 Stock inconsistente

Riesgo:

Pueden ocurrir inconsistencias si se confirma una venta con stock desactualizado.

Mitigación:

- Validar stock al momento de confirmar.
- Usar ERPNext como fuente de verdad.
- Bloquear venta si no hay stock.
- No habilitar venta offline en MVP.

## 27.6 Dependencia de servicios gratuitos

Riesgo:

Los planes gratuitos pueden cambiar o tener límites.

Mitigación:

- Usar open source.
- Mantener capacidad de migrar.
- Documentar despliegue.
- Evitar lock-in fuerte.
- Tener backups.

---

## 28. Decisiones técnicas registradas

## 28.1 No usar RAG en el MVP

Motivo:

El MVP requiere datos estructurados, no recuperación de documentos.

## 28.2 Usar código de barras como identificación principal

Motivo:

Es más confiable que reconocimiento visual.

## 28.3 Usar IA/OCR solo después

Motivo:

El sistema base debe funcionar sin IA para ser estable.

## 28.4 Usar FastAPI como backend intermedio

Motivo:

Permite proteger ERPNext y construir API limpia para Flutter.

## 28.5 Usar ERPNext como fuente de verdad

Motivo:

Evita construir desde cero inventario, stock ledger, ventas y facturación.

## 28.6 Usar Flutter Web/PWA primero

Motivo:

Permite iniciar sin app stores y aprovechar experiencia existente.

## 28.7 Usar Oracle Cloud Always Free

Motivo:

Permite desplegar ERPNext y FastAPI sin costo inicial.

---

## 29. Preguntas abiertas

Estas preguntas deben responderse antes o durante el desarrollo:

1. ¿El sistema será para un negocio específico o producto SaaS para varios negocios?
2. ¿Se necesita multiempresa desde el inicio?
3. ¿Se necesita multisucursal?
4. ¿Qué país usará la facturación?
5. ¿Qué impuestos se deben calcular?
6. ¿Se requiere factura fiscal legal o solo ticket interno?
7. ¿Se usarán clientes registrados o venta anónima?
8. ¿Se necesita manejo de caja?
9. ¿Se necesita apertura y cierre de caja?
10. ¿Se necesita devolución de productos?
11. ¿Se necesita imprimir en impresora térmica?
12. ¿Se manejarán productos con lote/vencimiento?
13. ¿Se manejarán productos por peso?
14. ¿Se venderá con lector físico o solo cámara?
15. ¿Cuántos usuarios simultáneos se esperan?
16. ¿El negocio necesita funcionar sin internet?
17. ¿Cuál será la moneda principal?
18. ¿Se manejarán múltiples monedas?
19. ¿Se necesita soporte para proveedores?
20. ¿Se necesita app móvil nativa después?

---

## 30. Próximos pasos recomendados

### Paso 1

Crear repositorio monorepo.

```text
smart-inventory-pos/
├── frontend/
├── backend/
├── infra/
└── docs/
```

### Paso 2

Instalar ERPNext en ambiente local o Oracle Cloud.

### Paso 3

Crear productos de prueba en ERPNext.

Ejemplo:

- Coca-Cola 600ml
- Harina PAN 1kg
- Shampoo 400ml
- Arroz 1kg

### Paso 4

Crear FastAPI con endpoints base.

Primero:

```text
GET /health
GET /health/erpnext
GET /products/barcode/{barcode}
```

### Paso 5

Crear Flutter Web con pantalla simple.

Primero:

- campo manual de código
- botón buscar
- mostrar producto
- carrito simple

### Paso 6

Agregar escáner con cámara.

### Paso 7

Crear flujo de venta.

### Paso 8

Desplegar frontend, backend y ERPNext.

---

## 31. Definición de MVP final

El MVP final será una PWA construida con Flutter Web que permita a un usuario autenticado vender productos mediante escaneo de código de barras. El frontend se comunicará con FastAPI, y FastAPI consultará ERPNext para obtener productos, precios, stock y crear facturas. ERPNext será la fuente central de inventario, ventas y facturación.

El sistema deberá permitir:

```text
Login
→ Escanear producto
→ Mostrar producto
→ Agregar al carrito
→ Confirmar venta
→ Crear factura
→ Descontar inventario
→ Mostrar comprobante
```

No incluirá inicialmente OCR, reconocimiento visual ni RAG, pero la arquitectura quedará preparada para agregarlos en futuras fases.

---

## 32. Resumen ejecutivo

Smart Inventory POS será un sistema de inventario y ventas con enfoque práctico: primero resolverá el flujo real de caja e inventario usando código de barras, FastAPI, Flutter Web y ERPNext. La IA se incorporará después como una capa adicional para mejorar el registro y reconocimiento de productos, pero no será la base del sistema.

La estrategia correcta es construir primero un sistema confiable, auditable y barato de operar. Luego se agregarán funciones inteligentes como OCR, reconocimiento visual, predicción de inventario y asistentes internos.

La primera meta no es construir un sistema futurista, sino un sistema que pueda vender, facturar y descontar inventario correctamente desde el primer MVP.
